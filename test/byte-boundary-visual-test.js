/**
 * Visual test for byte boundary artifacts
 *
 * Creates test images and dithers them to verify byte boundaries are clean
 */

import ImageDither from '../docs/lib/image-dither.js';
import NTSCRenderer from '../docs/lib/ntsc-renderer.js';
import { PNG } from 'pngjs';
import fs from 'fs';
import { createCanvas, ImageData as NodeImageData } from 'canvas';

// Create a gradient test image to check byte boundaries
function createGradientImage(width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Create horizontal gradient
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    return ctx.getImageData(0, 0, width, height);
}

// Render HGR data as PNG
function renderHgrToPng(hgrData, width, height, filename) {
    const renderer = new NTSCRenderer();
    const ntscWidth = 560;
    const ntscHeight = height;

    const png = new PNG({ width: ntscWidth, height: ntscHeight });

    for (let y = 0; y < height; y++) {
        const rowOffset = y * 40;
        const imageData = new NodeImageData(new Uint8ClampedArray(ntscWidth * 4), ntscWidth, 1);
        renderer.renderHgrScanline(imageData, hgrData, y, rowOffset);

        // Copy to PNG
        for (let x = 0; x < ntscWidth; x++) {
            const srcIdx = x * 4;
            const dstIdx = (y * ntscWidth + x) * 4;
            png.data[dstIdx] = imageData.data[srcIdx];
            png.data[dstIdx + 1] = imageData.data[srcIdx + 1];
            png.data[dstIdx + 2] = imageData.data[srcIdx + 2];
            png.data[dstIdx + 3] = 255;
        }
    }

    png.pack().pipe(fs.createWriteStream(filename));
    console.log(`Saved: ${filename}`);
}

// Detect byte boundary artifacts by checking vertical discontinuities
function detectByteBoundaryArtifacts(hgrData, width, height) {
    const renderer = new NTSCRenderer();
    const artifacts = [];

    for (let y = 0; y < height; y++) {
        const rowOffset = y * 40;
        const imageData = new NodeImageData(new Uint8ClampedArray(560 * 4), 560, 1);
        renderer.renderHgrScanline(imageData, hgrData, y, rowOffset);

        // Check each byte boundary (every 7 HGR pixels = 14 NTSC pixels)
        for (let byteX = 1; byteX < 40; byteX++) {
            const boundaryNtscX = byteX * 14; // 7 HGR pixels * 2 NTSC pixels per HGR

            // Get colors on both sides of boundary
            const leftIdx = (boundaryNtscX - 2) * 4;
            const rightIdx = boundaryNtscX * 4;

            const leftColor = {
                r: imageData.data[leftIdx],
                g: imageData.data[leftIdx + 1],
                b: imageData.data[leftIdx + 2]
            };

            const rightColor = {
                r: imageData.data[rightIdx],
                g: imageData.data[rightIdx + 1],
                b: imageData.data[rightIdx + 2]
            };

            // Calculate color difference
            const diff = Math.sqrt(
                Math.pow(leftColor.r - rightColor.r, 2) +
                Math.pow(leftColor.g - rightColor.g, 2) +
                Math.pow(leftColor.b - rightColor.b, 2)
            );

            // If difference is large, it might be an artifact
            if (diff > 100) {
                artifacts.push({
                    y,
                    byteX,
                    ntscX: boundaryNtscX,
                    diff,
                    leftColor,
                    rightColor
                });
            }
        }
    }

    return artifacts;
}

console.log('=== Byte Boundary Visual Test ===\n');

// Test 1: Solid white
console.log('Test 1: Solid White');
{
    const width = 280;
    const height = 192;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    const dither = new ImageDither();
    const hgrData = dither.ditherToHgr(imageData, 40, height, 'viterbi');

    renderHgrToPng(hgrData, width, height, 'test-output/byte-boundary-white.png');

    const artifacts = detectByteBoundaryArtifacts(hgrData, width, height);
    console.log(`  Detected ${artifacts.length} potential artifacts`);
    if (artifacts.length > 0) {
        console.log(`  Worst artifact: diff=${artifacts[0].diff.toFixed(2)} at byte ${artifacts[0].byteX}`);
    }
}

// Test 2: Gradient
console.log('\nTest 2: Horizontal Gradient');
{
    const width = 280;
    const height = 192;
    const imageData = createGradientImage(width, height);

    const dither = new ImageDither();
    const hgrData = dither.ditherToHgr(imageData, 40, height, 'viterbi');

    renderHgrToPng(hgrData, width, height, 'test-output/byte-boundary-gradient.png');

    const artifacts = detectByteBoundaryArtifacts(hgrData, width, height);
    console.log(`  Detected ${artifacts.length} potential artifacts`);

    // In a gradient, some discontinuities are expected, but excessive ones indicate problems
    const badArtifacts = artifacts.filter(a => a.diff > 150);
    console.log(`  Severe artifacts (diff > 150): ${badArtifacts.length}`);
}

// Test 3: Solid gray (common problem case)
console.log('\nTest 3: Solid Gray (#888)');
{
    const width = 280;
    const height = 192;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    const dither = new ImageDither();
    const hgrData = dither.ditherToHgr(imageData, 40, height, 'viterbi');

    renderHgrToPng(hgrData, width, height, 'test-output/byte-boundary-gray.png');

    const artifacts = detectByteBoundaryArtifacts(hgrData, width, height);
    console.log(`  Detected ${artifacts.length} potential artifacts`);
    if (artifacts.length > 0) {
        // Show first few artifacts
        for (let i = 0; i < Math.min(5, artifacts.length); i++) {
            const a = artifacts[i];
            console.log(`    Scanline ${a.y}, byte ${a.byteX}: diff=${a.diff.toFixed(2)}`);
        }
    }
}

console.log('\n=== Test Complete ===');
console.log('Check test-output/ for visual inspection of results');
