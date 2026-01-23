/**
 * Visual Quality Tester for HGR Image Conversion
 *
 * Provides objective metrics (PSNR, SSIM) to measure conversion quality
 * and generates visual reports for analysis.
 *
 * Usage:
 *   const tester = new VisualQualityTester({ outputDir: 'test-output/quality' });
 *   const result = await tester.assessConversionQuality(sourceImage, 'my-image');
 *   await tester.generateHTMLReport([result], 'report.html');
 */

import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import ImageDither from '../../docs/src/lib/image-dither.js';
import NTSCRenderer from '../../docs/src/lib/ntsc-renderer.js';

export default class VisualQualityTester {
    constructor(options = {}) {
        this.outputDir = options.outputDir || 'test-output/visual-quality';
        this.dither = new ImageDither();
        this.ntsc = new NTSCRenderer();

        // Ensure output directory exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Calculate Peak Signal-to-Noise Ratio (PSNR) between two images.
     * Higher is better. Typical values:
     *   > 40 dB: Excellent quality
     *   30-40 dB: Good quality
     *   20-30 dB: Acceptable quality
     *   < 20 dB: Poor quality
     *
     * @param {Uint8ClampedArray} img1 - First image data (RGBA)
     * @param {Uint8ClampedArray} img2 - Second image data (RGBA)
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {number} PSNR in decibels
     */
    calculatePSNR(img1, img2, width, height) {
        if (img1.length !== img2.length) {
            throw new Error('Images must be same size');
        }

        let mse = 0;
        let pixelCount = 0;

        // Calculate mean squared error, ignoring alpha channel
        for (let i = 0; i < img1.length; i += 4) {
            const r1 = img1[i];
            const g1 = img1[i + 1];
            const b1 = img1[i + 2];

            const r2 = img2[i];
            const g2 = img2[i + 1];
            const b2 = img2[i + 2];

            mse += Math.pow(r1 - r2, 2);
            mse += Math.pow(g1 - g2, 2);
            mse += Math.pow(b1 - b2, 2);

            pixelCount++;
        }

        mse /= (pixelCount * 3); // Average over all channels

        if (mse === 0) {
            return Infinity; // Perfect match
        }

        const maxPixelValue = 255;
        const psnr = 10 * Math.log10((maxPixelValue * maxPixelValue) / mse);

        return psnr;
    }

    /**
     * Calculate Structural Similarity Index (SSIM) between two images.
     * Returns value between 0 and 1, where 1 is perfect similarity.
     *
     * This is a simplified SSIM calculation that compares local windows.
     *
     * @param {Uint8ClampedArray} img1 - First image data (RGBA)
     * @param {Uint8ClampedArray} img2 - Second image data (RGBA)
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {number} SSIM value [0, 1]
     */
    calculateSSIM(img1, img2, width, height) {
        if (img1.length !== img2.length) {
            throw new Error('Images must be same size');
        }

        // SSIM constants
        const C1 = Math.pow(0.01 * 255, 2);
        const C2 = Math.pow(0.03 * 255, 2);

        // For small images, use the whole image as one window
        const windowSize = Math.min(8, width, height);
        let ssimSum = 0;
        let windowCount = 0;

        // Calculate SSIM for each window
        for (let y = 0; y <= height - windowSize; y += windowSize) {
            for (let x = 0; x <= width - windowSize; x += windowSize) {
                const window1 = this._extractWindow(img1, x, y, windowSize, windowSize, width);
                const window2 = this._extractWindow(img2, x, y, windowSize, windowSize, width);

                // Calculate mean
                const mean1 = this._calculateMean(window1);
                const mean2 = this._calculateMean(window2);

                // Calculate variance and covariance
                const var1 = this._calculateVariance(window1, mean1);
                const var2 = this._calculateVariance(window2, mean2);
                const covar = this._calculateCovariance(window1, window2, mean1, mean2);

                // Calculate SSIM for this window
                const numerator = (2 * mean1 * mean2 + C1) * (2 * covar + C2);
                const denominator = (mean1 * mean1 + mean2 * mean2 + C1) * (var1 + var2 + C2);
                const ssim = numerator / denominator;

                ssimSum += ssim;
                windowCount++;
            }
        }

        return windowCount > 0 ? ssimSum / windowCount : 0;
    }

    /**
     * Extract a window from image data
     */
    _extractWindow(imageData, x, y, windowWidth, windowHeight, imageWidth) {
        const window = [];
        for (let wy = 0; wy < windowHeight; wy++) {
            for (let wx = 0; wx < windowWidth; wx++) {
                const px = x + wx;
                const py = y + wy;
                const i = (py * imageWidth + px) * 4;

                // Convert to grayscale using standard coefficients
                const gray = 0.299 * imageData[i] + 0.587 * imageData[i + 1] + 0.114 * imageData[i + 2];
                window.push(gray);
            }
        }
        return window;
    }

    /**
     * Calculate mean of window
     */
    _calculateMean(window) {
        const sum = window.reduce((acc, val) => acc + val, 0);
        return sum / window.length;
    }

    /**
     * Calculate variance of window
     */
    _calculateVariance(window, mean) {
        const squaredDiffs = window.map(val => Math.pow(val - mean, 2));
        return squaredDiffs.reduce((acc, val) => acc + val, 0) / window.length;
    }

    /**
     * Calculate covariance between two windows
     */
    _calculateCovariance(window1, window2, mean1, mean2) {
        let sum = 0;
        for (let i = 0; i < window1.length; i++) {
            sum += (window1[i] - mean1) * (window2[i] - mean2);
        }
        return sum / window1.length;
    }

    /**
     * Generate a difference image highlighting areas where images differ.
     * Differences are shown in red, with intensity proportional to error magnitude.
     *
     * @param {Uint8ClampedArray} img1 - First image data (RGBA)
     * @param {Uint8ClampedArray} img2 - Second image data (RGBA)
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {ImageData} Difference image
     */
    generateDiffImage(img1, img2, width, height) {
        const diffData = new Uint8ClampedArray(img1.length);

        for (let i = 0; i < img1.length; i += 4) {
            const r1 = img1[i];
            const g1 = img1[i + 1];
            const b1 = img1[i + 2];

            const r2 = img2[i];
            const g2 = img2[i + 1];
            const b2 = img2[i + 2];

            // Calculate per-channel differences
            const diffR = Math.abs(r1 - r2);
            const diffG = Math.abs(g1 - g2);
            const diffB = Math.abs(b1 - b2);

            // Total difference magnitude
            const totalDiff = diffR + diffG + diffB;

            if (totalDiff === 0) {
                // No difference - black
                diffData[i] = 0;
                diffData[i + 1] = 0;
                diffData[i + 2] = 0;
            } else {
                // Show difference in red (intensity proportional to error)
                const intensity = Math.min(255, totalDiff / 3);
                diffData[i] = intensity;      // Red channel
                diffData[i + 1] = 0;          // Green channel
                diffData[i + 2] = 0;          // Blue channel
            }

            diffData[i + 3] = 255; // Alpha
        }

        // Use global.ImageData from test setup.js
        return new global.ImageData(diffData, width, height);
    }

    /**
     * Save ImageData as PNG file
     *
     * @param {ImageData} imageData - Image data to save
     * @param {string} filename - Output filename
     * @returns {string} Full path to saved file
     */
    async savePNG(imageData, filename) {
        const outputPath = path.join(this.outputDir, filename);

        const png = new PNG({
            width: imageData.width,
            height: imageData.height
        });

        // Copy data
        for (let i = 0; i < imageData.data.length; i++) {
            png.data[i] = imageData.data[i];
        }

        return new Promise((resolve, reject) => {
            png.pack()
                .pipe(fs.createWriteStream(outputPath))
                .on('finish', () => resolve(outputPath))
                .on('error', reject);
        });
    }

    /**
     * Render HGR screen data through NTSC to get RGB output
     *
     * @param {Uint8Array} hgrData - HGR screen data (40 bytes per line, 192 lines)
     * @returns {ImageData} Rendered NTSC output (280x192)
     */
    renderHGRWithNTSC(hgrData) {
        // Create canvas for NTSC rendering
        const canvas = global.document.createElement('canvas');
        canvas.width = 560; // DHGR width for NTSC
        canvas.height = 192;
        const ctx = canvas.getContext('2d');

        const imageData = ctx.createImageData(560, 192);

        // Render each scanline
        for (let row = 0; row < 192; row++) {
            const rowOffset = row * 40;
            this.ntsc.renderHgrScanline(imageData, hgrData, row, rowOffset);
        }

        // Scale down to 280x192 by sampling every other pixel
        // MANUAL DOWNSAMPLING: Canvas drawImage scaling is broken in test environments
        const scaledData = new Uint8ClampedArray(280 * 192 * 4);
        for (let y = 0; y < 192; y++) {
            for (let x = 0; x < 280; x++) {
                // Sample pixel x*2 from the 560-wide image
                const srcIdx = (y * 560 + x * 2) * 4;
                const dstIdx = (y * 280 + x) * 4;

                scaledData[dstIdx] = imageData.data[srcIdx];         // R
                scaledData[dstIdx + 1] = imageData.data[srcIdx + 1]; // G
                scaledData[dstIdx + 2] = imageData.data[srcIdx + 2]; // B
                scaledData[dstIdx + 3] = imageData.data[srcIdx + 3]; // A
            }
        }

        return new global.ImageData(scaledData, 280, 192);
    }

    /**
     * Assess the quality of HGR conversion for a source image.
     * This runs the full pipeline: source -> HGR -> NTSC render -> compare
     *
     * @param {ImageData} sourceImage - Source image (should be 280x192)
     * @param {string} name - Test name for output files
     * @param {string} algorithm - Dithering algorithm to use (default: 'hybrid')
     * @returns {Object} Quality assessment results
     */
    async assessConversionQuality(sourceImage, name, algorithm = 'hybrid') {
        // Step 1: Convert to HGR
        const hgrData = this.dither.ditherToHgr(sourceImage, 40, 192, algorithm);

        // Step 2: Render HGR through NTSC
        const convertedImage = this.renderHGRWithNTSC(hgrData);

        // Step 3: Calculate quality metrics
        const psnr = this.calculatePSNR(
            sourceImage.data,
            convertedImage.data,
            sourceImage.width,
            sourceImage.height
        );

        const ssim = this.calculateSSIM(
            sourceImage.data,
            convertedImage.data,
            sourceImage.width,
            sourceImage.height
        );

        // Step 4: Generate difference image
        const diffImage = this.generateDiffImage(
            sourceImage.data,
            convertedImage.data,
            sourceImage.width,
            sourceImage.height
        );

        // Step 5: Save all images
        const sourcePath = await this.savePNG(sourceImage, `${name}-source.png`);
        const convertedPath = await this.savePNG(convertedImage, `${name}-converted.png`);
        const diffPath = await this.savePNG(diffImage, `${name}-diff.png`);

        return {
            name,
            category: name,
            psnr,
            ssim,
            sourcePath,
            convertedPath,
            diffPath,
            sourceWidth: sourceImage.width,
            sourceHeight: sourceImage.height,
            convertedWidth: convertedImage.width,
            convertedHeight: convertedImage.height
        };
    }

    /**
     * Run batch tests on multiple images
     *
     * @param {Array} images - Array of {name, image} objects
     * @returns {Array} Array of quality assessment results
     */
    async runBatchTests(images) {
        const results = [];

        for (const { name, image } of images) {
            const result = await this.assessConversionQuality(image, name);
            results.push(result);
        }

        return results;
    }

    /**
     * Generate HTML report from quality assessment results
     *
     * @param {Array} results - Array of quality assessment results
     * @param {string} filename - Output filename
     * @returns {string} Full path to report file
     */
    async generateHTMLReport(results, filename) {
        const outputPath = path.join(this.outputDir, filename);

        // Calculate summary statistics
        const avgPSNR = results.reduce((sum, r) => sum + (isFinite(r.psnr) ? r.psnr : 0), 0) / results.length;
        const avgSSIM = results.reduce((sum, r) => sum + r.ssim, 0) / results.length;

        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Visual Quality Report</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        h1 {
            color: #333;
            border-bottom: 3px solid #4CAF50;
            padding-bottom: 10px;
        }
        h2 {
            color: #555;
            margin-top: 30px;
        }
        .summary {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        .summary-stat {
            display: inline-block;
            margin-right: 40px;
            font-size: 18px;
        }
        .summary-stat .label {
            color: #666;
            font-weight: bold;
        }
        .summary-stat .value {
            color: #4CAF50;
            font-size: 24px;
            font-weight: bold;
        }
        .test-result {
            background: white;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .test-result h3 {
            margin-top: 0;
            color: #333;
        }
        .metrics {
            margin: 15px 0;
        }
        .metric {
            display: inline-block;
            margin-right: 30px;
            padding: 10px 15px;
            background: #f9f9f9;
            border-radius: 4px;
        }
        .metric .label {
            color: #666;
            font-size: 14px;
        }
        .metric .value {
            font-size: 20px;
            font-weight: bold;
            color: #333;
        }
        .quality-good { color: #4CAF50; }
        .quality-acceptable { color: #FF9800; }
        .quality-poor { color: #F44336; }
        .images {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin-top: 20px;
        }
        .image-container {
            text-align: center;
        }
        .image-container img {
            max-width: 100%;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        .image-container .caption {
            margin-top: 5px;
            font-size: 14px;
            color: #666;
        }
        .timestamp {
            color: #999;
            font-size: 12px;
            text-align: right;
            margin-top: 30px;
        }
    </style>
</head>
<body>
    <h1>Visual Quality Report</h1>

    <div class="summary">
        <h2>Summary Statistics</h2>
        <div class="summary-stat">
            <div class="label">Average PSNR:</div>
            <div class="value">${avgPSNR.toFixed(2)} dB</div>
        </div>
        <div class="summary-stat">
            <div class="label">Average SSIM:</div>
            <div class="value">${avgSSIM.toFixed(3)}</div>
        </div>
        <div class="summary-stat">
            <div class="label">Tests Run:</div>
            <div class="value">${results.length}</div>
        </div>
    </div>

    <h2>Individual Test Results</h2>

${results.map(result => {
    const psnrClass = result.psnr > 30 ? 'quality-good' :
                      result.psnr > 20 ? 'quality-acceptable' : 'quality-poor';
    const ssimClass = result.ssim > 0.8 ? 'quality-good' :
                      result.ssim > 0.6 ? 'quality-acceptable' : 'quality-poor';

    return `
    <div class="test-result">
        <h3>${result.name}</h3>
        <div class="metrics">
            <div class="metric">
                <div class="label">PSNR</div>
                <div class="value ${psnrClass}">${isFinite(result.psnr) ? result.psnr.toFixed(2) + ' dB' : '∞ (perfect)'}</div>
            </div>
            <div class="metric">
                <div class="label">SSIM</div>
                <div class="value ${ssimClass}">${result.ssim.toFixed(3)}</div>
            </div>
            <div class="metric">
                <div class="label">Resolution</div>
                <div class="value">${result.sourceWidth}x${result.sourceHeight}</div>
            </div>
        </div>
        <div class="images">
            <div class="image-container">
                <img src="${path.basename(result.sourcePath)}" alt="Source">
                <div class="caption">Source Image</div>
            </div>
            <div class="image-container">
                <img src="${path.basename(result.convertedPath)}" alt="Converted">
                <div class="caption">HGR Converted (NTSC)</div>
            </div>
            <div class="image-container">
                <img src="${path.basename(result.diffPath)}" alt="Difference">
                <div class="caption">Difference Map</div>
            </div>
        </div>
    </div>
    `;
}).join('')}

    <div class="timestamp">
        Generated: ${new Date().toISOString()}
    </div>
</body>
</html>`;

        fs.writeFileSync(outputPath, html);
        return outputPath;
    }
}
