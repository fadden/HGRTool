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
 * Viterbi Full Scanline Optimization for HGR Image Import
 *
 * This module implements complete Viterbi dynamic programming across an entire
 * 40-byte scanline to find the globally optimal byte sequence for target colors.
 *
 * Algorithm:
 * 1. Initialize first position with all 256 possible byte values
 * 2. For each subsequent position (1-39):
 *    a. Expand each of K previous states with all 256 next bytes
 *    b. Calculate transition cost using NTSC-aware cost function
 *    c. Keep only K best states (beam pruning)
 * 3. Backtrack from best final state to reconstruct optimal path
 *
 * KEY FEATURES:
 * - Beam search with configurable width (default K=16)
 * - NTSC-aware cost function respects phase continuity
 * - Integrates with Floyd-Steinberg error diffusion
 * - Fixed white rendering bug (0x7F favored over 0x00)
 */

import ViterbiTrellis from './viterbi-trellis.js';
import { calculateTransitionCost } from './viterbi-cost-function.js';
import NTSCRenderer from './ntsc-renderer.js';
import ImageDither from './image-dither.js';

/**
 * Performs full Viterbi optimization for a single HGR scanline.
 *
 * Uses dynamic programming with beam search to find the optimal sequence of
 * 40 bytes that minimizes NTSC rendering error for the target pixel colors.
 *
 * CRITICAL UPDATE: Now uses centralized ImageDither.calculateNTSCError for consistent
 * phase-corrected evaluation across all dithering algorithms.
 *
 * STRUCTURE-AWARE OPTIMIZATION: When structure hints are provided, adjusts cost
 * function penalties based on image structure (EDGE, TEXTURE, SMOOTH) to reduce
 * graininess in smooth regions while preserving edge sharpness.
 *
 * @param {Uint8ClampedArray} pixels - Source pixel data (RGBA format)
 * @param {Array} errorBuffer - Error accumulation buffer from Floyd-Steinberg
 * @param {number} y - Y position (0-191)
 * @param {number} targetWidth - Width in bytes (40 for HGR)
 * @param {number} pixelWidth - Width in pixels (280 for HGR)
 * @param {number} beamWidth - Number of states to keep at each position (default 16)
 * @param {Function} getTargetWithError - Function to extract target colors with error
 * @param {Function} progressCallback - Optional callback(byteX, targetWidth) for progress updates
 * @param {ImageDither} imageDither - Optional ImageDither instance (created if not provided)
 * @param {Array<Array<string>>} structureHints - Optional structure hints [y][x] (EDGE, TEXTURE, SMOOTH)
 * @returns {Uint8Array} - Optimal scanline data (40 bytes)
 */
export function viterbiFullScanline(
    pixels,
    errorBuffer,
    y,
    targetWidth,
    pixelWidth,
    beamWidth = 16,
    getTargetWithError,
    progressCallback = null,
    imageDither = null,
    structureHints = null
) {
    const trellis = new ViterbiTrellis(targetWidth, beamWidth);

    // PERFORMANCE: Create ImageDither instance if not provided
    // For single scanline calls: create once per scanline
    // For multi-scanline calls: caller creates once and passes in
    if (!imageDither) imageDither = new ImageDither();

    // Helper function to get structure hint for a byte position
    const getStructureHint = (byteX) => {
        if (!structureHints || !structureHints[y]) {
            return null;
        }
        // Use hint from center pixel of this byte (pixel 3 of 7)
        const pixelX = byteX * 7 + 3;
        return structureHints[y][pixelX];
    };

    // INITIALIZATION: First position (byteX = 0)
    // Try all 256 possible byte values as initial states
    const targetColors0 = getTargetWithError(pixels, errorBuffer, 0, y, pixelWidth);
    const hint0 = getStructureHint(0);

    for (let byte = 0; byte < 256; byte++) {
        // Calculate initial cost (transition from 0x00 to this byte)
        const cost = calculateTransitionCost(0x00, byte, targetColors0, 0, imageDither, hint0);

        trellis.setState(0, byte, {
            byte: byte,
            cumulativeError: cost,
            backpointer: null // No previous state for first position
        });
    }

    // Prune to keep only K best initial states
    trellis.pruneBeam(0);

    // FORWARD PASS: Dynamic programming across remaining positions
    for (let byteX = 1; byteX < targetWidth; byteX++) {
        const prevStates = trellis.getStates(byteX - 1);
        const targetColors = getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);
        const hint = getStructureHint(byteX);

        // Expand each previous state with all 256 possible next bytes
        for (const prevState of prevStates) {
            for (let nextByte = 0; nextByte < 256; nextByte++) {
                // Calculate transition cost from prevState.byte to nextByte
                // Pass structure hint to guide optimization
                const transitionCost = calculateTransitionCost(
                    prevState.byte,
                    nextByte,
                    targetColors,
                    byteX,
                    imageDither,
                    hint
                );

                // Cumulative error = previous error + transition cost
                const cumulativeError = prevState.cumulativeError + transitionCost;

                // Check if this path to nextByte is better than existing path
                const existingState = trellis.getState(byteX, nextByte);
                if (!existingState || cumulativeError < existingState.cumulativeError) {
                    trellis.setState(byteX, nextByte, {
                        byte: nextByte,
                        cumulativeError: cumulativeError,
                        backpointer: prevState.byte // Remember which byte we came from
                    });
                }
            }
        }

        // Prune to keep only K best states at this position
        trellis.pruneBeam(byteX);

        // Report progress if callback provided
        if (progressCallback && (byteX % 5 === 0 || byteX === targetWidth - 1)) {
            progressCallback(byteX, targetWidth);
        }
    }

    // BACKTRACKING: Reconstruct optimal path
    const scanline = new Uint8Array(targetWidth);
    let currentState = trellis.getBestFinalState();

    if (!currentState) {
        // Should never happen, but handle gracefully
        console.error('Viterbi: No final state found!');
        return new Uint8Array(targetWidth); // Return zeros
    }

    // Work backwards from last position to first
    for (let pos = targetWidth - 1; pos >= 0; pos--) {
        scanline[pos] = currentState.byte;

        if (pos > 0) {
            // Move to previous state via backpointer
            const prevByte = currentState.backpointer;
            currentState = trellis.getState(pos - 1, prevByte);

            if (!currentState) {
                // Should never happen if backpointers are correct
                console.error(`Viterbi: Backtracking failed at position ${pos}`);
                break;
            }
        }
    }

    return scanline;
}
