/*
 * Pixel-Aware Solid Color Test
 *
 * CRITICAL FIX: Instead of using average colors per byte, this test
 * gives each PIXEL the exact color that the target byte produces at
 * that specific bit position.
 *
 * For byte 0xAA at position 0:
 * - Pixel 0: RGB(0, 0, 0)
 * - Pixel 1: RGB(255, 86, 0)
 * - Pixel 2: RGB(45, 214, 0)
 * - etc.
 *
 * This way, when the algorithm evaluates 0xAA, it will have ZERO error!
 */

import { describe, it, expect, beforeAll } from 'vitest';

let ImageDither;
let NTSCRenderer;

beforeAll(async () => {
    const imageDitherModule = await import('../docs/src/lib/image-dither.js');
    const ntscRendererModule = await import('../docs/src/lib/ntsc-renderer.js');

    ImageDither = imageDitherModule.default;
    NTSCRenderer = ntscRendererModule.default;

    new NTSCRenderer();
});

/**
 * Create pixel-perfect image where each pixel gets the exact color
 * that the target byte produces at that position.
 */
function createPixelPerfectImage(targetByte, width, height) {
    const ditherer = new ImageDither();
    const imageData = new ImageData(width, height);
    const data = imageData.data;

    const bytesPerRow = width / 7;

    for (let y = 0; y < height; y++) {
        for (let byteX = 0; byteX < bytesPerRow; byteX++) {
            // Get the exact colors this byte produces at this position
            const colors = ditherer.renderNTSCColors(targetByte, targetByte, byteX);

            // Fill each pixel with its exact color (not average!)
            for (let bit = 0; bit < 7; bit++) {
                const pixelX = byteX * 7 + bit;
                const idx = (y * width + pixelX) * 4;

                data[idx] = colors[bit].r;
                data[idx + 1] = colors[bit].g;
                data[idx + 2] = colors[bit].b;
                data[idx + 3] = 255;
            }
        }
    }

    return imageData;
}

function countUniformity(hgrBytes, targetByte) {
    let matchCount = 0;
    for (let i = 0; i < hgrBytes.length; i++) {
        if (hgrBytes[i] === targetByte) {
            matchCount++;
        }
    }
    return (matchCount / hgrBytes.length) * 100;
}

describe('Pixel-Perfect Solid Color Tests', () => {
    it('should produce solid 0xAA (orange) when given pixel-perfect input', () => {
        const ditherer = new ImageDither();
        const sourceImage = createPixelPerfectImage(0xAA, 280, 192);

        const hgrBytes = ditherer.ditherToHgr(sourceImage, 40, 192, 'hybrid');

        const uniformity = countUniformity(hgrBytes, 0xAA);
        console.log(`Orange (0xAA): ${uniformity.toFixed(1)}% uniformity`);

        // Sample first scanline
        const firstRow = Array.from(hgrBytes.slice(0, 40));
        const uniqueBytes = new Set(firstRow).size;
        console.log(`First row unique bytes: ${uniqueBytes}`);
        console.log(`First 8 bytes: ${firstRow.slice(0, 8).map(b => '0x' + b.toString(16).toUpperCase()).join(' ')}`);

        expect(uniformity).toBeGreaterThanOrEqual(95);
    });

    it('should produce solid 0xD5 (blue) when given pixel-perfect input', () => {
        const ditherer = new ImageDither();
        const sourceImage = createPixelPerfectImage(0xD5, 280, 192);

        const hgrBytes = ditherer.ditherToHgr(sourceImage, 40, 192, 'hybrid');

        const uniformity = countUniformity(hgrBytes, 0xD5);
        console.log(`Blue (0xD5): ${uniformity.toFixed(1)}% uniformity`);

        expect(uniformity).toBeGreaterThanOrEqual(95);
    });

    it('should produce solid 0x55 (purple) when given pixel-perfect input', () => {
        const ditherer = new ImageDither();
        const sourceImage = createPixelPerfectImage(0x55, 280, 192);

        const hgrBytes = ditherer.ditherToHgr(sourceImage, 40, 192, 'hybrid');

        const uniformity = countUniformity(hgrBytes, 0x55);
        console.log(`Purple (0x55): ${uniformity.toFixed(1)}% uniformity`);

        expect(uniformity).toBeGreaterThanOrEqual(95);
    });

    it('should produce solid 0x2A (green) when given pixel-perfect input', () => {
        const ditherer = new ImageDither();
        const sourceImage = createPixelPerfectImage(0x2A, 280, 192);

        const hgrBytes = ditherer.ditherToHgr(sourceImage, 40, 192, 'hybrid');

        const uniformity = countUniformity(hgrBytes, 0x2A);
        console.log(`Green (0x2A): ${uniformity.toFixed(1)}% uniformity`);

        expect(uniformity).toBeGreaterThanOrEqual(95);
    });
});
