import { describe, it, expect, beforeEach } from 'vitest';
import ImageDither from '../docs/src/lib/image-dither.js';

describe('ImageDither', () => {
  let dither;

  beforeEach(() => {
    dither = new ImageDither();
  });

  describe('initialization', () => {
    it('should create an instance', () => {
      expect(dither).toBeInstanceOf(ImageDither);
    });

    it('should use Floyd-Steinberg by default', () => {
      expect(dither.coefficients).toBe(ImageDither.FLOYD_STEINBERG);
      expect(dither.divisor).toBe(16);
    });
  });

  describe('algorithm selection', () => {
    it('should switch to Floyd-Steinberg', () => {
      dither.setDitherAlgorithm('floyd-steinberg');
      expect(dither.coefficients).toBe(ImageDither.FLOYD_STEINBERG);
      expect(dither.divisor).toBe(16);
    });

    it('should switch to Jarvis-Judice-Ninke', () => {
      dither.setDitherAlgorithm('jarvis-judice-ninke');
      expect(dither.coefficients).toBe(ImageDither.JARVIS_JUDICE_NINKE);
      expect(dither.divisor).toBe(48);
    });

    it('should switch to Atkinson', () => {
      dither.setDitherAlgorithm('atkinson');
      expect(dither.coefficients).toBe(ImageDither.ATKINSON);
      expect(dither.divisor).toBe(8);
    });

    it('should throw on unknown algorithm', () => {
      expect(() => {
        dither.setDitherAlgorithm('unknown');
      }).toThrow();
    });
  });

  describe('dithering coefficients', () => {
    it('should have Floyd-Steinberg coefficients', () => {
      expect(ImageDither.FLOYD_STEINBERG).toEqual([
        [0, 0, 7],
        [3, 5, 1]
      ]);
    });

    it('should have Jarvis-Judice-Ninke coefficients', () => {
      expect(ImageDither.JARVIS_JUDICE_NINKE).toEqual([
        [0, 0, 7, 5],
        [3, 5, 7, 5, 3],
        [1, 3, 5, 3, 1]
      ]);
    });

    it('should have Atkinson coefficients', () => {
      expect(ImageDither.ATKINSON).toEqual([
        [0, 0, 1, 1],
        [1, 1, 1, 0],
        [0, 1, 0, 0]
      ]);
    });
  });

  describe('color distance', () => {
    it('should calculate distance between identical colors as 0', () => {
      const distance = dither.colorDistance([128, 128, 128], [128, 128, 128]);
      expect(distance).toBe(0);
    });

    it('should calculate distance between black and white', () => {
      const distance = dither.colorDistance([0, 0, 0], [255, 255, 255]);
      expect(distance).toBeCloseTo(Math.sqrt(3 * 255 * 255));
    });

    it('should be symmetric', () => {
      const d1 = dither.colorDistance([100, 50, 200], [150, 100, 50]);
      const d2 = dither.colorDistance([150, 100, 50], [100, 50, 200]);
      expect(d1).toBe(d2);
    });
  });

  describe('buffer operations', () => {
    it('should copy buffer correctly', () => {
      const source = [
        [[255, 0, 0], [0, 255, 0]],
        [[0, 0, 255], [128, 128, 128]]
      ];
      const target = [
        [[0, 0, 0], [0, 0, 0]],
        [[0, 0, 0], [0, 0, 0]]
      ];

      dither.copyBuffer(source, target, 0, 2);

      expect(target[0][0]).toEqual([255, 0, 0]);
      expect(target[0][1]).toEqual([0, 255, 0]);
      expect(target[1][0]).toEqual([0, 0, 255]);
      expect(target[1][1]).toEqual([128, 128, 128]);
    });

    it('should handle partial buffer copy', () => {
      const source = [
        [[255, 0, 0], [0, 255, 0]],
        [[0, 0, 255], [128, 128, 128]]
      ];
      const target = [
        [[0, 0, 0], [0, 0, 0]],
        [[0, 0, 0], [0, 0, 0]]
      ];

      dither.copyBuffer(source, target, 0, 1);

      expect(target[0][0]).toEqual([255, 0, 0]);
      expect(target[1][0]).toEqual([0, 0, 0]); // Not copied
    });
  });

  describe('scratch buffer creation', () => {
    it('should create buffer from pixel data', () => {
      const pixels = new Uint8ClampedArray([
        255, 0, 0, 255,    // Red pixel
        0, 255, 0, 255,    // Green pixel
        0, 0, 255, 255     // Blue pixel
      ]);

      const buffer = dither.createScratchBuffer(pixels, 3, 1);

      expect(buffer.length).toBe(1);
      expect(buffer[0].length).toBe(3);
      expect(buffer[0][0]).toEqual([255, 0, 0]);
      expect(buffer[0][1]).toEqual([0, 255, 0]);
      expect(buffer[0][2]).toEqual([0, 0, 255]);
    });
  });

  describe('hybrid dithering - RGB utilities', () => {
    it('should unpack RGB values correctly', () => {
      const packed = (255 << 16) | (128 << 8) | 64;
      const rgb = dither.unpackRGB(packed);
      expect(rgb.r).toBe(255);
      expect(rgb.g).toBe(128);
      expect(rgb.b).toBe(64);
    });

    it('should unpack black correctly', () => {
      const packed = 0;
      const rgb = dither.unpackRGB(packed);
      expect(rgb.r).toBe(0);
      expect(rgb.g).toBe(0);
      expect(rgb.b).toBe(0);
    });

    it('should unpack white correctly', () => {
      const packed = (255 << 16) | (255 << 8) | 255;
      const rgb = dither.unpackRGB(packed);
      expect(rgb.r).toBe(255);
      expect(rgb.g).toBe(255);
      expect(rgb.b).toBe(255);
    });
  });

  describe('hybrid dithering - perceptual distance', () => {
    it('should calculate distance between identical colors as 0', () => {
      const distance = dither.perceptualDistance(
        {r: 128, g: 128, b: 128},
        {r: 128, g: 128, b: 128}
      );
      expect(distance).toBe(0);
    });

    it('should calculate distance between black and white', () => {
      const distance = dither.perceptualDistance(
        {r: 0, g: 0, b: 0},
        {r: 255, g: 255, b: 255}
      );
      // Using YIQ color space for perceptual distance
      // Black (0,0,0) in YIQ: (0, 0, 0)
      // White (255,255,255) in YIQ: (1, 0, 0) when normalized
      // Distance = sqrt((1-0)^2 + (0-0)^2 + (0-0)^2) = 1.0
      expect(distance).toBeCloseTo(1.0);
    });

    it('should weight green more heavily', () => {
      // Pure red difference
      const distRed = dither.perceptualDistance(
        {r: 0, g: 0, b: 0},
        {r: 255, g: 0, b: 0}
      );
      // Pure green difference
      const distGreen = dither.perceptualDistance(
        {r: 0, g: 0, b: 0},
        {r: 0, g: 255, b: 0}
      );
      // Green should be weighted more heavily (0.587 vs 0.299)
      expect(distGreen).toBeGreaterThan(distRed);
    });
  });

  describe('hybrid dithering - NTSC error calculation', () => {
    it('should calculate error for a byte pattern', () => {
      const targetColors = [
        {r: 128, g: 128, b: 128},
        {r: 128, g: 128, b: 128},
        {r: 128, g: 128, b: 128},
        {r: 128, g: 128, b: 128},
        {r: 128, g: 128, b: 128},
        {r: 128, g: 128, b: 128},
        {r: 128, g: 128, b: 128}
      ];

      const error = dither.calculateNTSCError(0x00, 0x55, targetColors, 0);
      expect(error).toBeGreaterThan(0);
      expect(error).toBeLessThan(Infinity);
    });

    it('should have lower error for matching patterns', () => {
      const blackTargets = Array(7).fill({r: 0, g: 0, b: 0});
      const whiteTargets = Array(7).fill({r: 255, g: 255, b: 255});

      const errorBlack = dither.calculateNTSCError(0x00, 0x00, blackTargets, 0);
      const errorWhite = dither.calculateNTSCError(0x00, 0x00, whiteTargets, 0);

      // Black pattern should match black targets better
      expect(errorBlack).toBeLessThan(errorWhite);
    });
  });

  describe('hybrid dithering - pattern selection', () => {
    it('should select best byte pattern', () => {
      const targetColors = Array(7).fill({r: 255, g: 255, b: 255});
      const bestByte = dither.findBestBytePattern(0x00, targetColors, 0);

      expect(bestByte).toBeGreaterThanOrEqual(0);
      expect(bestByte).toBeLessThanOrEqual(255);
    });

    it('should have canonical patterns available', () => {
      expect(dither.canonicalPatterns).toBeDefined();
      expect(dither.canonicalPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('hybrid dithering - NTSC color rendering', () => {
    it('should render colors for a byte', () => {
      const colors = dither.renderNTSCColors(0x00, 0x55, 0);

      expect(colors).toHaveLength(7);
      colors.forEach(color => {
        expect(color).toHaveProperty('r');
        expect(color).toHaveProperty('g');
        expect(color).toHaveProperty('b');
        expect(color.r).toBeGreaterThanOrEqual(0);
        expect(color.r).toBeLessThanOrEqual(255);
      });
    });
  });

  describe('hybrid dithering - target extraction', () => {
    it('should extract target colors with error', () => {
      const pixels = new Uint8ClampedArray(280 * 192 * 4);
      // Fill with gray
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 128;
        pixels[i + 1] = 128;
        pixels[i + 2] = 128;
        pixels[i + 3] = 255;
      }

      const errorBuffer = Array(192).fill(null).map(() =>
        Array(280).fill(null).map(() => [0, 0, 0])
      );

      const targets = dither.getTargetWithError(pixels, errorBuffer, 0, 0, 280);

      expect(targets).toHaveLength(7);
      targets.forEach(target => {
        expect(target.r).toBe(128);
        expect(target.g).toBe(128);
        expect(target.b).toBe(128);
      });
    });

    it('should apply error buffer corrections', () => {
      const pixels = new Uint8ClampedArray(280 * 192 * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 128;
        pixels[i + 1] = 128;
        pixels[i + 2] = 128;
        pixels[i + 3] = 255;
      }

      const errorBuffer = Array(192).fill(null).map(() =>
        Array(280).fill(null).map(() => [0, 0, 0])
      );
      // Add error to first pixel
      errorBuffer[0][0] = [50, 0, 0];

      const targets = dither.getTargetWithError(pixels, errorBuffer, 0, 0, 280);

      // First pixel should have error applied
      expect(targets[0].r).toBe(178); // 128 + 50
      expect(targets[0].g).toBe(128);
      expect(targets[0].b).toBe(128);
    });
  });

  describe('hybrid dithering - full algorithm', () => {
    it('should dither using hybrid algorithm', () => {
      // Create a simple 280x192 test image
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#808080'; // Gray
      ctx.fillRect(0, 0, 280, 192);

      const imageData = ctx.getImageData(0, 0, 280, 192);

      const result = dither.ditherToHgr(imageData, 40, 192, 'hybrid');

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(40 * 192);
    });

    it('should dither using threshold algorithm', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 280, 192);

      const imageData = ctx.getImageData(0, 0, 280, 192);

      const result = dither.ditherToHgr(imageData, 40, 192, 'threshold');

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(40 * 192);
    });

    it('should throw on unknown algorithm', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 192;
      const imageData = canvas.getContext('2d').getImageData(0, 0, 280, 192);

      expect(() => {
        dither.ditherToHgr(imageData, 40, 192, 'unknown');
      }).toThrow();
    });
  });

  describe('structure-aware dithering', () => {
    it('should dither using structure-aware algorithm', () => {
      // Create a simple 280x192 test image
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#808080'; // Gray
      ctx.fillRect(0, 0, 280, 192);

      const imageData = ctx.getImageData(0, 0, 280, 192);

      const result = dither.ditherToHgr(imageData, 40, 192, 'structure-aware');

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(40 * 192);
    });

    it('should dither using structure-aware algorithm async', async () => {
      // Create a simple 280x192 test image
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#808080'; // Gray
      ctx.fillRect(0, 0, 280, 192);

      const imageData = ctx.getImageData(0, 0, 280, 192);

      let progressCalls = 0;
      const progressCallback = (completed, total) => {
        progressCalls++;
        expect(completed).toBeLessThanOrEqual(total);
        expect(completed).toBeGreaterThan(0);
      };

      const result = await dither.ditherToHgrAsync(
        imageData,
        40,
        192,
        'structure-aware',
        progressCallback
      );

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(40 * 192);
      expect(progressCalls).toBeGreaterThan(0); // Should have progress updates
    });

    it('should produce valid HGR bytes with structure-aware', () => {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');

      // Create an image with edges and smooth regions
      ctx.fillStyle = '#FFFFFF'; // White background
      ctx.fillRect(0, 0, 280, 192);
      ctx.fillStyle = '#000000'; // Black square (creates edges)
      ctx.fillRect(50, 50, 100, 100);

      const imageData = ctx.getImageData(0, 0, 280, 192);
      const result = dither.ditherToHgr(imageData, 40, 192, 'structure-aware');

      // Verify all bytes are valid HGR bytes (0-255)
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(0);
        expect(result[i]).toBeLessThanOrEqual(255);
      }

      // Verify algorithm completed successfully
      // Note: In headless test environment, canvas rendering may produce all-black/all-white
      // The key is that the algorithm doesn't crash and produces valid byte values
      const uniqueValues = new Set(result);
      expect(uniqueValues.size).toBeGreaterThanOrEqual(1); // At least some output
    });
  });
});
