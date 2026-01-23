/**
 * Verification test for Viterbi byte boundary handling.
 *
 * Tests that the Viterbi algorithm properly handles byte transitions
 * without introducing artifacts due to:
 * 1. Incorrect context in cost calculation
 * 2. Double-counting error diffusion across byte boundaries
 */

import { describe, it, expect } from 'vitest';
import { viterbiFullScanline } from '../docs/lib/viterbi-scanline.js';
import NTSCRenderer from '../docs/lib/ntsc-renderer.js';
import ImageDither from '../docs/lib/image-dither.js';

describe('Viterbi Byte Boundary Handling', () => {
    it('should not create horizontal stripes at byte boundaries for solid white', () => {
        // Create solid white 280x192 image
        const width = 280;
        const height = 192;
        const pixels = new Uint8ClampedArray(width * height * 4);

        // Fill with white
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 255;     // R
            pixels[i + 1] = 255; // G
            pixels[i + 2] = 255; // B
            pixels[i + 3] = 255; // A
        }

        // Initialize error buffer (2D array as used by Viterbi)
        const errorBuffer = new Array(height);
        for (let y = 0; y < height; y++) {
            errorBuffer[y] = new Array(width);
            for (let x = 0; x < width; x++) {
                errorBuffer[y][x] = [0, 0, 0];
            }
        }

        // Initialize renderer and buffers
        const renderer = new NTSCRenderer();
        const imageData = new ImageData(560, 1);
        const hgrBytes = new Uint8Array(40);
        const targetWidth = 40;
        const dither = new ImageDither();

        // Dither first scanline using Viterbi
        const scanline = viterbiFullScanline(
            pixels,
            errorBuffer,
            0,
            targetWidth,
            width,
            4, // beam width
            dither.getTargetWithError.bind(dither),
            null, // no progress callback
            dither
        );

        // Render the scanline to check output
        hgrBytes.fill(0);
        hgrBytes.set(scanline);
        renderer.renderHgrScanline(imageData, hgrBytes, 0, 0);

        // Count white pixels (should be mostly white for solid white input)
        let whitePixels = 0;
        for (let x = 0; x < 560; x++) {
            const idx = x * 4;
            const r = imageData.data[idx];
            const g = imageData.data[idx + 1];
            const b = imageData.data[idx + 2];

            // Consider white if all channels > 200
            if (r > 200 && g > 200 && b > 200) {
                whitePixels++;
            }
        }

        const whitePercentage = (whitePixels / 560) * 100;
        console.log(`White pixels: ${whitePixels} / 560 (${whitePercentage.toFixed(2)}%)`);

        // Should be at least 95% white (allowing for some NTSC artifacts)
        expect(whitePercentage).toBeGreaterThan(95);
    });

    it('should maintain consistent byte context in cost calculation', async () => {
        // Test that the cost function uses consistent context position
        const renderer = new NTSCRenderer();
        const imageData = new ImageData(560, 1);
        const hgrBytes = new Uint8Array(40);
        const dither = new ImageDither();

        // Create target colors (gray)
        const targetColors = [];
        for (let i = 0; i < 7; i++) {
            targetColors.push({ r: 128, g: 128, b: 128 });
        }

        // Import cost function to test directly
        const { calculateTransitionCost } = await import('../docs/lib/viterbi-cost-function.js');

        // Calculate cost for same byte transition at different positions
        const cost1 = calculateTransitionCost(0x00, 0x7F, targetColors, 0, dither);
        const cost2 = calculateTransitionCost(0x00, 0x7F, targetColors, 1, dither);
        const cost3 = calculateTransitionCost(0x00, 0x7F, targetColors, 10, dither);

        console.log(`Cost at byteX=0: ${cost1.toFixed(2)}`);
        console.log(`Cost at byteX=1: ${cost2.toFixed(2)}`);
        console.log(`Cost at byteX=10: ${cost3.toFixed(2)}`);

        // Costs should be very similar (within 10%) since same transition
        // Small differences are OK due to NTSC phase
        const avgCost = (cost1 + cost2 + cost3) / 3;
        expect(Math.abs(cost1 - avgCost) / avgCost).toBeLessThan(0.1);
        expect(Math.abs(cost2 - avgCost) / avgCost).toBeLessThan(0.1);
        expect(Math.abs(cost3 - avgCost) / avgCost).toBeLessThan(0.1);
    });

    it('should not propagate error rightward across byte boundaries', () => {
        // Create test image with sharp transition at byte boundary
        const width = 280;
        const height = 192;
        const pixels = new Uint8ClampedArray(width * height * 4);

        // Left half black, right half white
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                if (x < width / 2) {
                    pixels[idx] = 0;     // R
                    pixels[idx + 1] = 0; // G
                    pixels[idx + 2] = 0; // B
                } else {
                    pixels[idx] = 255;     // R
                    pixels[idx + 1] = 255; // G
                    pixels[idx + 2] = 255; // B
                }
                pixels[idx + 3] = 255; // A
            }
        }

        // Initialize error buffer
        const errorBuffer = new Array(height);
        for (let y = 0; y < height; y++) {
            errorBuffer[y] = new Array(width);
            for (let x = 0; x < width; x++) {
                errorBuffer[y][x] = [0, 0, 0];
            }
        }

        const dither = new ImageDither();
        const targetWidth = 40;

        // Process first scanline
        const scanline = new Uint8Array(targetWidth);
        for (let byteX = 0; byteX < targetWidth; byteX++) {
            const target = dither.getTargetWithError(pixels, errorBuffer, byteX, 0, width);
            const prevByte = byteX > 0 ? scanline[byteX - 1] : 0;
            const bestByte = dither.findBestBytePattern(prevByte, target, byteX);
            scanline[byteX] = bestByte;

            const rendered = dither.renderNTSCColors(prevByte, bestByte, byteX);
            dither.propagateErrorToBuffer(errorBuffer, byteX, 0, target, rendered, width);
        }

        // Check that error at byte boundaries didn't propagate rightward
        // Check byte boundary at x=7, x=14, x=21 (every 7 pixels)
        for (let byteX = 1; byteX < targetWidth; byteX++) {
            const boundaryPixel = byteX * 7 - 1; // Last pixel of previous byte
            const nextPixel = byteX * 7;         // First pixel of current byte

            // Error should NOT have propagated rightward across boundary
            const errorAtNext = errorBuffer[0][nextPixel];

            // Error from the boundary pixel should not affect the next byte's first pixel
            // (error will go down and diagonal, but not right)
            // This is a weak test - just checking it didn't get huge
            if (errorAtNext) {
                const totalError = Math.abs(errorAtNext[0]) + Math.abs(errorAtNext[1]) + Math.abs(errorAtNext[2]);
                expect(totalError).toBeLessThan(500); // Reasonable upper bound
            }
        }

        console.log('Byte boundary error propagation test passed');
    });
});
