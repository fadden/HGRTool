/**
 * NTSC OutlawEditor Comparison Test Suite
 *
 * This test suite compares the JavaScript NTSC renderer output against
 * reference images generated from the OutlawEditor (Java) implementation.
 *
 * The goal is to achieve <2% pixel difference for all test patterns.
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
 * Load a PNG reference image and extract pixel data.
 */
function loadReferenceImage(filename) {
    const filepath = path.join(process.cwd(), 'test', 'reference-images', filename);
    const pngData = fs.readFileSync(filepath);
    const png = PNG.sync.read(pngData);
    return {
        width: png.width,
        height: png.height,
        data: png.data // RGBA buffer
    };
}

/**
 * Create HGR pattern with specified byte value.
 */
function createHGRPattern(byteValue, width = 40, height = 192) {
    const pattern = new Uint8Array(width * height);
    pattern.fill(byteValue);
    return pattern;
}

/**
 * Create checkerboard pattern (alternating rows).
 */
function createCheckerboardPattern(byte1, byte2, width = 40, height = 192) {
    const pattern = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const value = (y % 2 === 0) ? byte1 : byte2;
        for (let x = 0; x < width; x++) {
            pattern[y * width + x] = value;
        }
    }
    return pattern;
}

/**
 * Render HGR pattern using JS NTSC renderer.
 */
function renderJSPattern(hgrPattern, width = 40, height = 192) {
    const renderer = new NTSCRenderer();
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
 * Calculate pixel difference between two images.
 * Returns percentage of pixels that differ significantly.
 */
function calculatePixelDifference(refImage, testImage, threshold = 10) {
    if (refImage.width !== testImage.width || refImage.height !== testImage.height) {
        throw new Error(`Image dimensions don't match: ref=${refImage.width}x${refImage.height}, test=${testImage.width}x${testImage.height}`);
    }

    const totalPixels = refImage.width * refImage.height;
    let differentPixels = 0;
    let maxDiff = 0;
    let totalDiff = 0;

    // Sample pixels to compare (every pixel)
    for (let i = 0; i < refImage.data.length; i += 4) {
        const refR = refImage.data[i];
        const refG = refImage.data[i + 1];
        const refB = refImage.data[i + 2];

        const testR = testImage.data[i];
        const testG = testImage.data[i + 1];
        const testB = testImage.data[i + 2];

        // Calculate Euclidean distance in RGB space
        const diffR = Math.abs(refR - testR);
        const diffG = Math.abs(refG - testG);
        const diffB = Math.abs(refB - testB);
        const distance = Math.sqrt(diffR * diffR + diffG * diffG + diffB * diffB);

        totalDiff += distance;
        maxDiff = Math.max(maxDiff, distance);

        // Threshold for "significantly different" pixel
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
 * Extract color statistics from an image region.
 */
function extractColorStats(imageData, sampleSize = 100) {
    const colors = [];
    const step = Math.floor(imageData.data.length / (4 * sampleSize));

    for (let i = 0; i < imageData.data.length; i += step * 4) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        colors.push({ r, g, b });
    }

    // Calculate average color
    const avg = colors.reduce((acc, c) => ({
        r: acc.r + c.r / colors.length,
        g: acc.g + c.g / colors.length,
        b: acc.b + c.b / colors.length
    }), { r: 0, g: 0, b: 0 });

    return {
        count: colors.length,
        average: {
            r: Math.round(avg.r),
            g: Math.round(avg.g),
            b: Math.round(avg.b)
        }
    };
}

describe('NTSC OutlawEditor Comparison Tests', () => {
    it('should render solid orange (0x7F) matching OutlawEditor reference', () => {
        console.log('\n=== Testing solid orange (0x7F) ===');

        // Load reference image
        const refImage = loadReferenceImage('reference-orange-0x7F.png');
        console.log(`  Reference: ${refImage.width}x${refImage.height}`);

        // Extract reference color stats
        const refStats = extractColorStats(refImage);
        console.log(`  Reference avg color: RGB(${refStats.average.r}, ${refStats.average.g}, ${refStats.average.b})`);

        // Generate test image
        const hgrPattern = createHGRPattern(0x7F);
        const testImage = renderJSPattern(hgrPattern);
        console.log(`  Test image: ${testImage.width}x${testImage.height}`);

        // Extract test color stats
        const testStats = extractColorStats(testImage);
        console.log(`  Test avg color: RGB(${testStats.average.r}, ${testStats.average.g}, ${testStats.average.b})`);

        // Save test output for visual inspection
        saveTestImage(testImage, 'test-orange-0x7F.png');

        // Compare pixel-by-pixel
        const diff = calculatePixelDifference(refImage, testImage);
        console.log(`  Difference: ${diff.percentage.toFixed(2)}% (${diff.differentPixels}/${diff.totalPixels} pixels)`);
        console.log(`  Max pixel diff: ${diff.maxDiff.toFixed(2)}, Avg diff: ${diff.avgDiff.toFixed(2)}`);

        // Assert <2% difference
        expect(diff.percentage).toBeLessThan(2.0);
    });

    it('should render solid green (0x2A) matching OutlawEditor reference', () => {
        console.log('\n=== Testing solid green (0x2A) ===');

        const refImage = loadReferenceImage('reference-green-0x2A.png');
        console.log(`  Reference: ${refImage.width}x${refImage.height}`);

        const refStats = extractColorStats(refImage);
        console.log(`  Reference avg color: RGB(${refStats.average.r}, ${refStats.average.g}, ${refStats.average.b})`);

        const hgrPattern = createHGRPattern(0x2A);
        const testImage = renderJSPattern(hgrPattern);

        const testStats = extractColorStats(testImage);
        console.log(`  Test avg color: RGB(${testStats.average.r}, ${testStats.average.g}, ${testStats.average.b})`);

        saveTestImage(testImage, 'test-green-0x2A.png');

        const diff = calculatePixelDifference(refImage, testImage);
        console.log(`  Difference: ${diff.percentage.toFixed(2)}% (${diff.differentPixels}/${diff.totalPixels} pixels)`);
        console.log(`  Max pixel diff: ${diff.maxDiff.toFixed(2)}, Avg diff: ${diff.avgDiff.toFixed(2)}`);

        expect(diff.percentage).toBeLessThan(2.0);
    });

    it('should render solid purple (0x55) matching OutlawEditor reference', () => {
        console.log('\n=== Testing solid purple (0x55) ===');

        const refImage = loadReferenceImage('reference-purple-0x55.png');
        const refStats = extractColorStats(refImage);
        console.log(`  Reference avg color: RGB(${refStats.average.r}, ${refStats.average.g}, ${refStats.average.b})`);

        const hgrPattern = createHGRPattern(0x55);
        const testImage = renderJSPattern(hgrPattern);

        const testStats = extractColorStats(testImage);
        console.log(`  Test avg color: RGB(${testStats.average.r}, ${testStats.average.g}, ${testStats.average.b})`);

        saveTestImage(testImage, 'test-purple-0x55.png');

        const diff = calculatePixelDifference(refImage, testImage);
        console.log(`  Difference: ${diff.percentage.toFixed(2)}% (${diff.differentPixels}/${diff.totalPixels} pixels)`);

        expect(diff.percentage).toBeLessThan(2.0);
    });

    it('should render solid blue (0xAA) matching OutlawEditor reference', () => {
        console.log('\n=== Testing solid blue (0xAA) ===');

        const refImage = loadReferenceImage('reference-blue-0xAA.png');
        const refStats = extractColorStats(refImage);
        console.log(`  Reference avg color: RGB(${refStats.average.r}, ${refStats.average.g}, ${refStats.average.b})`);

        const hgrPattern = createHGRPattern(0xAA);
        const testImage = renderJSPattern(hgrPattern);

        const testStats = extractColorStats(testImage);
        console.log(`  Test avg color: RGB(${testStats.average.r}, ${testStats.average.g}, ${testStats.average.b})`);

        saveTestImage(testImage, 'test-blue-0xAA.png');

        const diff = calculatePixelDifference(refImage, testImage);
        console.log(`  Difference: ${diff.percentage.toFixed(2)}% (${diff.differentPixels}/${diff.totalPixels} pixels)`);

        expect(diff.percentage).toBeLessThan(2.0);
    });

    it('should render black (0x00) matching OutlawEditor reference', () => {
        console.log('\n=== Testing black (0x00) ===');

        const refImage = loadReferenceImage('reference-black-0x00.png');
        const hgrPattern = createHGRPattern(0x00);
        const testImage = renderJSPattern(hgrPattern);

        saveTestImage(testImage, 'test-black-0x00.png');

        const diff = calculatePixelDifference(refImage, testImage);
        console.log(`  Difference: ${diff.percentage.toFixed(2)}% (${diff.differentPixels}/${diff.totalPixels} pixels)`);

        expect(diff.percentage).toBeLessThan(2.0);
    });

    it('should render white (0xFF) matching OutlawEditor reference', () => {
        console.log('\n=== Testing white (0xFF) ===');

        const refImage = loadReferenceImage('reference-white-0xFF.png');
        const hgrPattern = createHGRPattern(0xFF);
        const testImage = renderJSPattern(hgrPattern);

        saveTestImage(testImage, 'test-white-0xFF.png');

        const diff = calculatePixelDifference(refImage, testImage);
        console.log(`  Difference: ${diff.percentage.toFixed(2)}% (${diff.differentPixels}/${diff.totalPixels} pixels)`);

        expect(diff.percentage).toBeLessThan(2.0);
    });

    it('should render checkerboard pattern matching OutlawEditor reference', () => {
        console.log('\n=== Testing checkerboard (0x55/0xAA alternating) ===');

        const refImage = loadReferenceImage('reference-checkerboard-55-AA.png');
        const hgrPattern = createCheckerboardPattern(0x55, 0xAA);
        const testImage = renderJSPattern(hgrPattern);

        saveTestImage(testImage, 'test-checkerboard-55-AA.png');

        const diff = calculatePixelDifference(refImage, testImage);
        console.log(`  Difference: ${diff.percentage.toFixed(2)}% (${diff.differentPixels}/${diff.totalPixels} pixels)`);

        expect(diff.percentage).toBeLessThan(2.0);
    });
});
