/*
 * Extract actual NTSC palette RGB values for testing
 */

import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

// Initialize palettes
new NTSCRenderer();

// Wait for initialization
await new Promise(resolve => setTimeout(resolve, 100));

function unpackRGB(packed) {
    return {
        r: (packed >> 16) & 0xFF,
        g: (packed >> 8) & 0xFF,
        b: packed & 0xFF
    };
}

console.log('=== HGR NTSC Color Palette ===\n');

// Test common solid color bytes and extract their colors
const testBytes = [
    { name: 'Black', byte: 0x00, pattern: 0x00 },
    { name: 'White', byte: 0x7F, pattern: 0x7F },
    { name: 'Purple (hi-bit 0)', byte: 0x55, pattern: 0x55 },
    { name: 'Green (hi-bit 0)', byte: 0x2A, pattern: 0x2A },
    { name: 'Blue (hi-bit 1)', byte: 0xD5, pattern: 0x55 },
    { name: 'Orange (hi-bit 1)', byte: 0xAA, pattern: 0x2A },
];

console.log('Solid color bytes (repeated pattern):');
for (const test of testBytes) {
    // For a solid color, the 7-bit pattern repeats
    // Phase 0 is a good representative
    const packed = NTSCRenderer.solidPalette[0][test.pattern];
    const rgb = unpackRGB(packed);
    console.log(`${test.name.padEnd(25)} byte=0x${test.byte.toString(16).toUpperCase().padStart(2, '0')}  pattern=0x${test.pattern.toString(16).toUpperCase().padStart(2, '0')}  RGB=(${rgb.r}, ${rgb.g}, ${rgb.b})`);
}

console.log('\n=== Recommended Test Colors ===\n');

// Get colors that should produce solid output
const solidColors = [
    { name: 'Orange', byte: 0xAA, pattern: 0x2A },
    { name: 'Blue', byte: 0xD5, pattern: 0x55 },
    { name: 'Purple', byte: 0x55, pattern: 0x55 },
    { name: 'Green', byte: 0x2A, pattern: 0x2A },
    { name: 'Black', byte: 0x00, pattern: 0x00 },
    { name: 'White', byte: 0x7F, pattern: 0x7F },
];

console.log('Use these RGB values in tests:');
for (const color of solidColors) {
    const packed = NTSCRenderer.solidPalette[0][color.pattern];
    const rgb = unpackRGB(packed);
    console.log(`${color.name}: { r: ${rgb.r}, g: ${rgb.g}, b: ${rgb.b} }`);
}

console.log('\n=== Phase Variation ===\n');

// Show how colors vary by phase
console.log('Orange pattern (0x2A) across phases:');
for (let phase = 0; phase < 4; phase++) {
    const packed = NTSCRenderer.solidPalette[phase][0x2A];
    const rgb = unpackRGB(packed);
    console.log(`  Phase ${phase}: RGB=(${rgb.r}, ${rgb.g}, ${rgb.b})`);
}

console.log('\nBlue pattern (0x55) across phases:');
for (let phase = 0; phase < 4; phase++) {
    const packed = NTSCRenderer.solidPalette[phase][0x55];
    const rgb = unpackRGB(packed);
    console.log(`  Phase ${phase}: RGB=(${rgb.r}, ${rgb.g}, ${rgb.b})`);
}
