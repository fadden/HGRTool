import { describe, it, expect } from 'vitest';
import StdHiRes from '../docs/src/lib/std-hi-res.js';
import Picture from '../docs/src/lib/picture.js';

/**
 * RGB Mode Rendering Bug Tests
 *
 * Bug A: Spatial Split During Real-time Drawing (RGB Mode)
 * - Symptom: When drawing with alternating green/orange pattern in RGB mode,
 *   green/black stripes appear on LEFT side, orange/black on RIGHT side
 * - The rectangle is spatially split instead of drawing in correct location
 *
 * Bug B: Wrong Colors After Mode Switching (RGB→Mono→RGB)
 * - Symptom: After drawing in RGB, toggling to Mono and back to RGB,
 *   rectangle has correct shape but colors are purple/violet/blue instead of green/orange/black
 *
 * Root Cause: ImageData width/height mismatch with canvas dimensions
 * - If ImageData is 560px wide but rendering uses 280px stride, pixels wrap incorrectly
 * - Even rows render to left half, odd rows to right half
 */

describe('RGB Rendering Bugs', () => {
  describe('Bug A: Spatial Split During Real-time Drawing', () => {
    it('should render alternating green/orange pattern without spatial split', () => {
      console.log('\n=== Bug A: Testing RGB mode rendering ===\n');

      // Create a new picture in RGB mode
      const picture = new Picture('test', StdHiRes.FORMAT_NAME, undefined, undefined);
      picture.useMono = false;
      picture.rawImage.renderMode = 'rgb';
      picture.render();  // Initialize ImageData with correct width

      // Create alternating green/orange pattern
      // Green on even rows (bytes 0-3), orange on odd rows (bytes 4-7)
      const pattern = new Uint8Array([
        0x2a, 0x55, 0x2a, 0x55,  // Even rows: green
        0xaa, 0xd5, 0xaa, 0xd5   // Odd rows: orange
      ]);

      // Draw a rectangle at x=100, y=50, width=20, height=10
      const rectX = 100;
      const rectY = 50;
      const rectWidth = 20;
      const rectHeight = 10;

      console.log(`ImageData dimensions before drawing: ${picture.pixelImage.width}x${picture.pixelImage.height}`);
      console.log(`renderMode: ${picture.rawImage.renderMode}`);

      picture.openUndoContext('test');
      const dirtyRect = picture.drawFillRect(rectX, rectY, rectX + rectWidth - 1, rectY + rectHeight - 1, pattern);
      console.log(`Dirty rect: ${dirtyRect.left},${dirtyRect.top} ${dirtyRect.width}x${dirtyRect.height}`);
      picture.renderArea(dirtyRect);  // Actually render the changes to ImageData
      picture.closeUndoContext(true);

      // Render to ImageData (should be 280x192 in RGB mode)
      expect(picture.pixelImage.width).toBe(280);
      expect(picture.pixelImage.height).toBe(192);

      // Check raw data was written
      console.log(`Checking raw data at offset for row ${rectY}...`);
      const rowOffset = StdHiRes.rowToOffset(rectY);
      const byteCol = Math.trunc(rectX / 7);
      console.log(`Raw byte at row ${rectY}, col ${byteCol}: 0x${picture.rawImage.rawData[rowOffset + byteCol].toString(16)}`);


      // Analyze where colored pixels appear
      console.log('Analyzing pixel positions...\n');

      // First, scan the entire dirty rect area to see if ANY pixels are colored
      let totalColoredPixels = 0;
      for (let y = rectY; y < rectY + rectHeight; y++) {
        for (let x = rectX; x < rectX + rectWidth; x++) {
          const idx = (y * 280 + x) * 4;
          const r = picture.pixelImage.data[idx];
          const g = picture.pixelImage.data[idx + 1];
          const b = picture.pixelImage.data[idx + 2];
          if (r + g + b > 50) {
            totalColoredPixels++;
          }
        }
      }
      console.log(`Total colored pixels in rectangle: ${totalColoredPixels} out of ${rectWidth * rectHeight}`);

      // Check a few key positions in the rectangle
      const testPositions = [
        { x: rectX, y: rectY, desc: 'top-left corner' },
        { x: rectX + 1, y: rectY, desc: 'second pixel' },
        { x: rectX + 2, y: rectY, desc: 'third pixel' },
        { x: rectX + 10, y: rectY + 5, desc: 'middle of rect' },
        { x: rectX + rectWidth - 1, y: rectY + rectHeight - 1, desc: 'bottom-right corner' }
      ];

      for (const { x, y, desc } of testPositions) {
        const idx = (y * 280 + x) * 4;
        const r = picture.pixelImage.data[idx];
        const g = picture.pixelImage.data[idx + 1];
        const b = picture.pixelImage.data[idx + 2];

        console.log(`${desc} (${x},${y}): RGB(${r},${g},${b})`);
      }

      // At least SOME pixels should have color
      expect(totalColoredPixels).toBeGreaterThan(0);

      // Verify pixels are NOT split across left/right halves
      console.log('\nChecking for spatial split...\n');

      let pixelsInRect = 0;
      let pixelsLeftOfRect = 0;
      let pixelsRightOfRect = 0;

      for (let y = rectY; y < rectY + rectHeight; y++) {
        for (let x = 0; x < 280; x++) {
          const idx = (y * 280 + x) * 4;
          const r = picture.pixelImage.data[idx];
          const g = picture.pixelImage.data[idx + 1];
          const b = picture.pixelImage.data[idx + 2];

          const isColored = (r + g + b) > 50;

          if (isColored) {
            if (x >= rectX && x < rectX + rectWidth) {
              pixelsInRect++;
            } else if (x < rectX) {
              pixelsLeftOfRect++;
            } else {
              pixelsRightOfRect++;
            }
          }
        }
      }

      console.log(`Colored pixels in rectangle area: ${pixelsInRect}`);
      console.log(`Colored pixels left of rectangle: ${pixelsLeftOfRect}`);
      console.log(`Colored pixels right of rectangle: ${pixelsRightOfRect}`);

      // Most colored pixels should be IN the rectangle, not split left/right
      expect(pixelsInRect).toBeGreaterThan(pixelsLeftOfRect + pixelsRightOfRect);
    });
  });

  describe('Bug B: Wrong Colors After Mode Switching', () => {
    it('should preserve colors when switching RGB→Mono→RGB', () => {
      console.log('\n=== Bug B: Testing mode switching ===\n');

      // Create a new picture in RGB mode
      const picture = new Picture('test', StdHiRes.FORMAT_NAME, undefined, undefined);
      picture.useMono = false;
      picture.rawImage.renderMode = 'rgb';
      picture.render();  // Initialize ImageData with correct width

      // Create alternating green/orange pattern
      const pattern = new Uint8Array([
        0x2a, 0x55, 0x2a, 0x55,  // Even rows: green
        0xaa, 0xd5, 0xaa, 0xd5   // Odd rows: orange
      ]);

      // Draw a rectangle
      const rectX = 100;
      const rectY = 50;
      const rectWidth = 20;
      const rectHeight = 4;  // Just 4 rows to test even/odd

      picture.openUndoContext('test');
      const dirtyRect2 = picture.drawFillRect(rectX, rectY, rectX + rectWidth - 1, rectY + rectHeight - 1, pattern);
      picture.renderArea(dirtyRect2);  // Actually render the changes to ImageData
      picture.closeUndoContext(true);

      // Capture RGB colors for even and odd rows
      const evenRowRGB = {
        r: picture.pixelImage.data[(rectY * 280 + rectX + 1) * 4],
        g: picture.pixelImage.data[(rectY * 280 + rectX + 1) * 4 + 1],
        b: picture.pixelImage.data[(rectY * 280 + rectX + 1) * 4 + 2]
      };

      const oddRowRGB = {
        r: picture.pixelImage.data[((rectY + 1) * 280 + rectX + 1) * 4],
        g: picture.pixelImage.data[((rectY + 1) * 280 + rectX + 1) * 4 + 1],
        b: picture.pixelImage.data[((rectY + 1) * 280 + rectX + 1) * 4 + 2]
      };

      console.log(`Even row color (green expected): RGB(${evenRowRGB.r},${evenRowRGB.g},${evenRowRGB.b})`);
      console.log(`Odd row color (orange expected): RGB(${oddRowRGB.r},${oddRowRGB.g},${oddRowRGB.b})`);

      // Switch to Monochrome
      console.log('\nSwitching to Monochrome...');
      picture.useMono = true;
      picture.rawImage.renderMode = 'mono';
      picture.render();

      // Switch back to RGB
      console.log('Switching back to RGB...\n');
      picture.useMono = false;
      picture.rawImage.renderMode = 'rgb';
      picture.render();

      // Check ImageData dimensions are correct after mode switch
      expect(picture.pixelImage.width).toBe(280);
      expect(picture.pixelImage.height).toBe(192);

      // Capture RGB colors again
      const evenRowRGB2 = {
        r: picture.pixelImage.data[(rectY * 280 + rectX + 1) * 4],
        g: picture.pixelImage.data[(rectY * 280 + rectX + 1) * 4 + 1],
        b: picture.pixelImage.data[(rectY * 280 + rectX + 1) * 4 + 2]
      };

      const oddRowRGB2 = {
        r: picture.pixelImage.data[((rectY + 1) * 280 + rectX + 1) * 4],
        g: picture.pixelImage.data[((rectY + 1) * 280 + rectX + 1) * 4 + 1],
        b: picture.pixelImage.data[((rectY + 1) * 280 + rectX + 1) * 4 + 2]
      };

      console.log(`Even row color after switch: RGB(${evenRowRGB2.r},${evenRowRGB2.g},${evenRowRGB2.b})`);
      console.log(`Odd row color after switch: RGB(${oddRowRGB2.r},${oddRowRGB2.g},${oddRowRGB2.b})`);

      // Colors should be the same (or at least same color family)
      // Allow some tolerance for rendering differences
      const colorDiffEven = Math.abs(evenRowRGB.r - evenRowRGB2.r) +
                           Math.abs(evenRowRGB.g - evenRowRGB2.g) +
                           Math.abs(evenRowRGB.b - evenRowRGB2.b);

      const colorDiffOdd = Math.abs(oddRowRGB.r - oddRowRGB2.r) +
                          Math.abs(oddRowRGB.g - oddRowRGB2.g) +
                          Math.abs(oddRowRGB.b - oddRowRGB2.b);

      console.log(`\nColor difference even row: ${colorDiffEven}`);
      console.log(`Color difference odd row: ${colorDiffOdd}`);

      // Colors should be similar (within tolerance)
      expect(colorDiffEven).toBeLessThan(100); // Allow some variance
      expect(colorDiffOdd).toBeLessThan(100);
    });
  });
});
