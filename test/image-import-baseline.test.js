import { describe, it, expect } from 'vitest';
import ImageDither from '../docs/src/lib/image-dither.js';

describe('Image Import - Baseline Conversion Tests', () => {
  describe('All-White Image', () => {
    it('should convert all-white image to 0x7F or 0xFF bytes', () => {
      // Create all-white ImageData (280×192)
      const width = 280;
      const height = 192;
      const imageData = new ImageData(width, height);

      // Fill with white (255, 255, 255, 255)
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 255;     // R
        imageData.data[i + 1] = 255; // G
        imageData.data[i + 2] = 255; // B
        imageData.data[i + 3] = 255; // A
      }

      // Convert to HGR (targetWidth is in BYTES, not pixels - 280 pixels = 40 bytes)
      const ditherer = new ImageDither();
      const hgrData = ditherer.ditherToHgr(imageData, 40, 192);

      // Verify: all bytes should be 0x7F or 0xFF
      const invalidBytes = [];
      for (let i = 0; i < hgrData.length; i++) {
        const byte = hgrData[i];
        if (byte !== 0x7F && byte !== 0xFF) {
          invalidBytes.push({ index: i, value: byte, hex: `0x${byte.toString(16).toUpperCase()}` });
        }
      }

      // Provide detailed failure message
      if (invalidBytes.length > 0) {
        const sample = invalidBytes.slice(0, 10);
        console.log(`Found ${invalidBytes.length} invalid bytes in all-white image`);
        console.log('First 10 invalid bytes:', sample);
      }

      expect(invalidBytes.length).toBe(0);
    });
  });

  describe('All-Black Image', () => {
    it('should convert all-black image to 0x00 or 0x80 bytes', () => {
      // Create all-black ImageData (280×192)
      const width = 280;
      const height = 192;
      const imageData = new ImageData(width, height);

      // Fill with black (0, 0, 0, 255)
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 0;       // R
        imageData.data[i + 1] = 0;   // G
        imageData.data[i + 2] = 0;   // B
        imageData.data[i + 3] = 255; // A
      }

      // Convert to HGR (targetWidth is in BYTES, not pixels - 280 pixels = 40 bytes)
      const ditherer = new ImageDither();
      const hgrData = ditherer.ditherToHgr(imageData, 40, 192);

      // Verify: all bytes should be 0x00 or 0x80
      const invalidBytes = [];
      for (let i = 0; i < hgrData.length; i++) {
        const byte = hgrData[i];
        if (byte !== 0x00 && byte !== 0x80) {
          invalidBytes.push({ index: i, value: byte, hex: `0x${byte.toString(16).toUpperCase()}` });
        }
      }

      // Provide detailed failure message
      if (invalidBytes.length > 0) {
        const sample = invalidBytes.slice(0, 10);
        console.log(`Found ${invalidBytes.length} invalid bytes in all-black image`);
        console.log('First 10 invalid bytes:', sample);
      }

      expect(invalidBytes.length).toBe(0);
    });
  });
});
