/*
 * Test without error diffusion - can we even pick the right byte?
 */

import ImageDither from '../docs/src/lib/image-dither.js';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

new NTSCRenderer();
const ditherer = new ImageDither();

console.log('=== Test: Can algorithm find correct byte WITHOUT error diffusion? ===\n');

// Orange should produce byte 0xAA
const orangeColor = { r: 116, g: 116, b: 73 };

// Create empty error buffer (no error diffusion)
const errorBuffer = new Array(192);
for (let y = 0; y < 192; y++) {
    errorBuffer[y] = new Array(280);
    for (let x = 0; x < 280; x++) {
        errorBuffer[y][x] = [0, 0, 0];
    }
}

// Create pixels with orange color
const pixels = new Uint8ClampedArray(280 * 4);
for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = orangeColor.r;
    pixels[i + 1] = orangeColor.g;
    pixels[i + 2] = orangeColor.b;
    pixels[i + 3] = 255;
}

// Get target for byteX=0
const target = ditherer.getTargetWithError(pixels, errorBuffer, 0, 0, 280);

console.log('Target color:', orangeColor);
console.log('Target with zero error:', target[0]);

// Test what byte 0xAA produces
const rendered_aa = ditherer.renderNTSCColors(0x00, 0xAA, 0);
const error_aa = ditherer.calculateNTSCError(0x00, 0xAA, target, 0);

console.log('\nByte 0xAA (correct orange):');
console.log('  Rendered:', rendered_aa[3]);
console.log('  Error:', error_aa.toFixed(2));

// Find what byte the algorithm actually picks
const bestByte = ditherer.findBestBytePattern(0x00, target, 0);
const rendered_best = ditherer.renderNTSCColors(0x00, bestByte, 0);
const error_best = ditherer.calculateNTSCError(0x00, bestByte, target, 0);

console.log(`\nByte 0x${bestByte.toString(16).toUpperCase()} (algorithm's choice):`);
console.log('  Hi-bit:', (bestByte & 0x80) ? 1 : 0);
console.log('  Rendered:', rendered_best[3]);
console.log('  Error:', error_best.toFixed(2));

console.log(`\nDoes algorithm pick correct byte? ${bestByte === 0xAA ? 'YES ✓' : 'NO ✗'}`);

// Test top 10 bytes by error
console.log('\nTop 10 bytes by error:');
const results = [];
for (let byte = 0; byte < 256; byte++) {
    const error = ditherer.calculateNTSCError(0x00, byte, target, 0);
    results.push({ byte, error, hiBit: (byte & 0x80) ? 1 : 0 });
}
results.sort((a, b) => a.error - b.error);

for (let i = 0; i < 10; i++) {
    const r = results[i];
    console.log(`  ${i + 1}. 0x${r.byte.toString(16).toUpperCase().padStart(2, '0')} (hi-bit ${r.hiBit}) - error: ${r.error.toFixed(2)}`);
}
