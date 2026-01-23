/*
 * Extract actual rendered colors by simulating HGR bytes
 */

import ImageDither from '../docs/src/lib/image-dither.js';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

// Initialize
new NTSCRenderer();
const ditherer = new ImageDither();

console.log('=== Actual HGR Rendered Colors ===\n');

// Test bytes that should produce solid colors
const testCases = [
    { name: 'Orange (0xAA hi-bit 1)', byte: 0xAA },
    { name: 'Blue (0xD5 hi-bit 1)', byte: 0xD5 },
    { name: 'Purple (0x55 hi-bit 0)', byte: 0x55 },
    { name: 'Green (0x2A hi-bit 0)', byte: 0x2A },
    { name: 'Black (0x00)', byte: 0x00 },
    { name: 'White (0x7F)', byte: 0x7F },
    { name: 'White (0xFF)', byte: 0xFF },
];

for (const test of testCases) {
    console.log(`${test.name}:`);

    // Render this byte repeated across positions to see typical color
    // prevByte doesn't matter much for repeating patterns
    const prevByte = test.byte;

    // Get colors at different positions (phase matters)
    for (let byteX = 0; byteX < 4; byteX++) {
        const colors = ditherer.renderNTSCColors(prevByte, test.byte, byteX);

        // Get middle pixel (position 3) as representative
        const representative = colors[3];
        console.log(`  byteX=${byteX} (phase offset): pixel[3] = RGB(${representative.r}, ${representative.g}, ${representative.b})`);
    }

    // Average across all 7 pixels at byteX=0
    const colors = ditherer.renderNTSCColors(test.byte, test.byte, 0);
    let avgR = 0, avgG = 0, avgB = 0;
    for (const c of colors) {
        avgR += c.r;
        avgG += c.g;
        avgB += c.b;
    }
    avgR = Math.round(avgR / 7);
    avgG = Math.round(avgG / 7);
    avgB = Math.round(avgB / 7);

    console.log(`  Average across 7 pixels: RGB(${avgR}, ${avgG}, ${avgB})`);
    console.log();
}

console.log('=== Recommended Test Colors (Use Averages) ===\n');

const recommendations = [
    { name: 'Orange', byte: 0xAA },
    { name: 'Blue', byte: 0xD5 },
    { name: 'Purple', byte: 0x55 },
    { name: 'Green', byte: 0x2A },
];

for (const rec of recommendations) {
    const colors = ditherer.renderNTSCColors(rec.byte, rec.byte, 0);
    let avgR = 0, avgG = 0, avgB = 0;
    for (const c of colors) {
        avgR += c.r;
        avgG += c.g;
        avgB += c.b;
    }
    avgR = Math.round(avgR / 7);
    avgG = Math.round(avgG / 7);
    avgB = Math.round(avgB / 7);

    console.log(`const ${rec.name.toLowerCase()}Color = { r: ${avgR}, g: ${avgG}, b: ${avgB} };`);
}
