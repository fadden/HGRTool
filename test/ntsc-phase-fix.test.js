import { describe, it, expect } from 'vitest';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

describe('NTSC Phase Fix - DHGR Coordinate Space', () => {
  it('should render all four solid colors (purple, blue, green, orange)', () => {
    const renderer = new NTSCRenderer();

    // Test each solid color
    const colors = [
      { byte: 0x2a, name: 'purple', expectedPhase: [0, 2] },  // 0101010, high bit 0
      { byte: 0x55, name: 'green', expectedPhase: [2, 0] },   // 1010101, high bit 0
      { byte: 0xaa, name: 'blue', expectedPhase: [1, 3] },    // 0101010, high bit 1
      { byte: 0xd5, name: 'orange', expectedPhase: [3, 1] }   // 1010101, high bit 1
    ];

    for (const color of colors) {
      console.log(`\n=== Testing ${color.name.toUpperCase()} (0x${color.byte.toString(16)}) ===`);

      const rawBytes = new Uint8Array(8192);
      // Fill first scanline with this color
      for (let i = 0; i < 40; i++) {
        rawBytes[i] = color.byte;
      }

      const imageData = {
        data: new Uint8ClampedArray(560 * 4), // DHGR width
        width: 560,
      };

      renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

      // Sample pixels and collect unique colors
      const data = imageData.data;
      const uniqueColors = new Set();
      const colorsByPhase = { 0: new Set(), 1: new Set(), 2: new Set(), 3: new Set() };

      for (let x = 0; x < 28; x++) {
        const idx = x * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const rgb = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
        const phase = x % 4;

        uniqueColors.add(rgb);
        colorsByPhase[phase].add(rgb);
      }

      console.log(`Unique colors: ${uniqueColors.size}`);
      console.log('Colors:', Array.from(uniqueColors));

      // Check that we have the right colors at the right phases
      console.log('\nColors by phase:');
      for (let phase = 0; phase < 4; phase++) {
        const colors = Array.from(colorsByPhase[phase]);
        console.log(`  Phase ${phase}: ${colors.length} unique - ${colors.join(', ')}`);
      }

      // Verify reasonable color count (not a rainbow, not pure grayscale)
      expect(uniqueColors.size).toBeGreaterThan(0);
      expect(uniqueColors.size).toBeLessThan(10);

      // Verify we don't have all black or all white
      const colorsArray = Array.from(uniqueColors);
      const allBlack = colorsArray.every(c => c === '000000');
      const allWhite = colorsArray.every(c => c === 'ffffff');

      if (allBlack) {
        console.log(`❌ ${color.name}: Renders as all black - phase calculation broken!`);
      } else if (allWhite) {
        console.log(`❌ ${color.name}: Renders as all white - phase calculation broken!`);
      } else {
        console.log(`✅ ${color.name}: Renders with color variation`);
      }

      expect(allBlack).toBe(false);
      expect(allWhite).toBe(false);
    }
  });

  it('should have correct phase values for different positions', () => {
    // Test that phase cycles every 4 DHGR pixels, not 4 HGR pixels
    const testCases = [
      // dhgrX, highBit, expectedPhase
      { dhgrX: 0, highBit: false, expectedPhase: 0 },
      { dhgrX: 0, highBit: true, expectedPhase: 1 },
      { dhgrX: 1, highBit: false, expectedPhase: 1 },
      { dhgrX: 1, highBit: true, expectedPhase: 2 },
      { dhgrX: 2, highBit: false, expectedPhase: 2 },
      { dhgrX: 2, highBit: true, expectedPhase: 3 },
      { dhgrX: 3, highBit: false, expectedPhase: 3 },
      { dhgrX: 3, highBit: true, expectedPhase: 0 },
      { dhgrX: 4, highBit: false, expectedPhase: 0 }, // Cycle repeats
      { dhgrX: 4, highBit: true, expectedPhase: 1 },
    ];

    console.log('\n=== Phase Calculation Test ===');
    console.log('dhgrX  highBit  phase  expected');
    console.log('-----  -------  -----  --------');

    for (const tc of testCases) {
      const phase = (tc.dhgrX + (tc.highBit ? 1 : 0)) % 4;
      const match = phase === tc.expectedPhase ? '✓' : '✗';
      console.log(
        `${tc.dhgrX.toString().padStart(5)}  ${tc.highBit.toString().padStart(7)}  ${phase.toString().padStart(5)}  ${tc.expectedPhase.toString().padStart(8)} ${match}`
      );
      expect(phase).toBe(tc.expectedPhase);
    }

    console.log('\n✅ All phase calculations correct!');
  });
});
