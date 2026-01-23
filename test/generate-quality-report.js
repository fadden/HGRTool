/**
 * Generate Comprehensive Visual Quality Report
 *
 * This script creates test images of various types and generates a full
 * quality assessment report for the HGR image converter.
 *
 * Usage: node test/generate-quality-report.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

// Setup test environment (same as in tests)
import './setup.js';

// For Node.js execution, we need document.createElement and HTMLImageElement
if (typeof global.document === 'undefined') {
    global.document = {
        createElement: (tag) => {
            if (tag === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    getContext: () => ({
                        canvas: { width: 0, height: 0 },
                        imageSmoothingEnabled: true,
                        imageSmoothingQuality: 'high',
                        drawImage: () => {},
                        getImageData: (x, y, w, h) => {
                            return new global.ImageData(w, h);
                        },
                        putImageData: () => {},
                        createImageData: (w, h) => {
                            return new global.ImageData(w, h);
                        }
                    })
                };
            }
            return {};
        }
    };
}

if (typeof global.HTMLImageElement === 'undefined') {
    global.HTMLImageElement = class HTMLImageElement {};
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import modules after setup
const { default: VisualQualityTester } = await import('./lib/visual-quality-tester.js');

console.log('Visual Quality Report Generator');
console.log('================================\n');

// Create output directory
const outputDir = 'test-output/visual-quality';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Initialize tester
const tester = new VisualQualityTester({ outputDir });

/**
 * Generate test images
 */
function generateTestImages() {
    const width = 280;
    const height = 192;
    const images = [];

    // 1. Solid colors
    console.log('Generating solid color test images...');
    const colors = [
        { name: 'solid-red', rgb: [255, 0, 0] },
        { name: 'solid-green', rgb: [0, 255, 0] },
        { name: 'solid-blue', rgb: [0, 0, 255] },
        { name: 'solid-white', rgb: [255, 255, 255] },
        { name: 'solid-black', rgb: [0, 0, 0] },
        { name: 'solid-gray', rgb: [128, 128, 128] }
    ];

    for (const { name, rgb } of colors) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = rgb[0];
            data[i + 1] = rgb[1];
            data[i + 2] = rgb[2];
            data[i + 3] = 255;
        }
        images.push({
            name,
            type: 'solid-color',
            image: new global.ImageData(data, width, height)
        });
    }

    // 2. Gradients (photo-like)
    console.log('Generating gradient test images...');

    // Horizontal gradient (grayscale)
    {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const value = Math.floor((x / width) * 255);
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }
        images.push({
            name: 'gradient-horizontal',
            type: 'photo',
            image: new global.ImageData(data, width, height)
        });
    }

    // Vertical gradient
    {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const value = Math.floor((y / height) * 255);
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }
        images.push({
            name: 'gradient-vertical',
            type: 'photo',
            image: new global.ImageData(data, width, height)
        });
    }

    // Radial gradient (more photo-like)
    {
        const data = new Uint8ClampedArray(width * height * 4);
        const centerX = width / 2;
        const centerY = height / 2;
        const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const dx = x - centerX;
                const dy = y - centerY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const value = Math.floor((1 - dist / maxDist) * 255);
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }
        images.push({
            name: 'gradient-radial',
            type: 'photo',
            image: new global.ImageData(data, width, height)
        });
    }

    // 3. High-contrast patterns
    console.log('Generating high-contrast test images...');

    // Checkerboard (10x10 squares)
    {
        const data = new Uint8ClampedArray(width * height * 4);
        const squareSize = 10;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const isBlack = (Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2;
                const value = isBlack ? 0 : 255;
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }
        images.push({
            name: 'checkerboard-10px',
            type: 'high-contrast',
            image: new global.ImageData(data, width, height)
        });
    }

    // Vertical stripes
    {
        const data = new Uint8ClampedArray(width * height * 4);
        const stripeWidth = 7; // One HGR byte
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const value = Math.floor(x / stripeWidth) % 2 ? 255 : 0;
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }
        images.push({
            name: 'stripes-vertical',
            type: 'high-contrast',
            image: new global.ImageData(data, width, height)
        });
    }

    // Horizontal stripes
    {
        const data = new Uint8ClampedArray(width * height * 4);
        const stripeHeight = 10;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const value = Math.floor(y / stripeHeight) % 2 ? 255 : 0;
                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }
        images.push({
            name: 'stripes-horizontal',
            type: 'high-contrast',
            image: new global.ImageData(data, width, height)
        });
    }

    // 4. Line art / geometric shapes
    console.log('Generating line art test images...');

    // Circle
    {
        const data = new Uint8ClampedArray(width * height * 4);
        data.fill(255); // White background
        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(width, height) / 3;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const dx = x - centerX;
                const dy = y - centerY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Draw circle outline (2 pixel thickness)
                if (Math.abs(dist - radius) < 2) {
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                }
                data[i + 3] = 255;
            }
        }
        images.push({
            name: 'line-art-circle',
            type: 'line-art',
            image: new global.ImageData(data, width, height)
        });
    }

    // Rectangle
    {
        const data = new Uint8ClampedArray(width * height * 4);
        data.fill(255); // White background
        const margin = 40;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;

                // Draw rectangle outline
                if ((y === margin || y === height - margin - 1) &&
                    x >= margin && x < width - margin) {
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                } else if ((x === margin || x === width - margin - 1) &&
                          y >= margin && y < height - margin) {
                    data[i] = 0;
                    data[i + 1] = 0;
                    data[i + 2] = 0;
                }
                data[i + 3] = 255;
            }
        }
        images.push({
            name: 'line-art-rectangle',
            type: 'line-art',
            image: new global.ImageData(data, width, height)
        });
    }

    console.log(`Generated ${images.length} test images\n`);
    return images;
}

/**
 * Main execution
 */
async function main() {
    try {
        // Generate test images
        const testImages = generateTestImages();

        // Run quality assessment on all images
        console.log('Running quality assessments...');
        const results = [];

        for (const { name, type, image } of testImages) {
            console.log(`  Assessing: ${name} (${type})`);
            const result = await tester.assessConversionQuality(image, name);
            result.type = type;
            results.push(result);
        }

        console.log('\nQuality Assessment Complete!');
        console.log('============================\n');

        // Print summary statistics
        const avgPSNR = results.reduce((sum, r) => sum + (isFinite(r.psnr) ? r.psnr : 0), 0) / results.length;
        const avgSSIM = results.reduce((sum, r) => sum + r.ssim, 0) / results.length;

        console.log('Summary Statistics:');
        console.log(`  Average PSNR: ${avgPSNR.toFixed(2)} dB`);
        console.log(`  Average SSIM: ${avgSSIM.toFixed(3)}`);
        console.log('');

        // Print per-category statistics
        const types = [...new Set(results.map(r => r.type))];
        console.log('By Category:');
        for (const type of types) {
            const typeResults = results.filter(r => r.type === type);
            const typePSNR = typeResults.reduce((sum, r) => sum + (isFinite(r.psnr) ? r.psnr : 0), 0) / typeResults.length;
            const typeSSIM = typeResults.reduce((sum, r) => sum + r.ssim, 0) / typeResults.length;
            console.log(`  ${type}: PSNR ${typePSNR.toFixed(2)} dB, SSIM ${typeSSIM.toFixed(3)}`);
        }
        console.log('');

        // Print individual results
        console.log('Individual Results:');
        for (const result of results) {
            const psnrStr = isFinite(result.psnr) ? `${result.psnr.toFixed(2)} dB` : '∞ (perfect)';
            console.log(`  ${result.name.padEnd(30)} PSNR: ${psnrStr.padEnd(15)} SSIM: ${result.ssim.toFixed(3)}`);
        }
        console.log('');

        // Generate HTML report
        console.log('Generating HTML report...');
        const reportPath = await tester.generateHTMLReport(results, 'quality-report.html');
        console.log(`HTML report generated: ${reportPath}`);
        console.log('');

        // Print problem areas (lowest scores)
        const sortedByPSNR = results.filter(r => isFinite(r.psnr)).sort((a, b) => a.psnr - b.psnr);
        console.log('Images with Lowest Quality (Needs Improvement):');
        for (let i = 0; i < Math.min(5, sortedByPSNR.length); i++) {
            const result = sortedByPSNR[i];
            console.log(`  ${i + 1}. ${result.name} - PSNR: ${result.psnr.toFixed(2)} dB, SSIM: ${result.ssim.toFixed(3)}`);
        }
        console.log('');

        console.log('Complete! Open the HTML report to view detailed comparison images.');

    } catch (error) {
        console.error('Error generating quality report:', error);
        process.exit(1);
    }
}

main();
