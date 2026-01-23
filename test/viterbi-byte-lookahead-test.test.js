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
 * Test the optimistic look-ahead logic to understand why it's failing.
 */

import { describe, it, beforeAll } from 'vitest';

describe('Viterbi Byte Look-Ahead Analysis', () => {
    let NTSCRenderer;
    let viterbiByteDither;

    beforeAll(async () => {
        const ntscRendererModule = await import('../docs/src/lib/ntsc-renderer.js');
        const viterbiByteModule = await import('../docs/src/lib/viterbi-byte-dither.js');

        NTSCRenderer = ntscRendererModule.default;
        viterbiByteDither = viterbiByteModule.viterbiByteDither;

        // Initialize NTSC palettes
        new NTSCRenderer();
    });

    it('should show why optimistic look-ahead picks wrong bytes', () => {
        console.log('\n=== OPTIMISTIC LOOK-AHEAD ANALYSIS ===\n');

        const renderer = new NTSCRenderer();
        const imageData = new ImageData(new Uint8ClampedArray(560 * 4), 560, 1);
        const hgrBytes = new Uint8Array(40);

        // Test what happens with byte 0 for target gray (128,128,128)
        const targetColor = { r: 128, g: 128, b: 128 };
        const targetColors = Array(7).fill(targetColor);

        console.log('Testing byte 0 with target gray (128,128,128) for 7 pixels\n');

        // Test a few candidate bytes
        const candidates = [
            0x00, // 00000000 - all black
            0x55, // 01010101 - checkerboard
            0xAA, // 10101010 - inverse checkerboard
            0xFF, // 11111111 - all white (well, 7 bits)
            0xB3, // 10110011 - what the algorithm actually picked
            0xE6, // 11100110 - what it switched to
            0xCC  // 11001100 - alternates with 0xE6
        ];

        // Perceptual distance function
        function perceptualDistanceSquared(c1, c2) {
            const dr = c1.r - c2.r;
            const dg = c1.g - c2.g;
            const db = c1.b - c2.b;
            return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
        }

        for (const candidateByte of candidates) {
            console.log(`\nCandidate byte: 0x${candidateByte.toString(16).padStart(2, '0')} (${candidateByte.toString(2).padStart(8, '0')})`);

            // Test with both fill scenarios
            const fillScenarios = [0x00, 0xFF];
            let minError = Infinity;
            let bestFill = null;

            for (const fillByte of fillScenarios) {
                // Set up scanline
                hgrBytes[0] = candidateByte;
                for (let i = 1; i < 40; i++) {
                    hgrBytes[i] = fillByte;
                }

                // Render
                for (let i = 0; i < imageData.data.length; i++) {
                    imageData.data[i] = 0;
                }
                renderer.renderHgrScanline(imageData, hgrBytes, 0, 0);

                // Calculate error for first byte's pixels only
                let totalError = 0;
                const renderedColors = [];
                for (let bitPos = 0; bitPos < 7; bitPos++) {
                    const pixelX = bitPos;
                    const ntscX = pixelX * 2;
                    const idx = ntscX * 4;

                    const rendered = {
                        r: imageData.data[idx],
                        g: imageData.data[idx + 1],
                        b: imageData.data[idx + 2]
                    };
                    renderedColors.push(rendered);
                    totalError += perceptualDistanceSquared(rendered, targetColor);
                }

                console.log(`  With fill 0x${fillByte.toString(16).padStart(2, '0')}: error=${totalError.toFixed(0)}`);

                if (totalError < minError) {
                    minError = totalError;
                    bestFill = fillByte;
                }
            }

            console.log(`  BEST scenario: fill=0x${bestFill.toString(16).padStart(2, '0')}, error=${minError.toFixed(0)}`);
        }

        console.log('\n=== KEY INSIGHT ===');
        console.log('The "optimistic" assumption (picking best of 0x00 and 0xFF) may be wrong!');
        console.log('The real next byte might NOT be 0x00 or 0xFF, so the error estimate is unreliable.');
        console.log('');
        console.log('HYPOTHESIS: The algorithm should test with more realistic fill patterns,');
        console.log('not just 0x00 and 0xFF. Or better yet, use the greedy approach without look-ahead.');
        console.log('\n=== END ANALYSIS ===\n');
    });

    it('should compare what byte gets picked vs what actually renders well', () => {
        console.log('\n=== RENDER QUALITY COMPARISON ===\n');

        const renderer = new NTSCRenderer();
        const imageData = new ImageData(new Uint8ClampedArray(560 * 4), 560, 1);
        const hgrBytes = new Uint8Array(40);

        const targetColor = { r: 128, g: 128, b: 128 };

        // Perceptual distance function
        function perceptualDistanceSquared(c1, c2) {
            const dr = c1.r - c2.r;
            const dg = c1.g - c2.g;
            const db = c1.b - c2.b;
            return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
        }

        // Test rendering the ENTIRE scanline with repeating bytes
        const testBytes = [0x00, 0x55, 0xAA, 0xFF, 0xB3, 0xE6, 0xCC];

        console.log('Testing FULL scanline rendering (all 40 bytes same):');
        console.log('This simulates what happens in a solid color area.\n');

        for (const testByte of testBytes) {
            // Fill entire scanline
            hgrBytes.fill(testByte);

            // Render
            for (let i = 0; i < imageData.data.length; i++) {
                imageData.data[i] = 0;
            }
            renderer.renderHgrScanline(imageData, hgrBytes, 0, 0);

            // Calculate average rendered color
            let sumR = 0, sumG = 0, sumB = 0;
            let totalError = 0;
            for (let x = 0; x < 280; x++) {
                const ntscX = x * 2;
                const idx = ntscX * 4;
                const rendered = {
                    r: imageData.data[idx],
                    g: imageData.data[idx + 1],
                    b: imageData.data[idx + 2]
                };
                sumR += rendered.r;
                sumG += rendered.g;
                sumB += rendered.b;
                totalError += perceptualDistanceSquared(rendered, targetColor);
            }

            const avgR = sumR / 280;
            const avgG = sumG / 280;
            const avgB = sumB / 280;

            console.log(`Byte 0x${testByte.toString(16).padStart(2, '0')} repeated:`);
            console.log(`  Avg rendered: (${avgR.toFixed(1)}, ${avgG.toFixed(1)}, ${avgB.toFixed(1)})`);
            console.log(`  Total error: ${totalError.toFixed(0)}`);
            console.log(`  Per-pixel: ${(totalError / 280).toFixed(1)}`);
        }

        console.log('\n=== EXPECTED RESULT ===');
        console.log('For gray target (128,128,128), bytes like 0x55 or 0xAA should have lowest error.');
        console.log('But the algorithm is picking 0xE6/0xCC which render dark with bright artifacts.');
        console.log('\n=== END COMPARISON ===\n');
    });
});
