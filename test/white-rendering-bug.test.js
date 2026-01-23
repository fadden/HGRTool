/**
 * White Rendering Bug Test
 *
 * This test suite demonstrates and validates the fix for the critical bug
 * where white colors (255,255,255) render as BLACK instead of white.
 *
 * BUG: PSNR = 0.00 dB (complete failure) for white input
 * ROOT CAUSE: To be determined through investigation
 *
 * Test-Driven Development Approach:
 * 1. Write failing tests that demonstrate the bug
 * 2. Investigate root cause in dithering/rendering code
 * 3. Implement fix to make tests pass
 * 4. Verify quality metrics improve
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('White Rendering Bug - Priority 1', () => {
    let ImageDither;
    let NTSCRenderer;
    let VisualQualityTester;

    beforeAll(async () => {
        // Import modules
        const imageDitherModule = await import('../docs/src/lib/image-dither.js');
        const ntscRendererModule = await import('../docs/src/lib/ntsc-renderer.js');
        const qualityModule = await import('./lib/visual-quality-tester.js');

        ImageDither = imageDitherModule.default;
        NTSCRenderer = ntscRendererModule.default;
        VisualQualityTester = qualityModule.default;
    });

    describe('Pure White Color (255,255,255)', () => {
        it('should render pure white as white, not black', async () => {
            const tester = new VisualQualityTester();

            // Create pure white image
            const width = 280, height = 192;
            const sourceData = new Uint8ClampedArray(width * height * 4);
            for (let i = 0; i < sourceData.length; i += 4) {
                sourceData[i] = 255;     // R
                sourceData[i + 1] = 255; // G
                sourceData[i + 2] = 255; // B
                sourceData[i + 3] = 255; // A
            }
            const sourceImage = new ImageData(sourceData, width, height);

            const result = await tester.assessConversionQuality(sourceImage, 'white-rendering-test');

            // BUG: Currently PSNR = 0.00 dB (white renders as black)
            // FIX: Should have good PSNR (>20 dB minimum for white)
            expect(result.psnr).toBeGreaterThan(20);
            expect(result.ssim).toBeGreaterThan(0.5);
        });

        it('should produce HGR bytes with all bits set for white input', () => {
            const dither = new ImageDither();

            // Create small white image (1 byte = 7 pixels)
            const width = 7, height = 1;
            const sourceData = new Uint8ClampedArray(width * height * 4);
            for (let i = 0; i < sourceData.length; i += 4) {
                sourceData[i] = 255;
                sourceData[i + 1] = 255;
                sourceData[i + 2] = 255;
                sourceData[i + 3] = 255;
            }
            const sourceImage = new ImageData(sourceData, width, height);

            // Convert to HGR
            const hgrData = dither.ditherToHgr(sourceImage, 1, 1, 'hybrid');

            // For white input, expect byte with all bits set: 0x7F or 0xFF
            // 0x7F = 0b01111111 (all data bits set, high bit off)
            // 0xFF = 0b11111111 (all bits set, high bit on)
            const byte = hgrData[0];
            const dataBits = byte & 0x7F; // Mask off high bit

            // All 7 data bits should be set for white
            expect(dataBits).toBe(0x7F);
        });

        it('should render HGR byte 0x7F as white through NTSC', () => {
            const ntsc = new NTSCRenderer();

            // Create canvas for rendering
            const canvas = global.document.createElement('canvas');
            canvas.width = 560;
            canvas.height = 1;
            const ctx = canvas.getContext('2d');
            const imageData = ctx.createImageData(560, 1);

            // Create HGR data with 0x7F (all bits set, low hi-bit)
            const hgrData = new Uint8Array(40);
            hgrData.fill(0x7F);

            // Render through NTSC
            ntsc.renderHgrScanline(imageData, hgrData, 0, 0);

            // Sample pixels - they should be light/white, not dark/black
            // Check first few pixels
            for (let x = 0; x < 20; x++) {
                const i = x * 4;
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];

                const brightness = (r + g + b) / 3;

                // White should have brightness > 200
                // BUG: Currently brightness is near 0 (black)
                expect(brightness).toBeGreaterThan(200);
            }
        });
    });

    describe('Light Grays (200-254)', () => {
        it('should render light grays as light tones, not dark', async () => {
            const tester = new VisualQualityTester();

            // Create light gray image (220, 220, 220)
            const width = 280, height = 192;
            const sourceData = new Uint8ClampedArray(width * height * 4);
            for (let i = 0; i < sourceData.length; i += 4) {
                sourceData[i] = 220;
                sourceData[i + 1] = 220;
                sourceData[i + 2] = 220;
                sourceData[i + 3] = 255;
            }
            const sourceImage = new ImageData(sourceData, width, height);

            const result = await tester.assessConversionQuality(sourceImage, 'light-gray-test');

            // Light grays are challenging - 11+ dB PSNR is acceptable
            expect(result.psnr).toBeGreaterThan(11);
            // SSIM can be low for uniform grays due to lack of structure
            expect(result.ssim).toBeGreaterThan(0.02);
        });
    });

    describe('White-on-Black Pattern', () => {
        it('should render white circle on black background correctly', async () => {
            const tester = new VisualQualityTester();

            // Create white circle on black background
            const width = 280, height = 192;
            const sourceData = new Uint8ClampedArray(width * height * 4);
            const centerX = width / 2;
            const centerY = height / 2;
            const radius = 50;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    const dx = x - centerX;
                    const dy = y - centerY;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // Inside circle = white, outside = black
                    const isWhite = dist < radius;
                    const value = isWhite ? 255 : 0;

                    sourceData[i] = value;
                    sourceData[i + 1] = value;
                    sourceData[i + 2] = value;
                    sourceData[i + 3] = 255;
                }
            }
            const sourceImage = new ImageData(sourceData, width, height);

            const result = await tester.assessConversionQuality(sourceImage, 'white-circle-test');

            // Should have reasonable quality
            expect(result.psnr).toBeGreaterThan(15);
            expect(result.ssim).toBeGreaterThan(0.4);
        });

        it('should render white rectangle on black background correctly', async () => {
            const tester = new VisualQualityTester();

            // Create white rectangle on black background
            const width = 280, height = 192;
            const sourceData = new Uint8ClampedArray(width * height * 4);
            const rectLeft = 70, rectRight = 210;
            const rectTop = 48, rectBottom = 144;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;

                    // Inside rectangle = white, outside = black
                    const isWhite = x >= rectLeft && x < rectRight &&
                                   y >= rectTop && y < rectBottom;
                    const value = isWhite ? 255 : 0;

                    sourceData[i] = value;
                    sourceData[i + 1] = value;
                    sourceData[i + 2] = value;
                    sourceData[i + 3] = 255;
                }
            }
            const sourceImage = new ImageData(sourceData, width, height);

            const result = await tester.assessConversionQuality(sourceImage, 'white-rectangle-test');

            // Should have reasonable quality
            expect(result.psnr).toBeGreaterThan(15);
            expect(result.ssim).toBeGreaterThan(0.4);
        });
    });

    describe('Root Cause Investigation', () => {
        it('should find best byte pattern correctly for white pixels', () => {
            const dither = new ImageDither();

            // Create target colors array (all white)
            const targetColors = [];
            for (let i = 0; i < 7; i++) {
                targetColors.push({ r: 255, g: 255, b: 255 });
            }

            // Find best byte for white pixels
            const prevByte = 0;
            const xPos = 0;
            const bestByte = dither.findBestBytePattern(prevByte, targetColors, xPos);

            // Best byte should have most bits set
            const bitCount = bestByte.toString(2).replace(/0/g, '').length;

            // For white, expect at least 5 bits set out of 8
            expect(bitCount).toBeGreaterThanOrEqual(5);
        });

        it('should calculate lower error for white bytes vs black bytes for white input', () => {
            const dither = new ImageDither();

            // Create target colors array (all white)
            const targetColors = [];
            for (let i = 0; i < 7; i++) {
                targetColors.push({ r: 255, g: 255, b: 255 });
            }

            const prevByte = 0;
            const xPos = 0;

            // Calculate error for black byte (0x00)
            const errorBlack = dither.calculateNTSCError(prevByte, 0x00, targetColors, xPos);

            // Calculate error for white byte (0x7F)
            const errorWhite = dither.calculateNTSCError(prevByte, 0x7F, targetColors, xPos);

            // White byte should have LOWER error than black byte for white input
            // BUG: Currently errorBlack < errorWhite (inverted!)
            expect(errorWhite).toBeLessThan(errorBlack);
        });

        it('should render 0x7F pattern as white in NTSC palette', () => {
            // Initialize NTSC renderer to ensure palettes are loaded
            const ntsc = new NTSCRenderer();

            // Check all phases of the 0x7F pattern
            // 0x7F = 0b01111111 (all bits set)
            const pattern = 0x7F;

            for (let phase = 0; phase < 4; phase++) {
                const colorPacked = NTSCRenderer.solidPalette[phase][pattern];

                // Unpack RGB
                const r = (colorPacked >> 16) & 0xFF;
                const g = (colorPacked >> 8) & 0xFF;
                const b = colorPacked & 0xFF;

                const brightness = (r + g + b) / 3;

                // Pattern 0x7F should produce light/white colors
                expect(brightness).toBeGreaterThan(200);
            }
        });
    });
});
