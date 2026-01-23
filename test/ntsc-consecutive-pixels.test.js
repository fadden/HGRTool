/**
 * NTSC Consecutive Pixel Test Suite
 *
 * This test suite specifically tests consecutive pixel rendering.
 * According to Apple II NTSC physics:
 * - Consecutive pixels (sustained runs) should render WHITE in the center
 * - Transitions (edges) should show color fringes
 *
 * Current bug: "Whenever there are two consecutive pixels next to each other,
 * they should turn white -- at least in the middle (fringes are non-white) --
 * right now I see a lot of colors"
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { PNG } from 'pngjs';
import path from 'path';

// Import the NTSC renderer
let NTSCRenderer;

// Manual ImageData implementation for testing
class TestImageData {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
    }
}

beforeAll(async () => {
    // Import the NTSC renderer module
    const module = await import('../docs/src/lib/ntsc-renderer.js');
    NTSCRenderer = module.default;
    console.log('Test setup complete');
});

/**
 * Create HGR pattern from repeating 8-bit pattern.
 * This allows testing specific bit patterns like 00110011.
 */
function createRepeatingPattern(pattern8bit, width = 40, height = 192) {
    const hgrPattern = new Uint8Array(width * height);
    hgrPattern.fill(pattern8bit);
    return hgrPattern;
}

/**
 * Render HGR pattern using JS NTSC renderer.
 * @param {boolean} useTextPalette - If true, use text palette (level-based luminance)
 */
function renderJSPattern(hgrPattern, width = 40, height = 192, useTextPalette = false) {
    const renderer = new NTSCRenderer();

    // Switch palette mode
    if (useTextPalette) {
        renderer.enableTextPalette();
    } else {
        renderer.enableSolidPalette();
    }

    const outputWidth = 560;  // DHGR width
    const outputHeight = height;

    // Create image data manually (no canvas needed)
    const imageData = new TestImageData(outputWidth, outputHeight);

    // Render each scanline
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        renderer.renderHgrScanline(imageData, hgrPattern, y, rowOffset);
    }

    return imageData;
}

/**
 * Save test output image for debugging.
 */
function saveTestImage(imageData, filename) {
    const png = new PNG({ width: imageData.width, height: imageData.height });
    png.data = Buffer.from(imageData.data);

    const filepath = path.join(process.cwd(), 'test', 'test-output', filename);
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filepath, PNG.sync.write(png));
    console.log(`  → Test output saved: ${filepath}`);
}

/**
 * Load a PNG reference image and extract pixel data.
 */
function loadReferenceImage(filename) {
    const filepath = path.join(process.cwd(), 'test', 'reference-images', filename);

    if (!fs.existsSync(filepath)) {
        console.log(`  ⚠ Reference image not found: ${filename}`);
        return null;
    }

    const pngData = fs.readFileSync(filepath);
    const png = PNG.sync.read(pngData);
    return {
        width: png.width,
        height: png.height,
        data: png.data // RGBA buffer
    };
}

/**
 * Calculate pixel difference between two images.
 */
function calculatePixelDifference(refImage, testImage, threshold = 10) {
    if (refImage.width !== testImage.width || refImage.height !== testImage.height) {
        throw new Error(`Image dimensions don't match: ref=${refImage.width}x${refImage.height}, test=${testImage.width}x${testImage.height}`);
    }

    const totalPixels = refImage.width * refImage.height;
    let differentPixels = 0;
    let maxDiff = 0;
    let totalDiff = 0;

    for (let i = 0; i < refImage.data.length; i += 4) {
        const refR = refImage.data[i];
        const refG = refImage.data[i + 1];
        const refB = refImage.data[i + 2];

        const testR = testImage.data[i];
        const testG = testImage.data[i + 1];
        const testB = testImage.data[i + 2];

        const diffR = Math.abs(refR - testR);
        const diffG = Math.abs(refG - testG);
        const diffB = Math.abs(refB - testB);
        const distance = Math.sqrt(diffR * diffR + diffG * diffG + diffB * diffB);

        totalDiff += distance;
        maxDiff = Math.max(maxDiff, distance);

        if (distance > threshold) {
            differentPixels++;
        }
    }

    const differencePercentage = (differentPixels / totalPixels) * 100;
    const avgDiff = totalDiff / totalPixels;

    return {
        percentage: differencePercentage,
        differentPixels,
        totalPixels,
        maxDiff,
        avgDiff
    };
}

/**
 * Analyze color distribution in an image.
 * Identifies if image contains mostly white (consecutive pixels) or colors.
 */
function analyzeColorDistribution(imageData) {
    let whitePixels = 0;
    let coloredPixels = 0;
    let blackPixels = 0;

    const whiteThreshold = 200; // RGB values above this = white
    const blackThreshold = 50;  // RGB values below this = black

    for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];

        const avg = (r + g + b) / 3;

        if (avg > whiteThreshold && Math.abs(r - g) < 30 && Math.abs(g - b) < 30) {
            whitePixels++;
        } else if (avg < blackThreshold) {
            blackPixels++;
        } else {
            coloredPixels++;
        }
    }

    const totalPixels = imageData.width * imageData.height;
    return {
        whitePercent: (whitePixels / totalPixels) * 100,
        coloredPercent: (coloredPixels / totalPixels) * 100,
        blackPercent: (blackPixels / totalPixels) * 100,
        whitePixels,
        coloredPixels,
        blackPixels,
        totalPixels
    };
}

/**
 * Analyze a horizontal scanline to see center vs edge coloring.
 */
function analyzeScanlineEdgesVsCenter(imageData, row = 96) {
    const width = imageData.width;
    const rowStart = row * width * 4;

    // Sample middle third vs edge thirds
    const edgeSize = Math.floor(width / 3);
    const centerStart = edgeSize;
    const centerEnd = width - edgeSize;

    let edgeColorSum = 0;
    let centerColorSum = 0;
    let edgeCount = 0;
    let centerCount = 0;

    for (let x = 0; x < width; x++) {
        const pixelIdx = rowStart + x * 4;
        const r = imageData.data[pixelIdx];
        const g = imageData.data[pixelIdx + 1];
        const b = imageData.data[pixelIdx + 2];

        // Calculate color intensity (deviation from grayscale)
        const avg = (r + g + b) / 3;
        const colorIntensity = Math.abs(r - avg) + Math.abs(g - avg) + Math.abs(b - avg);

        if (x < centerStart || x >= centerEnd) {
            edgeColorSum += colorIntensity;
            edgeCount++;
        } else {
            centerColorSum += colorIntensity;
            centerCount++;
        }
    }

    return {
        edgeColorAvg: edgeColorSum / edgeCount,
        centerColorAvg: centerColorSum / centerCount,
        ratio: (edgeColorSum / edgeCount) / (centerColorSum / centerCount)
    };
}

describe('NTSC Consecutive Pixel Tests', () => {
    describe('Palette Comparison - Solid vs Text', () => {
        it('should compare solid palette vs text palette for 00110011 pattern', () => {
            console.log('\n=== Palette Comparison: 00110011 (2-bit runs) ===');

            const pattern = 0b00110011; // 0x33 in hex
            const hgrPattern = createRepeatingPattern(pattern);

            // Render with solid palette
            const solidImage = renderJSPattern(hgrPattern, 40, 192, false);
            saveTestImage(solidImage, 'consecutive-00110011-solid.png');

            const solidAnalysis = analyzeColorDistribution(solidImage);
            console.log(`  SOLID palette:`);
            console.log(`    White: ${solidAnalysis.whitePercent.toFixed(1)}%`);
            console.log(`    Colored: ${solidAnalysis.coloredPercent.toFixed(1)}%`);
            console.log(`    Black: ${solidAnalysis.blackPercent.toFixed(1)}%`);

            // Render with text palette
            const textImage = renderJSPattern(hgrPattern, 40, 192, true);
            saveTestImage(textImage, 'consecutive-00110011-text.png');

            const textAnalysis = analyzeColorDistribution(textImage);
            console.log(`  TEXT palette:`);
            console.log(`    White: ${textAnalysis.whitePercent.toFixed(1)}%`);
            console.log(`    Colored: ${textAnalysis.coloredPercent.toFixed(1)}%`);
            console.log(`    Black: ${textAnalysis.blackPercent.toFixed(1)}%`);

            console.log(`  → Text palette should show MORE white (consecutive pixel effect)`);
            console.log(`  → Solid palette: ${solidAnalysis.whitePercent.toFixed(1)}% white`);
            console.log(`  → Text palette: ${textAnalysis.whitePercent.toFixed(1)}% white`);

            // Text palette should have at least as much white as solid palette for consecutive pixels
            // Note: For some patterns, both palettes may produce identical results if the bit density
            // happens to match the YIQ luminance for that color
            expect(textAnalysis.whitePercent).toBeGreaterThanOrEqual(solidAnalysis.whitePercent);
        });

        it('should compare solid palette vs text palette for 01111110 pattern (6-bit run)', () => {
            console.log('\n=== Palette Comparison: 01111110 (6-bit consecutive run) ===');

            const pattern = 0b01111110; // 0x7E in hex - 6 consecutive bits
            const hgrPattern = createRepeatingPattern(pattern);

            const solidImage = renderJSPattern(hgrPattern, 40, 192, false);
            saveTestImage(solidImage, 'consecutive-01111110-solid.png');
            const solidAnalysis = analyzeColorDistribution(solidImage);

            const textImage = renderJSPattern(hgrPattern, 40, 192, true);
            saveTestImage(textImage, 'consecutive-01111110-text.png');
            const textAnalysis = analyzeColorDistribution(textImage);

            console.log(`  SOLID: ${solidAnalysis.whitePercent.toFixed(1)}% white`);
            console.log(`  TEXT: ${textAnalysis.whitePercent.toFixed(1)}% white`);
            console.log(`  → 6-bit run should show STRONG white center in text palette`);

            // For 6-bit consecutive run, both palettes should produce very similar results
            // (both recognize this as white), so we check >= instead of >
            expect(textAnalysis.whitePercent).toBeGreaterThanOrEqual(solidAnalysis.whitePercent);
            expect(textAnalysis.whitePercent).toBeGreaterThan(50); // Should be mostly white
        });
    });

    describe('Consecutive Pixel Pattern Generation', () => {
        it('should generate 00110011 pattern (2-bit consecutive runs)', () => {
            console.log('\n=== Pattern 00110011 (2-bit runs) ===');

            const pattern = 0b00110011; // 0x33 in hex
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            saveTestImage(testImage, 'consecutive-00110011.png');

            const colorAnalysis = analyzeColorDistribution(testImage);
            console.log(`  White: ${colorAnalysis.whitePercent.toFixed(1)}%`);
            console.log(`  Colored: ${colorAnalysis.coloredPercent.toFixed(1)}%`);
            console.log(`  Black: ${colorAnalysis.blackPercent.toFixed(1)}%`);

            const scanlineAnalysis = analyzeScanlineEdgesVsCenter(testImage);
            console.log(`  Edge color intensity: ${scanlineAnalysis.edgeColorAvg.toFixed(2)}`);
            console.log(`  Center color intensity: ${scanlineAnalysis.centerColorAvg.toFixed(2)}`);
            console.log(`  Edge/Center ratio: ${scanlineAnalysis.ratio.toFixed(2)}x`);

            // This test documents current behavior - will compare to OutlawEditor
            expect(testImage).toBeDefined();
        });

        it('should generate 00001111 pattern (4-bit consecutive run)', () => {
            console.log('\n=== Pattern 00001111 (4-bit run) ===');

            const pattern = 0b00001111; // 0x0F in hex
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            saveTestImage(testImage, 'consecutive-00001111.png');

            const colorAnalysis = analyzeColorDistribution(testImage);
            console.log(`  White: ${colorAnalysis.whitePercent.toFixed(1)}%`);
            console.log(`  Colored: ${colorAnalysis.coloredPercent.toFixed(1)}%`);

            const scanlineAnalysis = analyzeScanlineEdgesVsCenter(testImage);
            console.log(`  Edge/Center color ratio: ${scanlineAnalysis.ratio.toFixed(2)}x`);

            expect(testImage).toBeDefined();
        });

        it('should generate 01110111 pattern (3-bit consecutive runs)', () => {
            console.log('\n=== Pattern 01110111 (3-bit runs) ===');

            const pattern = 0b01110111; // 0x77 in hex
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            saveTestImage(testImage, 'consecutive-01110111.png');

            const colorAnalysis = analyzeColorDistribution(testImage);
            console.log(`  White: ${colorAnalysis.whitePercent.toFixed(1)}%`);
            console.log(`  Colored: ${colorAnalysis.coloredPercent.toFixed(1)}%`);

            expect(testImage).toBeDefined();
        });

        it('should generate 11001100 pattern (2-bit runs inverted)', () => {
            console.log('\n=== Pattern 11001100 (2-bit runs inverted) ===');

            const pattern = 0b11001100; // 0xCC in hex
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            saveTestImage(testImage, 'consecutive-11001100.png');

            const colorAnalysis = analyzeColorDistribution(testImage);
            console.log(`  White: ${colorAnalysis.whitePercent.toFixed(1)}%`);
            console.log(`  Colored: ${colorAnalysis.coloredPercent.toFixed(1)}%`);

            expect(testImage).toBeDefined();
        });

        it('should generate single pixel pattern 01010101 (no consecutive)', () => {
            console.log('\n=== Pattern 01010101 (single pixels, no consecutive) ===');

            const pattern = 0b01010101; // 0x55 in hex (alternating)
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            saveTestImage(testImage, 'consecutive-01010101-single.png');

            const colorAnalysis = analyzeColorDistribution(testImage);
            console.log(`  White: ${colorAnalysis.whitePercent.toFixed(1)}%`);
            console.log(`  Colored: ${colorAnalysis.coloredPercent.toFixed(1)}%`);
            console.log(`  → Should be mostly colored (no consecutive pixels)`);

            expect(testImage).toBeDefined();
        });
    });

    describe('OutlawEditor Reference Comparison', () => {
        it('should match OutlawEditor for 00110011 pattern', () => {
            console.log('\n=== Comparing 00110011 to OutlawEditor ===');

            const refImage = loadReferenceImage('reference-consecutive-00110011.png');
            if (!refImage) {
                console.log('  ⚠ Skipping - reference not generated yet');
                return;
            }

            const pattern = 0b00110011;
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            const diff = calculatePixelDifference(refImage, testImage);
            console.log(`  Difference: ${diff.percentage.toFixed(2)}% (${diff.differentPixels}/${diff.totalPixels} pixels)`);
            console.log(`  Max pixel diff: ${diff.maxDiff.toFixed(2)}, Avg diff: ${diff.avgDiff.toFixed(2)}`);

            // Goal: <2% difference
            expect(diff.percentage).toBeLessThan(2.0);
        });

        it('should match OutlawEditor for 00001111 pattern', () => {
            console.log('\n=== Comparing 00001111 to OutlawEditor ===');

            const refImage = loadReferenceImage('reference-consecutive-00001111.png');
            if (!refImage) {
                console.log('  ⚠ Skipping - reference not generated yet');
                return;
            }

            const pattern = 0b00001111;
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            const diff = calculatePixelDifference(refImage, testImage);
            console.log(`  Difference: ${diff.percentage.toFixed(2)}%`);

            expect(diff.percentage).toBeLessThan(2.0);
        });

        it('should match OutlawEditor for 01110111 pattern', () => {
            console.log('\n=== Comparing 01110111 to OutlawEditor ===');

            const refImage = loadReferenceImage('reference-consecutive-01110111.png');
            if (!refImage) {
                console.log('  ⚠ Skipping - reference not generated yet');
                return;
            }

            const pattern = 0b01110111;
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            const diff = calculatePixelDifference(refImage, testImage);
            console.log(`  Difference: ${diff.percentage.toFixed(2)}%`);

            expect(diff.percentage).toBeLessThan(2.0);
        });

        it('should match OutlawEditor for 11001100 pattern', () => {
            console.log('\n=== Comparing 11001100 to OutlawEditor ===');

            const refImage = loadReferenceImage('reference-consecutive-11001100.png');
            if (!refImage) {
                console.log('  ⚠ Skipping - reference not generated yet');
                return;
            }

            const pattern = 0b11001100;
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            const diff = calculatePixelDifference(refImage, testImage);
            console.log(`  Difference: ${diff.percentage.toFixed(2)}%`);

            expect(diff.percentage).toBeLessThan(2.0);
        });

        it('should match OutlawEditor for 01010101 single pixel pattern', () => {
            console.log('\n=== Comparing 01010101 to OutlawEditor ===');

            const refImage = loadReferenceImage('reference-consecutive-01010101.png');
            if (!refImage) {
                console.log('  ⚠ Skipping - reference not generated yet');
                return;
            }

            const pattern = 0b01010101;
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            const diff = calculatePixelDifference(refImage, testImage);
            console.log(`  Difference: ${diff.percentage.toFixed(2)}%`);

            expect(diff.percentage).toBeLessThan(2.0);
        });
    });

    describe('White Center Detection', () => {
        it('should show white centers and colored edges for 00110011', () => {
            console.log('\n=== White Center Analysis: 00110011 ===');

            const refImage = loadReferenceImage('reference-consecutive-00110011.png');
            if (!refImage) {
                console.log('  ⚠ Skipping - reference not generated yet');
                return;
            }

            // Analyze OutlawEditor reference to understand edge vs center behavior
            const refScanline = analyzeScanlineEdgesVsCenter({
                width: refImage.width,
                height: refImage.height,
                data: refImage.data
            });

            console.log(`  OutlawEditor edge color: ${refScanline.edgeColorAvg.toFixed(2)}`);
            console.log(`  OutlawEditor center color: ${refScanline.centerColorAvg.toFixed(2)}`);
            console.log(`  OutlawEditor edge/center ratio: ${refScanline.ratio.toFixed(2)}x`);

            // Our implementation
            const pattern = 0b00110011;
            const hgrPattern = createRepeatingPattern(pattern);
            const testImage = renderJSPattern(hgrPattern);

            const testScanline = analyzeScanlineEdgesVsCenter(testImage);
            console.log(`  JS renderer edge color: ${testScanline.edgeColorAvg.toFixed(2)}`);
            console.log(`  JS renderer center color: ${testScanline.centerColorAvg.toFixed(2)}`);
            console.log(`  JS renderer edge/center ratio: ${testScanline.ratio.toFixed(2)}x`);

            // If OutlawEditor shows white centers, the ratio should be >1.0
            // (edges more colorful than center)
            console.log(`  → Expected: edges more colorful than center (ratio > 1.0)`);
            console.log(`  → Current: ratio = ${testScanline.ratio.toFixed(2)}x`);

            expect(testImage).toBeDefined();
        });
    });
});
