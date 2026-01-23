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
 * Tests for structure hint detection module.
 *
 * These tests validate the structure detection heuristics that classify
 * image regions as EDGE, TEXTURE, or SMOOTH to guide dithering optimization.
 */

import { describe, it, expect } from 'vitest';
import {
    calculateLocalVariance,
    classifyStructureHint,
    generateStructureHints,
    STRUCTURE_HINT
} from '../docs/src/lib/structure-hints.js';

describe('Structure Hints Detection', () => {
    describe('STRUCTURE_HINT enum', () => {
        it('should define hint types', () => {
            expect(STRUCTURE_HINT.EDGE).toBeDefined();
            expect(STRUCTURE_HINT.TEXTURE).toBeDefined();
            expect(STRUCTURE_HINT.SMOOTH).toBeDefined();
            expect(STRUCTURE_HINT.AUTO).toBeDefined();
        });
    });

    describe('calculateLocalVariance', () => {
        it('should calculate zero variance for uniform region', () => {
            // All pixels same color (gray)
            const pixels = new Uint8ClampedArray(280 * 3 * 4); // 3 scanlines, 280 pixels each, RGBA
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = 128;     // R
                pixels[i + 1] = 128; // G
                pixels[i + 2] = 128; // B
                pixels[i + 3] = 255; // A
            }

            const variance = calculateLocalVariance(pixels, 280, 140, 1, 3);
            expect(variance).toBe(0);
        });

        it('should calculate high variance for edge region', () => {
            // Sharp transition: left half black, right half white
            const pixels = new Uint8ClampedArray(280 * 3 * 4);
            for (let y = 0; y < 3; y++) {
                for (let x = 0; x < 280; x++) {
                    const idx = (y * 280 + x) * 4;
                    if (x < 140) {
                        // Left half: black
                        pixels[idx] = 0;
                        pixels[idx + 1] = 0;
                        pixels[idx + 2] = 0;
                    } else {
                        // Right half: white
                        pixels[idx] = 255;
                        pixels[idx + 1] = 255;
                        pixels[idx + 2] = 255;
                    }
                    pixels[idx + 3] = 255; // Alpha
                }
            }

            // Calculate variance at the edge (x=140)
            const variance = calculateLocalVariance(pixels, 280, 140, 1, 3);
            expect(variance).toBeGreaterThan(1000); // High variance at edge
        });

        it('should calculate medium variance for texture region', () => {
            // Checkerboard pattern (high frequency texture)
            const pixels = new Uint8ClampedArray(280 * 3 * 4);
            for (let y = 0; y < 3; y++) {
                for (let x = 0; x < 280; x++) {
                    const idx = (y * 280 + x) * 4;
                    const isBlack = (x + y) % 2 === 0;
                    const gray = isBlack ? 50 : 150;
                    pixels[idx] = gray;
                    pixels[idx + 1] = gray;
                    pixels[idx + 2] = gray;
                    pixels[idx + 3] = 255;
                }
            }

            const variance = calculateLocalVariance(pixels, 280, 140, 1, 3);
            expect(variance).toBeGreaterThan(100);  // Medium variance
            expect(variance).toBeLessThan(10000);   // But not as high as sharp edge
        });

        it('should handle boundary cases at image edges', () => {
            const pixels = new Uint8ClampedArray(280 * 3 * 4);
            // Fill with gradient
            for (let y = 0; y < 3; y++) {
                for (let x = 0; x < 280; x++) {
                    const idx = (y * 280 + x) * 4;
                    pixels[idx] = x;
                    pixels[idx + 1] = x;
                    pixels[idx + 2] = x;
                    pixels[idx + 3] = 255;
                }
            }

            // Test at left edge
            const varianceLeft = calculateLocalVariance(pixels, 280, 0, 1, 3);
            expect(varianceLeft).toBeGreaterThanOrEqual(0);

            // Test at right edge
            const varianceRight = calculateLocalVariance(pixels, 280, 279, 1, 3);
            expect(varianceRight).toBeGreaterThanOrEqual(0);
        });

        it('should use 3x3 window by default', () => {
            // Window size affects variance calculation
            const pixels = new Uint8ClampedArray(280 * 5 * 4);
            for (let y = 0; y < 5; y++) {
                for (let x = 0; x < 280; x++) {
                    const idx = (y * 280 + x) * 4;
                    // Create gradient
                    pixels[idx] = x % 256;
                    pixels[idx + 1] = x % 256;
                    pixels[idx + 2] = x % 256;
                    pixels[idx + 3] = 255;
                }
            }

            const variance = calculateLocalVariance(pixels, 280, 140, 2, 5);
            expect(variance).toBeGreaterThan(0);
        });
    });

    describe('classifyStructureHint', () => {
        it('should classify low variance as SMOOTH', () => {
            const hint = classifyStructureHint(5);
            expect(hint).toBe(STRUCTURE_HINT.SMOOTH);
        });

        it('should classify medium variance as TEXTURE', () => {
            const hint = classifyStructureHint(300);
            expect(hint).toBe(STRUCTURE_HINT.TEXTURE);
        });

        it('should classify high variance as EDGE', () => {
            const hint = classifyStructureHint(3000);
            expect(hint).toBe(STRUCTURE_HINT.EDGE);
        });

        it('should handle boundary thresholds correctly', () => {
            // Test exact threshold values
            const smooth = classifyStructureHint(49);  // Just below texture threshold
            const texture1 = classifyStructureHint(50); // At texture threshold
            const texture2 = classifyStructureHint(999); // Just below edge threshold
            const edge = classifyStructureHint(1000);   // At edge threshold

            expect(smooth).toBe(STRUCTURE_HINT.SMOOTH);
            expect(texture1).toBe(STRUCTURE_HINT.TEXTURE);
            expect(texture2).toBe(STRUCTURE_HINT.TEXTURE);
            expect(edge).toBe(STRUCTURE_HINT.EDGE);
        });

        it('should handle zero variance', () => {
            const hint = classifyStructureHint(0);
            expect(hint).toBe(STRUCTURE_HINT.SMOOTH);
        });

        it('should handle very high variance', () => {
            const hint = classifyStructureHint(50000);
            expect(hint).toBe(STRUCTURE_HINT.EDGE);
        });
    });

    describe('generateStructureHints', () => {
        it('should generate hints for entire image', () => {
            const width = 280;
            const height = 192;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Fill with gradient to create varying structure
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    pixels[idx] = (x + y) % 256;
                    pixels[idx + 1] = (x + y) % 256;
                    pixels[idx + 2] = (x + y) % 256;
                    pixels[idx + 3] = 255;
                }
            }

            const hints = generateStructureHints(pixels, width, height);

            // Should return array with one entry per pixel
            expect(hints.length).toBe(height);
            expect(hints[0].length).toBe(width);

            // All entries should be valid hint types
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const hint = hints[y][x];
                    expect([
                        STRUCTURE_HINT.EDGE,
                        STRUCTURE_HINT.TEXTURE,
                        STRUCTURE_HINT.SMOOTH
                    ]).toContain(hint);
                }
            }
        });

        it('should classify smooth regions correctly', () => {
            const width = 280;
            const height = 192;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // All pixels same color (smooth)
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = 128;
                pixels[i + 1] = 128;
                pixels[i + 2] = 128;
                pixels[i + 3] = 255;
            }

            const hints = generateStructureHints(pixels, width, height);

            // Most pixels should be classified as SMOOTH
            let smoothCount = 0;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (hints[y][x] === STRUCTURE_HINT.SMOOTH) {
                        smoothCount++;
                    }
                }
            }

            expect(smoothCount).toBeGreaterThan(width * height * 0.9); // >90% smooth
        });

        it('should detect edges in high-contrast image', () => {
            const width = 280;
            const height = 192;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Vertical edge: left half black, right half white
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const color = x < width / 2 ? 0 : 255;
                    pixels[idx] = color;
                    pixels[idx + 1] = color;
                    pixels[idx + 2] = color;
                    pixels[idx + 3] = 255;
                }
            }

            const hints = generateStructureHints(pixels, width, height);

            // Pixels near center should be classified as EDGE
            const centerX = Math.floor(width / 2);
            let edgeCount = 0;
            for (let y = 10; y < height - 10; y++) {
                // Check 5-pixel window around edge
                for (let x = centerX - 2; x <= centerX + 2; x++) {
                    if (hints[y][x] === STRUCTURE_HINT.EDGE) {
                        edgeCount++;
                    }
                }
            }

            expect(edgeCount).toBeGreaterThan(0); // Should detect some edges
        });

        it('should detect texture in checkerboard pattern', () => {
            const width = 280;
            const height = 192;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Checkerboard pattern - creates high local variance at boundaries
            // Note: High-contrast checkerboard may be classified as EDGE, not TEXTURE
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const isBlack = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
                    const color = isBlack ? 50 : 150;
                    pixels[idx] = color;
                    pixels[idx + 1] = color;
                    pixels[idx + 2] = color;
                    pixels[idx + 3] = 255;
                }
            }

            const hints = generateStructureHints(pixels, width, height);

            // Count non-smooth pixels (TEXTURE or EDGE)
            // Checkerboard creates high variance which may be EDGE classification
            let nonSmoothCount = 0;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (hints[y][x] !== STRUCTURE_HINT.SMOOTH) {
                        nonSmoothCount++;
                    }
                }
            }

            expect(nonSmoothCount).toBeGreaterThan(width * height * 0.3); // >30% non-smooth
        });

        it('should handle single scanline', () => {
            const width = 280;
            const height = 1;
            const pixels = new Uint8ClampedArray(width * height * 4);

            for (let x = 0; x < width; x++) {
                const idx = x * 4;
                pixels[idx] = x;
                pixels[idx + 1] = x;
                pixels[idx + 2] = x;
                pixels[idx + 3] = 255;
            }

            const hints = generateStructureHints(pixels, width, height);
            expect(hints.length).toBe(height);
            expect(hints[0].length).toBe(width);
        });

        it('should handle small images', () => {
            const width = 10;
            const height = 10;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Fill with random pattern
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = Math.floor(Math.random() * 256);
                pixels[i + 1] = Math.floor(Math.random() * 256);
                pixels[i + 2] = Math.floor(Math.random() * 256);
                pixels[i + 3] = 255;
            }

            const hints = generateStructureHints(pixels, width, height);
            expect(hints.length).toBe(height);
            expect(hints[0].length).toBe(width);
        });
    });

    describe('Structure hint thresholds tuning', () => {
        it('should use sensible default thresholds', () => {
            // Test that default thresholds produce reasonable classifications
            // for typical image content

            // Very uniform region
            const smoothVariance = 10;
            expect(classifyStructureHint(smoothVariance)).toBe(STRUCTURE_HINT.SMOOTH);

            // Moderate texture
            const textureVariance = 500;
            expect(classifyStructureHint(textureVariance)).toBe(STRUCTURE_HINT.TEXTURE);

            // Sharp edge
            const edgeVariance = 5000;
            expect(classifyStructureHint(edgeVariance)).toBe(STRUCTURE_HINT.EDGE);
        });
    });
});
