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
 * Structure hint detection for image dithering.
 *
 * This module provides simplified structure detection to guide dithering
 * optimization, reducing graininess in smooth regions and improving edge quality.
 *
 * The detection uses local variance heuristics to classify regions as:
 * - EDGE: Sharp transitions (high variance)
 * - TEXTURE: Fine details (medium variance)
 * - SMOOTH: Uniform regions (low variance)
 * - AUTO: Automatic classification based on local variance
 */

/**
 * Structure hint types for image regions.
 */
export const STRUCTURE_HINT = {
    EDGE: 'EDGE',       // Sharp transitions, high variance
    TEXTURE: 'TEXTURE', // Fine details, medium variance
    SMOOTH: 'SMOOTH',   // Uniform regions, low variance
    AUTO: 'AUTO'        // Automatic detection
};

/**
 * Thresholds for structure classification.
 * These are empirically tuned for HGR image quality.
 */
const VARIANCE_THRESHOLD_SMOOTH = 50;    // Below this: SMOOTH
const VARIANCE_THRESHOLD_EDGE = 1000;    // Above this: EDGE
// Between thresholds: TEXTURE

/**
 * Calculates local variance in a region around a pixel.
 *
 * Uses a 3x3 window (configurable) to measure color variation.
 * Higher variance indicates edges or texture, lower variance indicates smooth regions.
 *
 * @param {Uint8ClampedArray} pixels - Source pixel data (RGBA format)
 * @param {number} width - Image width in pixels
 * @param {number} x - Center pixel X coordinate
 * @param {number} y - Center pixel Y coordinate
 * @param {number} height - Image height in pixels
 * @param {number} windowRadius - Radius of analysis window (default 1 = 3x3)
 * @returns {number} - Local variance value
 */
export function calculateLocalVariance(pixels, width, x, y, height, windowRadius = 1) {
    let sumR = 0, sumG = 0, sumB = 0;
    let sumR2 = 0, sumG2 = 0, sumB2 = 0;
    let count = 0;

    // Calculate bounds with edge clamping
    const minX = Math.max(0, x - windowRadius);
    const maxX = Math.min(width - 1, x + windowRadius);
    const minY = Math.max(0, y - windowRadius);
    const maxY = Math.min(height - 1, y + windowRadius);

    // Accumulate color values and squared values
    for (let wy = minY; wy <= maxY; wy++) {
        for (let wx = minX; wx <= maxX; wx++) {
            const idx = (wy * width + wx) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];

            sumR += r;
            sumG += g;
            sumB += b;
            sumR2 += r * r;
            sumG2 += g * g;
            sumB2 += b * b;
            count++;
        }
    }

    // Calculate variance: E[X²] - E[X]²
    const meanR = sumR / count;
    const meanG = sumG / count;
    const meanB = sumB / count;

    const varianceR = (sumR2 / count) - (meanR * meanR);
    const varianceG = (sumG2 / count) - (meanG * meanG);
    const varianceB = (sumB2 / count) - (meanB * meanB);

    // Return combined variance across all channels
    return varianceR + varianceG + varianceB;
}

/**
 * Classifies structure type based on variance value.
 *
 * Uses empirically tuned thresholds to categorize regions:
 * - Low variance → SMOOTH (uniform regions)
 * - Medium variance → TEXTURE (fine details)
 * - High variance → EDGE (sharp transitions)
 *
 * @param {number} variance - Local variance value
 * @returns {string} - Structure hint type (EDGE, TEXTURE, or SMOOTH)
 */
export function classifyStructureHint(variance) {
    if (variance < VARIANCE_THRESHOLD_SMOOTH) {
        return STRUCTURE_HINT.SMOOTH;
    } else if (variance >= VARIANCE_THRESHOLD_EDGE) {
        return STRUCTURE_HINT.EDGE;
    } else {
        return STRUCTURE_HINT.TEXTURE;
    }
}

/**
 * Generates structure hints for an entire image.
 *
 * Analyzes each pixel's local neighborhood to classify it as EDGE, TEXTURE, or SMOOTH.
 * This provides guidance for structure-aware dithering optimization.
 *
 * @param {Uint8ClampedArray} pixels - Source pixel data (RGBA format)
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {Array<Array<string>>} - 2D array of structure hints [y][x]
 */
export function generateStructureHints(pixels, width, height) {
    const hints = new Array(height);

    for (let y = 0; y < height; y++) {
        hints[y] = new Array(width);

        for (let x = 0; x < width; x++) {
            // Calculate local variance
            const variance = calculateLocalVariance(pixels, width, x, y, height);

            // Classify structure type
            hints[y][x] = classifyStructureHint(variance);
        }
    }

    return hints;
}
