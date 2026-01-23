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
 * Image dithering engine for converting regular images to Apple II HGR/DHGR format.
 *
 * Uses Floyd-Steinberg error diffusion dithering to achieve the best possible
 * conversion quality while respecting HGR's unique color constraints and artifacts.
 *
 * Based on the implementation from The 8-Bit Bunch's Outlaw Editor, which was
 * originally adapted from literateprograms.org (MIT License).
 */

import Debug from "./debug.js";
import NTSCRenderer from "./ntsc-renderer.js";
import { CANONICAL_PATTERNS } from "./hgr-patterns.js";
import { viterbiFullScanline } from "./viterbi-scanline.js";
import { greedyDitherScanline, greedyDitherScanlineAsync } from "./greedy-dither.js";
import { viterbiByteDither } from "./viterbi-byte-dither.js";
import { nearestNeighborDitherScanline } from "./nearest-neighbor-dither.js";
import { secondPassDitherScanline } from "./nearest-neighbor-second-pass.js";
import { generateStructureHints } from "./structure-hints.js";

//
// Dithering engine for image-to-HGR conversion.
//
export default class ImageDither {
    // Floyd-Steinberg dithering coefficients
    // Standard pattern:
    //         X   7
    //     3   5   1    (divided by 16)
    static FLOYD_STEINBERG = [
        [0, 0, 7],
        [3, 5, 1]
    ];

    // Alternative: Jarvis-Judice-Ninke (better quality, slower)
    static JARVIS_JUDICE_NINKE = [
        [0, 0, 7, 5],
        [3, 5, 7, 5, 3],
        [1, 3, 5, 3, 1]
    ];

    // Atkinson dithering (used by MacPaint)
    static ATKINSON = [
        [0, 0, 1, 1],
        [1, 1, 1, 0],
        [0, 1, 0, 0]
    ];

    constructor() {
        this.coefficients = ImageDither.FLOYD_STEINBERG;
        this.divisor = 16;
        this.ntscRenderer = new NTSCRenderer();
        this.canonicalPatterns = CANONICAL_PATTERNS;
    }

    /**
     * Unpacks a packed RGB value from NTSC renderer.
     * NTSC renderer packs colors as: (r << 16) | (g << 8) | b
     * @param {number} packed - Packed RGB value
     * @returns {{r: number, g: number, b: number}} - RGB components
     */
    unpackRGB(packed) {
        return {
            r: (packed >> 16) & 0xFF,
            g: (packed >> 8) & 0xFF,
            b: packed & 0xFF
        };
    }

    /**
     * Convert RGB to YIQ color space (NTSC native color space).
     * @param {{r, g, b}} rgb - RGB color (0-255 range)
     * @returns {{y, i, q}} - YIQ color (all in 0-1 range)
     */
    rgbToYiq(rgb) {
        const r = rgb.r / 255;
        const g = rgb.g / 255;
        const b = rgb.b / 255;

        // NTSC YIQ transformation matrix
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const i = 0.596 * r - 0.275 * g - 0.321 * b;
        const q = 0.212 * r - 0.523 * g + 0.311 * b;

        return { y, i, q };
    }

    /**
     * Calculates perceptual color distance using YIQ color space.
     * YIQ is the native NTSC color space, so comparing in YIQ gives
     * more accurate error measurement for NTSC artifact colors.
     * @param {{r, g, b}} c1 - First color
     * @param {{r, g, b}} c2 - Second color
     * @returns {number} - Perceptual distance
     */
    perceptualDistance(c1, c2) {
        const yiq1 = this.rgbToYiq(c1);
        const yiq2 = this.rgbToYiq(c2);

        const dy = yiq1.y - yiq2.y;
        const di = yiq1.i - yiq2.i;
        const dq = yiq1.q - yiq2.q;

        // Equal weighting in YIQ space - let NTSC color space do the work
        return Math.sqrt(dy * dy + di * di + dq * dq);
    }

    /**
     * Calculates NTSC-aware error for a byte candidate.
     * Renders the byte through NTSC simulation and compares to target colors.
     * @param {number} prevByte - Previous byte in scanline
     * @param {number} currByte - Current byte candidate
     * @param {Array<{r, g, b}>} targetColors - Target colors for 7 pixels
     * @param {number} xPos - Byte position in scanline (0-39)
     * @param {number} nextByte - Next byte in scanline (optional, defaults to 0)
     * @returns {number} - Total error for this byte
     */
    calculateNTSCError(prevByte, currByte, targetColors, xPos, nextByte = 0) {
        // Use existing hgrToDhgr lookup to get expanded bit pattern
        const dhgrBits = NTSCRenderer.hgrToDhgr[prevByte][currByte];
        const dhgrBitsNext = NTSCRenderer.hgrToDhgr[currByte][nextByte];

        let totalError = 0;

        // CRITICAL FIX: The hgrToDhgr table produces a 28-bit word containing:
        // - Bits 0-13: Previous byte's 7 HGR bits expanded to 14 DHGR bits
        // - Bits 14-27: Current byte's 7 HGR bits expanded to 14 DHGR bits
        //
        // We need to extract patterns from the CURRENT byte's region (bits 14-27),
        // not from the start of the word (bits 0-13).
        //
        // Each HGR pixel position needs a 7-bit DHGR pattern for NTSC color lookup.
        // The pattern window slides across the current byte's DHGR bits.
        //
        // BYTE BOUNDARY FIX: The last pixel (bitPos=6) needs bits from the NEXT byte
        // to correctly extract the 7-bit pattern, otherwise phase calculation is wrong.

        // Evaluate each of the 7 pixels in this byte
        for (let bitPos = 0; bitPos < 7; bitPos++) {
            // Calculate starting position in DHGR bits for this pixel
            // Current byte starts at DHGR bit 14, each HGR bit → 2 DHGR bits
            const dhgrStartBit = 14 + (bitPos * 2);

            // Extract 7-bit pattern for NTSC lookup
            // Need to include context from previous bits for proper color rendering
            let pattern;
            if (bitPos === 0) {
                // First pixel: extract pattern spanning previous and current byte
                // We need bits 12-13 from previous byte region and bits 14-18 from current byte region
                const bitsFromPrev = (dhgrBits >> 12) & 0x03;     // 2 bits (12-13) from prevByte region
                const bitsFromCurrent = (dhgrBits >> 14) & 0x1F;  // 5 bits (14-18) from currByte region
                pattern = (bitsFromPrev | (bitsFromCurrent << 2)) & 0x7F;
            } else if (bitPos === 6) {
                // Last pixel: extract pattern spanning current and next byte
                // We need bits 23-27 from current byte and bits 0-1 from next byte
                const bitsFromCurrent = (dhgrBits >> 23) & 0x1F; // 5 bits (23-27)
                const bitsFromNext = dhgrBitsNext & 0x03; // 2 bits (0-1)
                pattern = (bitsFromCurrent | (bitsFromNext << 5)) & 0x7F;
            } else {
                // Normal extraction within current byte
                pattern = (dhgrBits >> (dhgrStartBit - 3)) & 0x7F;
            }

            // Phase calculation: NTSC repeats every 4 DHGR pixels
            // Each HGR pixel = 2 DHGR pixels, so phase = (hgrPixel * 2) % 4
            // Subtract 1 to align with NTSC renderer phase
            const pixelX = xPos * 7 + bitPos;
            const phase = ((pixelX * 2) + 3) % 4;  // +3 mod 4 = -1

            // Get actual NTSC-rendered color from pre-computed palette
            const ntscColor = NTSCRenderer.solidPalette[phase][pattern];
            const rendered = this.unpackRGB(ntscColor);

            // Calculate perceptual distance to target
            const target = targetColors[bitPos];
            totalError += this.perceptualDistance(rendered, target);
        }

        return totalError;
    }

    /**
     * Finds the best byte pattern using exhaustive search of key candidates.
     *
     * CRITICAL FIX FOR WHITE RENDERING BUG:
     *
     * The original greedy bit-by-bit optimization failed catastrophically for white
     * colors, producing 0x00 (black) instead of 0x7F/0xFF (white).
     *
     * ROOT CAUSE: NTSC color generation depends on BIT PATTERNS, not individual bits.
     * Greedy optimization fails because:
     * 1. Start with 0x00 or 0x7F
     * 2. Flip one bit at a time
     * 3. Each flip is evaluated in isolation
     * 4. NTSC rendering changes drastically based on surrounding bits
     * 5. Greedy algorithm gets stuck in local minima
     *
     * SOLUTION: Exhaustive search of 256 byte combinations.
     *
     * Performance: 256 error calculations per byte = ~10,000 per scanline.
     * This is acceptable for the accuracy gain. Modern CPUs can handle this easily.
     *
     * Alternative considered: Multi-start greedy still failed because greedy
     * optimization would turn OFF bits from 0x7F, arriving at 0x03 (mostly black).
     *
     * @param {number} prevByte - Previous byte in scanline
     * @param {Array<{r, g, b}>} targetColors - Target colors for 7 pixels
     * @param {number} xPos - Byte position in scanline (0-39)
     * @param {number} nextByte - Next byte in scanline (optional, defaults to 0x00)
     * @returns {number} - Best byte value (0-255)
     */
    findBestBytePattern(prevByte, targetColors, xPos, nextByte = 0x00) {
        let bestByte = 0;
        let leastError = Infinity;

        // Exhaustive search: test all 256 possible bytes
        // This is the ONLY way to guarantee finding the global optimum
        // because NTSC bit patterns are highly interdependent
        for (let byte = 0; byte < 256; byte++) {
            const error = this.calculateNTSCError(prevByte, byte, targetColors, xPos, nextByte);
            if (error < leastError) {
                leastError = error;
                bestByte = byte;
            }
        }

        return bestByte;
    }

    /**
     * Renders a byte through NTSC to get actual displayed colors.
     * Uses the same pattern extraction logic as calculateNTSCError to ensure consistency.
     * @param {number} prevByte - Previous byte in scanline
     * @param {number} currByte - Current byte
     * @param {number} xPos - Byte position in scanline (0-39)
     * @param {number} nextByte - Next byte in scanline (optional, defaults to 0)
     * @returns {Array<{r, g, b}>} - Rendered colors for 7 pixels
     */
    renderNTSCColors(prevByte, currByte, xPos, nextByte = 0) {
        const dhgrBits = NTSCRenderer.hgrToDhgr[prevByte][currByte];
        const dhgrBitsNext = NTSCRenderer.hgrToDhgr[currByte][nextByte];
        const colors = [];

        for (let bitPos = 0; bitPos < 7; bitPos++) {
            // Same logic as calculateNTSCError: extract from current byte region
            const dhgrStartBit = 14 + (bitPos * 2);

            // For the first and last pixels, we need bits from adjacent bytes
            let pattern;
            if (bitPos === 0) {
                // First pixel: extract pattern spanning previous and current byte
                // We need bits 12-13 from previous byte region and bits 14-18 from current byte region
                const bitsFromPrev = (dhgrBits >> 12) & 0x03;     // 2 bits (12-13) from prevByte region
                const bitsFromCurrent = (dhgrBits >> 14) & 0x1F;  // 5 bits (14-18) from currByte region
                pattern = (bitsFromPrev | (bitsFromCurrent << 2)) & 0x7F;
            } else if (bitPos === 6) {
                // Last pixel: extract pattern spanning current and next byte
                // We need bits 23-27 from current byte and bits 0-1 from next byte
                const bitsFromCurrent = (dhgrBits >> 23) & 0x1F; // 5 bits (23-27)
                const bitsFromNext = dhgrBitsNext & 0x03; // 2 bits (0-1)
                pattern = (bitsFromCurrent | (bitsFromNext << 5)) & 0x7F;
            } else {
                // Normal extraction within current byte
                pattern = (dhgrBits >> (dhgrStartBit - 3)) & 0x7F;
            }

            // Phase calculation: NTSC repeats every 4 DHGR pixels
            // Each HGR pixel = 2 DHGR pixels, so phase = (hgrPixel * 2) % 4
            // Subtract 1 to align with NTSC renderer phase
            const pixelX = xPos * 7 + bitPos;
            const phase = ((pixelX * 2) + 3) % 4;  // +3 mod 4 = -1

            const ntscColor = NTSCRenderer.solidPalette[phase][pattern];
            colors.push(this.unpackRGB(ntscColor));
        }

        return colors;
    }

    /**
     * Extracts target colors with accumulated error for a byte position.
     * @param {Uint8ClampedArray} pixels - Source pixel data
     * @param {Array} errorBuffer - Error accumulation buffer
     * @param {number} byteX - Byte X position (0-39)
     * @param {number} y - Y position (0-191)
     * @param {number} pixelWidth - Width in pixels (280)
     * @returns {Array<{r, g, b}>} - Target colors for 7 pixels
     */
    getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth) {
        const targetColors = [];

        for (let bit = 0; bit < 7; bit++) {
            const pixelX = byteX * 7 + bit;
            const pixelIdx = (y * pixelWidth + pixelX) * 4;

            // Get base color from source
            let r = pixels[pixelIdx];
            let g = pixels[pixelIdx + 1];
            let b = pixels[pixelIdx + 2];

            // Add accumulated error if buffer exists
            if (errorBuffer && errorBuffer[y] && errorBuffer[y][pixelX]) {
                const err = errorBuffer[y][pixelX];
                r = Math.max(0, Math.min(255, r + err[0]));
                g = Math.max(0, Math.min(255, g + err[1]));
                b = Math.max(0, Math.min(255, b + err[2]));
            }

            targetColors.push({ r, g, b });
        }

        return targetColors;
    }

    /**
     * Propagates quantization error to neighboring pixels (Floyd-Steinberg).
     * @param {Array} errorBuffer - Error accumulation buffer [y][x] = [r, g, b]
     * @param {number} byteX - Byte X position (0-39)
     * @param {number} y - Y position (0-191)
     * @param {Array<{r, g, b}>} target - Target colors for 7 pixels
     * @param {Array<{r, g, b}>} rendered - Rendered colors for 7 pixels
     * @param {number} pixelWidth - Width in pixels (280)
     */
    propagateErrorToBuffer(errorBuffer, byteX, y, target, rendered, pixelWidth) {
        // Propagate error for each of the 7 pixels in this byte
        for (let bit = 0; bit < 7; bit++) {
            const pixelX = byteX * 7 + bit;

            // Calculate quantization error
            const errorR = target[bit].r - rendered[bit].r;
            const errorG = target[bit].g - rendered[bit].g;
            const errorB = target[bit].b - rendered[bit].b;

            // Floyd-Steinberg distribution:
            //         X   7/16
            //     3/16 5/16 1/16
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
                // NTSC artifact rendering already handles color bleed between bytes via
                // the sliding window. Diffusing error rightward would double-count:
                // - Error from last pixel of byte N is calculated with byte N-1 context
                // - When byte N+1 renders, it already uses byte N as context
                // - NTSC renderer compensates via color bleed in the sliding window
                // - Adding diffused error on top creates double-correction artifacts
                //
                // We still diffuse DOWNWARD at byte boundaries because vertical
                // scanlines are independent (no NTSC bleed between scanlines).
                const isCrossingByteRight = (dy === 0 && dx > 0 && (pixelX % 7 === 6));

                if (isCrossingByteRight) {
                    // Skip rightward diffusion at byte boundary
                    continue;
                }

                if (ny >= 0 && ny < errorBuffer.length && nx >= 0 && nx < pixelWidth) {
                    if (!errorBuffer[ny][nx]) {
                        errorBuffer[ny][nx] = [0, 0, 0];
                    }

                    errorBuffer[ny][nx][0] += errorR * weight;
                    errorBuffer[ny][nx][1] += errorG * weight;
                    errorBuffer[ny][nx][2] += errorB * weight;
                }
            }
        }
    }

    /**
     * Performs improved hybrid dithering for a single scanline with two-pass optimization.
     *
     * TWO-PASS ARCHITECTURE:
     * Pass 1: Sequential optimization with nextByte=0x00 (traditional approach)
     * Pass 2: Re-optimize using actual nextByte from Pass 1 results
     *
     * This fixes bit 6 (last pixel) byte boundary artifacts by using correct
     * nextByte context for NTSC pattern extraction and color rendering.
     *
     * @param {Uint8ClampedArray} pixels - Source pixel data
     * @param {Array} errorBuffer - Error accumulation buffer [y][x] = [r, g, b]
     * @param {number} y - Y position (0-191)
     * @param {number} targetWidth - Width in bytes (40)
     * @param {number} pixelWidth - Width in pixels (280)
     * @param {boolean} enableTwoPass - Enable two-pass optimization (default: false)
     * @returns {Uint8Array} - Scanline data (40 bytes)
     */
    ditherScanlineHybrid(pixels, errorBuffer, y, targetWidth, pixelWidth, enableTwoPass = false) {
        const scanline = new Uint8Array(targetWidth);

        // PASS 1: Sequential optimization (nextByte defaults to 0x00)
        for (let byteX = 0; byteX < targetWidth; byteX++) {
            // Get target colors with accumulated error
            const target = this.getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);

            // Find best byte using exhaustive search
            let prevByte, bestByte;

            if (byteX === 0) {
                // CRITICAL FIX: First byte of scanline - test both hi-bit palettes
                // to avoid palette selection bias. Test candidates from both contexts
                // but evaluate them with prevByte=0 (the actual scanline start context).
                const byte0 = this.findBestBytePattern(0x00, target, byteX);  // best from hi-bit 0 context
                const byte1 = this.findBestBytePattern(0x80, target, byteX);  // best from hi-bit 1 context

                // Evaluate both with prevByte=0 (actual context) for fair comparison
                const error0 = this.calculateNTSCError(0x00, byte0, target, byteX);
                const error1 = this.calculateNTSCError(0x00, byte1, target, byteX);

                bestByte = (error0 <= error1) ? byte0 : byte1;
            } else {
                prevByte = scanline[byteX - 1];
                bestByte = this.findBestBytePattern(prevByte, target, byteX);
            }

            scanline[byteX] = bestByte;

            // Render through NTSC to get actual colors
            const actualPrevByte = byteX > 0 ? scanline[byteX - 1] : 0;
            const rendered = this.renderNTSCColors(actualPrevByte, bestByte, byteX);

            // Propagate quantization error Floyd-Steinberg style
            this.propagateErrorToBuffer(errorBuffer, byteX, y, target, rendered, pixelWidth);
        }

        if (!enableTwoPass) {
            return scanline;
        }

        // EXPERIMENTAL: Two-pass optimization to fix bit 6 boundary artifacts.
        // Currently disabled by default due to instability with error diffusion.
        // Can be enabled with enableTwoPass=true for testing.
        //
        // PASS 2: Refinement with actual nextByte from Pass 1 results
        // Create fresh error buffer for Pass 2 to avoid error accumulation issues
        const pass2ErrorBuffer = new Array(errorBuffer.length);
        for (let i = 0; i < errorBuffer.length; i++) {
            if (errorBuffer[i]) {
                pass2ErrorBuffer[i] = new Array(errorBuffer[i].length);
                for (let j = 0; j < errorBuffer[i].length; j++) {
                    if (errorBuffer[i][j]) {
                        pass2ErrorBuffer[i][j] = [...errorBuffer[i][j]];
                    }
                }
            }
        }

        for (let byteX = 0; byteX < targetWidth; byteX++) {
            // Get target colors with accumulated error from Pass 2 buffer
            const target = this.getTargetWithError(pixels, pass2ErrorBuffer, byteX, y, pixelWidth);

            const prevByte = byteX > 0 ? scanline[byteX - 1] : 0x00;
            const nextByte = byteX < targetWidth - 1 ? scanline[byteX + 1] : 0x00;

            // Re-optimize with correct nextByte context
            let bestByte = scanline[byteX];
            let leastError = Infinity;

            for (let byte = 0; byte < 256; byte++) {
                const error = this.calculateNTSCError(prevByte, byte, target, byteX, nextByte);
                if (error < leastError) {
                    leastError = error;
                    bestByte = byte;
                }
            }

            // Update if refinement found better byte
            scanline[byteX] = bestByte;

            // Error propagation with Pass 2 context (uses actual nextByte)
            const rendered = this.renderNTSCColors(prevByte, bestByte, byteX, nextByte);
            this.propagateErrorToBuffer(pass2ErrorBuffer, byteX, y, target, rendered, pixelWidth);
        }

        // Commit Pass 2 error state back to main buffer
        for (let i = 0; i < errorBuffer.length; i++) {
            if (pass2ErrorBuffer[i]) {
                errorBuffer[i] = pass2ErrorBuffer[i];
            }
        }

        return scanline;
    }

    /**
     * Converts a standard image to HGR format with dithering.
     * @param {HTMLImageElement|ImageData} source - Source image
     * @param {number} targetWidth - Target width in bytes (40 for HGR)
     * @param {number} targetHeight - Target height (192 for HGR)
     * @param {string} algorithm - Dithering algorithm: "hybrid" (default), "threshold", "viterbi", "greedy", "viterbi-byte", "structure-aware"
     * @param {number} beamWidth - Beam width for Viterbi algorithms (default 4 for viterbi, 16 for viterbi-byte)
     * @returns {Uint8Array} HGR screen data
     */
    ditherToHgr(source, targetWidth, targetHeight, algorithm = "hybrid", beamWidth = 4) {
        // Create a canvas to work with the source image
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // HGR is 280x192, so scale the source image appropriately
        const pixelWidth = targetWidth * 7; // 7 pixels per byte
        canvas.width = pixelWidth;
        canvas.height = targetHeight;

        // CRITICAL: Always rescale source to exact HGR resolution (280×192) before dithering
        // This prevents noisy output from dithering high-resolution source images
        // Get pixel data - handle both HTMLImageElement and ImageData
        let pixels;
        if (source instanceof HTMLImageElement) {
            // Draw image scaled to exact HGR resolution with high-quality scaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(source, 0, 0, pixelWidth, targetHeight);
            const imageData = ctx.getImageData(0, 0, pixelWidth, targetHeight);
            pixels = imageData.data;
        } else if (source instanceof ImageData) {
            // OPTIMIZATION: If source is already exact target size, use it directly
            const isExactSize = (source.width === pixelWidth && source.height === targetHeight);
            if (isExactSize) {
                pixels = source.data;
            } else {
                // Need to rescale - use canvas operations
                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = source.width;
                tempCanvas.height = source.height;
                const tempCtx = tempCanvas.getContext("2d");
                tempCtx.putImageData(source, 0, 0);

                // Draw scaled to target canvas with high-quality scaling
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(tempCanvas, 0, 0, pixelWidth, targetHeight);
                const imageData = ctx.getImageData(0, 0, pixelWidth, targetHeight);
                pixels = imageData.data;
            }
        }

        // Create output HGR screen buffer
        const screen = new Uint8Array(targetWidth * targetHeight);

        // Choose dithering algorithm
        if (algorithm === "hybrid") {
            // Hybrid Error Diffusion + Local Viterbi (NTSC-aware)
            // Initialize error buffer
            const errorBuffer = new Array(targetHeight);
            for (let y = 0; y < targetHeight; y++) {
                errorBuffer[y] = new Array(pixelWidth);
                for (let x = 0; x < pixelWidth; x++) {
                    errorBuffer[y][x] = [0, 0, 0];
                }
            }

            // Process each scanline with hybrid dithering
            for (let y = 0; y < targetHeight; y++) {
                const scanline = this.ditherScanlineHybrid(pixels, errorBuffer, y, targetWidth, pixelWidth);
                screen.set(scanline, y * targetWidth);
            }

        } else if (algorithm === "threshold") {
            // Simple threshold dithering (fast, baseline)
            for (let y = 0; y < targetHeight; y++) {
                for (let byteX = 0; byteX < targetWidth; byteX++) {
                    let byte = 0;
                    let highBit = 0;

                    // Process 7 pixels for this byte
                    for (let bit = 0; bit < 7; bit++) {
                        const pixelX = byteX * 7 + bit;
                        const pixelIdx = (y * pixelWidth + pixelX) * 4;

                        // Convert to grayscale
                        const r = pixels[pixelIdx];
                        const g = pixels[pixelIdx + 1];
                        const b = pixels[pixelIdx + 2];
                        const gray = (r + g + b) / 3;

                        // Threshold: if brightness > 127, set bit
                        if (gray > 127) {
                            byte |= (1 << bit);
                        }
                    }

                    // Determine high bit based on byte value
                    // If most bits are set, use high bit
                    const bitCount = (byte.toString(2).match(/1/g) || []).length;
                    if (bitCount >= 4) {
                        highBit = 0x80;
                    }

                    screen[y * targetWidth + byteX] = byte | highBit;
                }
            }

        } else if (algorithm === "viterbi") {
            // Full Viterbi optimization with Floyd-Steinberg error diffusion
            // Initialize error buffer
            const errorBuffer = new Array(targetHeight);
            for (let y = 0; y < targetHeight; y++) {
                errorBuffer[y] = new Array(pixelWidth);
                for (let x = 0; x < pixelWidth; x++) {
                    errorBuffer[y][x] = [0, 0, 0];
                }
            }

            // PERFORMANCE: Create reusable buffers once for entire image
            // This reduces allocations from 192 per image to just 3 total
            const renderer = new NTSCRenderer();
            const imageData = new ImageData(560, 1);
            const hgrBytes = new Uint8Array(40);

            // Process each scanline with Viterbi optimization
            for (let y = 0; y < targetHeight; y++) {
                const scanline = viterbiFullScanline(
                    pixels,
                    errorBuffer,
                    y,
                    targetWidth,
                    pixelWidth,
                    beamWidth, // configurable beam width (default K=4)
                    this.getTargetWithError.bind(this), // Pass helper function
                    null, // no progress callback
                    this // pass ImageDither instance with centralized functions
                );
                screen.set(scanline, y * targetWidth);

                // Propagate error to next scanline (Floyd-Steinberg style)
                for (let byteX = 0; byteX < targetWidth; byteX++) {
                    const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;
                    const currByte = scanline[byteX];

                    // Get target colors and rendered colors
                    const target = this.getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);
                    const rendered = this.renderNTSCColors(prevByte, currByte, byteX);

                    // Propagate error
                    this.propagateErrorToBuffer(errorBuffer, byteX, y, target, rendered, pixelWidth);
                }
            }

        } else if (algorithm === "greedy") {
            // Greedy byte-by-byte optimization with NTSC rendering
            // Initialize error buffer (flat array for better performance)
            const errorBuffer = new Array(targetHeight * pixelWidth);

            // PERFORMANCE: Create reusable buffers once for entire image
            const renderer = new NTSCRenderer();
            const imageData = new ImageData(560, 1);
            const hgrBytes = new Uint8Array(40);

            // Process each scanline with greedy optimization
            // Maintain history of previous scanlines for vertical smoothness
            const scanlineHistory = [];
            const MAX_HISTORY = 5; // Keep last 5 scanlines
            for (let y = 0; y < targetHeight; y++) {
                const scanline = greedyDitherScanline(
                    pixels,
                    errorBuffer,
                    y,
                    targetWidth,
                    pixelWidth,
                    targetHeight,
                    this,
                    scanlineHistory
                );
                screen.set(scanline, y * targetWidth);

                // Add current scanline to history (most recent first)
                scanlineHistory.unshift(scanline);
                // Keep only last MAX_HISTORY scanlines
                if (scanlineHistory.length > MAX_HISTORY) {
                    scanlineHistory.pop();
                }
            }

        } else if (algorithm === "viterbi-byte") {
            // Hybrid Viterbi-per-byte with byte-level error diffusion
            // This algorithm addresses the sliding window artifact issue
            // Initialize error buffer (flat array for better performance)
            const errorBuffer = new Array(targetHeight * pixelWidth);

            // Process each scanline with Viterbi byte-level optimization
            for (let y = 0; y < targetHeight; y++) {
                const scanline = viterbiByteDither(
                    pixels,
                    errorBuffer,
                    y,
                    targetWidth,
                    pixelWidth,
                    targetHeight,
                    this,
                    beamWidth // Pass beam width parameter
                );
                screen.set(scanline, y * targetWidth);
            }

        } else if (algorithm === "nearest-neighbor") {
            // Nearest-neighbor quantization (no error diffusion)
            for (let y = 0; y < targetHeight; y++) {
                const scanline = nearestNeighborDitherScanline(
                    pixels,
                    y,
                    targetWidth,
                    pixelWidth,
                    this
                );
                screen.set(scanline, y * targetWidth);
            }

        } else if (algorithm === "two-pass") {
            // Two-pass: nearest-neighbor first, then error diffusion refinement
            const renderer = new NTSCRenderer();
            const imageData = new ImageData(560, 1);
            const hgrBytes = new Uint8Array(40);

            // First pass: nearest-neighbor (no error diffusion)
            const firstPass = new Uint8Array(targetWidth * targetHeight);
            for (let y = 0; y < targetHeight; y++) {
                const scanline = nearestNeighborDitherScanline(
                    pixels,
                    y,
                    targetWidth,
                    pixelWidth,
                    this
                );
                firstPass.set(scanline, y * targetWidth);
            }

            // Second pass: refine with error diffusion
            const errorBuffer = new Array(targetHeight * pixelWidth);
            for (let y = 0; y < targetHeight; y++) {
                const firstPassScanline = firstPass.slice(y * targetWidth, (y + 1) * targetWidth);
                const scanline = secondPassDitherScanline(
                    pixels,
                    errorBuffer,
                    y,
                    targetWidth,
                    pixelWidth,
                    targetHeight,
                    renderer,
                    imageData,
                    hgrBytes,
                    firstPassScanline
                );
                screen.set(scanline, y * targetWidth);
            }

        } else if (algorithm === "structure-aware") {
            // Structure-aware Viterbi optimization with structure hints
            // This algorithm uses image structure detection to reduce graininess
            // in smooth regions while preserving edge sharpness

            // Generate structure hints from source image
            const structureHints = generateStructureHints(pixels, pixelWidth, targetHeight);

            // Initialize error buffer
            const errorBuffer = new Array(targetHeight);
            for (let y = 0; y < targetHeight; y++) {
                errorBuffer[y] = new Array(pixelWidth);
                for (let x = 0; x < pixelWidth; x++) {
                    errorBuffer[y][x] = [0, 0, 0];
                }
            }

            // PERFORMANCE: Create reusable buffers once for entire image
            const renderer = new NTSCRenderer();
            const imageData = new ImageData(560, 1);
            const hgrBytes = new Uint8Array(40);

            // Process each scanline with structure-aware Viterbi optimization
            for (let y = 0; y < targetHeight; y++) {
                const scanline = viterbiFullScanline(
                    pixels,
                    errorBuffer,
                    y,
                    targetWidth,
                    pixelWidth,
                    beamWidth, // configurable beam width (default K=4)
                    this.getTargetWithError.bind(this),
                    null, // no progress callback
                    this, // pass ImageDither instance with centralized functions
                    structureHints // pass structure hints to Viterbi
                );
                screen.set(scanline, y * targetWidth);

                // Propagate error to next scanline (Floyd-Steinberg style)
                for (let byteX = 0; byteX < targetWidth; byteX++) {
                    const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;
                    const currByte = scanline[byteX];

                    const target = this.getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);
                    const rendered = this.renderNTSCColors(prevByte, currByte, byteX);

                    this.propagateErrorToBuffer(errorBuffer, byteX, y, target, rendered, pixelWidth);
                }
            }

        } else {
            throw new Error(`Unknown dithering algorithm: ${algorithm}`);
        }

        return screen;
    }

    /**
     * Async version of ditherToHgr that doesn't block the UI thread.
     * Yields to event loop every few scanlines to keep UI responsive.
     *
     * @param {HTMLImageElement|ImageData} source - Source image
     * @param {number} targetWidth - Target width in bytes (40 for HGR)
     * @param {number} targetHeight - Target height (192 for HGR)
     * @param {string} algorithm - Dithering algorithm: "hybrid" (default), "threshold", "viterbi", "greedy", "greedy-parallel", "viterbi-byte", "structure-aware"
     * @param {Function} progressCallback - Optional callback(completed, total) for progress updates
     * @param {number} beamWidth - Beam width for Viterbi algorithms (default 4)
     * @param {AbortSignal} signal - Optional AbortSignal for cancellation
     * @returns {Promise<Uint8Array>} - HGR screen data
     */
    async ditherToHgrAsync(source, targetWidth, targetHeight, algorithm = "hybrid", progressCallback = null, beamWidth = 4, signal = null) {
        // Create a canvas to work with the source image
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // HGR is 280x192, so scale the source image appropriately
        const pixelWidth = targetWidth * 7; // 7 pixels per byte
        canvas.width = pixelWidth;
        canvas.height = targetHeight;

        // CRITICAL: Always rescale source to exact HGR resolution (280×192) before dithering
        let pixels;
        if (source instanceof HTMLImageElement) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(source, 0, 0, pixelWidth, targetHeight);
            const imageData = ctx.getImageData(0, 0, pixelWidth, targetHeight);
            pixels = imageData.data;
        } else if (source instanceof ImageData) {
            const isExactSize = (source.width === pixelWidth && source.height === targetHeight);
            if (isExactSize) {
                pixels = source.data;
            } else {
                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = source.width;
                tempCanvas.height = source.height;
                const tempCtx = tempCanvas.getContext("2d");
                tempCtx.putImageData(source, 0, 0);

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(tempCanvas, 0, 0, pixelWidth, targetHeight);
                const imageData = ctx.getImageData(0, 0, pixelWidth, targetHeight);
                pixels = imageData.data;
            }
        }

        // Create output HGR screen buffer
        const screen = new Uint8Array(targetWidth * targetHeight);

        // Choose dithering algorithm - focus on Viterbi since that's the slow one
        if (algorithm === "viterbi") {
            // Full Viterbi optimization with Floyd-Steinberg error diffusion
            // Initialize error buffer
            const errorBuffer = new Array(targetHeight);
            for (let y = 0; y < targetHeight; y++) {
                errorBuffer[y] = new Array(pixelWidth);
                for (let x = 0; x < pixelWidth; x++) {
                    errorBuffer[y][x] = [0, 0, 0];
                }
            }

            // PERFORMANCE: Create reusable buffers once for entire image
            const renderer = new NTSCRenderer();
            const imageData = new ImageData(560, 1);
            const hgrBytes = new Uint8Array(40);

            // Process scanlines in batches to avoid blocking UI
            const BATCH_SIZE = 10; // Process 10 scanlines before yielding

            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                // Check for cancellation at batch boundary
                if (signal && signal.aborted) {
                    throw new DOMException('Dithering cancelled', 'AbortError');
                }

                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                // Process this batch of scanlines
                for (let y = batchStart; y < batchEnd; y++) {
                    const scanline = viterbiFullScanline(
                        pixels,
                        errorBuffer,
                        y,
                        targetWidth,
                        pixelWidth,
                        beamWidth, // configurable beam width (default K=4)
                        this.getTargetWithError.bind(this),
                        null, // no progress callback
                        this // pass ImageDither instance with centralized functions
                    );
                    screen.set(scanline, y * targetWidth);

                    // Propagate error to next scanline
                    for (let byteX = 0; byteX < targetWidth; byteX++) {
                        const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;
                        const currByte = scanline[byteX];

                        const target = this.getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);
                        const rendered = this.renderNTSCColors(prevByte, currByte, byteX);

                        this.propagateErrorToBuffer(errorBuffer, byteX, y, target, rendered, pixelWidth);
                    }
                }

                // Report progress if callback provided
                if (progressCallback) {
                    progressCallback(batchEnd, targetHeight);
                }

                // Yield to event loop to keep UI responsive
                // Only yield if there are more batches to process
                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else if (algorithm === "hybrid") {
            // Hybrid algorithm - also make it async
            const errorBuffer = new Array(targetHeight);
            for (let y = 0; y < targetHeight; y++) {
                errorBuffer[y] = new Array(pixelWidth);
                for (let x = 0; x < pixelWidth; x++) {
                    errorBuffer[y][x] = [0, 0, 0];
                }
            }

            const BATCH_SIZE = 20; // Hybrid is faster, use larger batches

            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                // Check for cancellation at batch boundary
                if (signal && signal.aborted) {
                    throw new DOMException('Dithering cancelled', 'AbortError');
                }

                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                for (let y = batchStart; y < batchEnd; y++) {
                    const scanline = this.ditherScanlineHybrid(pixels, errorBuffer, y, targetWidth, pixelWidth);
                    screen.set(scanline, y * targetWidth);
                }

                if (progressCallback) {
                    progressCallback(batchEnd, targetHeight);
                }

                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else if (algorithm === "threshold") {
            // Threshold is very fast, but still make it async for consistency
            const BATCH_SIZE = 40;

            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                for (let y = batchStart; y < batchEnd; y++) {
                    for (let byteX = 0; byteX < targetWidth; byteX++) {
                        let byte = 0;
                        let highBit = 0;

                        for (let bit = 0; bit < 7; bit++) {
                            const pixelX = byteX * 7 + bit;
                            const pixelIdx = (y * pixelWidth + pixelX) * 4;

                            const r = pixels[pixelIdx];
                            const g = pixels[pixelIdx + 1];
                            const b = pixels[pixelIdx + 2];
                            const gray = (r + g + b) / 3;

                            if (gray > 127) {
                                byte |= (1 << bit);
                            }
                        }

                        const bitCount = (byte.toString(2).match(/1/g) || []).length;
                        if (bitCount >= 4) {
                            highBit = 0x80;
                        }

                        screen[y * targetWidth + byteX] = byte | highBit;
                    }
                }

                if (progressCallback) {
                    progressCallback(batchEnd, targetHeight);
                }

                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else if (algorithm === "greedy") {
            // Greedy byte-by-byte optimization with NTSC rendering (async, sequential)
            const errorBuffer = new Array(targetHeight * pixelWidth);

            // PERFORMANCE: Create reusable buffers once for entire image
            const renderer = new NTSCRenderer();
            const imageData = new ImageData(560, 1);
            const hgrBytes = new Uint8Array(40);

            // Process scanlines in batches to avoid blocking UI
            const BATCH_SIZE = 10; // Greedy is slower, use smaller batches
            const scanlineHistory = [];
            const MAX_HISTORY = 5; // Keep last 5 scanlines

            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                // Check for cancellation at batch boundary
                if (signal && signal.aborted) {
                    throw new DOMException('Dithering cancelled', 'AbortError');
                }

                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                for (let y = batchStart; y < batchEnd; y++) {
                    const scanline = greedyDitherScanline(
                        pixels,
                        errorBuffer,
                        y,
                        targetWidth,
                        pixelWidth,
                        targetHeight,
                        this,
                        scanlineHistory
                    );
                    screen.set(scanline, y * targetWidth);

                    // Maintain rolling history of last N scanlines for vertical smoothness
                    scanlineHistory.unshift(scanline);  // Add to front
                    if (scanlineHistory.length > MAX_HISTORY) {
                        scanlineHistory.pop();  // Remove oldest
                    }
                }

                if (progressCallback) {
                    progressCallback(batchEnd, targetHeight);
                }

                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else if (algorithm === "greedy-parallel") {
            // Greedy byte-by-byte optimization with parallel hi-bit testing
            const errorBuffer = new Array(targetHeight * pixelWidth);

            // PERFORMANCE: Create reusable renderer (buffers created per task to avoid races)
            const renderer = new NTSCRenderer();

            // Process scanlines in batches to avoid blocking UI
            const BATCH_SIZE = 10; // Greedy is slower, use smaller batches

            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                for (let y = batchStart; y < batchEnd; y++) {
                    const scanline = await greedyDitherScanlineAsync(
                        pixels,
                        errorBuffer,
                        y,
                        targetWidth,
                        pixelWidth,
                        targetHeight,
                        this
                    );
                    screen.set(scanline, y * targetWidth);
                }

                if (progressCallback) {
                    progressCallback(batchEnd, targetHeight);
                }

                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else if (algorithm === "viterbi-byte") {
            // Hybrid Viterbi-per-byte with byte-level error diffusion (async)
            const errorBuffer = new Array(targetHeight * pixelWidth);

            // Process scanlines in batches to avoid blocking UI
            const BATCH_SIZE = 10; // Similar performance to greedy

            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                for (let y = batchStart; y < batchEnd; y++) {
                    const scanline = viterbiByteDither(
                        pixels,
                        errorBuffer,
                        y,
                        targetWidth,
                        pixelWidth,
                        targetHeight,
                        this,
                        beamWidth // Pass beam width parameter
                    );
                    screen.set(scanline, y * targetWidth);
                }

                if (progressCallback) {
                    progressCallback(batchEnd, targetHeight);
                }

                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else if (algorithm === "nearest-neighbor") {
            // Nearest-neighbor quantization (no error diffusion) - async version
            const BATCH_SIZE = 10; // Process 10 scanlines before yielding

            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                for (let y = batchStart; y < batchEnd; y++) {
                    const scanline = nearestNeighborDitherScanline(
                        pixels,
                        y,
                        targetWidth,
                        pixelWidth,
                        this
                    );
                    screen.set(scanline, y * targetWidth);
                }

                if (progressCallback) {
                    progressCallback(batchEnd, targetHeight);
                }

                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else if (algorithm === "two-pass") {
            // Two-pass: nearest-neighbor first, then error diffusion refinement (async)
            const renderer = new NTSCRenderer();
            const imageData = new ImageData(560, 1);
            const hgrBytes = new Uint8Array(40);

            const BATCH_SIZE = 10; // Process 10 scanlines before yielding

            // First pass: nearest-neighbor (no error diffusion)
            const firstPass = new Uint8Array(targetWidth * targetHeight);
            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                for (let y = batchStart; y < batchEnd; y++) {
                    const scanline = nearestNeighborDitherScanline(
                        pixels,
                        y,
                        targetWidth,
                        pixelWidth,
                        this
                    );
                    firstPass.set(scanline, y * targetWidth);
                }

                if (progressCallback) {
                    progressCallback(batchEnd / 2, targetHeight); // First pass is 50% of work
                }

                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Second pass: refine with error diffusion
            const errorBuffer = new Array(targetHeight * pixelWidth);
            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                for (let y = batchStart; y < batchEnd; y++) {
                    const firstPassScanline = firstPass.slice(y * targetWidth, (y + 1) * targetWidth);
                    const scanline = secondPassDitherScanline(
                        pixels,
                        errorBuffer,
                        y,
                        targetWidth,
                        pixelWidth,
                        targetHeight,
                        renderer,
                        imageData,
                        hgrBytes,
                        firstPassScanline
                    );
                    screen.set(scanline, y * targetWidth);
                }

                if (progressCallback) {
                    progressCallback(targetHeight / 2 + batchEnd / 2, targetHeight); // Second pass is remaining 50%
                }

                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else if (algorithm === "structure-aware") {
            // Structure-aware Viterbi optimization with structure hints (async version)
            // This algorithm uses image structure detection to reduce graininess
            // in smooth regions while preserving edge sharpness

            // Generate structure hints from source image
            const structureHints = generateStructureHints(pixels, pixelWidth, targetHeight);

            // Initialize error buffer
            const errorBuffer = new Array(targetHeight);
            for (let y = 0; y < targetHeight; y++) {
                errorBuffer[y] = new Array(pixelWidth);
                for (let x = 0; x < pixelWidth; x++) {
                    errorBuffer[y][x] = [0, 0, 0];
                }
            }

            // PERFORMANCE: Create reusable buffers once for entire image
            const renderer = new NTSCRenderer();
            const imageData = new ImageData(560, 1);
            const hgrBytes = new Uint8Array(40);

            // Process scanlines in batches to avoid blocking UI
            const BATCH_SIZE = 10; // Similar performance to Viterbi

            for (let batchStart = 0; batchStart < targetHeight; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, targetHeight);

                // Process this batch of scanlines
                for (let y = batchStart; y < batchEnd; y++) {
                    const scanline = viterbiFullScanline(
                        pixels,
                        errorBuffer,
                        y,
                        targetWidth,
                        pixelWidth,
                        beamWidth, // configurable beam width (default K=4)
                        this.getTargetWithError.bind(this),
                        null, // no progress callback
                        this, // pass ImageDither instance with centralized functions
                        structureHints // pass structure hints to Viterbi
                    );
                    screen.set(scanline, y * targetWidth);

                    // Propagate error to next scanline
                    for (let byteX = 0; byteX < targetWidth; byteX++) {
                        const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;
                        const currByte = scanline[byteX];

                        const target = this.getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);
                        const rendered = this.renderNTSCColors(prevByte, currByte, byteX);

                        this.propagateErrorToBuffer(errorBuffer, byteX, y, target, rendered, pixelWidth);
                    }
                }

                // Report progress if callback provided
                if (progressCallback) {
                    progressCallback(batchEnd, targetHeight);
                }

                // Yield to event loop to keep UI responsive
                if (batchEnd < targetHeight) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

        } else {
            throw new Error(`Unknown dithering algorithm: ${algorithm}`);
        }

        return screen;
    }

    /**
     * Creates an RGB scratch buffer from image data.
     */
    createScratchBuffer(pixels, width, height) {
        const buffer = new Array(height);
        for (let y = 0; y < height; y++) {
            buffer[y] = new Array(width);
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                buffer[y][x] = [
                    pixels[idx],     // R
                    pixels[idx + 1], // G
                    pixels[idx + 2]  // B
                ];
            }
        }
        return buffer;
    }

    /**
     * Performs dithering for a pair of HGR bytes.
     * This is the core of the conversion algorithm.
     */
    hiresDither(screen, scratchBuffers, y, x, bufferWidth, pixelWidth, propagateError) {
        const [primaryBuffer, secondaryBuffer, tertiaryBuffer] = scratchBuffers;
        const errorWindow = 6;
        const overlap = 3;
        const pixelShift = -1;

        let bb1 = screen[y * bufferWidth + x] || 0;
        let bb2 = screen[y * bufferWidth + x + 1] || 0;

        let prev = 0;
        if (x > 0) {
            prev = screen[y * bufferWidth + x - 1] || 0;
        }

        let next = 0;
        if (x < bufferWidth - 2) {
            next = screen[y * bufferWidth + x + 2] || 0;
        }

        // Try both high bit settings and pick the one with least error
        let leastError = Number.MAX_VALUE;
        let bestByte1 = 0;

        for (let hi = 0; hi < 2; hi++) {
            this.copyBuffer(primaryBuffer, tertiaryBuffer, y, Math.min(y + 3, tertiaryBuffer.length));
            let b1 = hi << 7;
            let totalError = 0;

            // Try each bit position
            for (let c = 0; c < 7; c++) {
                const xx = x * 7 + c;  // FIX: x is byte index, multiply by 7 pixels/byte
                const on = b1 | (1 << c);
                const off = on ^ (1 << c);

                // Calculate error for bit off
                const errorOff = this.calculateBitError(tertiaryBuffer, prev, off, bb2, xx, y, c, pixelShift, errorWindow);

                // Calculate error for bit on
                const errorOn = this.calculateBitError(tertiaryBuffer, prev, on, bb2, xx, y, c, pixelShift, errorWindow);

                if (errorOff < errorOn) {
                    totalError += errorOff;
                    b1 = off;
                } else {
                    totalError += errorOn;
                    b1 = on;
                }
            }

            if (totalError < leastError) {
                this.copyBuffer(tertiaryBuffer, secondaryBuffer, y, Math.min(y + 3, secondaryBuffer.length));
                leastError = totalError;
                bestByte1 = b1;
            }
        }

        bb1 = bestByte1;
        this.copyBuffer(secondaryBuffer, primaryBuffer, y, Math.min(y + 3, primaryBuffer.length));

        // Similar process for second byte (bb2)
        leastError = Number.MAX_VALUE;
        let bestByte2 = 0;

        for (let hi = 0; hi < 2; hi++) {
            this.copyBuffer(primaryBuffer, tertiaryBuffer, y, Math.min(y + 3, tertiaryBuffer.length));
            let b2 = hi << 7;
            let totalError = 0;

            for (let c = 0; c < 7; c++) {
                const xx = (x + 1) * 7 + c;  // FIX: (x+1) is second byte index, multiply by 7 pixels/byte
                const on = b2 | (1 << c);
                const off = on ^ (1 << c);

                const errorOff = this.calculateBitError(tertiaryBuffer, bb1, off, next, xx, y, c + 7, pixelShift, errorWindow);
                const errorOn = this.calculateBitError(tertiaryBuffer, bb1, on, next, xx, y, c + 7, pixelShift, errorWindow);

                if (errorOff < errorOn) {
                    totalError += errorOff;
                    b2 = off;
                } else {
                    totalError += errorOn;
                    b2 = on;
                }
            }

            if (totalError < leastError) {
                this.copyBuffer(tertiaryBuffer, secondaryBuffer, y, Math.min(y + 3, secondaryBuffer.length));
                leastError = totalError;
                bestByte2 = b2;
            }
        }

        bb2 = bestByte2;
        this.copyBuffer(secondaryBuffer, primaryBuffer, y, Math.min(y + 3, primaryBuffer.length));

        // Store the final bytes
        screen[y * bufferWidth + x] = bb1;
        screen[y * bufferWidth + x + 1] = bb2;
    }

    /**
     * Calculates the color error for a specific bit configuration.
     */
    calculateBitError(buffer, prevByte, currentByte, nextByte, x, y, bitPos, pixelShift, window) {
        // Convert HGR bytes to DHGR pixel pattern
        const dhgrBits = NTSCRenderer.hgrToDhgr[prevByte][currentByte];

        let error = 0;
        for (let i = 0; i < window && x + i < buffer[y].length; i++) {
            // Get the rendered color for this pixel
            const pixelOn = (dhgrBits >> ((bitPos + i) * 2)) & 1;
            const renderedColor = pixelOn ? [255, 255, 255] : [0, 0, 0]; // Simplified

            // Calculate color distance
            const actual = buffer[y][x + i];
            error += this.colorDistance(actual, renderedColor);
        }

        return error;
    }

    /**
     * Calculates the Euclidean distance between two RGB colors.
     */
    colorDistance(c1, c2) {
        const dr = c1[0] - c2[0];
        const dg = c1[1] - c2[1];
        const db = c1[2] - c2[2];
        return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    /**
     * Propagates error to neighboring pixels using Floyd-Steinberg.
     */
    propagateError(buffer, x, y, error) {
        if (x < 0 || y < 0 || y >= buffer.length) {
            return;
        }

        for (let dy = 0; dy < this.coefficients.length; dy++) {
            const row = this.coefficients[dy];
            for (let dx = 0; dx < row.length; dx++) {
                const coef = row[dx];
                if (coef === 0) continue;

                const nx = x + dx - 1; // Center on current pixel
                const ny = y + dy;

                if (ny >= buffer.length || nx < 0 || nx >= buffer[ny].length) {
                    continue;
                }

                const errorAmount = (error * coef) / this.divisor;
                for (let c = 0; c < 3; c++) {
                    buffer[ny][nx][c] = Math.max(0, Math.min(255, buffer[ny][nx][c] + errorAmount[c]));
                }
            }
        }
    }

    /**
     * Copies a portion of one scratch buffer to another.
     */
    copyBuffer(source, target, startY, endY) {
        for (let y = startY; y < endY && y < source.length; y++) {
            for (let x = 0; x < source[y].length; x++) {
                target[y][x] = [...source[y][x]];
            }
        }
    }

    /**
     * Sets the dithering algorithm.
     */
    setDitherAlgorithm(algorithm) {
        switch (algorithm) {
            case "floyd-steinberg":
                this.coefficients = ImageDither.FLOYD_STEINBERG;
                this.divisor = 16;
                break;
            case "jarvis-judice-ninke":
                this.coefficients = ImageDither.JARVIS_JUDICE_NINKE;
                this.divisor = 48;
                break;
            case "atkinson":
                this.coefficients = ImageDither.ATKINSON;
                this.divisor = 8;
                break;
            default:
                throw new Error("Unknown dithering algorithm: " + algorithm);
        }
    }
}
