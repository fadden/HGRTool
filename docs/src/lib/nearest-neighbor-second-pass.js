/*
 * Copyright 2025 faddenSoft
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Second pass refinement for nearest-neighbor dithering.
 *
 * Takes the first-pass results and refines them using error diffusion.
 * The key advantage: we know what neighboring bytes are (from first pass),
 * so we can accurately evaluate NTSC rendering without guessing.
 */

import NTSCRenderer from './ntsc-renderer.js';

function perceptualDistanceSquared(c1, c2) {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
}

/**
 * Extracts target colors with accumulated error for a byte position.
 */
function getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth) {
    const targetColors = [];

    for (let bit = 0; bit < 7; bit++) {
        const pixelX = byteX * 7 + bit;
        const pixelIdx = (y * pixelWidth + pixelX) * 4;

        // Get base color from source
        let r = pixels[pixelIdx];
        let g = pixels[pixelIdx + 1];
        let b = pixels[pixelIdx + 2];

        // Add accumulated error if buffer exists
        const errorIdx = y * pixelWidth + pixelX;
        if (errorBuffer && errorBuffer[errorIdx]) {
            const err = errorBuffer[errorIdx];
            r = Math.max(0, Math.min(255, r + err.r));
            g = Math.max(0, Math.min(255, g + err.g));
            b = Math.max(0, Math.min(255, b + err.b));
        }

        targetColors.push({ r, g, b });
    }

    return targetColors;
}

/**
 * Calculates error for a candidate byte using refined context from second pass.
 *
 * @param {number} candidateByte - The byte value to test
 * @param {Array} targetColors - Target RGB colors for the 7 pixels
 * @param {number} byteX - Current byte position (0-39)
 * @param {NTSCRenderer} renderer - NTSC renderer instance
 * @param {ImageData} imageData - Canvas image data for rendering
 * @param {Uint8Array} hgrBytes - HGR scanline buffer (modified in place)
 * @param {Uint8Array} scanlineSoFar - Refined bytes from second pass (0 to byteX-1)
 * @param {Uint8Array} firstPassScanline - First-pass results for bytes not yet refined
 */
function calculateByteErrorWithContext(candidateByte, targetColors, byteX, renderer, imageData, hgrBytes, scanlineSoFar, firstPassScanline) {
    // Use refined results from second pass for bytes before current position
    for (let i = 0; i < byteX; i++) {
        hgrBytes[i] = scanlineSoFar[i];
    }

    // Place candidate byte at current position
    hgrBytes[byteX] = candidateByte;

    // Use first-pass results for bytes after current position (not yet refined)
    for (let i = byteX + 1; i < hgrBytes.length; i++) {
        hgrBytes[i] = firstPassScanline[i];
    }

    // Clear imageData
    for (let i = 0; i < imageData.data.length; i++) {
        imageData.data[i] = 0;
    }

    // Render through NTSC
    renderer.renderHgrScanline(imageData, hgrBytes, 0, 0);

    // Calculate error for the 7 pixels in this byte
    let totalError = 0;
    const renderedColors = [];

    for (let bitPos = 0; bitPos < 7; bitPos++) {
        const pixelX = byteX * 7 + bitPos;
        const ntscX = pixelX * 2;
        const idx = ntscX * 4;

        const rendered = {
            r: imageData.data[idx],
            g: imageData.data[idx + 1],
            b: imageData.data[idx + 2]
        };

        renderedColors.push(rendered);
        totalError += perceptualDistanceSquared(rendered, targetColors[bitPos]);
    }

    return { totalError, renderedColors };
}

/**
 * Propagates quantization error to adjacent pixels using Floyd-Steinberg.
 */
function propagateError(errorBuffer, byteX, y, target, rendered, pixelWidth, height) {
    // Floyd-Steinberg error diffusion:
    //         X   7/16
    //     3/16 5/16 1/16

    for (let bit = 0; bit < 7; bit++) {
        const pixelX = byteX * 7 + bit;

        const error = {
            r: target[bit].r - rendered[bit].r,
            g: target[bit].g - rendered[bit].g,
            b: target[bit].b - rendered[bit].b
        };

        const distributions = [
            { dx: 1, dy: 0, weight: 7 / 16 },   // Right
            { dx: -1, dy: 1, weight: 3 / 16 },  // Bottom-left
            { dx: 0, dy: 1, weight: 5 / 16 },   // Bottom
            { dx: 1, dy: 1, weight: 1 / 16 }    // Bottom-right
        ];

        for (const { dx, dy, weight } of distributions) {
            const nx = pixelX + dx;
            const ny = y + dy;

            if (ny >= 0 && ny < height && nx >= 0 && nx < pixelWidth) {
                const idx = ny * pixelWidth + nx;
                if (!errorBuffer[idx]) {
                    errorBuffer[idx] = { r: 0, g: 0, b: 0 };
                }

                // Clamp on write
                errorBuffer[idx].r = Math.max(-255, Math.min(255, errorBuffer[idx].r + error.r * weight));
                errorBuffer[idx].g = Math.max(-255, Math.min(255, errorBuffer[idx].g + error.g * weight));
                errorBuffer[idx].b = Math.max(-255, Math.min(255, errorBuffer[idx].b + error.b * weight));
            }
        }
    }
}

/**
 * Second pass: refines first pass using error diffusion.
 */
export function secondPassDitherScanline(pixels, errorBuffer, y, targetWidth, pixelWidth, height, renderer, imageData, hgrBytes, firstPassScanline) {
    const scanline = new Uint8Array(targetWidth);

    for (let byteX = 0; byteX < targetWidth; byteX++) {
        // Get target colors with accumulated error
        const targetColors = getTargetWithError(pixels, errorBuffer, byteX, y, pixelWidth);

        let bestByte = firstPassScanline[byteX]; // Start with first-pass result
        let leastError = Infinity;
        let bestRenderedColors = null;

        // Test all 256 byte values
        for (let byte = 0; byte < 256; byte++) {
            const { totalError, renderedColors } = calculateByteErrorWithContext(
                byte,
                targetColors,
                byteX,
                renderer,
                imageData,
                hgrBytes,
                scanline,  // Pass refined results from second pass so far
                firstPassScanline
            );

            if (totalError < leastError) {
                leastError = totalError;
                bestByte = byte;
                bestRenderedColors = renderedColors;
            }
        }

        scanline[byteX] = bestByte;

        // Propagate error (Floyd-Steinberg)
        propagateError(errorBuffer, byteX, y, targetColors, bestRenderedColors, pixelWidth, height);
    }

    return scanline;
}
