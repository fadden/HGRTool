import { describe, it, expect, beforeEach } from 'vitest';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

describe('NTSCRenderer', () => {
  let renderer;

  beforeEach(() => {
    renderer = new NTSCRenderer();
  });

  describe('initialization', () => {
    it('should create an instance', () => {
      expect(renderer).toBeInstanceOf(NTSCRenderer);
    });

    it('should initialize palettes', () => {
      expect(NTSCRenderer.solidPalette).toBeDefined();
      expect(NTSCRenderer.solidPalette.length).toBe(4);
      expect(NTSCRenderer.solidPalette[0].length).toBe(128);
    });

    // Note: textPalette removed in favor of solidPalette (OutlawEditor algorithm)

    it('should initialize HGR to DHGR conversion tables', () => {
      expect(NTSCRenderer.hgrToDhgr).toBeDefined();
      expect(NTSCRenderer.hgrToDhgr.length).toBe(512);
      expect(NTSCRenderer.hgrToDhgrBW).toBeDefined();
      expect(NTSCRenderer.hgrToDhgrBW.length).toBe(256);
    });
  });

  describe('parameters', () => {
    it('should have default parameters', () => {
      expect(renderer.hue).toBe(0);
      expect(renderer.saturation).toBe(1.0);
      expect(renderer.brightness).toBe(1.0);
      expect(renderer.contrast).toBe(1.0);
    });

    it('should allow parameter adjustment', () => {
      renderer.hue = 30;
      renderer.saturation = 1.5;
      renderer.brightness = 0.8;
      renderer.contrast = 1.2;

      expect(renderer.hue).toBe(30);
      expect(renderer.saturation).toBe(1.5);
      expect(renderer.brightness).toBe(0.8);
      expect(renderer.contrast).toBe(1.2);
    });
  });

  describe('YIQ color conversion', () => {
    it('should convert YIQ to RGB', () => {
      // Black
      const black = NTSCRenderer.yiqToRgb(0, 0, 0);
      expect(black).toBe(0x000000);

      // White
      const white = NTSCRenderer.yiqToRgb(1, 0, 0);
      expect(white).toBe(0xffffff);
    });

    it('should convert YIQ to RGBA', () => {
      const black = NTSCRenderer.yiqToRgba(0, 0, 0);
      expect(black).toBe(0x000000ff);

      const white = NTSCRenderer.yiqToRgba(1, 0, 0);
      // Note: JavaScript bitwise shift can produce negative numbers
      // 0xffffffff is -1 in 32-bit signed representation
      expect(white >>> 0).toBe(0xffffffff);
    });

    it('should normalize values correctly', () => {
      expect(NTSCRenderer.normalize(0.5, 0, 1)).toBe(0.5);
      expect(NTSCRenderer.normalize(-0.5, 0, 1)).toBe(0);
      expect(NTSCRenderer.normalize(1.5, 0, 1)).toBe(1);
    });
  });

  describe('byte doubler', () => {
    it('should double bits correctly', () => {
      // 0b1010101 -> 0b11001100110011
      const doubled = NTSCRenderer.byteDoubler(0b1010101);
      expect(doubled).toBe(0b11001100110011);

      // 0b0000000
      expect(NTSCRenderer.byteDoubler(0)).toBe(0);

      // 0b1111111
      expect(NTSCRenderer.byteDoubler(0b1111111)).toBe(0b11111111111111);
    });
  });

  describe('scanline rendering', () => {
    it('should render a scanline without errors', () => {
      const imageData = {
        data: new Uint8ClampedArray(280 * 4), // 280 pixels RGBA
        width: 280,
      };
      const rawBytes = new Uint8Array(8192);
      const row = 0;
      const rowOffset = 0;

      expect(() => {
        renderer.renderHgrScanline(imageData, rawBytes, row, rowOffset);
      }).not.toThrow();
    });

    it('should write to imageData', () => {
      const imageData = {
        data: new Uint8ClampedArray(280 * 4),
        width: 280,
      };
      const rawBytes = new Uint8Array(8192);
      // Set some data
      rawBytes[0] = 0xff;

      renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

      // Check that some pixels were written
      const hasData = Array.from(imageData.data).some(val => val !== 0);
      expect(hasData).toBe(true);
    });
  });

  describe('parameter adjustment', () => {
    it('should adjust YIQ values', () => {
      renderer.hue = 45;
      renderer.saturation = 1.5;
      renderer.brightness = 0.9;
      renderer.contrast = 1.1;

      const [y, i, q] = renderer.adjustYiq(0.5, 0.3, 0.2);

      // Values should be adjusted from original
      expect(y).not.toBe(0.5);
      expect(i).not.toBe(0.3);
      expect(q).not.toBe(0.2);
    });

    it('should handle zero hue correctly', () => {
      renderer.hue = 0;
      renderer.saturation = 1.0;

      const [y, i, q] = renderer.adjustYiq(0.5, 0.3, 0.2);

      // With no hue change, I and Q should only be scaled by saturation
      expect(i).toBeCloseTo(0.3);
      expect(q).toBeCloseTo(0.2);
    });
  });
});
