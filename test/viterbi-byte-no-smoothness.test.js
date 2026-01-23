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
 * Test viterbi-byte algorithm with smoothness penalty disabled.
 *
 * This will help us determine if the smoothness penalty is the root cause
 * of the catastrophic failure.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { PNG } from 'pngjs';
import path from 'path';

describe('Viterbi Byte Without Smoothness Penalty', () => {
    let ImageDither;
    let NTSCRenderer;

    beforeAll(async () => {
        const imageDitherModule = await import('../docs/src/lib/image-dither.js');
        const ntscRendererModule = await import('../docs/src/lib/ntsc-renderer.js');

        ImageDither = imageDitherModule.default;
        NTSCRenderer = ntscRendererModule.default;

        // Initialize NTSC palettes
        new NTSCRenderer();
    });

    it('should test if removing smoothness penalty fixes the catastrophic failure', async () => {
        console.log('\n=== TESTING WITHOUT SMOOTHNESS PENALTY ===\n');
        console.log('NOTE: To test this, temporarily set smoothnessWeight = 0 in viterbi-byte-dither.js line 219');
        console.log('Expected behavior without smoothness penalty:');
        console.log('  - Should render gray (128,128,128) as actual gray');
        console.log('  - May have more vertical striping (without penalty)');
        console.log('  - But should NOT be catastrophically wrong (black with bright colors)');
        console.log('');

        // Create solid gray test image
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
        const hgrData = dither.ditherToHgr(sourceImage, 40, 10, 'viterbi');

        // Render output
        const renderer = new NTSCRenderer();
        const ntscWidth = 560;
        const ntscHeight = 10;
        const ntscData = new Uint8ClampedArray(ntscWidth * ntscHeight * 4);
        const imageData = new ImageData(ntscData, ntscWidth, ntscHeight);

        for (let y = 0; y < 10; y++) {
            const scanlineStart = y * 40;
            const scanline = hgrData.slice(scanlineStart, scanlineStart + 40);
            renderer.renderHgrScanline(imageData, scanline, 0, y);
        }

        // Calculate color statistics
        let sumR = 0, sumG = 0, sumB = 0;
        for (let i = 0; i < imageData.data.length; i += 4) {
            sumR += imageData.data[i];
            sumG += imageData.data[i + 1];
            sumB += imageData.data[i + 2];
        }
        const avgR = sumR / (ntscWidth * ntscHeight);
        const avgG = sumG / (ntscWidth * ntscHeight);
        const avgB = sumB / (ntscWidth * ntscHeight);

        console.log('Rendered color statistics:');
        console.log(`  Average RGB: (${avgR.toFixed(1)}, ${avgG.toFixed(1)}, ${avgB.toFixed(1)})`);
        console.log(`  Target:      (128, 128, 128)`);
        console.log(`  Error:       (${(avgR - 128).toFixed(1)}, ${(avgG - 128).toFixed(1)}, ${(avgB - 128).toFixed(1)})`);
        console.log('');

        // Check if this is the catastrophic failure (almost black)
        const avgBrightness = (avgR + avgG + avgB) / 3;
        if (avgBrightness < 20) {
            console.log('FAILURE: Still catastrophically dark (smoothness penalty may not be the only issue)');
        } else if (avgBrightness > 80) {
            console.log('SUCCESS: Brightness in reasonable range (smoothness penalty was the main issue)');
        } else {
            console.log('PARTIAL: Brightness improved but still too dark');
        }

        // Print first scanline
        console.log('\nFirst scanline bytes (hex):');
        for (let i = 0; i < 40; i++) {
            process.stdout.write(hgrData[i].toString(16).padStart(2, '0') + ' ');
            if ((i + 1) % 10 === 0) console.log('');
        }
        console.log('\n');

        // Save output
        const outputDir = path.join(process.cwd(), 'test-output');
        const png = new PNG({ width: ntscWidth, height: ntscHeight });
        png.data = Buffer.from(imageData.data);
        const outputPath = path.join(outputDir, 'viterbi-byte-no-smoothness.png');
        await new Promise((resolve, reject) => {
            png.pack()
                .pipe(fs.createWriteStream(outputPath))
                .on('finish', resolve)
                .on('error', reject);
        });

        console.log(`Output saved to: ${outputPath}`);
        console.log('\n=== END TEST ===\n');
    }, 30000);

    it('should analyze what the smoothness penalty is doing', () => {
        console.log('\n=== SMOOTHNESS PENALTY ANALYSIS ===\n');

        // Simulate the smoothness penalty calculation for solid gray
        const targetColors = Array(7).fill({ r: 128, g: 128, b: 128 });

        let maxDiff = 0;
        for (let i = 0; i < targetColors.length - 1; i++) {
            const diff = Math.abs(targetColors[i].r - targetColors[i + 1].r) +
                         Math.abs(targetColors[i].g - targetColors[i + 1].g) +
                         Math.abs(targetColors[i].b - targetColors[i + 1].b);
            maxDiff = Math.max(maxDiff, diff);
        }
        const detailLevel = Math.min(maxDiff / (3 * 255), 1.0);
        const smoothnessWeight = 200000 * (1.0 - detailLevel * 0.95);

        console.log('For solid gray (128,128,128):');
        console.log(`  maxDiff between adjacent pixels: ${maxDiff}`);
        console.log(`  detailLevel: ${detailLevel.toFixed(4)} (0 = solid color, 1 = max contrast)`);
        console.log(`  smoothnessWeight: ${smoothnessWeight.toFixed(0)}`);
        console.log('');

        // Calculate typical perceptual error for gray
        // If we render solid black (0,0,0) instead of gray (128,128,128):
        const dr = 0 - 128;
        const dg = 0 - 128;
        const db = 0 - 128;
        const perceptualError = 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
        const perceptualErrorForByte = perceptualError * 7; // 7 pixels in a byte

        console.log('Perceptual color error comparison:');
        console.log(`  Error for one pixel (black vs gray): ${perceptualError.toFixed(0)}`);
        console.log(`  Error for one byte (7 pixels):      ${perceptualErrorForByte.toFixed(0)}`);
        console.log(`  Smoothness penalty:                  ${smoothnessWeight.toFixed(0)}`);
        console.log(`  Ratio (penalty/color_error):         ${(smoothnessWeight / perceptualErrorForByte).toFixed(1)}x`);
        console.log('');

        console.log('CONCLUSION: Smoothness penalty is dominating color accuracy!');
        console.log('  - Algorithm prefers wrong color + low pattern changes');
        console.log('  - Over correct color + pattern changes');
        console.log('  - This is why output is catastrophically wrong (black instead of gray)');
        console.log('\n=== END ANALYSIS ===\n');
    });
});
