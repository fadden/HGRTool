import { describe, it, expect } from 'vitest';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

describe('NTSC Orange Bug - Detailed Analysis', () => {
  it('should test correct orange byte value 0x80', () => {
    const renderer = new NTSCRenderer();

    // Orange is 0x80 (high bit set, all lower bits clear)
    const orangeByte = 0x80;
    const rawBytes = new Uint8Array(8192);

    // Fill first scanline with orange
    for (let i = 0; i < 40; i++) {
      rawBytes[i] = orangeByte;
    }

    const imageData = {
      data: new Uint8ClampedArray(280 * 4),
      width: 280,
    };

    renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

    // Analyze first 28 pixels (4 complete phase cycles)
    const data = imageData.data;
    const pixels = [];

    for (let x = 0; x < 28; x++) {
      const idx = x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const rgb = (r << 16) | (g << 8) | b;
      const phase = x % 4;

      pixels.push({
        x,
        phase,
        rgb: rgb.toString(16).padStart(6, '0'),
        r,
        g,
        b
      });
    }

    console.log('\n=== ORANGE (0x80) RENDERING ===');
    console.log('First 28 pixels (4 complete phase cycles):');
    console.log('X    Phase  RGB       R   G   B');
    console.log('---  -----  ------  ---  ---  ---');
    for (const p of pixels) {
      console.log(`${p.x.toString().padStart(3)}  ${p.phase}      ${p.rgb}  ${p.r.toString().padStart(3)}  ${p.g.toString().padStart(3)}  ${p.b.toString().padStart(3)}`);
    }

    // Count unique colors
    const uniqueRgbs = new Set(pixels.map(p => p.rgb));
    console.log(`\nUnique colors found: ${uniqueRgbs.size}`);
    console.log('Colors:', Array.from(uniqueRgbs));

    // Group by phase
    const byPhase = { 0: [], 1: [], 2: [], 3: [] };
    for (const p of pixels) {
      byPhase[p.phase].push(p.rgb);
    }

    console.log('\nColors by phase:');
    for (let phase = 0; phase < 4; phase++) {
      const colors = new Set(byPhase[phase]);
      console.log(`Phase ${phase}: ${colors.size} unique colors - ${Array.from(colors).join(', ')}`);
    }

    // Check if we have rainbow (many colors) or consistent pattern
    if (uniqueRgbs.size > 8) {
      console.log('\n🚨 RAINBOW BUG DETECTED - Too many unique colors for solid fill!');
    } else {
      console.log('\n✅ Reasonable color count for NTSC rendering');
    }
  });

  it('should trace DHGR bit expansion for orange (0x80, 0x80)', () => {
    const byte1 = 0x80;
    const byte2 = 0x80;

    console.log('\n=== DHGR BIT EXPANSION FOR ORANGE (0x80, 0x80) ===');

    const dhgrBits = NTSCRenderer.hgrToDhgr[byte1][byte2];
    console.log(`dhgrBits: 0x${dhgrBits.toString(16).padStart(8, '0')}`);
    console.log(`Binary (32-bit): ${dhgrBits.toString(2).padStart(32, '0')}`);

    console.log('\nPattern extraction (sliding window):');
    console.log('Bit  Shift  Pattern (hex)  Pattern (binary)');
    console.log('---  -----  ------------  -----------------');

    const patterns = [];
    for (let bit = 0; bit < 7; bit++) {
      const shift = bit * 2;
      const pattern = (dhgrBits >> shift) & 0x7f;
      patterns.push(pattern);

      console.log(`${bit}    ${shift.toString().padStart(2)}     0x${pattern.toString(16).padStart(2, '0')}           ${pattern.toString(2).padStart(7, '0')}`);
    }

    const uniquePatterns = new Set(patterns);
    console.log(`\nUnique patterns: ${uniquePatterns.size}`);
    console.log('Patterns:', Array.from(uniquePatterns).map(p => `0x${p.toString(16)}`).join(', '));

    if (uniquePatterns.size > 2) {
      console.log('\n🚨 ISSUE: Too many unique patterns for solid color!');
      console.log('Expected: 1-2 patterns that repeat');
      console.log('This causes different palette lookups for each pixel');
    }
  });

  it('should test different HGR color bytes', () => {
    const renderer = new NTSCRenderer();

    const testBytes = [
      { name: 'Black', byte: 0x00 },
      { name: 'Green', byte: 0x2a },
      { name: 'Purple', byte: 0x55 },
      { name: 'White', byte: 0x7f },
      { name: 'Orange (high bit)', byte: 0x80 },
      { name: 'Blue (high bit)', byte: 0xaa },
    ];

    console.log('\n=== TESTING DIFFERENT HGR COLORS ===\n');

    for (const test of testBytes) {
      const rawBytes = new Uint8Array(8192);
      for (let i = 0; i < 40; i++) {
        rawBytes[i] = test.byte;
      }

      const imageData = {
        data: new Uint8ClampedArray(280 * 4),
        width: 280,
      };

      renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

      // Count unique colors in first 28 pixels
      const uniqueColors = new Set();
      for (let x = 0; x < 28; x++) {
        const idx = x * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const rgb = (r << 16) | (g << 8) | b;
        uniqueColors.add(rgb.toString(16).padStart(6, '0'));
      }

      console.log(`${test.name} (0x${test.byte.toString(16).padStart(2, '0')}): ${uniqueColors.size} unique colors`);
      if (uniqueColors.size <= 4) {
        console.log(`  Colors: ${Array.from(uniqueColors).join(', ')}`);
      }
    }
  });
});
