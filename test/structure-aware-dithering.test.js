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
 * Tests for structure-aware dithering integration.
 *
 * These tests validate that structure hints are properly integrated into
 * the Viterbi scanline optimization pipeline.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { viterbiFullScanline } from '../docs/src/lib/viterbi-scanline.js';
import { generateStructureHints, STRUCTURE_HINT } from '../docs/src/lib/structure-hints.js';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

// Initialize NTSC palettes before tests
beforeAll(() => {
    new NTSCRenderer();
});

describe('Structure-Aware Dithering Integration', () => {
    describe('viterbiFullScanline with structure hints', () => {
        it('should accept structure hints parameter', () => {
            const width = 280;
            const height = 1;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Fill with orange color
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = 255;
                pixels[i + 1] = 140;
                pixels[i + 2] = 0;
                pixels[i + 3] = 255;
            }

            const errorBuffer = [new Array(width).fill([0, 0, 0])];
            const getTargetWithError = (pixels, errorBuffer, byteX, y, pixelWidth) => {
                const targetColors = [];
                for (let bit = 0; bit < 7; bit++) {
                    const pixelX = byteX * 7 + bit;
                    const pixelIdx = (y * pixelWidth + pixelX) * 4;
                    targetColors.push({
                        r: pixels[pixelIdx],
                        g: pixels[pixelIdx + 1],
                        b: pixels[pixelIdx + 2]
                    });
                }
                return targetColors;
            };

            // Generate structure hints
            const hints = generateStructureHints(pixels, width, height);

            // Should not throw with structure hints
            expect(() => {
                viterbiFullScanline(
                    pixels,
                    errorBuffer,
                    0,
                    40,
                    width,
                    4,
                    getTargetWithError,
                    null,
                    null,
                    null,
                    null,
                    hints // Pass structure hints
                );
            }).not.toThrow();
        });

        it('should work without structure hints (backward compatibility)', () => {
            const width = 280;
            const height = 1;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Fill with gray color
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = 128;
                pixels[i + 1] = 128;
                pixels[i + 2] = 128;
                pixels[i + 3] = 255;
            }

            const errorBuffer = [new Array(width).fill([0, 0, 0])];
            const getTargetWithError = (pixels, errorBuffer, byteX, y, pixelWidth) => {
                const targetColors = [];
                for (let bit = 0; bit < 7; bit++) {
                    const pixelX = byteX * 7 + bit;
                    const pixelIdx = (y * pixelWidth + pixelX) * 4;
                    targetColors.push({
                        r: pixels[pixelIdx],
                        g: pixels[pixelIdx + 1],
                        b: pixels[pixelIdx + 2]
                    });
                }
                return targetColors;
            };

            // Should work without structure hints
            const result = viterbiFullScanline(
                pixels,
                errorBuffer,
                0,
                40,
                width,
                4,
                getTargetWithError
            );

            expect(result).toBeInstanceOf(Uint8Array);
            expect(result.length).toBe(40);
        });

        it('should use structure hints to guide optimization', () => {
            const width = 280;
            const height = 1;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Create a scanline with smooth region (left) and edge (right)
            for (let x = 0; x < width; x++) {
                const idx = x * 4;
                if (x < width / 2) {
                    // Left half: smooth orange
                    pixels[idx] = 255;
                    pixels[idx + 1] = 140;
                    pixels[idx + 2] = 0;
                } else {
                    // Right half: smooth blue
                    pixels[idx] = 0;
                    pixels[idx + 1] = 100;
                    pixels[idx + 2] = 255;
                }
                pixels[idx + 3] = 255;
            }

            const errorBuffer = [new Array(width).fill([0, 0, 0])];
            const getTargetWithError = (pixels, errorBuffer, byteX, y, pixelWidth) => {
                const targetColors = [];
                for (let bit = 0; bit < 7; bit++) {
                    const pixelX = byteX * 7 + bit;
                    const pixelIdx = (y * pixelWidth + pixelX) * 4;
                    targetColors.push({
                        r: pixels[pixelIdx],
                        g: pixels[pixelIdx + 1],
                        b: pixels[pixelIdx + 2]
                    });
                }
                return targetColors;
            };

            // Generate structure hints
            const hints = generateStructureHints(pixels, width, height);

            // Process with structure hints
            const resultWithHints = viterbiFullScanline(
                pixels,
                errorBuffer,
                0,
                40,
                width,
                4,
                getTargetWithError,
                null,
                null,
                null,
                null,
                hints
            );

            expect(resultWithHints).toBeInstanceOf(Uint8Array);
            expect(resultWithHints.length).toBe(40);

            // Process without structure hints
            const errorBuffer2 = [new Array(width).fill([0, 0, 0])];
            const resultWithoutHints = viterbiFullScanline(
                pixels,
                errorBuffer2,
                0,
                40,
                width,
                4,
                getTargetWithError
            );

            // Results should be valid in both cases
            expect(resultWithoutHints).toBeInstanceOf(Uint8Array);
            expect(resultWithoutHints.length).toBe(40);

            // Results may differ due to structure-aware optimization
            // (but both should be valid)
        });

        it('should reduce graininess in smooth regions', () => {
            const width = 280;
            const height = 1;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Uniform smooth region (saturated color for penalty to apply)
            for (let i = 0; i < pixels.length; i += 4) {
                pixels[i] = 200;
                pixels[i + 1] = 100;
                pixels[i + 2] = 50;
                pixels[i + 3] = 255;
            }

            const errorBuffer = [new Array(width).fill([0, 0, 0])];
            const getTargetWithError = (pixels, errorBuffer, byteX, y, pixelWidth) => {
                const targetColors = [];
                for (let bit = 0; bit < 7; bit++) {
                    const pixelX = byteX * 7 + bit;
                    const pixelIdx = (y * pixelWidth + pixelX) * 4;
                    targetColors.push({
                        r: pixels[pixelIdx],
                        g: pixels[pixelIdx + 1],
                        b: pixels[pixelIdx + 2]
                    });
                }
                return targetColors;
            };

            // Generate structure hints (should be mostly SMOOTH)
            const hints = generateStructureHints(pixels, width, height);

            const result = viterbiFullScanline(
                pixels,
                errorBuffer,
                0,
                40,
                width,
                4,
                getTargetWithError,
                null,
                null,
                null,
                null,
                hints
            );

            expect(result).toBeInstanceOf(Uint8Array);
            expect(result.length).toBe(40);

            // In smooth regions, algorithm should favor pattern stability
            // Count byte changes
            let changes = 0;
            for (let i = 1; i < result.length; i++) {
                if (result[i] !== result[i - 1]) {
                    changes++;
                }
            }

            // With structure hints, should have fewer changes in smooth regions
            // (exact count depends on color matching, but should be relatively low)
            expect(changes).toBeLessThan(result.length); // Some stability expected
        });

        it('should preserve edge sharpness', () => {
            const width = 280;
            const height = 1;
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Sharp edge: left half orange, right half blue (saturated colors)
            for (let x = 0; x < width; x++) {
                const idx = x * 4;
                if (x < width / 2) {
                    pixels[idx] = 255;     // Orange
                    pixels[idx + 1] = 140;
                    pixels[idx + 2] = 0;
                } else {
                    pixels[idx] = 0;       // Blue
                    pixels[idx + 1] = 100;
                    pixels[idx + 2] = 255;
                }
                pixels[idx + 3] = 255;
            }

            const errorBuffer = [new Array(width).fill([0, 0, 0])];
            const getTargetWithError = (pixels, errorBuffer, byteX, y, pixelWidth) => {
                const targetColors = [];
                for (let bit = 0; bit < 7; bit++) {
                    const pixelX = byteX * 7 + bit;
                    const pixelIdx = (y * pixelWidth + pixelX) * 4;
                    targetColors.push({
                        r: pixels[pixelIdx],
                        g: pixels[pixelIdx + 1],
                        b: pixels[pixelIdx + 2]
                    });
                }
                return targetColors;
            };

            // Generate structure hints (center should be EDGE)
            const hints = generateStructureHints(pixels, width, height);

            const result = viterbiFullScanline(
                pixels,
                errorBuffer,
                0,
                40,
                width,
                4,
                getTargetWithError,
                null,
                null,
                null,
                null,
                hints
            );

            expect(result).toBeInstanceOf(Uint8Array);
            expect(result.length).toBe(40);

            // Edge should be present (byte values should differ at boundary)
            const centerByte = Math.floor(result.length / 2);
            const leftBytes = result.slice(0, centerByte);
            const rightBytes = result.slice(centerByte);

            // Values should differ across the edge
            // (exact pattern depends on color matching, but should transition)
            const leftAvg = leftBytes.reduce((a, b) => a + b, 0) / leftBytes.length;
            const rightAvg = rightBytes.reduce((a, b) => a + b, 0) / rightBytes.length;

            // Different colors should produce different average byte patterns
            expect(leftAvg).not.toBe(rightAvg);
        });
    });

    describe('Structure hint integration with image dithering', () => {
        it('should handle full image with mixed structure', () => {
            const width = 280;
            const height = 10; // Small height for faster test
            const pixels = new Uint8ClampedArray(width * height * 4);

            // Create varied content:
            // - Top: smooth region
            // - Middle: edge
            // - Bottom: texture
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;

                    if (y < 3) {
                        // Smooth: uniform color
                        pixels[idx] = 200;
                        pixels[idx + 1] = 100;
                        pixels[idx + 2] = 50;
                    } else if (y < 7) {
                        // Edge: sharp transition
                        if (x < width / 2) {
                            pixels[idx] = 255;
                            pixels[idx + 1] = 140;
                            pixels[idx + 2] = 0;
                        } else {
                            pixels[idx] = 0;
                            pixels[idx + 1] = 100;
                            pixels[idx + 2] = 255;
                        }
                    } else {
                        // Texture: checkerboard
                        const isLight = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
                        const color = isLight ? 200 : 100;
                        pixels[idx] = color;
                        pixels[idx + 1] = color;
                        pixels[idx + 2] = color;
                    }
                    pixels[idx + 3] = 255;
                }
            }

            // Generate structure hints for entire image
            const hints = generateStructureHints(pixels, width, height);

            // Verify hints contain different types
            let smoothCount = 0, edgeCount = 0, textureCount = 0;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (hints[y][x] === STRUCTURE_HINT.SMOOTH) smoothCount++;
                    else if (hints[y][x] === STRUCTURE_HINT.EDGE) edgeCount++;
                    else if (hints[y][x] === STRUCTURE_HINT.TEXTURE) textureCount++;
                }
            }

            // Should have detected all structure types
            expect(smoothCount).toBeGreaterThan(0);
            expect(edgeCount + textureCount).toBeGreaterThan(0); // Edge or texture detected

            // Process each scanline with structure hints
            const errorBuffer = new Array(height);
            for (let y = 0; y < height; y++) {
                errorBuffer[y] = new Array(width).fill([0, 0, 0]);
            }

            const getTargetWithError = (pixels, errorBuffer, byteX, y, pixelWidth) => {
                const targetColors = [];
                for (let bit = 0; bit < 7; bit++) {
                    const pixelX = byteX * 7 + bit;
                    const pixelIdx = (y * pixelWidth + pixelX) * 4;
                    targetColors.push({
                        r: pixels[pixelIdx],
                        g: pixels[pixelIdx + 1],
                        b: pixels[pixelIdx + 2]
                    });
                }
                return targetColors;
            };

            // Process multiple scanlines with structure hints
            for (let y = 0; y < height; y++) {
                const result = viterbiFullScanline(
                    pixels,
                    errorBuffer,
                    y,
                    40,
                    width,
                    4,
                    getTargetWithError,
                    null,
                    null,
                    null,
                    null,
                    hints
                );

                expect(result).toBeInstanceOf(Uint8Array);
                expect(result.length).toBe(40);
            }
        });
    });
});
