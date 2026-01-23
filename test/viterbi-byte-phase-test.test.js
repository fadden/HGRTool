/**
 * Test to identify the phase/rendering bug in viterbi-byte algorithm.
 *
 * This test compares:
 * 1. calculateNTSCError (used by greedy/viterbi-full) - WORKS
 * 2. calculateByteErrorWithColors (used by viterbi-byte) - BROKEN
 *
 * For the SAME byte, these should produce the SAME rendered colors.
 * If they don't, we've found the bug!
 */

import { describe, it, expect, beforeAll } from 'vitest';

describe('Viterbi Byte Phase Bug Investigation', () => {
    let ImageDither;
    let NTSCRenderer;
    let viterbiByteDither;

    beforeAll(async () => {
        const imageDitherModule = await import('../docs/src/lib/image-dither.js');
        const ntscRendererModule = await import('../docs/src/lib/ntsc-renderer.js');
        const viterbiByteModule = await import('../docs/src/lib/viterbi-byte-dither.js');

        ImageDither = imageDitherModule.default;
        NTSCRenderer = ntscRendererModule.default;
        viterbiByteDither = viterbiByteModule.viterbiByteDither;

        // Initialize NTSC palettes
        new NTSCRenderer();
    });

    it('should produce same colors from calculateNTSCError and renderHgrScanline', () => {
        console.log('\n=== PHASE BUG INVESTIGATION ===\n');

        const dither = new ImageDither();
        const renderer = new NTSCRenderer();

        // Test byte: 0x55 (01010101) - should produce gray
        const testByte = 0x55;
        const prevByte = 0x00;
        const byteX = 0;

        // Target colors (gray)
        const targetColors = [];
        for (let i = 0; i < 7; i++) {
            targetColors.push({ r: 128, g: 128, b: 128 });
        }

        console.log(`Testing byte 0x${testByte.toString(16)} at position ${byteX}`);
        console.log(`Previous byte: 0x${prevByte.toString(16)}\n`);

        // Method 1: calculateNTSCError (used by greedy - WORKS)
        console.log('Method 1: calculateNTSCError (used by greedy/viterbi-full)');
        const error1 = dither.calculateNTSCError(prevByte, testByte, targetColors, byteX);
        console.log(`  Total error: ${error1.toFixed(2)}`);

        // Extract rendered colors by calling the internal method
        const dhgrBits = NTSCRenderer.hgrToDhgr[prevByte][testByte];
        console.log('  Rendered colors:');
        for (let bitPos = 0; bitPos < 7; bitPos++) {
            const dhgrStartBit = 14 + (bitPos * 2);
            const pattern = (dhgrBits >> (dhgrStartBit - 3)) & 0x7F;
            const pixelX = byteX * 7 + bitPos;
            const phase = ((pixelX * 2) + 3) % 4;
            const ntscColor = NTSCRenderer.solidPalette[phase][pattern];
            const r = (ntscColor >> 16) & 0xFF;
            const g = (ntscColor >> 8) & 0xFF;
            const b = ntscColor & 0xFF;
            console.log(`    Pixel ${bitPos}: (${r}, ${g}, ${b}) [phase=${phase}, pattern=0x${pattern.toString(16)}]`);
        }
        console.log('');

        // Method 2: renderHgrScanline (used by viterbi-byte - BROKEN?)
        console.log('Method 2: renderHgrScanline (used by viterbi-byte)');

        // Set up like calculateByteErrorWithColors does
        const hgrBytes = new Uint8Array(40);
        hgrBytes[byteX] = testByte;
        // Fill rest with testByte (like viterbi-byte does)
        for (let i = byteX + 1; i < 40; i++) {
            hgrBytes[i] = testByte;
        }

        const imageData = new ImageData(560, 1);
        renderer.renderHgrScanline(imageData, hgrBytes, 0, 0);

        console.log('  Rendered colors:');
        let totalError2 = 0;
        for (let bitPos = 0; bitPos < 7; bitPos++) {
            const pixelX = byteX * 7 + bitPos;
            const ntscX = pixelX * 2;
            const idx = ntscX * 4;
            const r = imageData.data[idx];
            const g = imageData.data[idx + 1];
            const b = imageData.data[idx + 2];
            console.log(`    Pixel ${bitPos}: (${r}, ${g}, ${b})`);

            // Calculate error
            const dr = r - targetColors[bitPos].r;
            const dg = g - targetColors[bitPos].g;
            const db = b - targetColors[bitPos].b;
            totalError2 += dr*dr + dg*dg + db*db;
        }
        console.log(`  Total error: ${totalError2.toFixed(2)}`);
        console.log('');

        // Compare
        console.log('COMPARISON:');
        console.log(`  Method 1 error: ${error1.toFixed(2)}`);
        console.log(`  Method 2 error: ${totalError2.toFixed(2)}`);
        console.log(`  Difference: ${Math.abs(error1 - totalError2).toFixed(2)}`);

        if (Math.abs(error1 - totalError2) > 0.01) {
            console.log('  ❌ MISMATCH DETECTED - This is the bug!');
        } else {
            console.log('  ✓ Match - colors are the same');
        }

        console.log('\n=== END INVESTIGATION ===\n');
    });

    it('should test phase calculation at different byte positions', () => {
        console.log('\n=== PHASE CALCULATION AT DIFFERENT POSITIONS ===\n');

        const dither = new ImageDither();
        const testByte = 0x55;
        const prevByte = 0x00;

        const targetColors = [];
        for (let i = 0; i < 7; i++) {
            targetColors.push({ r: 128, g: 128, b: 128 });
        }

        // Test at byte positions 0, 1, 2, 3 to see if phase alignment is correct
        for (const byteX of [0, 1, 2, 3]) {
            console.log(`\nByte position ${byteX}:`);

            // Calculate what phase the leftmost pixel SHOULD have
            const pixelX = byteX * 7;
            const expectedPhase = ((pixelX * 2) + 3) % 4;
            console.log(`  Expected phase for pixel 0: ${expectedPhase}`);

            // Get actual rendered color
            const hgrBytes = new Uint8Array(40);
            hgrBytes.fill(testByte);
            const imageData = new ImageData(560, 1);
            const renderer = new NTSCRenderer();
            renderer.renderHgrScanline(imageData, hgrBytes, 0, 0);

            const ntscX = pixelX * 2;
            const idx = ntscX * 4;
            const r = imageData.data[idx];
            const g = imageData.data[idx + 1];
            const b = imageData.data[idx + 2];
            console.log(`  Actual rendered color: (${r}, ${g}, ${b})`);

            // Get expected color from calculateNTSCError
            const dhgrBits = NTSCRenderer.hgrToDhgr[prevByte][testByte];
            const dhgrStartBit = 14; // First pixel (bitPos=0)
            const pattern = (dhgrBits >> (dhgrStartBit - 3)) & 0x7F;
            const ntscColor = NTSCRenderer.solidPalette[expectedPhase][pattern];
            const expectedR = (ntscColor >> 16) & 0xFF;
            const expectedG = (ntscColor >> 8) & 0xFF;
            const expectedB = ntscColor & 0xFF;
            console.log(`  Expected color: (${expectedR}, ${expectedG}, ${expectedB})`);

            if (r === expectedR && g === expectedG && b === expectedB) {
                console.log(`  ✓ Match`);
            } else {
                console.log(`  ❌ MISMATCH - phase calculation is wrong!`);
            }
        }

        console.log('\n=== END PHASE TEST ===\n');
    });
});
