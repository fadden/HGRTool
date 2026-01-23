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
 * Diagnostic test for viterbi-byte algorithm failure.
 *
 * CRITICAL BUG: The algorithm is producing catastrophic output (extreme vertical
 * striping, colored noise) despite all tests passing. This indicates the tests
 * are inadequate and there's a critical bug.
 *
 * This test adds extensive logging to understand what's happening.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { PNG } from 'pngjs';
import path from 'path';

describe('Viterbi Byte Diagnostic', () => {
    let ImageDither;
    let NTSCRenderer;
    let viterbiByteDither;

    beforeAll(async () => {
        const imageDitherModule = await import('../docs/src/lib/image-dither.js');
        const ntscRendererModule = await import('../docs/src/lib/ntsc-renderer.js');
        const viterbiByteModule = await import('../docs/src/lib/viterbi-byte-dither.js');

        ImageDither = imageDitherModule.default;
        NTSCRenderer = ntscRendererModule.default;
        viterbiByteDither = viterbiByteModule.viterbiByteDither;

        // Initialize NTSC palettes
        new NTSCRenderer();
    });

    it('should diagnose viterbi-byte algorithm with extensive logging', async () => {
        console.log('\n=== VITERBI-BYTE DIAGNOSTIC TEST ===\n');

        // Create a simple solid color test (128,128,128 gray)
        const width = 280, height = 10; // Small test for detailed analysis
        const sourceData = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < sourceData.length; i += 4) {
            sourceData[i] = 128;     // R
            sourceData[i + 1] = 128; // G
            sourceData[i + 2] = 128; // B
            sourceData[i + 3] = 255; // A
        }
        const sourceImage = new ImageData(sourceData, width, height);

        console.log('Test image: 280x10 solid gray (128,128,128)\n');

        // Convert using viterbi algorithm
        const dither = new ImageDither();
        const hgrData = dither.ditherToHgr(sourceImage, 40, 10, 'viterbi');

        console.log('First scanline bytes (hex):');
        for (let i = 0; i < 40; i++) {
            process.stdout.write(hgrData[i].toString(16).padStart(2, '0') + ' ');
            if ((i + 1) % 10 === 0) console.log('');
        }
        console.log('\n');

        // Analyze byte patterns
        const patterns = new Map();
        for (let i = 0; i < 40; i++) {
            const pattern = hgrData[i] & 0x7F;
            patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
        }

        console.log('Byte pattern frequency (first scanline):');
        const sortedPatterns = Array.from(patterns.entries()).sort((a, b) => b[1] - a[1]);
        for (const [pattern, count] of sortedPatterns) {
            console.log(`  Pattern 0x${pattern.toString(16).padStart(2, '0')}: ${count} times`);
        }
        console.log('');

        // Check for extreme striping (every 7 pixels)
        let stripingDetected = false;
        const bytePositions = [];
        for (let i = 0; i < 40; i++) {
            bytePositions.push(hgrData[i]);
        }

        // Look for repeating pattern every 7 bytes (which would cause visible 7-pixel stripes)
        for (let offset = 1; offset <= 7; offset++) {
            let matches = 0;
            for (let i = 0; i < 40 - offset; i++) {
                if (bytePositions[i] === bytePositions[i + offset]) {
                    matches++;
                }
            }
            const matchPercent = (matches / (40 - offset)) * 100;
            if (matchPercent > 70) {
                console.log(`WARNING: ${matchPercent.toFixed(0)}% pattern repeat at offset ${offset}`);
                stripingDetected = true;
            }
        }

        if (!stripingDetected) {
            console.log('No obvious striping pattern detected.');
        }
        console.log('');

        // Render the output to see what it actually looks like
        const renderer = new NTSCRenderer();
        const ntscWidth = 560;
        const ntscHeight = 10;
        const ntscData = new Uint8ClampedArray(ntscWidth * ntscHeight * 4);
        const imageData = new ImageData(ntscData, ntscWidth, ntscHeight);

        // Render all scanlines
        for (let y = 0; y < height; y++) {
            const scanlineStart = y * 40;
            const scanline = hgrData.slice(scanlineStart, scanlineStart + 40);
            renderer.renderHgrScanline(imageData, scanline, 0, y);
        }

        // Save rendered output
        const outputDir = path.join(process.cwd(), 'test-output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const png = new PNG({ width: ntscWidth, height: ntscHeight });
        png.data = Buffer.from(imageData.data);
        const outputPath = path.join(outputDir, 'viterbi-byte-diagnostic-gray.png');
        await new Promise((resolve, reject) => {
            png.pack()
                .pipe(fs.createWriteStream(outputPath))
                .on('finish', resolve)
                .on('error', reject);
        });

        console.log(`Rendered output saved to: ${outputPath}`);
        console.log('');

        // Calculate actual rendered color statistics
        const renderedColors = [];
        for (let i = 0; i < imageData.data.length; i += 4) {
            renderedColors.push({
                r: imageData.data[i],
                g: imageData.data[i + 1],
                b: imageData.data[i + 2]
            });
        }

        const avgR = renderedColors.reduce((sum, c) => sum + c.r, 0) / renderedColors.length;
        const avgG = renderedColors.reduce((sum, c) => sum + c.g, 0) / renderedColors.length;
        const avgB = renderedColors.reduce((sum, c) => sum + c.b, 0) / renderedColors.length;

        console.log('Rendered color statistics:');
        console.log(`  Average RGB: (${avgR.toFixed(1)}, ${avgG.toFixed(1)}, ${avgB.toFixed(1)})`);
        console.log(`  Target:      (128, 128, 128)`);
        console.log(`  Error:       (${(avgR - 128).toFixed(1)}, ${(avgG - 128).toFixed(1)}, ${(avgB - 128).toFixed(1)})`);
        console.log('');

        // Measure color variance (high variance = noise)
        const varR = renderedColors.reduce((sum, c) => sum + Math.pow(c.r - avgR, 2), 0) / renderedColors.length;
        const varG = renderedColors.reduce((sum, c) => sum + Math.pow(c.g - avgG, 2), 0) / renderedColors.length;
        const varB = renderedColors.reduce((sum, c) => sum + Math.pow(c.b - avgB, 2), 0) / renderedColors.length;

        console.log('Rendered color variance (lower = smoother):');
        console.log(`  Variance RGB: (${varR.toFixed(1)}, ${varG.toFixed(1)}, ${varB.toFixed(1)})`);
        console.log(`  Std Dev RGB:  (${Math.sqrt(varR).toFixed(1)}, ${Math.sqrt(varG).toFixed(1)}, ${Math.sqrt(varB).toFixed(1)})`);
        console.log('');

        // FAILURE CRITERIA: If variance is extremely high, the algorithm is broken
        const maxStdDev = Math.max(Math.sqrt(varR), Math.sqrt(varG), Math.sqrt(varB));
        if (maxStdDev > 80) {
            console.log('FAILURE: Extremely high color variance indicates catastrophic algorithm failure');
            console.log(`  Max std dev: ${maxStdDev.toFixed(1)} (threshold: 80)`);
        } else {
            console.log(`SUCCESS: Color variance within acceptable range (max std dev: ${maxStdDev.toFixed(1)})`);
        }

        // Analyze first scanline in detail
        console.log('\n=== FIRST SCANLINE DETAILED ANALYSIS ===\n');

        const firstScanline = hgrData.slice(0, 40);
        console.log('First 10 bytes with their pixel rendering:');

        for (let byteX = 0; byteX < 10; byteX++) {
            const byte = firstScanline[byteX];
            const pattern = byte & 0x7F;
            const hibit = (byte & 0x80) ? 1 : 0;

            console.log(`\nByte ${byteX}: 0x${byte.toString(16).padStart(2, '0')} (pattern: 0x${pattern.toString(16).padStart(2, '0')}, hibit: ${hibit})`);
            console.log(`  Binary: ${byte.toString(2).padStart(8, '0')}`);

            // Show rendered colors for this byte's pixels
            const pixelStart = byteX * 7 * 2; // Each HGR pixel is 2 NTSC pixels
            console.log('  Rendered pixels (RGB):');
            for (let bit = 0; bit < 7; bit++) {
                const ntscX = (byteX * 7 + bit) * 2;
                const idx = ntscX * 4;
                const r = imageData.data[idx];
                const g = imageData.data[idx + 1];
                const b = imageData.data[idx + 2];
                console.log(`    Pixel ${bit}: (${r}, ${g}, ${b})`);
            }
        }

        console.log('\n=== END DIAGNOSTIC ===\n');

        // The test should fail if the output is catastrophically broken
        expect(maxStdDev).toBeLessThan(80);
    }, 30000);

    it('should test on actual cat image to reproduce user-reported failure', async () => {
        console.log('\n=== CAT IMAGE DIAGNOSTIC TEST ===\n');

        // Load the cat image
        const catPath = path.join(process.cwd(), 'test', 'fixtures', 'cat-bill-280x192.png');
        if (!fs.existsSync(catPath)) {
            console.log('Cat image not found, skipping test');
            return;
        }

        const catPng = PNG.sync.read(fs.readFileSync(catPath));
        const sourceImage = new ImageData(
            new Uint8ClampedArray(catPng.data),
            catPng.width,
            catPng.height
        );

        console.log(`Cat image: ${catPng.width}x${catPng.height}`);

        // Convert using viterbi algorithm
        const dither = new ImageDither();
        const hgrData = dither.ditherToHgr(sourceImage, 40, catPng.height, 'viterbi');

        // Analyze first scanline
        console.log('\nFirst scanline bytes (hex):');
        for (let i = 0; i < 40; i++) {
            process.stdout.write(hgrData[i].toString(16).padStart(2, '0') + ' ');
            if ((i + 1) % 10 === 0) console.log('');
        }
        console.log('\n');

        // Render the output
        const renderer = new NTSCRenderer();
        const ntscWidth = 560;
        const ntscHeight = catPng.height;
        const ntscData = new Uint8ClampedArray(ntscWidth * ntscHeight * 4);
        const imageData = new ImageData(ntscData, ntscWidth, ntscHeight);

        for (let y = 0; y < catPng.height; y++) {
            const scanlineStart = y * 40;
            const scanline = hgrData.slice(scanlineStart, scanlineStart + 40);
            renderer.renderHgrScanline(imageData, scanline, 0, y);
        }

        // Save rendered output
        const outputDir = path.join(process.cwd(), 'test-output');
        const png = new PNG({ width: ntscWidth, height: ntscHeight });
        png.data = Buffer.from(imageData.data);
        const outputPath = path.join(outputDir, 'viterbi-byte-diagnostic-cat.png');
        await new Promise((resolve, reject) => {
            png.pack()
                .pipe(fs.createWriteStream(outputPath))
                .on('finish', resolve)
                .on('error', reject);
        });

        console.log(`Cat rendered output saved to: ${outputPath}`);
        console.log('Visual inspection required: Check for extreme vertical striping and colored noise');
        console.log('\n=== END CAT DIAGNOSTIC ===\n');
    }, 30000);

    it('should compare viterbi vs greedy on same input', async () => {
        console.log('\n=== VITERBI VS GREEDY COMPARISON ===\n');

        // Create test image (solid gray)
        const width = 280, height = 10;
        const sourceData = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < sourceData.length; i += 4) {
            sourceData[i] = 128;
            sourceData[i + 1] = 128;
            sourceData[i + 2] = 128;
            sourceData[i + 3] = 255;
        }
        const sourceImage = new ImageData(sourceData, width, height);

        const dither = new ImageDither();

        // Convert with greedy
        const greedyData = dither.ditherToHgr(sourceImage, 40, 10, 'greedy');

        // Convert with viterbi
        const viterbiData = dither.ditherToHgr(sourceImage, 40, 10, 'viterbi');

        console.log('GREEDY first scanline:');
        for (let i = 0; i < 40; i++) {
            process.stdout.write(greedyData[i].toString(16).padStart(2, '0') + ' ');
            if ((i + 1) % 10 === 0) console.log('');
        }
        console.log('\n');

        console.log('VITERBI first scanline:');
        for (let i = 0; i < 40; i++) {
            process.stdout.write(viterbiData[i].toString(16).padStart(2, '0') + ' ');
            if ((i + 1) % 10 === 0) console.log('');
        }
        console.log('\n');

        // Count differences
        let differences = 0;
        for (let i = 0; i < greedyData.length; i++) {
            if (greedyData[i] !== viterbiData[i]) {
                differences++;
            }
        }

        console.log(`Byte differences: ${differences} out of ${greedyData.length} (${(differences / greedyData.length * 100).toFixed(1)}%)`);
        console.log('\n=== END COMPARISON ===\n');
    }, 30000);
});
