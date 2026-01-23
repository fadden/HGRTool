import { describe, it, expect } from 'vitest';
import NTSCRenderer from '../docs/src/lib/ntsc-renderer.js';

describe('NTSC 0x7F Color Test', () => {
  it('should render 0x7F as white/light color, not salmon/pink', () => {
    const renderer = new NTSCRenderer();
    const rawBytes = new Uint8Array(8192);

    // Fill with 0x7F (all 7 data bits set, high bit clear)
    // This should render as WHITE, not orange
    for (let i = 0; i < 40; i++) {
      rawBytes[i] = 0x7F;
    }

    const imageData = {
      data: new Uint8ClampedArray(560 * 4),
      width: 560,
    };

    renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

    console.log('\n=== RENDERING 0x7F ===');
    console.log('Expected: WHITE (all bits set, high bit clear)');
    console.log('\nFirst 10 DHGR pixels:');

    const pixels = [];
    for (let x = 0; x < 10; x++) {
      const idx = x * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      pixels.push({ x, r, g, b });
      console.log(`Pixel ${x}: R=${r.toString().padStart(3)} G=${g.toString().padStart(3)} B=${b.toString().padStart(3)}`);
    }

    // Count unique colors
    const colors = new Set();
    for (let x = 0; x < 560; x++) {
      const idx = x * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const rgb = (r << 16) | (g << 8) | b;
      colors.add(rgb);
    }

    console.log(`\nUnique colors: ${colors.size}`);
    const colorArray = Array.from(colors);
    console.log('Colors (hex):', colorArray.map(c => c.toString(16).padStart(6, '0')).slice(0, 10));

    // Verify the first pixel is close to white (high brightness)
    // White should have R, G, B all > 180
    const firstPixel = pixels[0];
    const avgBrightness = (firstPixel.r + firstPixel.g + firstPixel.b) / 3;

    console.log(`\nFirst pixel average brightness: ${avgBrightness.toFixed(1)}`);
    console.log('Expected: > 180 for white');

    expect(avgBrightness).toBeGreaterThan(180);
  });

  it('should render 0xAA as orange (alternating bits with high bit)', () => {
    const renderer = new NTSCRenderer();
    const rawBytes = new Uint8Array(8192);

    // Fill with 0xAA (10101010 binary = alternating bits with high bit set)
    // This should render as ORANGE
    for (let i = 0; i < 40; i++) {
      rawBytes[i] = 0xAA;
    }

    const imageData = {
      data: new Uint8ClampedArray(560 * 4),
      width: 560,
    };

    renderer.renderHgrScanline(imageData, rawBytes, 0, 0);

    console.log('\n=== RENDERING 0xAA (should be ORANGE) ===');
    console.log('\nFirst 20 DHGR pixels:');

    for (let x = 0; x < 20; x++) {
      const idx = x * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      console.log(`Pixel ${x}: R=${r.toString().padStart(3)} G=${g.toString().padStart(3)} B=${b.toString().padStart(3)}`);
    }

    // Count unique colors
    const colors = new Set();
    for (let x = 0; x < 560; x++) {
      const idx = x * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      const rgb = (r << 16) | (g << 8) | b;
      colors.add(rgb);
    }

    console.log(`\nUnique colors: ${colors.size}`);
    const colorArray = Array.from(colors);
    console.log('Colors (hex):', colorArray.map(c => c.toString(16).padStart(6, '0')));

    // For orange (0xAA), verify we get orange-ish colors
    // Sample first few pixels and check R > G > B (orange characteristic)
    const orangePixels = [];
    for (let x = 0; x < Math.min(20, 560); x++) {
      const idx = x * 4;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      if (r > 100 && g > 50 && b < 100) {
        orangePixels.push(x);
      }
    }

    console.log(`\nOrange-like pixels (R>100, G>50, B<100) found: ${orangePixels.length} out of first 20`);
    expect(orangePixels.length).toBeGreaterThan(0);
  });
});
