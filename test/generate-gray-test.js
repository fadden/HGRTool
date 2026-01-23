import fs from 'fs';
import { PNG } from 'pngjs';
import { createCanvas } from 'canvas';
import { JSDOM } from 'jsdom';
import ImageDither from '../docs/src/lib/image-dither.js';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

// Set up minimal DOM globals needed by ImageDither
// Note: canvas package provides its own ImageData, so we'll use that
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.HTMLImageElement = dom.window.HTMLImageElement;

// Create a canvas and fill it with gray #888
const canvas = createCanvas(280, 192);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#888888';
ctx.fillRect(0, 0, 280, 192);

console.log('Created gray #888 source image');

// Get ImageData from canvas and set up the global
const imageData = ctx.getImageData(0, 0, 280, 192);
console.log('ImageData type:', imageData.constructor.name);

// Set global.ImageData to match the canvas package's ImageData
global.ImageData = imageData.constructor;

// Dither it using ImageData directly
const dither = new ImageDither();
const hgrBytes = dither.ditherToHgr(imageData, 40, 192, 'greedy');

console.log(`Dithered to ${hgrBytes.length} bytes`);

// Analyze byte distribution
const byteHistogram = new Map();
for (const byte of hgrBytes) {
    byteHistogram.set(byte, (byteHistogram.get(byte) || 0) + 1);
}

console.log('\n=== Byte Distribution ===');
const sortedBytes = [...byteHistogram.entries()].sort((a, b) => b[1] - a[1]);
sortedBytes.slice(0, 10).forEach(([byte, count]) => {
    console.log(`  0x${byte.toString(16).padStart(2, '0')}: ${count} times (${(count/hgrBytes.length*100).toFixed(1)}%)`);
});

// Render through NTSC
const renderer = new NTSCRenderer();
const outputWidth = 560;
const outputHeight = 192;
const outputCanvas = createCanvas(outputWidth, outputHeight);
const outputCtx = outputCanvas.getContext('2d');
const outputImageData = outputCtx.createImageData(outputWidth, outputHeight);

for (let y = 0; y < 192; y++) {
    const scanlineBytes = hgrBytes.slice(y * 40, (y + 1) * 40);
    renderer.renderHgrScanline(outputImageData, scanlineBytes, 0, y);
}

outputCtx.putImageData(outputImageData, 0, 0);

// Save output
if (!fs.existsSync('test-output')) {
    fs.mkdirSync('test-output', { recursive: true });
}

const buffer = outputCanvas.toBuffer('image/png');
fs.writeFileSync('test-output/gray-888-test.png', buffer);

console.log('\nOutput saved to: test-output/gray-888-test.png');
console.log('Open this file to visually inspect the dither quality');
