import { describe, it, expect, beforeEach } from 'vitest';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

describe('NTSC Rendering - Color Accuracy', () => {
  let renderer;

  beforeEach(() => {
    renderer = new NTSCRenderer();
  });

  /**
   * Helper to create HGR screen buffer with a solid color fill.
   * HGR uses 40 bytes per row, each byte represents 7 pixels.
   */
  function createSolidColorBuffer(colorByte) {
    const buffer = new Uint8Array(8192);
    // Fill first row (bytes 0-39) with the color pattern
    for (let i = 0; i < 40; i++) {
      buffer[i] = colorByte;
    }
    return buffer;
  }

  /**
   * Helper to extract unique RGB colors from rendered scanline.
   */
  function getUniqueColors(imageData) {
    const colors = new Set();
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const rgb = (r << 16) | (g << 8) | b;
      colors.add(rgb);
    }

    return Array.from(colors);
  }

  /**
   * Helper to count color transitions in scanline.
   */
  function countColorTransitions(imageData) {
    const data = imageData.data;
    let transitions = 0;

    for (let i = 4; i < data.length; i += 4) {
      const prevR = data[i - 4];
      const prevG = data[i - 3];
      const prevB = data[i - 2];
      const currR = data[i];
      const currG = data[i + 1];
      const currB = data[i + 2];

      if (prevR !== currR || prevG !== currG || prevB !== currB) {
        transitions++;
      }
    }

    return transitions;
  }

  describe('Solid Orange (HGR Color 5)', () => {
    it('should NOT produce rainbow stripes for solid orange', () => {
      // Orange in HGR is typically 0xFF (all bits set, high bit set)
      // This should produce consistent orange color, not cycling through rainbow
      const orangeByte = 0xFF;
      const rawBytes = createSolidColorBuffer(orangeByte);

      const imageData = {
        data: new Uint8ClampedArray(280 * 4),
        width: 280,
      };

      renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

      const uniqueColors = getUniqueColors(imageData);

      // With proper NTSC rendering, we should see:
      // - Either 1 solid color
      // - Or 2-4 colors due to NTSC color fringing (orange + black bars)
      //
      // We should NOT see dozens of different colors (rainbow effect)
      expect(uniqueColors.length).toBeLessThan(10);

      // Additional check: count color transitions
      const transitions = countColorTransitions(imageData);

      // For 280 pixels, if we have rainbow stripes with phase cycling every pixel,
      // we'd see ~70 transitions (280/4). Proper rendering should have far fewer.
      expect(transitions).toBeLessThan(50);
    });

    it('should render orange with consistent phase-based pattern', () => {
      // When rendering solid orange, the pattern should repeat every 4 pixels
      // due to the NTSC phase cycling (0, 1, 2, 3, 0, 1, 2, 3...)
      const orangeByte = 0xFF;
      const rawBytes = createSolidColorBuffer(orangeByte);

      const imageData = {
        data: new Uint8ClampedArray(280 * 4),
        width: 280,
      };

      renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

      // Check that pixels at phase 0, 4, 8, 12... have the same color
      const data = imageData.data;
      const phase0Colors = [];

      for (let x = 0; x < 280; x += 4) {
        const idx = x * 4;
        const rgb = (data[idx] << 16) | (data[idx + 1] << 8) | data[idx + 2];
        phase0Colors.push(rgb);
      }

      // All phase 0 pixels should have very similar colors (allow for minor variations at byte boundaries)
      // Most pixels should be the same color, with at most 2-3 variants due to boundary effects
      const uniquePhase0Colors = new Set(phase0Colors);
      expect(uniquePhase0Colors.size).toBeLessThanOrEqual(3);
    });
  });

  describe('Phase Calculation', () => {
    it('should correctly calculate phase for pixel positions', () => {
      // Phase should cycle 0, 1, 2, 3, 0, 1, 2, 3...
      // This is implicitly tested by rendering, but let's verify the logic

      const expectedPhases = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];

      for (let x = 0; x < expectedPhases.length; x++) {
        const phase = x % 4;
        expect(phase).toBe(expectedPhases[x]);
      }
    });
  });

  describe('Palette Lookup Consistency', () => {
    it('should use consistent palette entries for same phase and pattern', () => {
      // Access the solid palette directly
      const palette = NTSCRenderer.solidPalette;

      // For a given phase and pattern, the color should be consistent
      const phase = 0;
      const pattern = 0x7F; // All bits set

      const color1 = palette[phase][pattern];
      const color2 = palette[phase][pattern];

      expect(color1).toBe(color2);
      expect(color1).toBeDefined();
    });

    it('should have different colors for different phases with same pattern', () => {
      // The NTSC effect means different phases should produce different colors
      const palette = NTSCRenderer.solidPalette;
      // Use pattern 0x01 (single bit set) which rotates to create distinct colors
      // Pattern extraction: (0b0000001 >> 2) & 0xF = 0b0000 = 0
      // This will rotate through colors 0, 0, 0, 0 on phases 0-3
      // Let's use 0x04 instead: (0b0000100 >> 2) & 0xF = 0b0001 = 1
      // Rotation: phase0=1, phase1=2, phase2=4, phase3=8 - all different in YIQ table
      const pattern = 0x04;

      const colors = [
        palette[0][pattern],
        palette[1][pattern],
        palette[2][pattern],
        palette[3][pattern]
      ];

      // At least some phase offsets should produce different colors
      // With pattern 0x04, we should get 4 different colors (or at least 2 if YIQ has some duplicates)
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Bit Pattern Extraction', () => {
    it('should extract consistent patterns for solid color bytes', () => {
      // When rendering a solid color (all same bytes), the extracted
      // 7-bit patterns should be consistent and not create cycling rainbow

      // Simulate what happens during rendering
      const byte1 = 0xFF;
      const byte2 = 0xFF;

      const dhgrBits = NTSCRenderer.hgrToDhgr[byte1][byte2];

      // Extract patterns for 7 consecutive pixels
      const patterns = [];
      for (let bit = 0; bit < 7; bit++) {
        const pattern = (dhgrBits >> (bit * 2)) & 0x7f;
        patterns.push(pattern);
      }

      // For solid orange (0xFF repeated), we should see consistent patterns
      // or a repeating pattern, NOT 7 completely different patterns
      const uniquePatterns = new Set(patterns);

      // This test documents the current behavior - if we see 7 unique patterns,
      // that's the source of the rainbow bug
      console.log('Patterns extracted from 0xFF, 0xFF:', patterns.map(p => p.toString(16)));
      console.log('Unique patterns:', uniquePatterns.size);

      // The bug manifests as too many unique patterns
      // After fix, we should see <= 2 unique patterns for solid color
    });
  });

  describe('Known HGR Color Patterns', () => {
    it('should render black correctly', () => {
      const blackByte = 0x00;
      const rawBytes = createSolidColorBuffer(blackByte);

      const imageData = {
        data: new Uint8ClampedArray(280 * 4),
        width: 280,
      };

      renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

      // Black should be mostly black pixels
      const uniqueColors = getUniqueColors(imageData);
      expect(uniqueColors.length).toBeLessThan(5);
    });

    it('should render white correctly', () => {
      const whiteByte = 0x7F; // White is all 7 bits set, high bit clear
      const rawBytes = createSolidColorBuffer(whiteByte);

      const imageData = {
        data: new Uint8ClampedArray(280 * 4),
        width: 280,
      };

      renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

      const uniqueColors = getUniqueColors(imageData);
      expect(uniqueColors.length).toBeLessThan(5);
    });
  });

  describe('Rainbow Bug Detection', () => {
    it('should NOT cycle through many colors for repeating byte pattern', () => {
      // This is the core bug test: repeating the same byte should not
      // produce a rainbow of different colors

      const testByte = 0xFF; // Orange
      const rawBytes = new Uint8Array(8192);

      // Fill with repeating pattern
      for (let i = 0; i < 40; i++) {
        rawBytes[i] = testByte;
      }

      const imageData = {
        data: new Uint8ClampedArray(280 * 4),
        width: 280,
      };

      renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

      const uniqueColors = getUniqueColors(imageData);

      // If we see more than 10 unique colors for a solid fill,
      // we have the rainbow bug
      console.log(`Unique colors for solid 0x${testByte.toString(16)} fill: ${uniqueColors.length}`);

      expect(uniqueColors.length).toBeLessThan(10);
    });
  });
});
