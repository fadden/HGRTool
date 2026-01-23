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
 * Hybrid Viterbi-per-byte dithering with greedy pre-fill and byte-level error diffusion.
 *
 * This algorithm addresses the sliding window artifact issue where the last two bits
 * of every byte affect the rendering of the next byte through HGR's NTSC color system.
 *
 * Key insight: "It's the last two bits of every byte. When we turn a bit on, it
 * actually affects the bit to the left (sliding window) and we're not factoring that in."
 *
 * Algorithm combines:
 * - Greedy pre-fill pass for realistic future byte context
 * - Viterbi algorithm for optimal byte selection (handles NTSC sliding window naturally)
 * - Byte-level error diffusion for global quality (distributes aggregate error)
 *
 * The critical innovation is the greedy pre-fill:
 * 1. Run a fast greedy pass to get reasonable baseline byte values for the entire scanline
 * 2. When evaluating candidate bytes at position X, use greedy pre-fill values for positions X+1 onwards
 * 3. This gives Viterbi realistic context about what colors will appear to the right
 * 4. Without pre-fill, Viterbi has no information about future bytes, leading to poor local decisions
 *
 * Process for each scanline:
 * 1. Run greedy dithering to get pre-fill scanline (fast, one pass)
 * 2. For each byte position (left-to-right):
 *    a. Use Viterbi to test all 256 byte values
 *    b. For each candidate, use: committed bytes (left) + candidate (current) + greedy pre-fill (right)
 *    c. Calculate error with this realistic future context
 *    d. Select byte with lowest error
 * 3. Distribute aggregate byte error to neighbors
 *
 * This naturally handles the sliding window because Viterbi tests all 256 byte values
 * with both previous byte context (committed) and future byte context (greedy pre-fill).
 */

import { greedyDitherScanline } from './greedy-dither.js';

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
 * @param {Array} errorBuffer - Error accumulation buffer (flat array indexed by y*width+x)
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
 * Calculates error for a candidate byte with optional greedy pre-fill context.
 *
 * When greedy pre-fill is provided, this constructs a test scanline with:
 * - Committed bytes (0 to byteX-1)
 * - Candidate byte (byteX)
 * - Greedy pre-fill bytes (byteX+1 to 39)
 *
 * Then renders the byte at byteX with this realistic future context, giving much
 * better error estimates than rendering in isolation.
 *
 * Without pre-fill, falls back to simple cached lookup (fast but no future context).
 *
 * @param {number} prevByte - Previous byte in scanline (or 0 if first)
 * @param {number} candidateByte - Byte value to test (0-255)
 * @param {Array<{r: number, g: number, b: number}>} targetColors - Target colors for 7 pixels
 * @param {number} byteX - Byte X position (0-39)
 * @param {ImageDither} imageDither - ImageDither instance for NTSC error calculation
 * @param {Uint8Array} greedyPreFill - Optional greedy scanline for future context
 * @param {Uint8Array} scanlineSoFar - Optional partial scanline with committed bytes
 * @returns {{totalError: number, renderedColors: Array<{r,g,b}>}} - Total error and rendered colors
 */
function calculateByteErrorWithColors(prevByte, candidateByte, targetColors, byteX, imageDither, greedyPreFill = null, scanlineSoFar = null) {
    // Construct test scanline with candidate + greedy pre-fill for realistic context
    const testScanline = new Uint8Array(greedyPreFill ? greedyPreFill.length : 40);

    // Copy committed bytes (0 to byteX-1)
    if (scanlineSoFar) {
        for (let i = 0; i < byteX; i++) {
            testScanline[i] = scanlineSoFar[i];
        }
    }

    // Insert candidate byte
    testScanline[byteX] = candidateByte;

    // Fill future bytes with greedy pre-fill values (or 0 if no pre-fill)
    if (greedyPreFill) {
        for (let i = byteX + 1; i < greedyPreFill.length; i++) {
            testScanline[i] = greedyPreFill[i];
        }
    }

    // Get next byte for complete pattern extraction at byte boundary
    const nextByte = testScanline[byteX + 1] || 0;

    // Render the current byte with BOTH prevByte and nextByte context
    // This is critical for correct phase calculation at byte boundaries
    const renderedColors = imageDither.renderNTSCColors(prevByte, candidateByte, byteX, nextByte);

    // Calculate error between target and rendered
    let totalError = 0;
    for (let i = 0; i < 7; i++) {
        totalError += perceptualDistanceSquared(targetColors[i], renderedColors[i]);
    }

    return { totalError, renderedColors };
}

/**
 * Finds the best byte using Viterbi-style search with greedy pre-fill context and beam width.
 * Tests up to beamWidth candidate byte values using cached NTSC palette lookups.
 * Returns both the best byte and its rendered colors for error diffusion.
 *
 * BEAM WIDTH STRATEGY:
 * - Always test greedy suggestion (if available) as first candidate
 * - Test evenly-spaced candidates across the 0-255 range to ensure coverage
 * - Beam width range: 1-256 (UI default is 16)
 * - Lower beam width = faster but potentially lower quality
 * - Higher beam width = slower but better quality
 * - Beam width 256 = exhaustive search (tests all byte values)
 *
 * GREEDY PRE-FILL GUIDANCE: Uses greedy result as a hint about what byte value would
 * work well in this position. Adds a penalty for deviating from the greedy value,
 * encouraging Viterbi to stay close unless there's a significant quality improvement.
 * This prevents poor local decisions that greedy would avoid.
 *
 * SMOOTHNESS PENALTY: To prevent vertical stripes in solid color areas, we add a
 * penalty for changing the byte pattern (lower 7 bits). This encourages pattern
 * consistency while still allowing changes when needed for detail or color accuracy.
 * The penalty is adaptive: stronger for uniform areas, weaker for detailed areas.
 *
 * @param {number} prevByte - Previous byte in scanline (or 0 if first)
 * @param {Array<{r: number, g: number, b: number}>} targetColors - Target colors for 7 pixels
 * @param {number} byteX - Byte X position (0-39)
 * @param {ImageDither} imageDither - ImageDither instance for NTSC calculations
 * @param {Uint8Array} greedyPreFill - Optional greedy scanline for guidance
 * @param {Uint8Array} scanlineSoFar - Optional partial scanline with committed bytes
 * @param {number} beamWidth - Maximum number of candidates to test (default 16, range 1-256)
 * @returns {{byte: number, renderedColors: Array<{r,g,b}>}} - Best byte and its rendered colors
 */
function findBestByteViterbi(prevByte, targetColors, byteX, imageDither, greedyPreFill = null, scanlineSoFar = null, beamWidth = 16) {
    let bestByte = 0;
    let leastError = Infinity;
    let bestRenderedColors = null;

    // Calculate target uniformity to adapt smoothness penalty
    // High uniformity (low variance) means solid color area → strong smoothness penalty
    // Low uniformity (high variance) means detailed area → weak smoothness penalty
    let maxDiff = 0;
    for (let i = 0; i < targetColors.length - 1; i++) {
        const diff = Math.abs(targetColors[i].r - targetColors[i + 1].r) +
                     Math.abs(targetColors[i].g - targetColors[i + 1].g) +
                     Math.abs(targetColors[i].b - targetColors[i + 1].b);
        maxDiff = Math.max(maxDiff, diff);
    }
    // Normalize to 0-1 range (0 = solid color, 1 = max contrast)
    const detailLevel = Math.min(maxDiff / (3 * 255), 1.0);

    // Smoothness penalty weight: strong for solid areas, weak for detailed areas
    // Typical perceptual color error is 0-65025 (255^2 * 3 channels with weights)
    // Base penalty of 20,000 is ~16% of typical byte error (enough to encourage
    // consistency without forcing catastrophically wrong choices)
    // For solid colors: We want pattern change to be moderately expensive (~20000)
    // For detailed areas: We want pattern change to be cheap (~1000)
    const smoothnessWeight = 20000 * (1.0 - detailLevel * 0.95);

    // Get greedy suggestion for this position (if available)
    const greedySuggestion = greedyPreFill ? greedyPreFill[byteX] : null;

    // Greedy deviation penalty: encourage staying close to greedy unless there's clear benefit
    // Typical color errors: 0-65025 (255^2 * 3 channels with weights)
    // Set penalty to 5000 (~8% of typical byte error) - enough to encourage consistency
    // but not so large that it prevents beneficial deviations
    const greedyDeviationPenalty = 5000;

    // Build candidate list based on beam width (range 1-256)
    const candidates = new Set();

    // If beam width >= 256, test all bytes exhaustively
    if (beamWidth >= 256) {
        for (let byte = 0; byte < 256; byte++) {
            candidates.add(byte);
        }
    } else {
        // Always test greedy suggestion first (if available) - this is our best hint
        if (greedySuggestion !== null) {
            candidates.add(greedySuggestion);
        }

        // Always test extremes (0 and 255) for better coverage
        candidates.add(0);
        candidates.add(255);

        // Sample evenly across 0-255 range for diversity
        // This ensures we explore different regions of the byte space
        const step = Math.floor(256 / (beamWidth + 1));
        for (let i = 1; candidates.size < beamWidth && i < 256; i++) {
            const byte = Math.min(255, i * step);
            candidates.add(byte);
        }

        // Fill remaining slots with random sampling if needed
        // (shouldn't happen often with the even sampling, but ensures we hit beamWidth)
        while (candidates.size < beamWidth) {
            const randomByte = Math.floor(Math.random() * 256);
            candidates.add(randomByte);
        }
    }

    // Test all candidates
    for (const byte of candidates) {
        const { totalError, renderedColors } = calculateByteErrorWithColors(
            prevByte,
            byte,
            targetColors,
            byteX,
            imageDither,
            greedyPreFill,
            scanlineSoFar
        );

        // Apply smoothness penalty if byte pattern changes (only after first byte)
        let finalError = totalError;
        if (byteX > 0) {
            const prevPattern = prevByte & 0x7F;
            const currPattern = byte & 0x7F;
            if (prevPattern !== currPattern) {
                finalError += smoothnessWeight;
            }
        }

        // Apply greedy deviation penalty if this byte differs from greedy suggestion
        // This encourages Viterbi to follow greedy's lead unless there's a clear improvement
        if (greedySuggestion !== null && byte !== greedySuggestion) {
            finalError += greedyDeviationPenalty;
        }

        if (finalError < leastError) {
            leastError = finalError;
            bestByte = byte;
            bestRenderedColors = renderedColors;
        }
    }

    return { byte: bestByte, renderedColors: bestRenderedColors };
}

/**
 * Distributes aggregate byte error to neighboring bytes using byte-level error diffusion.
 *
 * Unlike pixel-level Floyd-Steinberg which distributes error from each pixel to its
 * 4 neighbors, this distributes the TOTAL ERROR from all 7 pixels in a byte to
 * 3 strategic locations:
 *
 * - Right (7/16): First pixel of next byte in same scanline
 *   (handles horizontal color continuity at byte boundaries)
 *
 * - Down (7/16): Same byte column in next scanline, distributed across all 7 pixels
 *   (handles vertical color continuity)
 *
 * - Down-right (2/16): First pixel of next byte in next scanline
 *   (handles diagonal continuity)
 *
 * This approach is critical because:
 * 1. NTSC rendering already handles color bleed within a byte (sliding window)
 * 2. We only need to diffuse error at byte boundaries where the sliding window breaks
 * 3. Byte-level diffusion prevents double-counting NTSC artifacts
 *
 * @param {Array} errorBuffer - Error buffer (flat array indexed by y*width+x)
 * @param {number} byteX - Byte X position (0-39)
 * @param {number} y - Y position (0-191)
 * @param {Array<{r: number, g: number, b: number}>} targetColors - Target colors for 7 pixels
 * @param {Array<{r: number, g: number, b: number}>} renderedColors - Rendered colors for 7 pixels
 * @param {number} pixelWidth - Width in pixels (280)
 * @param {number} height - Height in pixels (192)
 */
function distributeByteError(errorBuffer, byteX, y, targetColors, renderedColors, pixelWidth, height) {
    // Calculate aggregate error for this entire byte (sum of all 7 pixel errors)
    const totalError = { r: 0, g: 0, b: 0 };

    for (let bit = 0; bit < 7; bit++) {
        totalError.r += targetColors[bit].r - renderedColors[bit].r;
        totalError.g += targetColors[bit].g - renderedColors[bit].g;
        totalError.b += targetColors[bit].b - renderedColors[bit].b;
    }

    // Distribute to 3 neighbors (weights sum to 1.0, similar to Floyd-Steinberg):
    // - Right: 7/16 to first pixel of next byte
    // - Down: 7/16 spread across same byte column, next scanline
    // - Down-right: 2/16 to first pixel of next byte, next scanline
    const distributions = [
        { dx: 7, dy: 0, weight: 7/16, spread: false },     // Right (next byte first pixel)
        { dx: 0, dy: 1, weight: 7/16, spread: true },      // Down (spread across byte)
        { dx: 7, dy: 1, weight: 2/16, spread: false }      // Down-right (next byte first pixel)
    ];

    for (const { dx, dy, weight, spread } of distributions) {
        if (spread) {
            // Spread error across all 7 pixels of the target byte
            for (let bit = 0; bit < 7; bit++) {
                const targetPixelX = byteX * 7 + bit;
                const targetY = y + dy;

                if (targetY >= 0 && targetY < height && targetPixelX >= 0 && targetPixelX < pixelWidth) {
                    const idx = targetY * pixelWidth + targetPixelX;
                    if (!errorBuffer[idx]) {
                        errorBuffer[idx] = { r: 0, g: 0, b: 0 };
                    }

                    // Divide weight by 7 since we're spreading across 7 pixels
                    const spreadWeight = weight / 7;

                    // Clamp on write to prevent overflow
                    errorBuffer[idx].r = Math.max(-255, Math.min(255, errorBuffer[idx].r + totalError.r * spreadWeight));
                    errorBuffer[idx].g = Math.max(-255, Math.min(255, errorBuffer[idx].g + totalError.g * spreadWeight));
                    errorBuffer[idx].b = Math.max(-255, Math.min(255, errorBuffer[idx].b + totalError.b * spreadWeight));
                }
            }
        } else {
            // Concentrate error on a single pixel
            const targetPixelX = byteX * 7 + dx;
            const targetY = y + dy;

            if (targetY >= 0 && targetY < height && targetPixelX >= 0 && targetPixelX < pixelWidth) {
                const idx = targetY * pixelWidth + targetPixelX;
                if (!errorBuffer[idx]) {
                    errorBuffer[idx] = { r: 0, g: 0, b: 0 };
                }

                // Clamp on write
                errorBuffer[idx].r = Math.max(-255, Math.min(255, errorBuffer[idx].r + totalError.r * weight));
                errorBuffer[idx].g = Math.max(-255, Math.min(255, errorBuffer[idx].g + totalError.g * weight));
                errorBuffer[idx].b = Math.max(-255, Math.min(255, errorBuffer[idx].b + totalError.b * weight));
            }
        }
    }
}

/**
 * Dithers a single scanline using hybrid Viterbi-per-byte with greedy pre-fill and beam width.
 *
 * This is the main entry point for the hybrid algorithm. Process:
 * 1. Run fast greedy pass to get baseline scanline (pre-fill with reasonable values)
 * 2. For each byte position:
 *    a. Extract target colors with accumulated error
 *    b. Use Viterbi to find best byte (beam search with greedy guidance)
 *    c. Calculate aggregate error for the byte
 *    d. Distribute error to 3 neighbors (right, down, down-right)
 *
 * The greedy pre-fill provides two benefits:
 * - Gives Viterbi a reasonable starting point (penalty for deviating from greedy)
 * - Prevents poor local decisions by biasing toward globally sensible values
 *
 * Beam width controls the quality/speed tradeoff:
 * - Lower beam width (e.g., 16) = faster, tests fewer candidates
 * - Higher beam width (e.g., 128) = slower, tests more candidates for better quality
 * - Beam width 256 = exhaustive search (tests all byte values)
 * - Range: 1-256 (UI default is 16)
 *
 * @param {Uint8ClampedArray} pixels - Source pixel data
 * @param {Array} errorBuffer - Error buffer (flat array)
 * @param {number} y - Y position (0-191)
 * @param {number} targetWidth - Width in bytes (40)
 * @param {number} pixelWidth - Width in pixels (280)
 * @param {number} height - Height in pixels (192)
 * @param {ImageDither} imageDither - ImageDither instance for NTSC calculations
 * @param {number} beamWidth - Maximum candidates to test per byte (default 16, range 1-256)
 * @returns {Uint8Array} - Scanline data (40 bytes)
 */
export function viterbiByteDither(pixels, errorBuffer, y, targetWidth, pixelWidth, height, imageDither, beamWidth = 16) {
    // Step 1: Run greedy pass to get pre-fill values (provides reasonable baseline)
    // Use a separate error buffer so greedy's error diffusion doesn't affect viterbi
    const greedyErrorBuffer = errorBuffer ? new Array(errorBuffer.length) : null;
    const greedyPreFill = greedyDitherScanline(
        pixels,
        greedyErrorBuffer,
        y,
        targetWidth,
        pixelWidth,
        height,
        imageDither,
        [] // No scanline history needed for pre-fill
    );

    // Step 2: Viterbi pass with greedy guidance
    const scanline = new Uint8Array(targetWidth);

    for (let byteX = 0; byteX < targetWidth; byteX++) {
        // Get target colors with accumulated error
        const targetColors = getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);

        // Find best byte using Viterbi with greedy pre-fill guidance and beam width
        const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;
        const { byte: bestByte, renderedColors } = findBestByteViterbi(
            prevByte,
            targetColors,
            byteX,
            imageDither,
            greedyPreFill,
            scanline,
            beamWidth
        );

        // Commit best byte
        scanline[byteX] = bestByte;

        // Distribute aggregate byte error to neighbors
        distributeByteError(
            errorBuffer,
            byteX,
            y,
            targetColors,
            renderedColors,
            pixelWidth,
            height
        );
    }

    return scanline;
}
