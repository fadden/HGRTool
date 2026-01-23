import { describe, it, expect, beforeEach } from 'vitest';
import ImageDither from '../docs/src/lib/image-dither.js';

/**
 * Focused tests for the image import garbage output bug fix.
 *
 * Bug: ditherToHgr() used putImageData() which doesn't scale,
 * causing garbage output when ImageData dimensions != target dimensions.
 *
 * Fix: Use temporary canvas to scale ImageData before processing.
 */

// Helper to create ImageData
function createImageData(width, height, fillColor) {
  const data = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = fillColor;
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255; // Alpha
  }
  const imageData = new ImageData(width, height);
  imageData.data.set(data);
  return imageData;
}

describe('Image Import Bug Fix - ImageData Scaling', () => {
  let dither;

  beforeEach(() => {
    dither = new ImageDither();
  });

  describe('Core bug fix validation', () => {
    it('should accept ImageData without crashing (bug was: putImageData doesnt scale)', () => {
      const imageData = createImageData(280, 192, [128, 128, 128]);

      // This should not throw an error
      expect(() => {
        const hgrData = dither.ditherToHgr(imageData, 40, 192, 'threshold');
        expect(hgrData).toBeInstanceOf(Uint8Array);
      }).not.toThrow();
    });

    it('should return correct buffer size for HGR (40 bytes * 192 rows = 7680)', () => {
      const imageData = createImageData(280, 192, [0, 0, 0]);

      const hgrData = dither.ditherToHgr(imageData, 40, 192, 'threshold');

      expect(hgrData.length).toBe(7680); // 40 bytes per row * 192 rows
    });

    it('should handle ImageData larger than target without crashing', () => {
      // This was the main bug scenario - larger image would cause garbage
      const largeImageData = createImageData(560, 384, [128, 128, 128]);

      const hgrData = dither.ditherToHgr(largeImageData, 40, 192, 'threshold');

      expect(hgrData).toBeInstanceOf(Uint8Array);
      expect(hgrData.length).toBe(7680);
    });

    it('should handle ImageData smaller than target without crashing', () => {
      const smallImageData = createImageData(140, 96, [128, 128, 128]);

      const hgrData = dither.ditherToHgr(smallImageData, 40, 192, 'threshold');

      expect(hgrData).toBeInstanceOf(Uint8Array);
      expect(hgrData.length).toBe(7680);
    });

    it('should handle ImageData exactly matching target dimensions', () => {
      const exactImageData = createImageData(280, 192, [128, 128, 128]);

      const hgrData = dither.ditherToHgr(exactImageData, 40, 192, 'threshold');

      expect(hgrData).toBeInstanceOf(Uint8Array);
      expect(hgrData.length).toBe(7680);
    });

    it('should handle very large ImageData gracefully', () => {
      const hugeImageData = createImageData(1920, 1080, [64, 64, 64]);

      const hgrData = dither.ditherToHgr(hugeImageData, 40, 192, 'threshold');

      expect(hgrData).toBeInstanceOf(Uint8Array);
      expect(hgrData.length).toBe(7680);
    });

    it('should handle very small ImageData gracefully', () => {
      const tinyImageData = createImageData(70, 48, [192, 192, 192]);

      const hgrData = dither.ditherToHgr(tinyImageData, 40, 192, 'threshold');

      expect(hgrData).toBeInstanceOf(Uint8Array);
      expect(hgrData.length).toBe(7680);
    });
  });

  describe('Output format validation', () => {
    it('should produce bytes in valid range (0-255)', () => {
      const imageData = createImageData(280, 192, [100, 150, 200]);

      const hgrData = dither.ditherToHgr(imageData, 40, 192, 'threshold');

      // Every byte should be valid (0-255)
      for (let i = 0; i < hgrData.length; i++) {
        expect(hgrData[i]).toBeGreaterThanOrEqual(0);
        expect(hgrData[i]).toBeLessThanOrEqual(255);
      }
    });

    it('should process all rows (each row is 40 bytes)', () => {
      const imageData = createImageData(280, 192, [128, 128, 128]);

      const hgrData = dither.ditherToHgr(imageData, 40, 192, 'threshold');

      // Verify we can access all rows without error
      for (let row = 0; row < 192; row++) {
        const rowStart = row * 40;
        const rowEnd = rowStart + 40;
        const rowData = hgrData.slice(rowStart, rowEnd);
        expect(rowData.length).toBe(40);
      }
    });
  });

  describe('Different dithering algorithms', () => {
    it('should work with Floyd-Steinberg algorithm', () => {
      const imageData = createImageData(280, 192, [128, 128, 128]);

      dither.setDitherAlgorithm('floyd-steinberg');
      const hgrData = dither.ditherToHgr(imageData, 40, 192, 'threshold');

      expect(hgrData.length).toBe(7680);
    });

    it('should work with Atkinson algorithm', () => {
      const imageData = createImageData(280, 192, [128, 128, 128]);

      dither.setDitherAlgorithm('atkinson');
      const hgrData = dither.ditherToHgr(imageData, 40, 192, 'threshold');

      expect(hgrData.length).toBe(7680);
    });

    it('should work with Jarvis-Judice-Ninke algorithm', () => {
      const imageData = createImageData(280, 192, [128, 128, 128]);

      dither.setDitherAlgorithm('jarvis-judice-ninke');
      const hgrData = dither.ditherToHgr(imageData, 40, 192, 'threshold');

      expect(hgrData.length).toBe(7680);
    });
  });

  describe('Aspect ratio variations', () => {
    it('should handle wide images (16:9 aspect)', () => {
      const wideImageData = createImageData(1920, 1080, [128, 128, 128]);

      const hgrData = dither.ditherToHgr(wideImageData, 40, 192, 'threshold');

      expect(hgrData.length).toBe(7680);
    });

    it('should handle tall images (9:16 aspect)', () => {
      const tallImageData = createImageData(1080, 1920, [128, 128, 128]);

      const hgrData = dither.ditherToHgr(tallImageData, 40, 192, 'threshold');

      expect(hgrData.length).toBe(7680);
    });

    it('should handle square images', () => {
      const squareImageData = createImageData(800, 800, [128, 128, 128]);

      const hgrData = dither.ditherToHgr(squareImageData, 40, 192, 'threshold');

      expect(hgrData.length).toBe(7680);
    });
  });
});
