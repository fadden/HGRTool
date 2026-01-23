# Visual Quality Test Framework

A comprehensive TDD-based framework for measuring and improving HGR image conversion quality.

## Quick Start

### Run Tests
```bash
npx vitest run test/visual-quality.test.js
```

### Generate Quality Report
```bash
node test/generate-quality-report.js
```

View the report: Open `test-output/visual-quality/quality-report.html` in your browser

## Overview

This framework provides objective metrics to measure the quality of HGR image conversion:

- **PSNR (Peak Signal-to-Noise Ratio)**: Measures pixel-level accuracy
  - > 40 dB: Excellent quality
  - 30-40 dB: Good quality
  - 20-30 dB: Acceptable quality
  - < 20 dB: Poor quality

- **SSIM (Structural Similarity Index)**: Measures perceptual quality
  - 1.0: Perfect similarity
  - > 0.8: Good quality
  - 0.6-0.8: Acceptable quality
  - < 0.6: Poor quality

## Framework Components

### VisualQualityTester (`test/lib/visual-quality-tester.js`)

Main class providing:
- PSNR and SSIM calculation
- Visual difference image generation
- HTML report generation
- Batch testing capabilities
- Integration with HGR dithering and NTSC rendering

### Test Suite (`test/visual-quality.test.js`)

Comprehensive tests (17 tests, all passing):
- PSNR calculation tests
- SSIM calculation tests
- Difference image generation tests
- HTML report generation tests
- HGR conversion quality assessment tests
- Multiple image type tests
- Batch testing tests

### Report Generator (`test/generate-quality-report.js`)

Generates comprehensive quality reports with:
- 14 test images across 4 categories
- Individual quality scores
- Category-averaged statistics
- Visual side-by-side comparisons
- Highlighted problem areas

## Test Image Categories

1. **Solid Colors**: Red, green, blue, white, black, gray
2. **Photo-like (Gradients)**: Horizontal, vertical, radial
3. **High-Contrast**: Checkerboard, vertical stripes, horizontal stripes
4. **Line Art**: Circle, rectangle

## Usage Examples

### Basic Usage

```javascript
import VisualQualityTester from './lib/visual-quality-tester.js';

const tester = new VisualQualityTester({
    outputDir: 'test-output/my-quality-tests'
});

// Create a test image (280x192 RGBA)
const width = 280, height = 192;
const imageData = new ImageData(
    new Uint8ClampedArray(width * height * 4),
    width,
    height
);

// Assess quality
const result = await tester.assessConversionQuality(
    imageData,
    'my-test-image'
);

console.log(`PSNR: ${result.psnr.toFixed(2)} dB`);
console.log(`SSIM: ${result.ssim.toFixed(3)}`);
```

### Batch Testing

```javascript
const images = [
    { name: 'gradient', image: gradientImageData },
    { name: 'checkerboard', image: checkerboardImageData },
    { name: 'photo', image: photoImageData }
];

const results = await tester.runBatchTests(images);

// Generate HTML report
await tester.generateHTMLReport(results, 'my-report.html');
```

### Custom Test Images

```javascript
// Create a gradient test image
function createGradient() {
    const width = 280, height = 192;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const value = Math.floor((x / width) * 255);
            data[i] = value;     // R
            data[i + 1] = value; // G
            data[i + 2] = value; // B
            data[i + 3] = 255;   // A
        }
    }

    return new ImageData(data, width, height);
}

const result = await tester.assessConversionQuality(
    createGradient(),
    'custom-gradient'
);
```

## Output Files

When running quality assessments, the framework generates:

- `{name}-source.png` - Original test image
- `{name}-converted.png` - HGR converted image (rendered through NTSC)
- `{name}-diff.png` - Visual difference map (red = errors)
- `quality-report.html` - Interactive HTML report

## Interpreting Results

### Good Quality
- PSNR > 30 dB
- SSIM > 0.8
- Minimal red areas in difference image

### Poor Quality
- PSNR < 20 dB
- SSIM < 0.6
- Large red areas in difference image

### Critical Issues
- PSNR < 10 dB (like current results)
- SSIM near 0 (like current results)
- Difference image is almost entirely red

## Current Algorithm Performance

As of the initial quality assessment:

| Category | Avg PSNR | Avg SSIM | Status |
|----------|----------|----------|--------|
| Overall | 3.23 dB | 0.094 | Critical |
| Solid Colors | 3.38 dB | 0.168 | Critical |
| Photos | 5.19 dB | 0.010 | Critical |
| High-Contrast | 3.07 dB | 0.094 | Critical |
| Line Art | 0.09 dB | 0.000 | Critical |

These results indicate the current dithering algorithm requires significant improvement.

## Using for Algorithm Development

### Iterative Improvement Workflow

1. Make changes to dithering algorithm
2. Run quality report: `node test/generate-quality-report.js`
3. Compare new scores with previous scores
4. Review HTML report for visual improvements
5. Commit changes if scores improve

### Regression Prevention

Add the visual quality test to CI/CD:

```yaml
# .github/workflows/quality.yml
- name: Run Visual Quality Tests
  run: npx vitest run test/visual-quality.test.js
```

### Benchmark Tracking

Track quality improvements over time:

```bash
# Run before changes
node test/generate-quality-report.js > baseline.txt

# Make algorithm changes

# Run after changes
node test/generate-quality-report.js > improved.txt

# Compare
diff baseline.txt improved.txt
```

## Adding New Test Images

Edit `test/generate-quality-report.js` and add to the `generateTestImages()` function:

```javascript
// Add a custom test pattern
{
    const data = new Uint8ClampedArray(width * height * 4);
    // ... generate your pattern ...
    images.push({
        name: 'my-custom-pattern',
        type: 'custom',
        image: new global.ImageData(data, width, height)
    });
}
```

## Technical Details

### PSNR Calculation

```javascript
MSE = average((source - converted)^2)
PSNR = 10 * log10(255^2 / MSE)
```

### SSIM Calculation

Simplified SSIM using local windows:
- Compares luminance, contrast, and structure
- More aligned with human perception than PSNR
- Values range from 0 (no similarity) to 1 (perfect match)

### NTSC Integration

The framework:
1. Converts source image to HGR (40 bytes × 192 lines)
2. Renders HGR through NTSC simulation (produces 280×192 RGB)
3. Compares NTSC output with original source

This provides a fair comparison since the Apple II displays HGR through NTSC, not directly.

## Dependencies

- `vitest` - Test framework
- `pngjs` - PNG file I/O
- Existing HGR modules:
  - `image-dither.js` - Dithering algorithm
  - `ntsc-renderer.js` - NTSC simulation

## License

Same as parent project (Apache 2.0)
