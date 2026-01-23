import { describe, it } from 'vitest';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

describe('NTSC Rainbow Bug - True Reproduction', () => {
  it('should test orange with actual pixel data 0xAA', () => {
    const renderer = new NTSCRenderer();

    // Orange with alternating pixels: 0xAA = 10101010
    const orangeByte = 0xAA;
    const rawBytes = new Uint8Array(8192);

    for (let i = 0; i < 40; i++) {
      rawBytes[i] = orangeByte;
    }

    const imageData = {
      data: new Uint8ClampedArray(280 * 4),
      width: 280,
    };

    renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

    // Analyze first 56 pixels (8 bytes * 7 pixels/byte)
    const data = imageData.data;
    const pixels = [];

    for (let x = 0; x < 56; x++) {
      const idx = x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const rgb = (r << 16) | (g << 8) | b;

      pixels.push(rgb.toString(16).padStart(6, '0'));
    }

    console.log('\n=== ORANGE (0xAA = 10101010) RENDERING ===');
    console.log('First 56 pixels (8 complete 7-pixel groups):');

    // Show in groups of 7
    for (let i = 0; i < 56; i += 7) {
      const group = pixels.slice(i, i + 7);
      console.log(`Pixels ${i.toString().padStart(2)}-${(i+6).toString().padStart(2)}: ${group.join(' ')}`);
    }

    const uniqueColors = new Set(pixels);
    console.log(`\nUnique colors: ${uniqueColors.size}`);
    console.log('Colors:', Array.from(uniqueColors).sort());

    if (uniqueColors.size > 10) {
      console.log('\n🚨 RAINBOW BUG CONFIRMED!');
    }
  });

  it('should test orange 0xD5 pattern', () => {
    const renderer = new NTSCRenderer();

    // Orange with different pattern: 0xD5 = 11010101
    const orangeByte = 0xD5;
    const rawBytes = new Uint8Array(8192);

    for (let i = 0; i < 40; i++) {
      rawBytes[i] = orangeByte;
    }

    const imageData = {
      data: new Uint8ClampedArray(280 * 4),
      width: 280,
    };

    renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

    const pixels = [];
    for (let x = 0; x < 56; x++) {
      const idx = x * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const rgb = (r << 16) | (g << 8) | b;
      pixels.push(rgb.toString(16).padStart(6, '0'));
    }

    console.log('\n=== ORANGE (0xD5 = 11010101) RENDERING ===');
    for (let i = 0; i < 56; i += 7) {
      const group = pixels.slice(i, i + 7);
      console.log(`Pixels ${i.toString().padStart(2)}-${(i+6).toString().padStart(2)}: ${group.join(' ')}`);
    }

    const uniqueColors = new Set(pixels);
    console.log(`\nUnique colors: ${uniqueColors.size}`);
    console.log('Colors:', Array.from(uniqueColors).sort());

    if (uniqueColors.size > 10) {
      console.log('\n🚨 RAINBOW BUG CONFIRMED!');
    }
  });

  it('should trace DHGR expansion to understand the bug mechanism', () => {
    console.log('\n=== DHGR EXPANSION ANALYSIS ===');

    const testBytes = [0xAA, 0xD5, 0xFF];

    for (const byte of testBytes) {
      console.log(`\n--- Byte 0x${byte.toString(16).padStart(2, '0')} (${byte.toString(2).padStart(8, '0')}) ---`);

      const dhgrBits = NTSCRenderer.hgrToDhgr[byte][byte];
      console.log(`dhgrBits: 0x${dhgrBits.toString(16).padStart(8, '0')}`);

      // Extract 7 patterns (one for each pixel in the byte)
      const patterns = [];
      for (let bit = 0; bit < 7; bit++) {
        const pattern = (dhgrBits >> (bit * 2)) & 0x7f;
        patterns.push(pattern);
      }

      const uniquePatterns = new Set(patterns);
      console.log(`7 patterns extracted: ${patterns.map(p => `0x${p.toString(16)}`).join(' ')}`);
      console.log(`Unique patterns: ${uniquePatterns.size}`);

      if (uniquePatterns.size > 2) {
        console.log('⚠️  Too many unique patterns - will cause color cycling!');
      }
    }
  });

  it('should show exactly what colors appear for 0xAA across phases', () => {
    const renderer = new NTSCRenderer();
    const orangeByte = 0xAA;
    const rawBytes = new Uint8Array(8192);

    for (let i = 0; i < 40; i++) {
      rawBytes[i] = orangeByte;
    }

    const imageData = {
      data: new Uint8ClampedArray(280 * 4),
      width: 280,
    };

    renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

    console.log('\n=== COLOR-BY-PHASE ANALYSIS FOR 0xAA ===');
    console.log('X    Phase  RGB');
    console.log('---  -----  ------');

    const byPhase = { 0: new Set(), 1: new Set(), 2: new Set(), 3: new Set() };

    for (let x = 0; x < 56; x++) {
      const idx = x * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const rgb = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
      const phase = x % 4;

      if (x < 28) {
        console.log(`${x.toString().padStart(3)}  ${phase}      ${rgb}`);
      }

      byPhase[phase].add(rgb);
    }

    console.log('\nColors grouped by phase:');
    for (let phase = 0; phase < 4; phase++) {
      console.log(`Phase ${phase}: ${byPhase[phase].size} unique - ${Array.from(byPhase[phase]).sort().join(', ')}`);
    }

    // Calculate if we have rainbow
    const totalUnique = new Set([...byPhase[0], ...byPhase[1], ...byPhase[2], ...byPhase[3]]).size;
    console.log(`\nTotal unique colors across all phases: ${totalUnique}`);

    if (totalUnique > 8) {
      console.log('🚨 RAINBOW BUG: Colors cycling through spectrum instead of consistent orange/black pattern');
    }
  });
});
