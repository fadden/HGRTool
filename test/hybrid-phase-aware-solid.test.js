/*
 * Phase-Aware Solid Color Test
 *
 * Creates images with phase-dependent colors that match what
 * a repeating byte pattern actually produces in NTSC.
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
 * Create phase-aware image for a repeating byte pattern.
 * Each byte position gets the RGB that the byte actually produces at that position.
 */
function createPhaseAwareImage(targetByte, width, height) {
    const ditherer = new ImageDither();
    const imageData = new ImageData(width, height);
    const data = imageData.data;

    // Pre-calculate colors for each byte position (4-byte repeat pattern)
    const phaseColors = [];
    for (let phase = 0; phase < 4; phase++) {
        const colors = ditherer.renderNTSCColors(targetByte, targetByte, phase);

        // Average the 7 pixels for this byte position
        let avgR = 0, avgG = 0, avgB = 0;
        for (const c of colors) {
            avgR += c.r;
            avgG += c.g;
            avgB += c.b;
        }
        phaseColors.push({
            r: Math.round(avgR / 7),
            g: Math.round(avgG / 7),
            b: Math.round(avgB / 7)
        });
    }

    // Fill image with phase-dependent colors
    const bytesPerRow = width / 7;
    for (let y = 0; y < height; y++) {
        for (let byteX = 0; byteX < bytesPerRow; byteX++) {
            const phase = byteX % 4;
            const color = phaseColors[phase];

            // Fill all 7 pixels in this byte
            for (let bit = 0; bit < 7; bit++) {
                const pixelX = byteX * 7 + bit;
                const idx = (y * width + pixelX) * 4;

                data[idx] = color.r;
                data[idx + 1] = color.g;
                data[idx + 2] = color.b;
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

describe('Phase-Aware Solid Color Tests', () => {
    it('should produce solid 0xAA (orange) when given phase-correct input', () => {
        const ditherer = new ImageDither();
        const sourceImage = createPhaseAwareImage(0xAA, 280, 192);

        const hgrBytes = ditherer.ditherToHgr(sourceImage, 40, 192, 'hybrid');

        const uniformity = countUniformity(hgrBytes, 0xAA);
        console.log(`Orange (0xAA): ${uniformity.toFixed(1)}% uniformity`);

        // Sample first scanline
        const firstRow = Array.from(hgrBytes.slice(0, 40));
        const uniqueBytes = new Set(firstRow).size;
        console.log(`First row unique bytes: ${uniqueBytes}`);
        console.log(`First 8 bytes: ${firstRow.slice(0, 8).map(b => '0x' + b.toString(16).toUpperCase()).join(' ')}`);

        expect(uniformity).toBeGreaterThanOrEqual(80);
    });

    it('should produce solid 0xD5 (blue) when given phase-correct input', () => {
        const ditherer = new ImageDither();
        const sourceImage = createPhaseAwareImage(0xD5, 280, 192);

        const hgrBytes = ditherer.ditherToHgr(sourceImage, 40, 192, 'hybrid');

        const uniformity = countUniformity(hgrBytes, 0xD5);
        console.log(`Blue (0xD5): ${uniformity.toFixed(1)}% uniformity`);

        expect(uniformity).toBeGreaterThanOrEqual(80);
    });

    it('should produce solid 0x55 (purple) when given phase-correct input', () => {
        const ditherer = new ImageDither();
        const sourceImage = createPhaseAwareImage(0x55, 280, 192);

        const hgrBytes = ditherer.ditherToHgr(sourceImage, 40, 192, 'hybrid');

        const uniformity = countUniformity(hgrBytes, 0x55);
        console.log(`Purple (0x55): ${uniformity.toFixed(1)}% uniformity`);

        expect(uniformity).toBeGreaterThanOrEqual(80);
    });

    it('should produce solid 0x2A (green) when given phase-correct input', () => {
        const ditherer = new ImageDither();
        const sourceImage = createPhaseAwareImage(0x2A, 280, 192);

        const hgrBytes = ditherer.ditherToHgr(sourceImage, 40, 192, 'hybrid');

        const uniformity = countUniformity(hgrBytes, 0x2A);
        console.log(`Green (0x2A): ${uniformity.toFixed(1)}% uniformity`);

        expect(uniformity).toBeGreaterThanOrEqual(80);
    });
});
