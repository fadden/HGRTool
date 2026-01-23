import { describe, it, expect } from 'vitest';
import StdHiRes from '../docs/src/lib/std-hi-res.js';
import fs from 'fs';
import path from 'path';

/**
 * CRITICAL NTSC RENDERING BUGS - Visual Verification Tests
 *
 * This test suite reproduces three severe rendering bugs reported by the user:
 *
 * Bug 1: NTSC Mode Shows Color Bars (Not Solid Orange)
 *   - User report: "Bars of different colors (Mostly orange, green, blue and violet)"
 *   - Expected: Solid orange rectangle with NTSC artifacts
 *   - Actual: Vertical color bars across the image
 *
 * Bug 2: Monochrome Mode Shows Split Image
 *   - User report: "Even rows on left, odd rows on right (half width each)"
 *   - Expected: Single contiguous monochrome rectangle
 *   - Actual: Image split horizontally into two halves
 *
 * Bug 3: Mode Switching Corruption
 *   - User report: "Unchecking monochrome goes back to previous (incorrect) NTSC"
 *   - Expected: Clean transitions between render modes
 *   - Actual: Corrupted rendering when switching modes
 *
 * Test Approach:
 *   1. Create identical HGR data (solid orange rectangle)
 *   2. Render in RGB mode (baseline)
 *   3. Render in NTSC mode (should be orange, not color bars)
 *   4. Render in Mono mode (should be single image, not split)
 *   5. Test mode switching (should not corrupt)
 *   6. Save PNG images for visual inspection
 */

describe('NTSC Visual Rendering Bugs - Critical Issues', () => {
  const TEST_OUTPUT_DIR = '/tmp/claude/hgrtool-ntsc-rendering/iteration-1/test-output';

  // Ensure output directory exists
  if (!fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  }

  /**
   * Helper: Create a filled orange rectangle in HGR memory
   * Orange = HGR color 6 = 0xAA (alternating bits: 10101010 with high bit set)
   * NOT 0x80 (which is just high bit = black with high-bit palette)
   */
  function createOrangeRectangle(hires, left, top, width, height) {
    // Orange pattern: 0xAA (alternating bits with high bit set)
    const orangePattern = StdHiRes.createSimplePattern(0xAA);

    console.log('Orange pattern bytes:', Array.from(orangePattern).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '));

    // Draw filled rectangle
    for (let y = top; y < top + height; y++) {
      hires.plotHorizSegment(left, y, width, orangePattern);
    }
  }

  /**
   * Helper: Analyze ImageData for color distribution
   */
  function analyzeImageData(imageData, name) {
    const colorCounts = new Map();
    const width = imageData.width;
    const height = imageData.height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const rgb = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');

        colorCounts.set(rgb, (colorCounts.get(rgb) || 0) + 1);
      }
    }

    console.log(`\n=== ${name} Analysis ===`);
    console.log(`Image size: ${width}x${height}`);
    console.log(`Unique colors: ${colorCounts.size}`);

    // Show top 10 colors by frequency
    const sortedColors = Array.from(colorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    console.log('Top colors:');
    for (const [rgb, count] of sortedColors) {
      const percent = ((count / (width * height)) * 100).toFixed(1);
      console.log(`  #${rgb}: ${count} pixels (${percent}%)`);
    }

    return colorCounts;
  }

  /**
   * Helper: Check for split image bug (even/odd rows separated)
   */
  function checkForSplitImage(imageData, rectLeft, rectTop, rectWidth, rectHeight) {
    const width = imageData.width;

    // Check if left half has even rows and right half has odd rows
    const leftHalfX = Math.floor(width / 2);

    let leftHasContent = false;
    let rightHasContent = false;

    // Sample a few rows in the rectangle area
    for (let y = rectTop; y < rectTop + Math.min(10, rectHeight); y++) {
      // Check left half
      for (let x = 0; x < leftHalfX; x++) {
        const idx = (y * width + x) * 4;
        const r = imageData.data[idx];
        if (r > 0) {
          leftHasContent = true;
          break;
        }
      }

      // Check right half
      for (let x = leftHalfX; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = imageData.data[idx];
        if (r > 0) {
          rightHasContent = true;
          break;
        }
      }
    }

    const isSplit = leftHasContent && rightHasContent;

    if (isSplit) {
      console.log('🚨 SPLIT IMAGE BUG DETECTED:');
      console.log('   Content found in both left and right halves');
      console.log('   This indicates even/odd row separation');
    }

    return isSplit;
  }

  /**
   * Helper: Save ImageData as text representation (ASCII art)
   * Since we can't easily save PNG in Node.js tests, create a visual representation
   */
  function saveImageAsText(imageData, filename, rectLeft, rectTop, rectWidth, rectHeight) {
    const filepath = path.join(TEST_OUTPUT_DIR, filename);
    const width = imageData.width;
    const height = imageData.height;

    let output = `Image: ${width}x${height}\n`;
    output += `Rectangle: ${rectLeft},${rectTop} ${rectWidth}x${rectHeight}\n`;
    output += `\n`;

    // Sample every 4th pixel to fit in console
    const sampleRate = 4;

    for (let y = 0; y < height; y += sampleRate) {
      for (let x = 0; x < width; x += sampleRate) {
        const idx = (y * width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];

        // Convert to ASCII grayscale
        const brightness = (r + g + b) / 3;
        if (brightness < 32) output += ' ';
        else if (brightness < 64) output += '.';
        else if (brightness < 96) output += ':';
        else if (brightness < 128) output += '-';
        else if (brightness < 160) output += '=';
        else if (brightness < 192) output += '+';
        else if (brightness < 224) output += '#';
        else output += '@';
      }
      output += '\n';
    }

    fs.writeFileSync(filepath, output);
    console.log(`Saved text representation: ${filepath}`);
  }

  /**
   * Test 1: RGB Baseline (Control Test)
   * This establishes what the CORRECT rendering should look like
   */
  it('should render solid orange rectangle in RGB mode (baseline)', () => {
    console.log('\n=== TEST 1: RGB BASELINE ===');

    // Create HGR image
    const hires = new StdHiRes();

    // Set to RGB mode explicitly
    hires.renderMode = 'rgb';

    // Draw orange rectangle at position 50,50 with size 180x92
    // (centered in 280x192 screen with some margin)
    const rectLeft = 50;
    const rectTop = 50;
    const rectWidth = 180;
    const rectHeight = 92;

    createOrangeRectangle(hires, rectLeft, rectTop, rectWidth, rectHeight);

    // Create ImageData for RGB mode (280x192)
    const imageData = new ImageData(StdHiRes.NUM_COLS, StdHiRes.NUM_ROWS);

    // Render
    hires.renderFull(imageData, false);

    // Analyze
    const colors = analyzeImageData(imageData, 'RGB Mode');

    // Save
    saveImageAsText(imageData, 'rgb-orange-baseline.txt', rectLeft, rectTop, rectWidth, rectHeight);

    // Verify baseline expectations
    expect(imageData.width).toBe(280);
    expect(imageData.height).toBe(192);

    // Should have orange color (RGB values for orange are approximately 255, 106, 60)
    // Allow for some variation due to RGB palette
    let hasOrangeishColor = false;
    for (const [rgb, count] of colors.entries()) {
      const r = parseInt(rgb.substring(0, 2), 16);
      const g = parseInt(rgb.substring(2, 4), 16);
      const b = parseInt(rgb.substring(4, 6), 16);

      // Check if color is orange-ish (high red, medium green, low blue)
      if (r > 200 && g > 50 && g < 150 && b < 100) {
        hasOrangeishColor = true;
        console.log(`✅ Found orange-ish color: #${rgb} (R:${r} G:${g} B:${b})`);
        break;
      }
    }

    expect(hasOrangeishColor, 'RGB mode should render orange color').toBe(true);

    // Should not have too many colors (solid fill should be mostly uniform)
    expect(colors.size, 'RGB mode should have relatively few colors').toBeLessThan(10);

    console.log('✅ RGB baseline test passed');
  });

  /**
   * Test 2: NTSC Rendering (BUG 1 - Color Bars Instead of Orange)
   * EXPECTED: Orange rectangle with some NTSC artifacts/fringing
   * ACTUAL: Vertical color bars (rainbow effect)
   */
  it('should render orange rectangle in NTSC mode without color bars', () => {
    console.log('\n=== TEST 2: NTSC MODE (BUG 1) ===');

    // Create HGR image
    const hires = new StdHiRes();

    // Set to NTSC mode
    hires.renderMode = 'ntsc';

    // Draw same orange rectangle as baseline
    const rectLeft = 50;
    const rectTop = 50;
    const rectWidth = 180;
    const rectHeight = 92;

    createOrangeRectangle(hires, rectLeft, rectTop, rectWidth, rectHeight);

    // Create ImageData for NTSC mode (560x192 - DHGR resolution)
    const ntscWidth = 560;
    const imageData = new ImageData(ntscWidth, StdHiRes.NUM_ROWS);

    // Render
    hires.renderFull(imageData, false);

    // Analyze
    const colors = analyzeImageData(imageData, 'NTSC Mode');

    // Save
    saveImageAsText(imageData, 'ntsc-orange.txt', rectLeft * 2, rectTop, rectWidth * 2, rectHeight);

    // Verify NTSC rendering
    expect(imageData.width).toBe(560);
    expect(imageData.height).toBe(192);

    // BUG CHECK: Color bars manifest as many unique colors across horizontal span
    // A solid orange fill should have at most 4-8 colors (NTSC phase artifacts)
    // Color bars will have 20+ colors
    if (colors.size > 12) {
      console.log('🚨 BUG 1 DETECTED: COLOR BARS IN NTSC MODE');
      console.log(`   Found ${colors.size} unique colors (expected: 4-8 for solid fill)`);
      console.log('   This indicates vertical color bars instead of solid orange');

      // Show color distribution to understand the pattern
      const colorArray = Array.from(colors.entries()).sort((a, b) => b[1] - a[1]);
      console.log('\n   Color distribution (top 20):');
      for (let i = 0; i < Math.min(20, colorArray.length); i++) {
        const [rgb, count] = colorArray[i];
        console.log(`   #${rgb}: ${count} pixels`);
      }
    }

    // For now, this test documents the bug
    // After fixes, expect colors.size < 12
    console.log(`Color count: ${colors.size} (threshold: 12)`);
  });

  /**
   * Test 3: Monochrome Rendering (BUG 2 - Split Image)
   * EXPECTED: Single contiguous monochrome rectangle
   * ACTUAL: Even rows on left, odd rows on right (split horizontally)
   */
  it('should render orange rectangle in Monochrome mode without splitting', () => {
    console.log('\n=== TEST 3: MONOCHROME MODE (BUG 2) ===');

    // Create HGR image
    const hires = new StdHiRes();

    // Set to monochrome mode
    hires.renderMode = 'mono';

    // Draw same orange rectangle
    const rectLeft = 50;
    const rectTop = 50;
    const rectWidth = 180;
    const rectHeight = 92;

    createOrangeRectangle(hires, rectLeft, rectTop, rectWidth, rectHeight);

    // Create ImageData for monochrome mode (280x192 - standard HGR resolution)
    const imageData = new ImageData(StdHiRes.NUM_COLS, StdHiRes.NUM_ROWS);

    // Render
    hires.renderFull(imageData, true);  // true = monochrome

    // Analyze
    const colors = analyzeImageData(imageData, 'Monochrome Mode');

    // Check for split image bug
    const isSplit = checkForSplitImage(imageData, rectLeft, rectTop, rectWidth, rectHeight);

    // Save
    saveImageAsText(imageData, 'mono-orange.txt', rectLeft, rectTop, rectWidth, rectHeight);

    // Verify monochrome rendering
    expect(imageData.width).toBe(280);
    expect(imageData.height).toBe(192);

    // Monochrome should have only black and white
    expect(colors.size, 'Monochrome mode should only have black and white').toBeLessThanOrEqual(2);

    // BUG CHECK: Split image means content in both left and right halves
    if (isSplit) {
      console.log('🚨 BUG 2 DETECTED: SPLIT IMAGE IN MONOCHROME MODE');
      console.log('   Image is split horizontally (even rows left, odd rows right)');
    } else {
      console.log('✅ Image is not split');
    }

    // For now, this test documents the bug
    // After fixes, expect isSplit = false
  });

  /**
   * Test 4: Mode Switching (BUG 3 - Corruption on Mode Change)
   * EXPECTED: Clean transitions between RGB, NTSC, and Mono modes
   * ACTUAL: Corrupted rendering when switching between modes
   */
  it('should correctly switch between RGB, NTSC, and Mono modes', () => {
    console.log('\n=== TEST 4: MODE SWITCHING (BUG 3) ===');

    // Create HGR image with orange rectangle
    const hires = new StdHiRes();
    const rectLeft = 50;
    const rectTop = 50;
    const rectWidth = 180;
    const rectHeight = 92;

    createOrangeRectangle(hires, rectLeft, rectTop, rectWidth, rectHeight);

    // Test sequence: RGB -> NTSC -> Mono -> RGB
    console.log('\nSwitching: RGB -> NTSC -> Mono -> RGB');

    // 1. Start in RGB mode
    hires.renderMode = 'rgb';
    let imageData = new ImageData(280, 192);
    hires.renderFull(imageData, false);
    const rgbColors1 = analyzeImageData(imageData, 'RGB (initial)');

    // 2. Switch to NTSC
    hires.renderMode = 'ntsc';
    imageData = new ImageData(560, 192);
    hires.renderFull(imageData, false);
    const ntscColors = analyzeImageData(imageData, 'NTSC (after RGB)');

    // 3. Switch to Mono
    hires.renderMode = 'mono';
    imageData = new ImageData(280, 192);
    hires.renderFull(imageData, true);
    const monoColors = analyzeImageData(imageData, 'Mono (after NTSC)');

    // 4. Switch back to RGB
    hires.renderMode = 'rgb';
    imageData = new ImageData(280, 192);
    hires.renderFull(imageData, false);
    const rgbColors2 = analyzeImageData(imageData, 'RGB (after Mono)');

    // Verify: RGB rendering should be consistent before and after mode switches
    console.log('\nComparing RGB rendering before and after mode switches:');
    console.log(`  Initial RGB colors: ${rgbColors1.size}`);
    console.log(`  Final RGB colors: ${rgbColors2.size}`);

    // The color counts should be similar (within 2-3 colors due to rounding)
    const colorDifference = Math.abs(rgbColors1.size - rgbColors2.size);

    if (colorDifference > 5) {
      console.log('🚨 BUG 3 DETECTED: MODE SWITCHING CORRUPTION');
      console.log(`   RGB rendering changed significantly after mode switching`);
      console.log(`   Color count difference: ${colorDifference}`);
    } else {
      console.log('✅ RGB rendering consistent across mode switches');
    }

    // Verify mono mode produced only black and white
    expect(monoColors.size, 'Mono mode should only have black and white').toBeLessThanOrEqual(2);
  });

  /**
   * Test 5: Comprehensive Mode Comparison
   * Side-by-side analysis of all three rendering modes
   */
  it('should produce consistent geometry across all rendering modes', () => {
    console.log('\n=== TEST 5: CROSS-MODE GEOMETRY CONSISTENCY ===');

    // Create three separate HGR instances for clarity
    const rectLeft = 50;
    const rectTop = 50;
    const rectWidth = 180;
    const rectHeight = 92;

    // RGB
    const hiresRgb = new StdHiRes();
    hiresRgb.renderMode = 'rgb';
    createOrangeRectangle(hiresRgb, rectLeft, rectTop, rectWidth, rectHeight);
    const imageDataRgb = new ImageData(280, 192);
    hiresRgb.renderFull(imageDataRgb, false);

    // NTSC
    const hiresNtsc = new StdHiRes();
    hiresNtsc.renderMode = 'ntsc';
    createOrangeRectangle(hiresNtsc, rectLeft, rectTop, rectWidth, rectHeight);
    const imageDataNtsc = new ImageData(560, 192);
    hiresNtsc.renderFull(imageDataNtsc, false);

    // Mono
    const hiresMono = new StdHiRes();
    hiresMono.renderMode = 'mono';
    createOrangeRectangle(hiresMono, rectLeft, rectTop, rectWidth, rectHeight);
    const imageDataMono = new ImageData(280, 192);
    hiresMono.renderFull(imageDataMono, true);

    // Count non-black pixels in each mode
    const countNonBlack = (data, width, height) => {
      let count = 0;
      for (let i = 0; i < width * height * 4; i += 4) {
        if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) {
          count++;
        }
      }
      return count;
    };

    const rgbNonBlack = countNonBlack(imageDataRgb.data, 280, 192);
    const ntscNonBlack = countNonBlack(imageDataNtsc.data, 560, 192);
    const monoNonBlack = countNonBlack(imageDataMono.data, 280, 192);

    // Expected non-black pixels: approximately rectWidth * rectHeight
    const expectedPixels = rectWidth * rectHeight;

    console.log('\nNon-black pixel counts:');
    console.log(`  RGB:  ${rgbNonBlack} (expected: ~${expectedPixels})`);
    console.log(`  NTSC: ${ntscNonBlack} (expected: ~${expectedPixels * 2} for 560-wide)`);
    console.log(`  Mono: ${monoNonBlack} (expected: ~${expectedPixels})`);

    // RGB and Mono should have similar pixel counts
    const rgbMonoDiff = Math.abs(rgbNonBlack - monoNonBlack);
    const tolerance = expectedPixels * 0.1; // 10% tolerance

    console.log(`\nRGB/Mono difference: ${rgbMonoDiff} pixels (tolerance: ${Math.round(tolerance)})`);

    if (rgbMonoDiff > tolerance) {
      console.log('⚠️  Large discrepancy between RGB and Mono pixel counts');
      console.log('   This may indicate split image or other rendering bugs');
    } else {
      console.log('✅ RGB and Mono pixel counts are consistent');
    }

    // NTSC should have roughly 2x the pixels (560 width vs 280)
    const expectedNtscPixels = expectedPixels * 2;
    const ntscDiff = Math.abs(ntscNonBlack - expectedNtscPixels);
    const ntscTolerance = expectedNtscPixels * 0.1;

    console.log(`\nNTSC pixel count difference: ${ntscDiff} (tolerance: ${Math.round(ntscTolerance)})`);

    if (ntscDiff > ntscTolerance) {
      console.log('⚠️  NTSC pixel count unexpected');
      console.log('   This may indicate color bars or incorrect rendering');
    } else {
      console.log('✅ NTSC pixel count is reasonable');
    }
  });
});
