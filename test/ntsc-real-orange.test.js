import { describe, it } from 'vitest';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';
import StdHiRes from '../docs/src/lib/std-hi-res.js';

describe('NTSC Real Orange Pattern Analysis', () => {
  it('should analyze what createSimplePattern(0x80) produces', () => {
    const orangePattern = StdHiRes.createSimplePattern(0x80);

    console.log('\n=== ORANGE PATTERN FROM createSimplePattern(0x80) ===');
    console.log('Pattern bytes:', Array.from(orangePattern).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '));

    // Pattern is 8 bytes: 4 for even rows, 4 for odd rows
    console.log('\nEven row pattern (bytes 0-3):', Array.from(orangePattern.slice(0, 4)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '));
    console.log('Odd row pattern (bytes 4-7):', Array.from(orangePattern.slice(4, 8)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '));
  });

  it('should render orange using the actual pattern that would be drawn', () => {
    const renderer = new NTSCRenderer();
    const orangePattern = StdHiRes.createSimplePattern(0x80);

    console.log('\n=== RENDERING ORANGE USING ACTUAL DRAW PATTERN ===');

    // Simulate what happens when user draws orange on the screen
    // The pattern repeats every 4 bytes
    const rawBytes = new Uint8Array(8192);

    // Fill first row with the even-row pattern (bytes 0-3 of orangePattern)
    for (let i = 0; i < 40; i++) {
      rawBytes[i] = orangePattern[i % 4];
    }

    const imageData = {
      data: new Uint8ClampedArray(280 * 4),
      width: 280,
    };

    renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

    // Analyze first 28 pixels
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

    console.log('\nFirst 28 pixels:');
    console.log('X    Phase  RGB       R   G   B');
    console.log('---  -----  ------  ---  ---  ---');
    for (const p of pixels) {
      console.log(`${p.x.toString().padStart(3)}  ${p.phase}      ${p.rgb}  ${p.r.toString().padStart(3)}  ${p.g.toString().padStart(3)}  ${p.b.toString().padStart(3)}`);
    }

    // Count unique colors
    const uniqueRgbs = new Set(pixels.map(p => p.rgb));
    console.log(`\nUnique colors found: ${uniqueRgbs.size}`);

    // Group by phase
    const byPhase = { 0: [], 1: [], 2: [], 3: [] };
    for (const p of pixels) {
      byPhase[p.phase].push(p.rgb);
    }

    console.log('\nColors by phase:');
    for (let phase = 0; phase < 4; phase++) {
      const colors = new Set(byPhase[phase]);
      console.log(`Phase ${phase}: ${colors.size} unique - ${Array.from(colors).join(', ')}`);
    }

    // Check for rainbow
    if (uniqueRgbs.size > 8) {
      console.log('\n🚨 RAINBOW BUG DETECTED!');
    } else {
      console.log('\n✅ Color count looks reasonable');
    }
  });

  it('should trace DHGR expansion for the actual orange pattern bytes', () => {
    const orangePattern = StdHiRes.createSimplePattern(0x80);

    console.log('\n=== DHGR BIT EXPANSION FOR ORANGE PATTERN ===');

    // Check what happens for consecutive bytes in the pattern
    for (let i = 0; i < 3; i++) {
      const byte1 = orangePattern[i];
      const byte2 = orangePattern[i + 1];

      console.log(`\nBytes [${i}] and [${i+1}]: 0x${byte1.toString(16).padStart(2, '0')}, 0x${byte2.toString(16).padStart(2, '0')}`);

      const dhgrBits = NTSCRenderer.hgrToDhgr[byte1][byte2];
      console.log(`dhgrBits: 0x${dhgrBits.toString(16).padStart(8, '0')} (${dhgrBits.toString(2).padStart(32, '0')})`);

      // Extract patterns for each of 7 pixels
      const patterns = [];
      for (let bit = 0; bit < 7; bit++) {
        const pattern = (dhgrBits >> (bit * 2)) & 0x7f;
        patterns.push(`0x${pattern.toString(16)}`);
      }

      const uniquePatterns = new Set(patterns);
      console.log(`  7 extracted patterns: ${patterns.join(', ')}`);
      console.log(`  Unique: ${uniquePatterns.size} patterns`);
    }
  });

  it('should compare all 7 bytes of a row to understand the full pattern', () => {
    const orangePattern = StdHiRes.createSimplePattern(0x80);
    const renderer = new NTSCRenderer();

    console.log('\n=== FULL ROW ANALYSIS (40 BYTES) ===');

    const rawBytes = new Uint8Array(8192);
    for (let i = 0; i < 40; i++) {
      rawBytes[i] = orangePattern[i % 4];
    }

    // Show what bytes are in the first 40 positions
    console.log('\nFirst 40 HGR bytes:');
    const byteStr = [];
    for (let i = 0; i < 40; i++) {
      byteStr.push(`0x${rawBytes[i].toString(16).padStart(2, '0')}`);
    }
    console.log(byteStr.join(' '));

    // Render and count colors across full width
    const imageData = {
      data: new Uint8ClampedArray(280 * 4),
      width: 280,
    };

    renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

    // Count all unique colors in the full 280-pixel scanline
    const uniqueColors = new Set();
    for (let x = 0; x < 280; x++) {
      const idx = x * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const rgb = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
      uniqueColors.add(rgb);
    }

    console.log(`\nTotal unique colors in 280 pixels: ${uniqueColors.size}`);
    console.log('Colors:', Array.from(uniqueColors).sort());

    if (uniqueColors.size > 12) {
      console.log('\n🚨 RAINBOW BUG: Too many colors for a solid orange fill!');
      console.log('Expected: 1-4 colors (solid or NTSC artifact pattern)');
      console.log(`Actual: ${uniqueColors.size} colors (cycling rainbow effect)`);
    }
  });
});
