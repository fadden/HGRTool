/*
 * Test odd/even byte position color differences
 */

import ImageDither from '../docs/src/lib/image-dither.js';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

new NTSCRenderer();
const ditherer = new ImageDither();

console.log('=== Byte 0xAA (Orange) at Different Positions ===\n');

// Render byte 0xAA with itself as previous byte (simulating repeating pattern)
for (let byteX = 0; byteX < 8; byteX++) {
    const colors = ditherer.renderNTSCColors(0xAA, 0xAA, byteX);

    // Calculate average
    let avgR = 0, avgG = 0, avgB = 0;
    for (const c of colors) {
        avgR += c.r;
        avgG += c.g;
        avgB += c.b;
    }
    avgR = Math.round(avgR / 7);
    avgG = Math.round(avgG / 7);
    avgB = Math.round(avgB / 7);

    const evenOdd = byteX % 2 === 0 ? 'EVEN' : 'ODD ';
    console.log(`byteX=${byteX} (${evenOdd}): avg RGB(${avgR}, ${avgG}, ${avgB})`);
    console.log(`  Pixels:`, colors.map(c => `(${c.r},${c.g},${c.b})`).join(' '));
}

console.log('\n=== Byte 0xD5 (Blue) at Different Positions ===\n');

for (let byteX = 0; byteX < 8; byteX++) {
    const colors = ditherer.renderNTSCColors(0xD5, 0xD5, byteX);

    let avgR = 0, avgG = 0, avgB = 0;
    for (const c of colors) {
        avgR += c.r;
        avgG += c.g;
        avgB += c.b;
    }
    avgR = Math.round(avgR / 7);
    avgG = Math.round(avgG / 7);
    avgB = Math.round(avgB / 7);

    const evenOdd = byteX % 2 === 0 ? 'EVEN' : 'ODD ';
    console.log(`byteX=${byteX} (${evenOdd}): avg RGB(${avgR}, ${avgG}, ${avgB})`);
}

console.log('\n=== Byte 0x55 (Purple) at Different Positions ===\n');

for (let byteX = 0; byteX < 8; byteX++) {
    const colors = ditherer.renderNTSCColors(0x55, 0x55, byteX);

    let avgR = 0, avgG = 0, avgB = 0;
    for (const c of colors) {
        avgR += c.r;
        avgG += c.g;
        avgB += c.b;
    }
    avgR = Math.round(avgR / 7);
    avgG = Math.round(avgG / 7);
    avgB = Math.round(avgB / 7);

    const evenOdd = byteX % 2 === 0 ? 'EVEN' : 'ODD ';
    console.log(`byteX=${byteX} (${evenOdd}): avg RGB(${avgR}, ${avgG}, ${avgB})`);
}

console.log('\n=== Pattern Analysis ===\n');

// Check if there's a repeating pattern
console.log('If colors repeat every 2 bytes (odd/even), we should use:');
console.log('- Even byte target: average of byteX=0,2,4,6');
console.log('- Odd byte target: average of byteX=1,3,5,7');

let evenR = 0, evenG = 0, evenB = 0;
let oddR = 0, oddG = 0, oddB = 0;

for (let byteX = 0; byteX < 8; byteX++) {
    const colors = ditherer.renderNTSCColors(0xAA, 0xAA, byteX);
    let avgR = 0, avgG = 0, avgB = 0;
    for (const c of colors) {
        avgR += c.r;
        avgG += c.g;
        avgB += c.b;
    }

    if (byteX % 2 === 0) {
        evenR += avgR / 7;
        evenG += avgG / 7;
        evenB += avgB / 7;
    } else {
        oddR += avgR / 7;
        oddG += avgG / 7;
        oddB += avgB / 7;
    }
}

evenR = Math.round(evenR / 4);
evenG = Math.round(evenG / 4);
evenB = Math.round(evenB / 4);
oddR = Math.round(oddR / 4);
oddG = Math.round(oddG / 4);
oddB = Math.round(oddB / 4);

console.log(`\nOrange (0xAA):`);
console.log(`  Even bytes: RGB(${evenR}, ${evenG}, ${evenB})`);
console.log(`  Odd bytes:  RGB(${oddR}, ${oddG}, ${oddB})`);
