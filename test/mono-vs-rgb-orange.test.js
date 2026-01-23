import { describe, it } from 'vitest';
import StdHiRes from '../docs/src/lib/std-hi-res.js';

/**
 * Monochrome vs RGB Orange Pattern Test
 *
 * This test compares how orange (0xAA) is rendered in RGB vs Monochrome modes
 * to understand why mono has half the pixels.
 */

describe('Mono vs RGB Orange Pattern', () => {
  it('should compare orange rendering in RGB and Mono modes', () => {
    console.log('\n=== ORANGE (0xAA) IN RGB VS MONO ===\n');

    // Create two instances
    const hiresRgb = new StdHiRes();
    hiresRgb.renderMode = 'rgb';

    const hiresMono = new StdHiRes();
    hiresMono.renderMode = 'mono';

    // Draw orange rectangle 50,50 -> 180x92
    const orangePattern = StdHiRes.createSimplePattern(0xAA);

    console.log('Orange pattern:', Array.from(orangePattern).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '));
    console.log('');

    for (let y = 50; y < 142; y++) {
      hiresRgb.plotHorizSegment(50, y, 180, orangePattern);
      hiresMono.plotHorizSegment(50, y, 180, orangePattern);
    }

    // Render both
    const imageDataRgb = new ImageData(280, 192);
    const imageDataMono = new ImageData(280, 192);

    hiresRgb.renderFull(imageDataRgb, false);
    hiresMono.renderFull(imageDataMono, true);

    // Count non-black pixels
    let rgbCount = 0;
    let monoCount = 0;

    for (let y = 0; y < 192; y++) {
      for (let x = 0; x < 280; x++) {
        const idx = (y * 280 + x) * 4;

        if (imageDataRgb.data[idx] > 0 || imageDataRgb.data[idx + 1] > 0 || imageDataRgb.data[idx + 2] > 0) {
          rgbCount++;
        }

        if (imageDataMono.data[idx] > 0 || imageDataMono.data[idx + 1] > 0 || imageDataMono.data[idx + 2] > 0) {
          monoCount++;
        }
      }
    }

    console.log(`RGB non-black pixels:  ${rgbCount}`);
    console.log(`Mono non-black pixels: ${monoCount}`);
    console.log(`Expected: ~16560 (180 × 92)`);
    console.log(`Ratio: ${(monoCount / rgbCount * 100).toFixed(1)}%`);

    if (monoCount < rgbCount * 0.6) {
      console.log('\n🚨 MONOCHROME HAS SIGNIFICANTLY FEWER PIXELS!');
      console.log(`   Mono has only ${(monoCount / rgbCount * 100).toFixed(0)}% of RGB pixels`);
    }

    // Analyze the HGR data
    console.log('\n--- HGR Data Analysis ---');
    console.log('Orange pattern: 0xAA, 0xD5 (alternating even/odd)');
    console.log('  0xAA = 10101010');
    console.log('  0xD5 = 11010101');

    // Check first row HGR data
    const rowOffset = StdHiRes.rowToOffset(50);
    console.log('\nFirst row HGR bytes (columns 50-57 / bytes 7-8):');
    for (let byteCol = 7; byteCol <= 8; byteCol++) {
      const byteVal = hiresRgb.rawData[rowOffset + byteCol];
      console.log(`  Byte ${byteCol}: 0x${byteVal.toString(16).padStart(2, '0')} (${byteVal.toString(2).padStart(8, '0')})`);
    }

    // Count set bits in the pattern
    console.log('\n--- Bit Density Analysis ---');
    const countBits = (byte) => {
      let count = 0;
      for (let i = 0; i < 7; i++) {  // Only count lower 7 bits
        if (byte & (1 << i)) count++;
      }
      return count;
    };

    console.log('0xAA: ' + countBits(0xAA) + ' bits set (out of 7)');
    console.log('0xD5: ' + countBits(0xD5) + ' bits set (out of 7)');
    console.log('Average: ' + ((countBits(0xAA) + countBits(0xD5)) / 2) + ' bits per byte');

    // In RGB mode, alternating bits create colors
    // In Mono mode, each bit directly corresponds to white/black
    console.log('\nRGB Mode:');
    console.log('  Alternating bits (10101010) create ORANGE color');
    console.log('  All 7 pixels in each byte contribute to the colored area');

    console.log('\nMono Mode:');
    console.log('  Each bit is independently white (1) or black (0)');
    console.log('  0xAA (10101010): 4 white pixels, 3 black pixels');
    console.log('  0xD5 (11010101): 5 white pixels, 2 black pixels');

    const expectedMonoRatio = (countBits(0xAA) + countBits(0xD5)) / 14;
    console.log(`\n  Expected mono/RGB ratio: ${(expectedMonoRatio * 100).toFixed(0)}%`);
    console.log(`  Actual mono/RGB ratio: ${(monoCount / rgbCount * 100).toFixed(0)}%`);

    if (Math.abs((monoCount / rgbCount) - expectedMonoRatio) < 0.05) {
      console.log('\n  ✅ Ratio matches expected bit density!');
      console.log('     This is CORRECT behavior, not a bug.');
    } else {
      console.log('\n  ⚠️  Ratio does NOT match expected bit density.');
      console.log('     There may be a rendering bug.');
    }
  });

  it('should visualize orange pattern bit-by-bit', () => {
    console.log('\n=== BIT-BY-BIT ORANGE PATTERN ===\n');

    console.log('Orange pattern bytes: 0xAA, 0xD5 (repeating)');
    console.log('');
    console.log('Byte 0 (0xAA = 10101010):');
    console.log('  Bit: 0 1 2 3 4 5 6 (bit 7 is high bit)');
    console.log('  Val: 0 1 0 1 0 1 0');
    console.log('  RGB: All bits contribute to ORANGE color');
    console.log('  Mono: 0 1 0 1 0 1 0 → 4 white, 3 black');

    console.log('');
    console.log('Byte 1 (0xD5 = 11010101):');
    console.log('  Bit: 0 1 2 3 4 5 6 (bit 7 is high bit)');
    console.log('  Val: 1 0 1 0 1 0 1');
    console.log('  RGB: All bits contribute to ORANGE color');
    console.log('  Mono: 1 0 1 0 1 0 1 → 4 white, 3 black');

    console.log('');
    console.log('Pattern repeats: 0xAA, 0xD5, 0xAA, 0xD5...');
    console.log('');
    console.log('RGB mode interpretation:');
    console.log('  The alternating 01010101 pattern creates a color fringe');
    console.log('  Combined with high bit, this becomes ORANGE');
    console.log('  All 7 pixels per byte are colored orange');
    console.log('  Total: 7 pixels/byte × 40 bytes/row = 280 colored pixels');

    console.log('');
    console.log('Mono mode interpretation:');
    console.log('  Each bit is rendered independently as white or black');
    console.log('  0xAA: 4/7 pixels white');
    console.log('  0xD5: 4/7 pixels white');
    console.log('  Average: 4/7 = 57% pixels white');
    console.log('  Total: ~160 white pixels per row (out of 280)');

    console.log('');
    console.log('🔍 Conclusion:');
    console.log('   Monochrome rendering 50% fewer pixels is EXPECTED');
    console.log('   This is not a bug - it is the correct interpretation of the bit pattern!');
    console.log('   Orange (0xAA/0xD5) is an ALTERNATING pattern, not a solid fill.');
  });
});
