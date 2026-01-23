/*
 * Debug: Why can't the algorithm find 0xAA when given phase-correct input?
 */

import ImageDither from '../docs/src/lib/image-dither.js';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

new NTSCRenderer();
const ditherer = new ImageDither();

console.log('=== Test: Can algorithm find 0xAA at position 0? ===\n');

// Get the colors that 0xAA actually produces at position 0
const actualColors = ditherer.renderNTSCColors(0x00, 0xAA, 0);
console.log('Colors that 0xAA produces at position 0:');
for (let i = 0; i < actualColors.length; i++) {
    console.log(`  Pixel ${i}: RGB(${actualColors[i].r}, ${actualColors[i].g}, ${actualColors[i].b})`);
}

// Calculate average
let avgR = 0, avgG = 0, avgB = 0;
for (const c of actualColors) {
    avgR += c.r;
    avgG += c.g;
    avgB += c.b;
}
avgR = Math.round(avgR / 7);
avgG = Math.round(avgG / 7);
avgB = Math.round(avgB / 7);
console.log(`\nAverage: RGB(${avgR}, ${avgG}, ${avgB})`);

// Create target array with this average color for all 7 pixels
const target = [];
for (let i = 0; i < 7; i++) {
    target.push({ r: avgR, g: avgG, b: avgB });
}

console.log('\n=== Evaluating byte 0xAA with this target ===\n');

// Calculate error for 0xAA
const error_AA = ditherer.calculateNTSCError(0x00, 0xAA, target, 0);
console.log(`Error for 0xAA: ${error_AA.toFixed(2)}`);

// Find what byte the algorithm picks
const bestByte = ditherer.findBestBytePattern(0x00, target, 0);
const error_best = ditherer.calculateNTSCError(0x00, bestByte, target, 0);

console.log(`\nAlgorithm chose: 0x${bestByte.toString(16).toUpperCase()}`);
console.log(`Error for chosen byte: ${error_best.toFixed(2)}`);

// Show the colors the chosen byte produces
const chosenColors = ditherer.renderNTSCColors(0x00, bestByte, 0);
console.log('\nColors that chosen byte produces:');
for (let i = 0; i < chosenColors.length; i++) {
    console.log(`  Pixel ${i}: RGB(${chosenColors[i].r}, ${chosenColors[i].g}, ${chosenColors[i].b})`);
}

// Calculate average of chosen
let chosenAvgR = 0, chosenAvgG = 0, chosenAvgB = 0;
for (const c of chosenColors) {
    chosenAvgR += c.r;
    chosenAvgG += c.g;
    chosenAvgB += c.b;
}
chosenAvgR = Math.round(chosenAvgR / 7);
chosenAvgG = Math.round(chosenAvgG / 7);
chosenAvgB = Math.round(chosenAvgB / 7);
console.log(`\nChosen average: RGB(${chosenAvgR}, ${chosenAvgG}, ${chosenAvgB})`);

console.log(`\n=== Does algorithm pick correct byte? ${bestByte === 0xAA ? 'YES ✓' : 'NO ✗'} ===`);

// Show top 10 candidates
console.log('\nTop 10 candidates by error:');
const results = [];
for (let byte = 0; byte < 256; byte++) {
    const error = ditherer.calculateNTSCError(0x00, byte, target, 0);
    results.push({ byte, error });
}
results.sort((a, b) => a.error - b.error);

for (let i = 0; i < 10; i++) {
    const r = results[i];
    const marker = r.byte === 0xAA ? ' ← TARGET' : '';
    console.log(`  ${i + 1}. 0x${r.byte.toString(16).toUpperCase().padStart(2, '0')} - error: ${r.error.toFixed(2)}${marker}`);
}
