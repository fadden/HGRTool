/*
 * Copyright 2025 faddenSoft
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Nearest-neighbor quantization for HGR with NTSC-aware color matching.
 *
 * This is a non-dithered first pass that selects the best-matching byte
 * for each position based purely on minimizing perceptual color error.
 * No error diffusion, no smoothness penalties - just pure color matching.
 *
 * This can be used standalone or as the first pass of a two-pass refinement.
 */

/**
 * Calculates error for a candidate byte using cached NTSC palette lookups.
 * Uses the same optimized approach as the Greedy algorithm.
 */
function calculateByteError(candidateByte, targetColors, byteX, imageDither, scanlineSoFar) {
    // Get previous byte for context
    const prevByte = byteX > 0 ? scanlineSoFar[byteX - 1] : 0;

    // Use cached palette lookup (fast, pre-computed colors)
    return imageDither.calculateNTSCError(prevByte, candidateByte, targetColors, byteX);
}

/**
 * Finds the best byte by testing all 256 values.
 */
function findBestByte(targetColors, byteX, imageDither, scanlineSoFar) {
    let bestByte = 0;
    let leastError = Infinity;

    // Test all 256 possible byte values
    for (let byte = 0; byte < 256; byte++) {
        const error = calculateByteError(
            byte,
            targetColors,
            byteX,
            imageDither,
            scanlineSoFar
        );

        if (error < leastError) {
            leastError = error;
            bestByte = byte;
        }
    }

    return bestByte;
}

/**
 * Dithers a single scanline using nearest-neighbor quantization.
 * No error diffusion - just picks the best-matching byte for each position.
 */
export function nearestNeighborDitherScanline(pixels, y, targetWidth, pixelWidth, imageDither) {
    const scanline = new Uint8Array(targetWidth);

    for (let byteX = 0; byteX < targetWidth; byteX++) {
        // Get target colors for this byte (7 pixels)
        const targetColors = [];
        for (let bit = 0; bit < 7; bit++) {
            const pixelX = byteX * 7 + bit;
            const pixelIdx = (y * pixelWidth + pixelX) * 4;

            targetColors.push({
                r: pixels[pixelIdx],
                g: pixels[pixelIdx + 1],
                b: pixels[pixelIdx + 2]
            });
        }

        // Find best byte (no error diffusion)
        const bestByte = findBestByte(
            targetColors,
            byteX,
            imageDither,
            scanline
        );

        scanline[byteX] = bestByte;
    }

    return scanline;
}
