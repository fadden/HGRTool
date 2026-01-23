/*
 * Copyright 2025 faddenSoft
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * NTSC color rendering for Apple II graphics.
 *
 * This module provides authentic NTSC composite video simulation, converting
 * Apple II HGR/DHGR graphics to RGB using the YIQ color space as it would have
 * appeared on a real CRT monitor.
 *
 * Based on the implementation from The 8-Bit Bunch's Outlaw Editor.
 */

import Debug from "./debug.js";

//
// NTSC color renderer for Apple II graphics.
//
export default class NTSCRenderer {
    // YIQ color space constants
    static MAX_I = 0.5957;
    static MAX_Q = 0.5226;
    static MAX_Y = 1.0;
    static MIN_Y = 0.0;

    // YIQ values for 16 DHGR colors (matching OutlawEditor lines 68-84)
    // These values represent the NTSC composite video color space
    // [Y, I, Q] for each 4-bit color pattern
    static YIQ_VALUES = [
        [0.0, 0.0, 0.0],        // 0
        [0.25, 0.5, 0.5],       // 1
        [0.25, -0.5, 0.5],      // 2
        [0.5, 0.0, 1.0],        // 3
        [0.25, -0.5, -0.5],     // 4
        [0.5, 0.0, 0.0],        // 5
        [0.5, -1.0, 0.0],       // 6
        [0.75, -0.5, 0.5],      // 7
        [0.25, 0.5, -0.5],      // 8
        [0.5, 1.0, 0.0],        // 9
        [0.5, 0.0, 0.0],        // 10
        [0.75, 0.5, 0.5],       // 11
        [0.5, 0.0, -1.0],       // 12
        [0.75, 0.5, -0.5],      // 13
        [0.75, -0.5, -0.5],     // 14
        [1.0, 0.0, 0.0]         // 15
    ];

    // HGR to DHGR bit expansion lookup tables
    static hgrToDhgr = [];
    static hgrToDhgrBW = [];

    // Palette lookup tables [phase][pattern] for fast color lookups
    // Matching OutlawEditor lines 63-64
    static solidPalette = Array(4).fill(null).map(() => new Array(128));
    static textPalette = Array(4).fill(null).map(() => new Array(128));

    // Adjustable NTSC parameters
    hue = 0.0;          // [-180, 180] degrees
    saturation = 1.0;   // [0, 2] multiplier
    brightness = 1.0;   // [0, 2] multiplier
    contrast = 1.0;     // [0, 2] multiplier

    constructor() {
        // Initialize lookup tables if not already done
        if (NTSCRenderer.hgrToDhgr.length === 0) {
            console.log('[NTSC] Initializing palettes...');
            NTSCRenderer.initPalettes();
            console.log('[NTSC] Palette initialized. Sample: solidPalette[0][76] = 0x' +
                       (NTSCRenderer.solidPalette[0][76] !== undefined ?
                        NTSCRenderer.solidPalette[0][76].toString(16) : 'undefined'));
        }
    }

    /**
     * Doubles a 7-bit byte value by duplicating each bit.
     * Example: 0b1010101 becomes 0b11001100110011
     */
    static byteDoubler(b) {
        const num = ((b & 64) << 6) | ((b & 32) << 5) | ((b & 16) << 4) |
                    ((b & 8) << 3) | ((b & 4) << 2) | ((b & 2) << 1) | (b & 1);
        return num | (num << 1);
    }

    /**
     * Initializes the palette lookup tables and HGR to DHGR bit expansion tables.
     * Matching OutlawEditor's initPalettes() (lines 67-124).
     *
     * This creates:
     * 1. solidPalette[4][128] - Color palettes for each phase and 7-bit pattern
     * 2. textPalette[4][128] - Same but with luminance based on bit density
     * 3. hgrToDhgr[512][256] - HGR byte pair to 28-bit DHGR word conversion
     * 4. hgrToDhgrBW[256][256] - Same but for black/white rendering
     *
     * CRITICAL: The high-bit shift (lines 106-111) is the key to proper color rendering.
     * When high bit is set, the doubled bits are shifted left by 1, creating a half-pixel
     * phase shift that produces the correct color artifacts.
     */
    static initPalettes() {
        const yiq = NTSCRenderer.YIQ_VALUES;

        // Build solidPalette and textPalette (matching OutlawEditor lines 87-98)
        const maxLevel = 10;
        for (let offset = 0; offset < 4; offset++) {
            for (let pattern = 0; pattern < 128; pattern++) {
                // Calculate luminance level from bit pattern (lines 89)
                const level = (pattern & 1) +
                             ((pattern >> 1) & 1) * 1 +
                             ((pattern >> 2) & 1) * 2 +
                             ((pattern >> 3) & 1) * 4 +
                             ((pattern >> 4) & 1) * 2 +
                             ((pattern >> 5) & 1) * 1;

                // Extract 4-bit color from center of 7-bit pattern (line 90)
                let col = (pattern >> 2) & 15;

                // Rotate color bits based on phase offset (lines 91-93)
                for (let rot = 0; rot < offset; rot++) {
                    col = ((col & 8) >> 3) | ((col << 1) & 15);
                }

                // solidPalette uses YIQ table's luminance (line 96)
                const y1 = yiq[col][0];
                const i = yiq[col][1] * NTSCRenderer.MAX_I;
                const q = yiq[col][2] * NTSCRenderer.MAX_Q;
                NTSCRenderer.solidPalette[offset][pattern] =
                    (255 << 24) | NTSCRenderer.yiqToRgb(y1, i, q);

                // textPalette uses calculated luminance from bit density (line 97)
                const y2 = level / maxLevel;
                NTSCRenderer.textPalette[offset][pattern] =
                    (255 << 24) | NTSCRenderer.yiqToRgb(y2, i, q);
            }
        }

        // Build HGR to DHGR conversion tables (matching OutlawEditor lines 100-123)
        NTSCRenderer.hgrToDhgr = new Array(512);
        NTSCRenderer.hgrToDhgrBW = new Array(256);

        for (let bb1 = 0; bb1 < 512; bb1++) {
            NTSCRenderer.hgrToDhgr[bb1] = new Array(256);
            if (bb1 < 256) {
                NTSCRenderer.hgrToDhgrBW[bb1] = new Array(256);
            }
        }

        for (let bb1 = 0; bb1 < 512; bb1++) {
            for (let bb2 = 0; bb2 < 256; bb2++) {
                // Line 104: Check if bit 0 of current byte should be merged with prev byte
                let value = ((bb1 & 385) >= 257) ? 1 : 0;

                // Lines 105-108: Double bits with high-bit shift for previous byte
                let b1 = NTSCRenderer.byteDoubler(bb1 & 127);
                if ((bb1 & 128) !== 0) {
                    b1 <<= 1;  // CRITICAL: Half-pixel shift when high bit set
                }

                // Lines 109-112: Double bits with high-bit shift for current byte
                let b2 = NTSCRenderer.byteDoubler(bb2 & 127);
                if ((bb2 & 128) !== 0) {
                    b2 <<= 1;  // CRITICAL: Half-pixel shift when high bit set
                }

                // Lines 113-115: Merge bits if prev byte's bit 6 and cur byte's bit 0 are both set
                if ((bb1 & 64) === 64 && (bb2 & 1) !== 0) {
                    b2 |= 1;
                }

                // Line 116: Combine into 28-bit word
                value |= b1 | (b2 << 14);

                // Lines 117-119: Set bit 28 if current byte's bit 6 is set
                if ((bb2 & 64) !== 0) {
                    value |= 268435456;  // 0x10000000
                }

                NTSCRenderer.hgrToDhgr[bb1][bb2] = value;

                // Line 121: Black and white table (no high bit handling)
                if (bb1 < 256) {
                    NTSCRenderer.hgrToDhgrBW[bb1][bb2] =
                        NTSCRenderer.byteDoubler(bb1) | (NTSCRenderer.byteDoubler(bb2) << 14);
                }
            }
        }
    }

    /**
     * Clamps a value to the specified range.
     */
    static normalize(x, minX, maxX) {
        if (x < minX) return minX;
        if (x > maxX) return maxX;
        return x;
    }

    /**
     * Converts YIQ color space to RGB.
     * @param {number} y - Luminance [0, 1]
     * @param {number} i - In-phase [-0.5957, 0.5957]
     * @param {number} q - Quadrature [-0.5226, 0.5226]
     * @returns {number} RGB color as 0xRRGGBB
     */
    static yiqToRgb(y, i, q) {
        const r = Math.round(NTSCRenderer.normalize(y + 0.956 * i + 0.621 * q, 0, 1) * 255);
        const g = Math.round(NTSCRenderer.normalize(y - 0.272 * i - 0.647 * q, 0, 1) * 255);
        const b = Math.round(NTSCRenderer.normalize(y - 1.105 * i + 1.702 * q, 0, 1) * 255);
        return (r << 16) | (g << 8) | b;
    }

    /**
     * Converts RGB to YIQ color space (inverse of yiqToRgb).
     * @param {number} r - Red [0, 255]
     * @param {number} g - Green [0, 255]
     * @param {number} b - Blue [0, 255]
     * @returns {Array<number>} [Y, I, Q]
     */
    rgbToYiq(r, g, b) {
        const rNorm = r / 255.0;
        const gNorm = g / 255.0;
        const bNorm = b / 255.0;

        const y = 0.299 * rNorm + 0.587 * gNorm + 0.114 * bNorm;
        const i = 0.596 * rNorm - 0.275 * gNorm - 0.321 * bNorm;
        const q = 0.212 * rNorm - 0.523 * gNorm + 0.311 * bNorm;

        return [y, i, q];
    }

    /**
     * Converts YIQ to RGBA8888 format.
     */
    static yiqToRgba(y, i, q) {
        return (NTSCRenderer.yiqToRgb(y, i, q) << 8) | 0xff;
    }

    // Note: Old DHGR palette initialization code removed.
    // HGR rendering now uses direct bit-pattern interpretation
    // with YIQ color values, similar to RGB rendering logic.

    /**
     * Renders an HGR scanline with NTSC color artifacts using palette lookups.
     *
     * This implementation matches OutlawEditor's palette-based approach:
     * 1. Convert HGR byte pairs to 28-bit DHGR words using hgrToDhgr lookup
     * 2. Extract 7-bit patterns from the DHGR word by shifting
     * 3. Look up colors from solidPalette[phase][pattern]
     * 4. Phase (0-3) alternates based on horizontal position
     *
     * The palette approach is much faster and more accurate than analyzing
     * bit patterns, as all color combinations are pre-computed.
     *
     * @param {ImageData} imageData - Target image data (must be 560×192)
     * @param {Uint8Array} rawBytes - HGR screen data
     * @param {number} row - Row number [0, 191]
     * @param {number} rowOffset - Offset into rawBytes for this row
     */
    renderHgrScanline(imageData, rawBytes, row, rowOffset) {
        const rgbaData = imageData.data;
        const width = imageData.width;  // Should be 560 for DHGR NTSC
        const palette = NTSCRenderer.solidPalette;

        // Debug first call
        if (row === 0 && !this._debugLogged) {
            this._debugLogged = true;
            console.log(`[NTSC] First renderHgrScanline call:`);
            console.log(`  imageData: ${imageData.width}x${imageData.height}`);
            console.log(`  palette defined: ${palette !== undefined && palette[0] !== undefined}`);
            console.log(`  First HGR byte: 0x${rawBytes[rowOffset].toString(16)}`);
        }

        // HGR scanline has 40 bytes = 20 byte pairs
        // Each byte pair produces 28 DHGR pixels via hgrToDhgr lookup
        // This matches AppleImageRenderer.renderHGRScanline (lines 82-88)
        const scanline = new Array(20);
        let extraHalfBit = false;

        // Build scanline array of 28-bit words (matching OutlawEditor lines 82-88)
        for (let x = 0; x < 40; x += 2) {
            const b1 = rawBytes[rowOffset + x] & 0xff;
            const b2 = rawBytes[rowOffset + x + 1] & 0xff;

            // Apply extra half-bit if previous word indicated it
            const b1Index = (extraHalfBit && x > 0) ? (b1 | 0x100) : b1;
            const wordValue = NTSCRenderer.hgrToDhgr[b1Index][b2];

            // Extract bit 28 for next iteration
            extraHalfBit = (wordValue & 0x10000000) !== 0;

            // Store 28-bit word (mask off bit 28)
            scanline[x / 2] = wordValue & 0x0fffffff;
        }

        // Render scanline (matching AppleImageRenderer.renderScanline logic)
        // Process each 28-bit word in the scanline
        let x = 0;
        for (let s = 0; s < scanline.length; s++) {
            // Shift left by 2 and bring in bits from previous word (line 103-105)
            let bits = scanline[s] << 2;
            if (s > 0) {
                bits |= (scanline[s - 1] >> 26) & 3;
            }

            // Get bits to add from next word for mid-word transition (line 114)
            const add = (s < scanline.length - 1) ? (scanline[s + 1] & 7) : 0;

            // Process all 28 DHGR pixels from this word (line 138-148)
            for (let i = 0; i < 28; i++) {
                const phase = i % 4;
                const pattern = bits & 0x7f;

                // Look up color from palette
                const col = palette[phase][pattern];

                // Extract RGB (format: AARRGGBB)
                const r = (col >> 16) & 0xff;
                const g = (col >> 8) & 0xff;
                const b = col & 0xff;

                // Apply adjustable NTSC parameters if needed
                let rgb;
                if (this.hue !== 0 || this.saturation !== 1.0 ||
                    this.brightness !== 1.0 || this.contrast !== 1.0) {
                    const [y, i_val, q] = this.rgbToYiq(r, g, b);
                    const [adjY, adjI, adjQ] = this.adjustYiq(y, i_val, q);
                    rgb = NTSCRenderer.yiqToRgb(adjY, adjI, adjQ);
                } else {
                    rgb = (r << 16) | (g << 8) | b;
                }

                // Write pixel
                if (x < width) {
                    const pixelIndex = (row * width + x) * 4;
                    rgbaData[pixelIndex] = (rgb >> 16) & 0xff;
                    rgbaData[pixelIndex + 1] = (rgb >> 8) & 0xff;
                    rgbaData[pixelIndex + 2] = rgb & 0xff;
                    rgbaData[pixelIndex + 3] = 0xff;
                }
                x++;

                // Shift to next bit (line 144)
                bits >>= 1;

                // At pixel 20, add bits from next word (line 145-147)
                if (i === 20) {
                    bits |= add << 9;  // hiresMode = true, so shift by 9
                }
            }
        }
    }

    /**
     * Determines YIQ color from a 4-bit HGR window.
     *
     * This is the KEY FIX for the color bars bug. Instead of looking at individual
     * HGR pixels, we analyze a 4-bit window to detect alternating patterns.
     *
     * NTSC color averaging:
     * - A 4-bit window like "0101" represents 2 complete color cycles
     * - NTSC blurs this into a single perceived color
     * - The high bit selects the color palette
     *
     * @param {number} bit0 - HGR bit at position x-1
     * @param {number} bit1 - HGR bit at position x
     * @param {number} bit2 - HGR bit at position x+1
     * @param {number} bit3 - HGR bit at position x+2
     * @param {boolean} highBit - High bit for this byte
     * @param {number} hgrX - Horizontal position (for phase)
     * @returns {Array<number>} [Y, I, Q] color values
     */
    getColorFromHgr4BitWindow(bit0, bit1, bit2, bit3, highBit, hgrX) {
        // Luminance: average of all 4 bits
        const bitSum = bit0 + bit1 + bit2 + bit3;
        const y = bitSum / 4.0;

        // Detect alternating patterns
        // Perfect alternation: 0101 or 1010
        const pattern = (bit0 << 3) | (bit1 << 2) | (bit2 << 1) | bit3;
        const isAlternating = (pattern === 0b0101 || pattern === 0b1010);

        if (isAlternating) {
            // Pure alternating = full color saturation
            // High bit determines color: 0=purple/green, 1=blue/orange
            // Pattern determines phase: 0101 vs 1010 differ by 180°
            const patternPhase = (pattern === 0b1010) ? 2 : 0;  // 0 or 2
            const highBitPhase = highBit ? 1 : 0;                // 0 or 1
            const totalPhase = (patternPhase + highBitPhase) % 4;

            // Apple II NTSC color phases (empirically determined):
            // totalPhase 0 = purple (hue ~300°)
            // totalPhase 1 = blue (hue ~240°)
            // totalPhase 2 = green (hue ~120°)
            // totalPhase 3 = orange (hue ~30°)
            //
            // Phase offset calculation:
            // For totalPhase=3 to produce orange at 30°:
            // 3 * 90° + offset = 30° → offset = 30° - 270° = -240°
            const hueRadians = (totalPhase * Math.PI / 2) - (4 * Math.PI / 3);  // -240°

            const saturation = 0.5;
            const i = saturation * Math.cos(hueRadians);
            const q = saturation * Math.sin(hueRadians);

            return [y, i, q];
        }

        // Count bit transitions for partial color
        const transitions = ((bit0 !== bit1) ? 1 : 0) +
                          ((bit1 !== bit2) ? 1 : 0) +
                          ((bit2 !== bit3) ? 1 : 0);

        if (transitions >= 2) {
            // Some alternation = some color
            // Use position-based phase for mixed patterns
            const positionPhase = (hgrX % 2) * 2;
            const highBitPhase = highBit ? 1 : 0;
            const totalPhase = (positionPhase + highBitPhase) % 4;
            const hueRadians = totalPhase * Math.PI / 2;

            const saturation = 0.3 * (transitions / 3.0);  // Weaker saturation
            const i = saturation * Math.cos(hueRadians);
            const q = saturation * Math.sin(hueRadians);

            return [y, i, q];
        }

        // No alternation = grayscale
        return [y, 0, 0];
    }

    /**
     * Determines YIQ color from HGR bit pattern (LEGACY METHOD).
     * @deprecated Replaced by getColorFromHgr4BitWindow for color bars fix.
     */
    getColorFromHgrBits(prevBit, curBit, nextBit, highBit, hgrX) {
        // Luminance: average of the 3-bit window
        const y = (prevBit + curBit + nextBit) / 3.0;

        // Check for alternating pattern (color)
        const isPrevDifferent = (prevBit !== curBit);
        const isNextDifferent = (nextBit !== curBit);

        // Strong alternation = strong color
        if (isPrevDifferent && isNextDifferent) {
            // Pure alternating pattern: determine color from high bit and position
            // Position determines base phase: even positions and odd positions differ by 180°
            const positionPhase = (hgrX % 2) * 2;  // 0 or 2 (0° or 180°)
            // High bit adds another 90° shift
            const highBitPhase = highBit ? 1 : 0;  // 0 or 1 (0° or 90°)
            const totalPhase = (positionPhase + highBitPhase) % 4;

            // Apple II NTSC color phases (empirically determined):
            // totalPhase 0 = purple (hue ~300°)
            // totalPhase 1 = blue (hue ~240°)
            // totalPhase 2 = green (hue ~120°)
            // totalPhase 3 = orange (hue ~30°)
            //
            // Phase offset calculation:
            // For totalPhase=3 to produce orange at 30°:
            // 3 * 90° + offset = 30° → offset = 30° - 270° = -240°
            const hueRadians = (totalPhase * Math.PI / 2) - (4 * Math.PI / 3);  // -240°

            // Use strong saturation for pure alternating patterns
            const saturation = 0.5;
            const i = saturation * Math.cos(hueRadians);
            const q = saturation * Math.sin(hueRadians);

            return [y, i, q];
        } else if (isPrevDifferent || isNextDifferent) {
            // Weak alternation = weak color
            const positionPhase = (hgrX % 2) * 2;
            const highBitPhase = highBit ? 1 : 0;
            const totalPhase = (positionPhase + highBitPhase) % 4;
            const hueRadians = totalPhase * Math.PI / 2;

            const saturation = 0.25;  // Weaker saturation
            const i = saturation * Math.cos(hueRadians);
            const q = saturation * Math.sin(hueRadians);

            return [y, i, q];
        }

        // No alternation = grayscale
        return [y, 0, 0];
    }

    /**
     * Extracts a 4-bit window from the DHGR bit stream at the specified position.
     * @param {Array<number>} dhgrBits - DHGR bit stream (560 bits)
     * @param {number} position - Position in bit stream [0, 559]
     * @returns {number} 4-bit pattern [0, 15]
     * @deprecated This method is no longer used after the color bars bug fix.
     */
    get4BitWindow(dhgrBits, position) {
        // Get 4 consecutive bits starting at position
        // Handle edge cases where we go past the end
        const bit0 = position < dhgrBits.length ? dhgrBits[position] : 0;
        const bit1 = position + 1 < dhgrBits.length ? dhgrBits[position + 1] : 0;
        const bit2 = position + 2 < dhgrBits.length ? dhgrBits[position + 2] : 0;
        const bit3 = position + 3 < dhgrBits.length ? dhgrBits[position + 3] : 0;

        return (bit0 << 3) | (bit1 << 2) | (bit2 << 1) | bit3;
    }

    /**
     * Determines YIQ color from 4-bit DHGR pattern and phase.
     * This simulates NTSC color fringing based on the bit pattern.
     *
     * For Apple II NTSC rendering:
     * - All-black (0000) = black
     * - All-white (1111) = white
     * - Alternating patterns create color based on phase:
     *   - Phase 0,2: 0101 = purple, 1010 = green
     *   - Phase 1,3: 0101 = blue, 1010 = orange
     *
     * @param {number} pattern - 4-bit pattern [0, 15]
     * @param {number} phase - Color phase [0, 3] based on horizontal position
     * @returns {Array<number>} [Y, I, Q] color values
     */
    getColorFromPattern(pattern, phase) {
        // Handle solid black and white first
        if (pattern === 0b0000) {
            return [0.0, 0.0, 0.0];  // Black
        }
        if (pattern === 0b1111) {
            return [1.0, 0.0, 0.0];  // White
        }

        // Count set bits for luminance calculation
        const bitCount = (pattern & 0b1000 ? 1 : 0) +
                        (pattern & 0b0100 ? 1 : 0) +
                        (pattern & 0b0010 ? 1 : 0) +
                        (pattern & 0b0001 ? 1 : 0);

        // Base luminance from bit density
        const y = bitCount / 4.0;

        // Detect alternating patterns for color generation
        // 0101 = alternating starting with 0
        // 1010 = alternating starting with 1
        const isAlternating0101 = (pattern === 0b0101);
        const isAlternating1010 = (pattern === 0b1010);

        if (isAlternating0101 || isAlternating1010) {
            // Strong color saturation for pure alternating patterns
            // Color phase depends on both pattern and pixel position
            const patternPhase = isAlternating1010 ? 2 : 0;  // 1010 shifts by 180 degrees
            const totalPhase = (phase + patternPhase) % 4;

            // Apple II NTSC color phases (empirically determined):
            // totalPhase 0 = purple (hue ~300°)
            // totalPhase 1 = blue (hue ~240°)
            // totalPhase 2 = green (hue ~120°)
            // totalPhase 3 = orange (hue ~30°)
            //
            // Phase offset calculation:
            // For totalPhase=3 to produce orange at 30°:
            // 3 * 90° + offset = 30° → offset = 30° - 270° = -240°
            const hueRadians = (totalPhase * Math.PI / 2) - (4 * Math.PI / 3);  // -240°  // 0, 90, 180, 270 degrees

            // Use Apple II color saturation (moderate, not full intensity)
            const saturation = 0.5;
            const i = saturation * Math.cos(hueRadians);
            const q = saturation * Math.sin(hueRadians);

            return [y, i, q];
        }

        // For mixed patterns (not pure alternating), calculate based on bit transitions
        const transitions = ((pattern & 0b1000) !== (pattern & 0b0100) ? 1 : 0) +
                          ((pattern & 0b0100) !== (pattern & 0b0010) ? 1 : 0) +
                          ((pattern & 0b0010) !== (pattern & 0b0001) ? 1 : 0);

        if (transitions >= 2) {
            // Some alternation = some color
            const hueRadians = phase * Math.PI / 2;
            const saturation = 0.3 * (transitions / 3.0);  // Weaker saturation for mixed patterns
            const i = saturation * Math.cos(hueRadians);
            const q = saturation * Math.sin(hueRadians);
            return [y, i, q];
        }

        // Solid runs of bits = grayscale
        return [y, 0, 0];
    }

    /**
     * Applies adjustable NTSC parameters to a YIQ color.
     */
    adjustYiq(y, i, q) {
        // Apply brightness and contrast
        y = (y - 0.5) * this.contrast + 0.5 + (this.brightness - 1.0) * 0.5;

        // Apply saturation
        i *= this.saturation;
        q *= this.saturation;

        // Apply hue rotation (convert hue to radians)
        if (this.hue !== 0) {
            const hueRad = this.hue * Math.PI / 180;
            const cosHue = Math.cos(hueRad);
            const sinHue = Math.sin(hueRad);
            const iNew = i * cosHue - q * sinHue;
            const qNew = i * sinHue + q * cosHue;
            i = iNew;
            q = qNew;
        }

        return [y, i, q];
    }
}
