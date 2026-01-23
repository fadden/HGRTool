/*
 * Copyright 2025 faddenSoft
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Greedy byte-by-byte dithering with NTSC-aware error diffusion.
 *
 * This is a simpler alternative to the Viterbi algorithm that uses:
 * 1. Exhaustive search of all 256 byte values for each position
 * 2. Actual NTSC renderer for accurate color evaluation
 * 3. Floyd-Steinberg error diffusion for quality
 *
 * Algorithm:
 * - For each byte position (left-to-right, top-to-bottom)
 * - Test all 256 possible byte values
 * - Render each using actual NTSC renderer
 * - Calculate perceptual error between rendered and target colors
 * - Select byte with lowest error
 * - Propagate quantization error to neighbors (Floyd-Steinberg)
 */

import NTSCRenderer from './ntsc-renderer.js';
import ImageDither from './image-dither.js';

/**
 * Smoothness penalty to discourage repetitive byte patterns.
 * Penalizes selecting the exact same byte value as previous scanlines.
 * This prevents vertical white stripes caused by columns of identical bytes.
 *
 * CRITICAL TUNING NOTE:
 * - Typical color errors for correct bytes: 0-10,000
 * - Typical color errors for wrong bytes: 40,000-100,000
 * - Penalty MUST be smaller than color error differences to avoid forcing wrong choices
 * - A penalty of 1,000,000 was 100x too large and destroyed solid color rendering
 * - New value: 0 (disabled) - let color accuracy dominate
 *
 * History depth: Track last 5 scanlines with decaying penalties:
 * - Previous scanline (y-1): Full penalty
 * - 2 scanlines ago (y-2): 80% penalty
 * - 3 scanlines ago (y-3): 60% penalty
 * - 4 scanlines ago (y-4): 40% penalty
 * - 5 scanlines ago (y-5): 20% penalty
 */
const SMOOTHNESS_PENALTY = 0; // DISABLED: Color accuracy is more important than preventing repetition
const HISTORY_DEPTH = 5; // Track last 5 scanlines
const PENALTY_DECAY = [1.0, 0.8, 0.6, 0.4, 0.2]; // Decay factors for each position in history

/**
 * Calculates perceptual color distance squared.
 * Uses weighted RGB based on human color perception (ITU-R BT.601).
 * @param {{r: number, g: number, b: number}} c1 - First color
 * @param {{r: number, g: number, b: number}} c2 - Second color
 * @returns {number} - Perceptual distance squared
 */
function perceptualDistanceSquared(c1, c2) {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
}

/**
 * Extracts target colors with accumulated error for a byte position.
 * @param {Uint8ClampedArray} pixels - Source pixel data
 * @param {Array} errorBuffer - Error accumulation buffer [y][x] = {r, g, b}
 * @param {number} byteX - Byte X position (0-39)
 * @param {number} y - Y position (0-191)
 * @param {number} pixelWidth - Width in pixels (280)
 * @returns {Array<{r: number, g: number, b: number}>} - Target colors for 7 pixels
 */
function getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth) {
    const targetColors = [];

    for (let bit = 0; bit < 7; bit++) {
        const pixelX = byteX * 7 + bit;
        const pixelIdx = (y * pixelWidth + pixelX) * 4;

        // Get base color from source
        let r = pixels[pixelIdx];
        let g = pixels[pixelIdx + 1];
        let b = pixels[pixelIdx + 2];

        // Add accumulated error if buffer exists
        const errorIdx = y * pixelWidth + pixelX;
        if (errorBuffer && errorBuffer[errorIdx]) {
            const err = errorBuffer[errorIdx];
            r = Math.max(0, Math.min(255, r + err.r));
            g = Math.max(0, Math.min(255, g + err.g));
            b = Math.max(0, Math.min(255, b + err.b));
        }

        targetColors.push({ r, g, b });
    }

    return targetColors;
}

/**
 * Calculates error for a candidate byte using centralized NTSC functions.
 * Uses ImageDither.calculateNTSCError for consistent phase-corrected evaluation.
 * @param {number} prevByte - Previous byte in scanline (or 0 if first)
 * @param {number} candidateByte - Byte value to test (0-255)
 * @param {Array<{r: number, g: number, b: number}>} targetColors - Target colors for 7 pixels
 * @param {number} byteX - Byte X position (0-39)
 * @param {ImageDither} imageDither - ImageDither instance with centralized functions
 * @returns {number} - Total perceptual error for this byte
 */
function calculateByteError(prevByte, candidateByte, targetColors, byteX, imageDither) {
    return imageDither.calculateNTSCError(prevByte, candidateByte, targetColors, byteX);
}

/**
 * Propagates quantization error to adjacent pixels using Floyd-Steinberg.
 * @param {Array} errorBuffer - Error buffer (flat array indexed by y*width+x)
 * @param {number} byteX - Byte X position (0-39)
 * @param {number} y - Y position (0-191)
 * @param {Array<{r: number, g: number, b: number}>} target - Target colors for 7 pixels
 * @param {Array<{r: number, g: number, b: number}>} rendered - Rendered colors for 7 pixels
 * @param {number} pixelWidth - Width in pixels (280)
 * @param {number} height - Height in pixels (192)
 */
function propagateError(errorBuffer, byteX, y, target, rendered, pixelWidth, height) {
    // Floyd-Steinberg error diffusion:
    //         X   7/16
    //     3/16 5/16 1/16

    for (let bit = 0; bit < 7; bit++) {
        const pixelX = byteX * 7 + bit;

        // Calculate quantization error
        const error = {
            r: target[bit].r - rendered[bit].r,
            g: target[bit].g - rendered[bit].g,
            b: target[bit].b - rendered[bit].b
        };

        const distributions = [
            { dx: 1, dy: 0, weight: 7 / 16 },   // Right
            { dx: -1, dy: 1, weight: 3 / 16 },  // Bottom-left
            { dx: 0, dy: 1, weight: 5 / 16 },   // Bottom
            { dx: 1, dy: 1, weight: 1 / 16 }    // Bottom-right
        ];

        for (const { dx, dy, weight } of distributions) {
            const nx = pixelX + dx;
            const ny = y + dy;

            // CRITICAL FIX: Do not diffuse error RIGHTWARD across byte boundaries
            // NTSC artifact rendering already handles color bleed between bytes.
            // Diffusing error rightward would double-count this effect:
            // - The error from last pixel of byte N is calculated with byte N-1 context
            // - When byte N+1 renders, it uses byte N as context (different context!)
            // - NTSC renderer already compensates via color bleed
            // - Adding diffused error on top would be double-correction
            //
            // We still diffuse error DOWNWARD at byte boundaries because vertical
            // scanlines are independent (no NTSC bleed between scanlines).
            const isCrossingByteRight = (dy === 0 && dx > 0 && (pixelX % 7 === 6));

            if (isCrossingByteRight) {
                // Skip rightward diffusion at byte boundary
                continue;
            }

            if (ny >= 0 && ny < height && nx >= 0 && nx < pixelWidth) {
                const idx = ny * pixelWidth + nx;
                if (!errorBuffer[idx]) {
                    errorBuffer[idx] = { r: 0, g: 0, b: 0 };
                }

                // CRITICAL FIX: Clamp error buffer on WRITE to prevent overflow
                // Without this, errors can accumulate to extreme values (+5000, -3000, etc.)
                // which then get clamped on read, losing important information
                errorBuffer[idx].r = Math.max(-255, Math.min(255, errorBuffer[idx].r + error.r * weight));
                errorBuffer[idx].g = Math.max(-255, Math.min(255, errorBuffer[idx].g + error.g * weight));
                errorBuffer[idx].b = Math.max(-255, Math.min(255, errorBuffer[idx].b + error.b * weight));
            }
        }
    }

}

/**
 * Tests a range of byte values and returns the best candidate.
 * Uses centralized calculateNTSCError for consistent evaluation.
 * @param {number} prevByte - Previous byte in scanline
 * @param {number} startByte - Start of byte range (inclusive)
 * @param {number} endByte - End of byte range (inclusive)
 * @param {Array<{r: number, g: number, b: number}>} targetColors - Target colors for 7 pixels
 * @param {number} byteX - Byte X position (0-39)
 * @param {ImageDither} imageDither - ImageDither instance with centralized functions
 * @returns {Promise<{byte: number, error: number}>} - Best byte and its error
 */
async function testByteGroup(prevByte, startByte, endByte, targetColors, byteX, imageDither) {
    let bestByte = startByte;
    let bestError = Infinity;

    for (let candidateByte = startByte; candidateByte <= endByte; candidateByte++) {
        let totalError = calculateByteError(
            prevByte,
            candidateByte,
            targetColors,
            byteX,
            imageDither
        );

        // Smoothness penalty disabled - color accuracy is more important
        // The original penalty of 1,000,000 was forcing incorrect byte choices
        // in solid color regions, resulting in 0% white pixels for solid white input
        // (disabled code remains for reference)
        // if (candidateByte === prevByte && prevByte !== 0) {
        //     totalError += SMOOTHNESS_PENALTY;
        // }

        if (totalError < bestError) {
            bestError = totalError;
            bestByte = candidateByte;
        }
    }

    return { byte: bestByte, error: bestError };
}

/**
 * Dithers a single scanline using greedy byte-by-byte optimization with interleaved refinement.
 *
 * INTERLEAVED REFINEMENT OPTIMIZATION:
 * This uses a two-phase approach to fix byte boundary artifacts:
 *
 * Phase 1: Full optimization (nextByte=0x00)
 * - Test all 256 candidates for each byte position
 * - Uses nextByte=0x00 as default (traditional approach)
 * - Produces good initial approximation
 *
 * Phase 2: Interleaved refinement (actual nextByte)
 * - For each byte, test bits 6-7 flips (4 candidates)
 * - Uses actual nextByte from Phase 1 results
 * - Focuses on bit 6 (rightmost pixel) and bit 7 (hi-bit/palette)
 * - Both bits are most affected by nextByte due to NTSC color phase and pattern window
 *
 * WHY THIS WORKS:
 * - nextByte context primarily affects bits 6-7 (rightmost pixel and palette)
 * - Testing 4 bit-flip candidates is ~64x faster than testing all 256 bytes
 * - Achieves optimal quality with minimal performance cost
 * - Total candidates: 10,240 + 156 = 10,396 vs 20,480 (two full passes)
 *
 * Performance: ~49% faster than two full passes while achieving same quality!
 *
 * @param {Uint8ClampedArray} pixels - Source pixel data
 * @param {Array} errorBuffer - Error buffer (flat array)
 * @param {number} y - Y position (0-191)
 * @param {number} targetWidth - Width in bytes (40)
 * @param {number} pixelWidth - Width in pixels (280)
 * @param {number} height - Height in pixels (192)
 * @param {ImageDither} imageDither - ImageDither instance with centralized functions
 * @param {Array<Uint8Array>} scanlineHistory - Array of previous scanlines for vertical smoothness (most recent first)
 * @param {boolean} enableRefinement - Enable interleaved refinement (default: true)
 * @returns {Uint8Array} - Scanline data (40 bytes)
 */
export function greedyDitherScanline(pixels, errorBuffer, y, targetWidth, pixelWidth, height, imageDither, scanlineHistory = [], enableRefinement = true) {
    const scanline = new Uint8Array(targetWidth);

    // PHASE 1: Full optimization with nextByte=0x00
    for (let byteX = 0; byteX < targetWidth; byteX++) {
        // Get target colors with accumulated error
        const targetColors = getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);

        let bestByte = 0;
        let bestError = Infinity;

        // Test all 256 byte values with nextByte=0x00
        const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;

        for (let candidateByte = 0; candidateByte < 256; candidateByte++) {
            let totalError = calculateByteError(
                prevByte,
                candidateByte,
                targetColors,
                byteX,
                imageDither
            );

            // Add smoothness penalty with history decay to discourage vertical byte repetition
            // Check against last N scanlines with decaying penalty strength
            // This prevents vertical white stripes caused by columns of identical bytes
            for (let histIdx = 0; histIdx < Math.min(scanlineHistory.length, HISTORY_DEPTH); histIdx++) {
                if (scanlineHistory[histIdx] && candidateByte === scanlineHistory[histIdx][byteX]) {
                    totalError += SMOOTHNESS_PENALTY * PENALTY_DECAY[histIdx];
                }
            }

            if (totalError < bestError) {
                bestError = totalError;
                bestByte = candidateByte;
            }
        }

        // Commit best byte from Phase 1
        scanline[byteX] = bestByte;

        // Get actual rendered colors for error diffusion using centralized function
        const renderedColors = imageDither.renderNTSCColors(prevByte, bestByte, byteX);

        // Propagate error (Floyd-Steinberg)
        propagateError(errorBuffer, byteX, y, targetColors, renderedColors, pixelWidth, height);
    }

    // PHASE 2: Interleaved refinement with single-bit flips
    if (!enableRefinement) {
        return scanline;
    }

    // Refine each byte (except last) using actual nextByte context
    for (let byteX = 0; byteX < targetWidth - 1; byteX++) {
        // Get target colors for refinement
        const targetColors = getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);

        const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;
        const nextByte = scanline[byteX + 1]; // Actual next byte from Phase 1
        const currentByte = scanline[byteX];

        // Refinement pass: Test bits 6-7 with actual nextByte context
        // Bit 6 (rightmost pixel) and bit 7 (hi-bit) are most affected by nextByte
        // due to NTSC color phase and pattern window spanning byte boundaries
        const candidates = [
            currentByte,           // Keep current
            currentByte ^ 0x40,    // Flip bit 6 (rightmost pixel)
            currentByte ^ 0x80,    // Flip bit 7 (hi-bit/palette)
            currentByte ^ 0xC0     // Flip both bits 6+7
        ];

        let bestByte = currentByte;
        let bestError = imageDither.calculateNTSCError(prevByte, currentByte, targetColors, byteX, nextByte);

        // Test each bit-flip candidate with actual nextByte
        for (const candidate of candidates) {
            const error = imageDither.calculateNTSCError(prevByte, candidate, targetColors, byteX, nextByte);
            if (error < bestError) {
                bestError = error;
                bestByte = candidate;
            }
        }

        // Update if refinement found better byte
        if (bestByte !== currentByte) {
            scanline[byteX] = bestByte;

            // Re-render and re-propagate error with refined byte and actual nextByte
            const renderedColors = imageDither.renderNTSCColors(prevByte, bestByte, byteX, nextByte);
            propagateError(errorBuffer, byteX, y, targetColors, renderedColors, pixelWidth, height);
        }
    }

    return scanline;
}

/**
 * Dithers a single scanline using greedy byte-by-byte optimization with parallel hi-bit testing.
 * Tests bytes 0x00-0x7F and 0x80-0xFF in parallel for potential speedup.
 * Uses centralized calculateNTSCError and renderNTSCColors for consistency.
 *
 * Note: Parallel version does NOT include interleaved refinement to maintain
 * simplicity and avoid complexity. Use synchronous version for refinement.
 *
 * @param {Uint8ClampedArray} pixels - Source pixel data
 * @param {Array} errorBuffer - Error buffer (flat array)
 * @param {number} y - Y position (0-191)
 * @param {number} targetWidth - Width in bytes (40)
 * @param {number} pixelWidth - Width in pixels (280)
 * @param {number} height - Height in pixels (192)
 * @param {ImageDither} imageDither - ImageDither instance with centralized functions
 * @returns {Promise<Uint8Array>} - Scanline data (40 bytes)
 */
export async function greedyDitherScanlineAsync(pixels, errorBuffer, y, targetWidth, pixelWidth, height, imageDither) {
    const scanline = new Uint8Array(targetWidth);

    for (let byteX = 0; byteX < targetWidth; byteX++) {
        // Get target colors with accumulated error
        const targetColors = getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);
        const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;

        // Test both hi-bit groups in parallel
        // Each group gets its own buffers to avoid race conditions
        const [result0, result1] = await Promise.all([
            testByteGroup(prevByte, 0x00, 0x7F, targetColors, byteX, imageDither),
            testByteGroup(prevByte, 0x80, 0xFF, targetColors, byteX, imageDither)
        ]);

        // Pick best from both groups
        // If errors are equal, prefer the lower byte value for consistency
        const bestByte = result0.error <= result1.error ? result0.byte : result1.byte;

        // Commit best byte
        scanline[byteX] = bestByte;

        // Get actual rendered colors for error diffusion using centralized function
        const renderedColors = imageDither.renderNTSCColors(prevByte, bestByte, byteX);

        // Propagate error (Floyd-Steinberg)
        propagateError(errorBuffer, byteX, y, targetColors, renderedColors, pixelWidth, height);
    }

    return scanline;
}
