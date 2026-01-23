import { createCanvas, loadImage, ImageData } from 'canvas';
import fs from 'fs';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

// Mock document for Node.js environment
global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') {
            return createCanvas(1, 1);
        }
        throw new Error(`Unsupported element type: ${tag}`);
    }
};

// Mock ImageData constructor for Node.js
global.ImageData = ImageData;

// Mock HTMLImageElement for instanceof checks
global.HTMLImageElement = class HTMLImageElement {};

// Now import after setting up globals
const ImageDither = (await import('../docs/src/lib/image-dither.js')).default;

console.log('Loading cat image...');
const catImage = await loadImage('test/fixtures/cat-bill.jpg');
console.log(`Loaded: ${catImage.width}x${catImage.height}`);

// Create canvas and resize to 280x192
const canvas = createCanvas(280, 192);
const ctx = canvas.getContext('2d');
ctx.drawImage(catImage, 0, 0, 280, 192);

// Get ImageData
const imageData = ctx.getImageData(0, 0, 280, 192);

console.log('Dithering with greedy algorithm...');
const dither = new ImageDither();
const startTime = Date.now();

// Dither to HGR
const hgrBytes = dither.ditherToHgr(imageData, 40, 192, 'greedy');

const elapsed = Date.now() - startTime;
console.log(`Dithered in ${(elapsed / 1000).toFixed(2)}s`);

// Analyze byte distribution
const byteHistogram = new Map();
for (const byte of hgrBytes) {
    byteHistogram.set(byte, (byteHistogram.get(byte) || 0) + 1);
}

console.log('\n=== Byte Distribution (top 10) ===');
const sortedBytes = [...byteHistogram.entries()].sort((a, b) => b[1] - a[1]);
sortedBytes.slice(0, 10).forEach(([byte, count]) => {
    console.log(`  0x${byte.toString(16).padStart(2, '0')}: ${count} times (${(count/hgrBytes.length*100).toFixed(1)}%)`);
});

// Check for suspicious patterns that might indicate white vertical lines
// Look for runs of bytes that would render as white/light
const lightBytes = [0xFF, 0xFE, 0xFD, 0xFC, 0xFB, 0xFA, 0xF9, 0xF8];
let lightByteCount = 0;
for (const byte of hgrBytes) {
    if (lightBytes.includes(byte)) {
        lightByteCount++;
    }
}
console.log(`\nLight bytes (0xF8-0xFF): ${lightByteCount} / ${hgrBytes.length} (${(lightByteCount/hgrBytes.length*100).toFixed(1)}%)`);

// Check for vertical patterns (same byte in same column)
console.log('\n=== Checking for Vertical Patterns ===');
let suspiciousColumns = 0;
for (let col = 0; col < 40; col++) {
    const columnBytes = [];
    for (let row = 0; row < 192; row++) {
        columnBytes.push(hgrBytes[row * 40 + col]);
    }

    // Check if column has unusual amount of same byte
    const colHistogram = new Map();
    for (const byte of columnBytes) {
        colHistogram.set(byte, (colHistogram.get(byte) || 0) + 1);
    }

    const maxRepeat = Math.max(...colHistogram.values());
    if (maxRepeat > 50) { // More than 25% of column is same byte
        console.log(`  Column ${col}: byte 0x${[...colHistogram.entries()].sort((a,b) => b[1] - a[1])[0][0].toString(16)} repeats ${maxRepeat} times (${(maxRepeat/192*100).toFixed(1)}%)`);
        suspiciousColumns++;
    }
}
console.log(`Suspicious columns: ${suspiciousColumns} / 40`);

// Render through NTSC
console.log('\nRendering through NTSC...');
const renderer = new NTSCRenderer();
const outputCanvas = createCanvas(560, 192);
const outputCtx = outputCanvas.getContext('2d');
const outputImageData = outputCtx.createImageData(560, 192);

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
fs.writeFileSync('test-output/cat-bill-greedy.png', buffer);

console.log('\nOutput saved to: test-output/cat-bill-greedy.png');
console.log('Check this file for white vertical lines');
