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

/*
Implementation of Apple II standard hi-res graphics.

This does not model half-pixel shifts or NTSC fringe effects.  The screen is regarded as
280x192 whether we're currently displaying it as color or monochrome.  When generating color,
we need to look at the bits surrounding each pixel to determine what the color should be.
Examples ('B'=black, 'W'=white, 'G'=green, 'P'=purple, bits reversed to match screen order):
 $00 x-> 0000000 -> BBBBBBB
 $7f x-> 1111111 -> WWWWWWW
 $7e x-> 0111111 -> BWWWWWW
 $7c x-> 0011111 -> BBWWWWW
 $72 x-> 0100111 -> BGBBWWW
 $41 x-> 1000001 -> PBBBBBP
 $1d x-> 1011100 -> PPWWWBB
 $55 x-> 1010101 -> PPPPPPP
 $2a x-> 0101010 -> BGGGGGB
 $2d x-> 1011010 -> PPWWGGB (*)
 $51 x-> 1000101 -> PBBBPPP
These examples assume that the bytes before and after are zero, which is the case for the
screen edges.  '1' bits always have a color on screen, determined by the odd/even position of
the bit and the value of the previous and following bits, while '0' bits only have a color if
the bits to the left and right are both set.

For any given pixel, we can determine its base color based on the three bits before, at, and
after the pixel's position.  This is combined with the high bit of the pixel's byte to determine
whether we use green/purple or orange/blue.

To render the pixel data for display, we use an ImageData object, which allows us to specify
pixels as RGBA8888 data.  ImageData objects are created for a specific Canvas context, and we
want to keep our objects independent from Canvas, so we need to pass ImageData objects in as
arguments rather than storing them as members.

To handle modifications efficiently, we want to update a minimal set of pixels in the
ImageData object when bits in the underlying data change.  This is a bit complicated because
changes to a given byte potentially affect pixels in the bytes to the left and right.

Some operations, such as line drawing, could be implemented more efficiently inside this
class rather than being handled as pixel operations in Picture, because we wouldn't need to
recalculate things like the byte and line offsets for every pixel.  For our purposes this isn't
important.
*/

import gColorPalette from "./palette.js";
import Clipping from "./clipping.js";
import Debug from "./debug.js";

//
// Manage a ~8KB standard hi-res screen.
//
export default class StdHiRes {
    static FORMAT_NAME = "std-hi-res";
    static EXPECTED_LEN = 8192;
    static MIN_LEN = StdHiRes.EXPECTED_LEN - 8;
    static MAX_LEN = StdHiRes.EXPECTED_LEN;
    static NUM_COLS = 280;
    static NUM_COL_BYTES = 280 / 7;
    static NUM_ROWS = 192;
    static MODE_BYTE_OFFSET = 120;
    static SIG_BYTE_OFFSET = 121;

    // "HGRTool" in ASCII.
    static SIGNATURE = new Uint8Array([0x48, 0x47, 0x52, 0x54, 0x6f, 0x6f, 0x6c]);

    // We use hi-res patterns that are 4 bytes wide by two rows high.
    // These are too big to store in a JavaScript integer, so we generally use a Uint8Array(8).
    static PATTERN_LEN = 4 * 2;

    // Pattern objects for transparent-low and transparent-high.  These are handled specially.
    static HI_BIT_CLEAR = new Uint8Array(StdHiRes.PATTERN_LEN);
    static HI_BIT_SET = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);

    // Pattern with all black pixels, used for operations like "cut".
    CLEAR_PATTERN = new Uint8Array(StdHiRes.PATTERN_LEN);

    //
    // Constructor.  Loads raw image data from a file ArrayBuffer, or creates a new blank image.
    //
    // Throws an exception if the file contents are incompatible.
    //
    //  buffer: ArrayBuffer object, or undefined for a new image
    //
    constructor(arrayBuffer) {
        if (arrayBuffer === undefined) {
            this.rawBytes = new Uint8Array(StdHiRes.MIN_LEN);
            // The file type note for FOT ($08) says the first byte in the first screen hole
            // at +120 (+$78) is reserved for use as a mode byte.  Put our signature into
            // the next seven.
            this.rawBytes[StdHiRes.MODE_BYTE_OFFSET] = 1;       // 280x192 limited color, page 1
            for (let i = 0; i < StdHiRes.SIGNATURE.length; i++) {
                this.rawBytes[StdHiRes.SIG_BYTE_OFFSET + i] = StdHiRes.SIGNATURE[i];
            }
        } else {
            let size = arrayBuffer.byteLength;
            if (!StdHiRes.checkMatch(size)) {
                throw new Error("incorrect size");      // should have been caught earlier
            }
            // Make a copy of the data in the ArrayBuffer.
            this.rawBytes = new Uint8Array(arrayBuffer);
        }
    }

    toString() { return "[StdHiRes]"; }

    // These map a 3-bit previous-current-next pattern to a hi-res color.  The color may change
    // depending on whether "current" is in an odd or even column, so the table has two parts.
    static bitsToColor = [
        // even columns
        0,      // 000  black0/black1
        0,      // 001  black0/black1
        1,      // 010  purple/blue
        3,      // 011  white0/white1
        0,      // 100  black0/black1
        2,      // 101  green/orange
        3,      // 110  white0/white1
        3,      // 111  white0/white1
        // odd columns
        0,      // 000  black0/black1
        0,      // 001  black0/black1
        2,      // 010  green/orange
        3,      // 011  white0/white1
        0,      // 100  black0/black1
        1,      // 101  purple/blue
        3,      // 110  white0/white1
        3,      // 111  white0/white1
    ];
    // Map the hi-res color index [0,7] to an RGBA color.
    static colorToRGBA = [
        gColorPalette.get("Black"),
        gColorPalette.get("Purple"),
        gColorPalette.get("LightGreen"),
        gColorPalette.get("White"),
        gColorPalette.get("Black"),
        gColorPalette.get("MediumBlue"),
        gColorPalette.get("Orange"),
        gColorPalette.get("White")
    ];
    // Alternate palette that makes black1/white1 visually distinct.
    static colorToRGBAAlt = [
        gColorPalette.get("Black"),
        gColorPalette.get("Purple"),
        gColorPalette.get("LightGreen"),
        gColorPalette.get("White"),
        0x101040ff,
        gColorPalette.get("MediumBlue"),
        gColorPalette.get("Orange"),
        0xefefffff
    ];

    //
    // Checks to see if the size of the file matches our requirements.
    //
    static checkMatch(size) {
        return (size >= StdHiRes.MIN_LEN && size <= StdHiRes.MAX_LEN);
    }

    //
    // Returns a typed array (Uint8Array) with the raw data.  This is a reference to the
    // original, not a copy.
    //
    // The length of the array matches that of the original file.
    //
    get rawData() { return this.rawBytes; }

    //
    // Replaces the raw data array.  The reference will be used directly, not copied.
    //
    // This should only be used for undo/redo operations.
    //
    set rawData(value) { this.rawBytes = value; }

    //
    // True if our signature is detected.
    //
    get hasSignature() {
        for (let i = 0; i < StdHiRes.SIGNATURE.length; i++) {
            if (this.rawBytes[StdHiRes.SIG_BYTE_OFFSET + i] != StdHiRes.SIGNATURE[i]) {
                return false;
            }
        }
        return true;
    }

    //
    // True if the mode byte is present and indicates that the image should be monochrome.
    //
    get preferMono() { return this.hasSignature && this.rawBytes[StdHiRes.MODE_BYTE_OFFSET] == 0; }

    //
    // Renders the full image onto an ImageData object.
    //
    //  imageData: ImageData object, must be 280x192
    //  asMono: true if we want to render as monochrome
    //
    renderFull(imageData, asMono) {
        this.renderArea(imageData, asMono, 0, 0, StdHiRes.NUM_COLS, StdHiRes.NUM_ROWS);
    }

    //
    // Renders an area into an ImageData object.  Use this to re-render a dirty area.
    //
    //  imageData: ImageData object, must be 280x192
    //  asMono: true if we want to render as monochrome
    //  left: leftmost column [0,279]
    //  top: top row number [0,191]
    //  width: number of columns [1,280]
    //  height: number of rows [1,192]
    //
    renderArea(imageData, asMono, left, top, width, height) {
        Debug.assert(StdHiRes.isValidScreenArea(left, top, width, height),
            "invalid args to renderArea()");
        // console.log(`renderArea asMono=${asMono} ${left},${top} ${width}x${height}`);

        // Update the mono/color mode byte now, since we don't get notified before saving.
        // Don't touch files if our signature isn't present.
        if (this.hasSignature) {
            // 280x192 B&W or limited color, page 1
            this.rawBytes[StdHiRes.MODE_BYTE_OFFSET] = asMono ? 0 : 1;
        }

        let rgbaData = imageData.data;      // Uint8ClampedArray, RGBA order
        if (!asMono) {
                // Changing a bit can affect the colors of pixels to the immediate left and right.
                // Additionally, changing the MSB can affect all pixels within a byte.  To
                // avoid handling this for every row, we just expand the dirty rect here.
                let newLeft;
                // Make sure we're aligned with the left edge of the pixel byte.  If we were
                // already at the left edge, expand by one pixel to include the highest bit of the
                // previous byte (but just one bit -- our high bit doesn't affect them).
                if (left % 7 == 0) {
                    newLeft = (left == 0) ? left : left - 1;
                } else {
                    newLeft = Math.trunc(left / 7) * 7;
                }
                // Set the right edge to point at our MSB - 1.  If we were already there, expand
                // the right edge by one to encompass the low bit of the byte to the right.
                let incRight = left + width - 1;        // inclusive end
                if (incRight % 7 == 7 - 1) {
                    if (incRight < StdHiRes.NUM_COLS - 1) {
                        incRight++;     // advance into next byte
                    }
                } else {
                    incRight = Math.trunc(incRight / 7) * 7 + 7 - 1;    // fill out current byte
                }
                // The width should always be a multiple of 7 (updating all pixels spanned by
                // each byte) or (7*n)+1 (updating bytes and the pixel to either the right or left).
                let newWidth = incRight - newLeft + 1;
                // console.log(`col renderArea L=${left} W=${width} -> NL=${newLeft} NW=${newWidth}`);
                left = newLeft;
                width = newWidth;
        }
        // Do the actual render.
        for (let row = top; row < top + height; row++) {
            if (asMono) {
                this.renderLineAsMono(rgbaData, row, left, width, undefined);
            } else {
                this.renderLineAsColor(rgbaData, row, left, width, undefined);
            }
        }
    }

    //
    // Renders a section of one line, in monochrome.
    //
    // In B&W mode, the pixel color is determined by the value of individual bits (neighboring
    // bits don't matter).  The MSB is still factored in so that we can choose to display
    // black0/white0 differently from black1/white1.
    //
    //  rgbaData: ImageData pixel storage (Uint8ClampedArray, RGBA order) (may be undefined)
    //  row: row number [0,191]
    //  left: leftmost column [0,279]
    //  width: number of columns [1,280]
    //  colorMap: map with one byte per color (may be undefined)
    //
    renderLineAsMono(rgbaData, row, left, width, colorMap) {
        let rgbaColors = StdHiRes.colorToRGBA;
        let rowOffset = StdHiRes.rowToOffset(row);
        let byteCol = Math.trunc(left / 7);
        let curBit = left % 7;
        let lastBit = (left + width - 1) % 7;
        // console.log(`RLAM left=${left} width=${width} byteCol=${byteCol} curBit=${curBit} ` +
        //     `lastBit=${lastBit}`);
        while (width > 0) {
            let byteVal = this.rawBytes[rowOffset + byteCol] >> curBit;
            let highAdj = (byteVal & 0x80) >> 5;        // 0 or 4

            width -= (7 - curBit);
            let loopStop = (width <= 0) ? lastBit : 6;
            for ( ; curBit <= loopStop; curBit++) {
                // Set color to 0/4 for black or 3/7 for white.
                let index = (((byteVal & 0x01) | (byteVal << 1)) & 0x03) | highAdj;
                if (rgbaData != undefined) {
                    StdHiRes.setRGBAColor(rgbaData, byteCol * 7 + curBit, row, StdHiRes.NUM_COLS,
                        rgbaColors[index]);
                }
                if (colorMap != undefined) {
                    colorMap[row * StdHiRes.NUM_COLS + byteCol * 7 + curBit] = index;
                }
                byteVal >>= 1;
            }
            byteCol++;
            curBit = 0;
        }
    }

    //
    // Renders a section of one line, in color.
    //
    // The caller is expected to have expanded the left/width arguments to cover all pixels that
    // can be dirty.
    //
    //  rgbaData: ImageData pixel storage (Uint8ClampedArray, RGBA order) (may be undefined)
    //  row: row number [0,191]
    //  left: leftmost column [0,279]
    //  width: number of columns [1,280]
    //  colorMap: map with one byte per color (may be undefined)
    //
    renderLineAsColor(rgbaData, row, left, width, colorMap) {
        let rgbaColors = StdHiRes.colorToRGBA;
        let rowOffset = StdHiRes.rowToOffset(row);
        let byteCol = Math.trunc(left / 7);
        let curBit = left % 7;
        let lastBit = (left + width - 1) % 7;
        let oddAdj = (left & 0x01) << 3;    // 0 or 8
        // Get the value of the bit to the left of the leftmost pixel.
        let prevBit;
        if (left == 0) {
            prevBit = 0;        // treat left screen border as black
        } else {
            if (curBit == 0) {
                // we're starting with LSB; look back one byte, grab bit 6
                prevBit = (this.rawBytes[rowOffset + byteCol - 1] >> 6) & 0x01;
            } else {
                // starting partway into byte, grab bit before first
                prevBit = (this.rawBytes[rowOffset + byteCol] >> (curBit - 1)) & 0x01;
            }
        }
        Debug.assert(prevBit === 0 || prevBit === 1, "bad lastbit: " + prevBit);

        while (width > 0) {
            let byteVal = this.rawBytes[rowOffset + byteCol];
            let highAdj = (byteVal & 0x80) >> 5;        // 0 or 4
            byteVal &= 0x7f;
            if (byteCol < StdHiRes.NUM_COL_BYTES - 1) {
                // Copy leftmost pixel bit of next byte into high bit, so we can apply
                // it without having to special-case it below.
                byteVal |= (this.rawBytes[rowOffset + byteCol + 1] & 0x01) << 7;
            } else {
                // Leave bit set to zero, as if right screen border is black.
            }
            byteVal >>= curBit;     // adjust for non-byte-aligned left edge

            width -= (7 - curBit);
            let loopStop = (width <= 0) ? lastBit : 6;
            for ( ; curBit <= loopStop; curBit++) {
                // Assemble three bits in previous-current-next order.
                let bits = (prevBit << 2) | ((byteVal & 0x01) << 1) | ((byteVal & 0x02) >> 1);
                // Map bits to hi-res color index, adjusting for high bit.
                let colorIndex = StdHiRes.bitsToColor[bits | oddAdj] | highAdj;     // [0,7]
                if (rgbaData != undefined) {
                    StdHiRes.setRGBAColor(rgbaData, byteCol * 7 + curBit, row, StdHiRes.NUM_COLS,
                        rgbaColors[colorIndex]);
                }
                if (colorMap != undefined) {
                    colorMap[row * StdHiRes.NUM_COLS + byteCol * 7 + curBit] = colorIndex;
                }
                prevBit = byteVal & 0x01;   // save for next loop iteration
                oddAdj = 8 - oddAdj;        // alternate odd/even
                byteVal >>= 1;
            }

            byteCol++;
            curBit = 0;
        }
    }

    //
    // Renders a pattern into a strip of colors.  The left/right edges are treated as if the
    // pattern wraps around.
    //
    //  pat: color pattern to use
    //  start: initial offset within pattern (usually 0 or 4)
    //  len: length of pattern (usually 4)
    //  asMono: if true, render as mono
    //  (returns): an array with (7 * len) RGBA color values
    //
    static generateColorStrip(pat, start, len, asMono) {
        Debug.assert(pat !== undefined && start + len <= pat.length,
            `bad args: pat=${pat} start=${start} len=${len}`);
        let strip = [];

        // Init prevBit with the last pixel bit of the last byte.
        let prevBit = (pat[start + len - 1] >> 6) & 0x01;
        // Assume starting in even byte.
        let oddAdj = 0;

        for (let i = 0; i < len ; i++) {
            let byteVal = pat[start + i];
            let highAdj = (byteVal & 0x80) >> 5;        // 0 or 4
            byteVal &= 0x7f;
            if (i < len - 1) {
                // Copy leftmost pixel bit of next byte into high bit, so we can apply
                // it without having to special-case it below.
                byteVal |= (pat[start + i + 1] & 0x01) << 7;
            } else {
                // Copy leftmost pixel bit of *first* byte into high bit, wrapping around.
                byteVal |= (pat[start] & 0x01) << 7;
            }
            for (let bit = 0; bit < 7; bit++) {
                let colorIndex;
                if (asMono) {
                    colorIndex = ((byteVal & 0x01) | (byteVal << 1)) & 0x03;    // 0 or 3 (B or W)
                } else {
                    // Assemble three bits in previous-current-next order.
                    let bits = (prevBit << 2) | ((byteVal & 0x01) << 1) | ((byteVal & 0x02) >> 1);
                    // Map bits to hi-res color index, adjusting for high bit.
                    colorIndex = StdHiRes.bitsToColor[bits | oddAdj] | highAdj;     // [0,7]
                }
                strip.push(StdHiRes.colorToRGBA[colorIndex]);
                prevBit = byteVal & 0x01;   // save for next loop iteration
                oddAdj = 8 - oddAdj;        // alternate odd/even
                byteVal >>= 1;
            }
        }
        Debug.assert(strip.length == len * 7, "unexpected strip len " + strip.length)
        return strip;
    }

    //
    // Creates an ImageData filled with the specified pattern.
    //
    //  width: desired image width, in pixels
    //  height: desired image height, in pixels
    //  pat: 8-byte hi-res color pattern
    //  asMono: if true, render as monochrome
    //  (returns): newly-created ImageData object
    //
    static renderSwatch(width, height, pat, asMono) {
        Debug.assert(width > 0 && height > 0 && pat !== undefined && pat.length == 8,
            `bad args: width=${width} height=${height} pat=${pat}`);
        const showHalf = true;
        let imageData = new ImageData(width, height);
        let rgbaData = imageData.data;

        // Generate color strips for even/odd rows.
        let evenStrip = StdHiRes.generateColorStrip(pat, 0, 4, asMono);
        let oddStrip = StdHiRes.generateColorStrip(pat, 4, 4, asMono);
        // Detect whether the color pattern on this row has the high bit set.
        let evenHi = (pat[0] & 0x80) != 0;
        let oddHi = (pat[4] & 0x80) != 0;

        // Render each pixel in a 2x2 area.  This makes the pattern easier to see on a
        // modern display, and gives us an opportunity to show the half-pixel shift.
        for (let row = 0; row < height; row++) {
            let strip = ((row & 0x02) == 0) ? evenStrip : oddStrip;
            let isHi = ((row & 0x02) == 0) ? evenHi : oddHi;
            let stripIdx = 0;
            let pixCount = 1;
            for (let col = 0; col < width; col++) {
                if (showHalf && isHi && col == 0) {
                    // Start the line with a single black pixel to show half-pixel shift.
                    this.setRGBAColor(rgbaData, col, row, width, StdHiRes.colorToRGBA[0]);
                    continue;
                }
                this.setRGBAColor(rgbaData, col, row, width, strip[stripIdx]);

                // Advance to next color entry.  Because of the half-pixel shift, this may not
                // be bitmap-aligned.
                if (pixCount-- == 0) {
                    stripIdx++;
                    pixCount = 1;
                }
                if (stripIdx == strip.length) {
                    stripIdx = 0;
                }
            }
        }

        return imageData;
    }

    //
    // Sets the color of the RGBA pixel at the specified coordinate.
    //
    //  rgbaData: RGBA8888 byte array from an ImageData object
    //  xc: X coordinate as integer [0,279]
    //  yc: Y coordinate as integer [0,191]
    //  pixelStride: width of ImageData, in pixels
    //  color: RGBA color value (integer)
    //
    static setRGBAColor(rgbaData, xc, yc, pixelStride, color) {
        Debug.assert(color !== undefined, `bad color ${color}`);
        const bytesPer = 4;
        let rowOffset = yc * pixelStride * bytesPer;
        let colOffset = rowOffset + xc * bytesPer;
        rgbaData[colOffset++] = (color >> 24) & 0xff;
        rgbaData[colOffset++] = (color >> 16) & 0xff;
        rgbaData[colOffset++] = (color >> 8) & 0xff;
        rgbaData[colOffset] = color & 0xff;
    }

    //
    // Computes the offset of the Nth row of a hi-res image.
    //
    //  rowNum: row number as integer [0,191]
    //  (returns): buffer offset as integer [0,8191]
    //
    static rowToOffset(rowNum) {
        Debug.assert(rowNum >= 0 && rowNum < StdHiRes.NUM_ROWS, "invalid row " + rowNum);
        // If row is ABCDEFGH, we want pppFGHCD EABAB000 (where p would be $20/$40).
        let low = ((rowNum & 0xc0) >> 1) | ((rowNum & 0xc0) >> 3) | ((rowNum & 0x08) << 4);
        let high = ((rowNum & 0x07) << 2) | ((rowNum & 0x30) >> 4);
        return (high << 8) | low;
    }

    //
    // Sets a single pixel on or off, according to the current color pattern.
    //
    //  x: X coordinate [0,279]
    //  y: Y coordinate [0,191]
    //  pat: color pattern
    //
    setPixel(x, y, pat) {
        Debug.assert(x >= 0 && x < StdHiRes.NUM_COLS && y >= 0 && y < StdHiRes.NUM_ROWS &&
            pat !== undefined && pat.length === StdHiRes.PATTERN_LEN,
            `invalid args ${x} ${y} ${pat}`);
        let rowOffset = StdHiRes.rowToOffset(y);
        let colOffset = Math.trunc(x / 7);
        // Get color pattern.  Even rows use pattern bytes 0-3, odd rows use pattern bytes 4-7.
        let patByte = pat[(colOffset & 0x03) | ((y & 0x01) << 2)];
        // Identify the bit of interest.  For "transparent" patterns, there is no bit except msb.
        let pixelMask = 0x80;
        if (StdHiRes.checkMsbPattern(pat) < 0) {
            pixelMask |= 1 << (x % 7);
        }
        //
        // Apply the usual hi-res plot logic:
        //   LDA colormask          ;start with color pattern
        //   EOR (screenptr),Y      ;flip bits affected by color
        //   AND pixelmask          ;clear the bits we want to modify
        //   EOR (screenptr),Y      ;restore unmodified bits, set bits affected by color
        //   STA (screenptr),Y      ;update screen
        //
        let curVal = this.rawBytes[rowOffset + colOffset];
        let newVal = ((patByte ^ curVal) & pixelMask) ^ curVal;
        this.rawBytes[rowOffset + colOffset] = newVal;
    }

    //
    // Sets the pixels in a horizontal segment.
    //
    // This is more efficient than calling setPixel() repeatedly for wider segments.
    //
    //  xc: coordinate of left edge
    //  yc: row number
    //  width: number of pixels to draw
    //  pat: color pattern
    //
    plotHorizSegment(xc, yc, width, pat) {
        Debug.assert(StdHiRes.isValidScreenArea(xc, yc, width, 1) &&
            pat !== undefined && pat.length == StdHiRes.PATTERN_LEN);
        let leftMask = (0x7f << (xc % 7)) & 0x7f;
        let rightMask = 0x7f >> (6 - ((xc + width - 1) % 7));
        let leftCol = Math.trunc(xc / 7);
        let rightCol = Math.trunc((xc + width - 1) / 7);
        // console.log(`seg: ${xc},${yc} w=${width} lc=${leftCol} rc=${rightCol} ` +
        //     `lm=${leftMask.toString(16)} rm=${rightMask.toString(16)}`);

        // Handle the MSB-only patterns.
        let msbOnly = false;
        if (StdHiRes.checkMsbPattern(pat) >= 0) {
            leftMask = rightMask = 0;
            msbOnly = true;
        }
        leftMask |= 0x80;
        rightMask |= 0x80;

        let rowOffset = StdHiRes.rowToOffset(yc);
        if (leftCol == rightCol) {
            // All within a single byte.
            let pixelMask = leftMask & rightMask;
            let patByte = pat[(leftCol & 0x03) | ((yc & 0x01) << 2)];

            let curVal = this.rawBytes[rowOffset + leftCol];
            let newVal = ((patByte ^ curVal) & pixelMask) ^ curVal;
            this.rawBytes[rowOffset + leftCol] = newVal;
        } else {
            // Do the left/right edges, then fill in the middle.
            let patByte = pat[(leftCol & 0x03) | ((yc & 0x01) << 2)];
            let curVal = this.rawBytes[rowOffset + leftCol];
            let newVal = ((patByte ^ curVal) & leftMask) ^ curVal;
            this.rawBytes[rowOffset + leftCol] = newVal;

            patByte = pat[(rightCol & 0x03) | ((yc & 0x01) << 2)];
            curVal = this.rawBytes[rowOffset + rightCol];
            newVal = ((patByte ^ curVal) & rightMask) ^ curVal;
            this.rawBytes[rowOffset + rightCol] = newVal;

            for (let byteCol = leftCol + 1; byteCol < rightCol; byteCol++) {
                patByte = pat[(byteCol & 0x03) | ((yc & 0x01) << 2)];
                if (msbOnly) {
                    this.rawBytes[rowOffset + byteCol] =
                        (this.rawBytes[rowOffset + byteCol] & 0x7f) | patByte;
                } else {
                    this.rawBytes[rowOffset + byteCol] = patByte;
                }
            }
        }
    }

    //
    // Generates a one-byte-per-pixel linear color map.
    //
    // The map will be 280x192, with color values 0-7.  black1/white1 will be converted to
    // black0/white0.
    //
    //  asMono: if true, generate a map with only black0 and white0 (0/3)
    //  (returns): Uint8Array with color map
    //
    generateColorMap(asMono) {
        let map = new Uint8Array(StdHiRes.NUM_COLS * StdHiRes.NUM_ROWS);
        for (let row = 0; row < StdHiRes.NUM_ROWS; row++) {
            if (asMono) {
                this.renderLineAsMono(undefined, row, 0, StdHiRes.NUM_COLS, map);
            } else {
                this.renderLineAsColor(undefined, row, 0, StdHiRes.NUM_COLS, map);
            }

            // Normalize black and white, i.e convert black1/white1 to black0/white0.  We could do
            // this in the render function, but we may want to make it optional, and the
            // render code is cluttered enough.
            let rowOffset = row * StdHiRes.NUM_COLS;
            for (let col = 0; col < StdHiRes.NUM_COLS; col++) {
                let val = map[rowOffset + col];
                if (val == 4) {
                    map[rowOffset + col] = 0;
                } else if (val == 7) {
                    map[rowOffset + col] = 3;
                }
            }
        }
        return map;
    }

    //
    // Replaces all instances of the specified color with a pattern.  This reads from the color
    // map and writes to the raw image.
    //
    //  colorMap: linear color map of the image (Uint8Array)
    //  color: color to replace (single-byte value)
    //  pat: color pattern to draw
    //
    replaceColor(colorMap, color, pat) {
        // TODO(maybe): we could speed this up by identifying horizontal segments and using
        //   plotHorizSegment() instead of setting individual pixels.
        for (let row = 0; row < StdHiRes.NUM_ROWS; row++) {
            let rowOffset = row * StdHiRes.NUM_COLS;
            for (let col = 0; col < StdHiRes.NUM_COLS; col++) {
                if (colorMap[rowOffset + col] == color) {
                    this.setPixel(col, row, pat);
                }
            }
        }
    }

    //
    // Reads the pixel value at the specified coordinate.  The X coordinate is rounded down to
    // the nearest even value, effectively treating the screen as 140x192.
    //
    //  xc: column [0,279]
    //  yc: row [0,191]
    //  (returns) two-bit pixel value (00, 01, 10, 11)
    //
    getPixel140(xc, yc) {
        // We need two-bit pairs from bytes that have groups of 7 pixels.
        // bit number:   7 6 5 4 3 2 1 0  7 6 5 4 3 2 1 0
        // pixel index:  - d c c b b a a  - g g f f e e d
        xc &= ~1;
        let rowOffset = StdHiRes.rowToOffset(yc);
        let colOffset = Math.trunc(xc / 7);
        let bitNum = xc % 7;            // 0, 2, 4, 6
        bitNum |= colOffset & 0x01;     // start one bit over for odd columns
        let result = (this.rawBytes[rowOffset + colOffset] >> bitNum) & 0x03;
        if (bitNum == 6) {
            // We grabbed the MSB; discard it and get the low bit of the next byte.
            result &= 0x01;
            result |= (this.rawBytes[rowOffset + colOffset + 1] & 0x01) << 1;
        }
        return result;
    }

    //
    // Generates a clipping from the specified rectangle.
    //
    //  left, top, width, height: rectangular area to clip
    //  (returns) new Clipping object
    //
    createClipping(left, top, width, height) {
        Debug.assert(StdHiRes.isValidScreenArea(left, top, width, height));
        // Calculate array dimensions.
        let leftByteCol = Math.trunc(left / 7);
        let rightByteCol = Math.trunc((left + width - 1) / 7);
        let byteWidth = rightByteCol - leftByteCol + 1;
        let arrayLen = byteWidth * height;

        let xoffLeft = left - leftByteCol * 7;

        let pixArray = new Uint8Array(arrayLen);
        let maskArray = new Uint8Array(arrayLen);
        let leftMask = (0xff << (left % 7)) & 0xff;
        let rightMask = (0x7f >> (6 - ((left + width - 1) % 7))) | 0x80;

        console.log(`clip L=${left} T=${top} W=${width} H=${height} ` +
            `len=${arrayLen} lm=${leftMask.toString(16)} rm=${rightMask.toString(16)}`);

        for (let row = 0; row < height; row++) {
            let srcOffset = StdHiRes.rowToOffset(top + row) + leftByteCol;
            let dstOffset = row * byteWidth;
            for (let col = leftByteCol; col <= rightByteCol; col++) {
                let mask;
                if (col == leftByteCol) {
                    if (leftByteCol == rightByteCol) {
                        mask = leftMask & rightMask;
                    } else {
                        mask = leftMask;
                    }
                } else if (col == rightByteCol) {
                    mask = rightMask;
                } else {
                    mask = 0xff;    // middle byte
                }
                maskArray[dstOffset] = mask;
                pixArray[dstOffset] = this.rawBytes[srcOffset];
                srcOffset++;
                dstOffset++;
            }
        }

        let clipping = new Clipping(StdHiRes.FORMAT_NAME, width, height, byteWidth,
            xoffLeft, pixArray, maskArray);
        return clipping;
    }

    //
    // Converts a 1bpp bitmap to a clipping, applying the color pattern to the set pixels.
    // The mask is set to the bitmap's bits before the pattern is applied.
    //
    bitmapToClipping(bitmap, stride, width, pat) {
        Debug.assert(bitmap.length > 0 && stride > 0 && width > 0);
        Debug.assert(bitmap.length % stride == 0);
        let height = bitmap.length / stride;
        // We need one byte to store every 7 pixels.
        let clipByteWidth = Math.trunc((width + 6) / 7);
        let pixArray = new Uint8Array(clipByteWidth * height);
        let maskArray = new Uint8Array(clipByteWidth * height);

        // Walk across the source bitmap one row at a time, forming bytes.
        for (let row = 0; row < height; row++) {
            let srcOffset = row * stride;
            let srcEndOffset = srcOffset + stride;
            let outOffset = row * clipByteWidth;
            let outEndOffset = outOffset + clipByteWidth;

            let srcVal = bitmap[srcOffset];
            let srcBitCount = 8;
            let outBitCount = 0;
            let outVal = 0;
            let patIndex = 0;
            while (true) {
                // Add as many bits as possible to the output byte.  Unfortunately we can't
                // just OR them in bulk, because we have to reverse the order as well.
                let maxUsedBits = 7 - outBitCount;
                let usedBits = srcBitCount < maxUsedBits ? srcBitCount : maxUsedBits;
                for (let i = 0; i < usedBits; i++) {
                    outVal |= srcVal & 0x80;    // copy leftmost bit to rightmost position
                    srcVal <<= 1;               // move to next input bit
                    outVal >>= 1;               // shift output toward correct position
                }

                outBitCount += usedBits;
                Debug.assert(outBitCount > 0 && outBitCount <= 7);
                if (outBitCount == 7) {
                    let patByte = pat[(patIndex & 0x03) | ((row & 0x01) << 2)];
                    maskArray[outOffset] = outVal | 0x80;
                    let outByte = (outVal | 0x80) & patByte;
                    pixArray[outOffset] = outByte;
                    outOffset++;
                    patIndex++;
                    outBitCount = 0;
                    outVal = 0;
                }

                srcBitCount -= usedBits;
                Debug.assert(srcBitCount >= 0 && srcBitCount < 8);
                if (srcBitCount == 0) {
                    srcOffset++;
                    if (srcOffset == srcEndOffset) {
                        break;
                    }
                    srcVal = bitmap[srcOffset];
                    srcBitCount = 8;
                }
            }
            // All source bytes have been used.  Output any remainder.  The last few bits from
            // the source byte might be extraneous, so we only need to do this if there's room
            // for more in the output.
            // if (row == 0) {
            //     console.log(`outBitCount=${outBitCount} outLeft=${outEndOffset - outOffset}`);
            // }
            if (outOffset < outEndOffset && outBitCount != 0) {
                outVal >>= 7 - outBitCount;    // finish shifting outByte
                maskArray[outOffset] = outVal | 0x80;
                let patByte = pat[(patIndex & 0x03) | ((row & 0x01) << 2)];
                let outByte = (outVal | 0x80) & patByte;
                pixArray[outOffset] = outByte;
                //let rightBits = width % 7;      // number of bits in rightmost byte
                //maskArray[outOffset] = (0x7f >> (7 - rightBits)) | 0x80;
                // console.log(` outByte=${outByte} mask=${maskArray[outOffset]}`);
            }
        }

        let clipping = new Clipping(StdHiRes.FORMAT_NAME, width, height, clipByteWidth,
            0, pixArray, maskArray);
        return clipping;
    }

    //
    // Copies a clipping onto the frame buffer.  The clipping may be partially or wholly
    // offscreen.
    //
    //  clipping: Clipping object
    //  xc, yc: top-left corner of pasted image (values may be negative)
    //  xferMode: transfer mode
    //
    putClipping(clipping, xc, yc, xferMode) {
        // Clippings are created by copying whole bytes, so there may be unused bits on the
        // left and right edges.  These are excluded by the AND mask, but we need to shift
        // the bits so that they are in the correct position within the screen bytes.  This
        // may require shifting them to the left or to the right.  We want to try to keep
        // the color bits matched with their MSBs, but that won't always work out.
        //
        // For example, suppose we grabbed the rect L=2 T=10 W=12 H=5.  We want to draw it
        // at some arbitrary X coordinate, but for shifting purposes we only care about X % 7.
        // The amount we shift can increase or decrease the byte width of the clipping.
        //  - draw at XC=0: shift pixels left 2, byteWidth=2
        //  - draw at XC=2: no shifting required, byteWidth=2
        //  - draw at XC=5: shift pixels right 3, byteWidth=3
        // The shift can cause our byte width to grow or shrink by one byte.
        //
        // Alternatively, we can do it with only shifting pixels to the right (i.e. shifting
        // bits toward the MSB).  This simplifies the code somewhat.
        //  - draw at XC=0: shift pixels right (7-2)=5, byteWidth=2, offset 1
        // In this case, we need to skip over the first (empty) byte column.
        //
        // (Historical note: see the Dec 1984 issue of Byte for an article entitled
        // "Preshift-Table Graphics On Your Apple" that shows how to do this quickly on
        // a 6502, with about 3.5KB of lookup tables.)
        Debug.assert(clipping.leftOff >= 0 && clipping.leftOff < 7);
        Debug.assert(Clipping.isValidXferMode(xferMode));

        let leftOutCol = Math.floor(xc / 7);    // want xc=-1 to become outCol=-1, use floor()
        let rightOutCol = Math.floor((xc + clipping.width - 1) / 7);

        let pixTmp = new Uint8Array(clipping.byteStride + 1);
        let maskTmp = new Uint8Array(clipping.byteStride + 1);
        let xmod7 = xc % 7;
        if (xmod7 < 0) { xmod7 += 7; }          // be positive
        let shiftDist = xmod7 - clipping.leftOff;
        let adjustedStart = 0;
        if (shiftDist < 0) {
            shiftDist += 7;     // slide everything into the next byte
            adjustedStart = 1;  // don't include first byte when writing to screen
        }
        let copyWidth = rightOutCol - leftOutCol + 1;   // may be larger than byteStride
        // console.log(`putClip ${xc},${yc} ${clipping} shiftDist=${shiftDist} ` +
        //     `copyWidth=${copyWidth}/str=${clipping.byteStride}/adj=${adjustedStart} ` +
        //     `l/rCol=${leftOutCol}/${rightOutCol}`);
        Debug.assert(copyWidth + adjustedStart <= clipping.byteStride + 1);

        for (let row = 0; row < clipping.height; row++) {
            let hgrRow = row + yc;
            if (hgrRow < 0) {
                continue;   // offscreen
            } else if (hgrRow >= StdHiRes.NUM_ROWS) {
                break;
            }
            let rowOffset = StdHiRes.rowToOffset(hgrRow);
            let srcOffset = row * clipping.byteStride;

            if (shiftDist == 0) {
                // No shift required, just copy bytes over.
                for (let i = 0; i < clipping.byteStride; i++) {
                    pixTmp[i] = clipping.pixArray[srcOffset + i];
                    maskTmp[i] = clipping.maskArray[srcOffset + i];
                }
            } else {
                // Shift pixels right => shift bits left.
                let revShift = 7 - shiftDist;
                let shiftMaskHi = 0x7f >> revShift;
                // Walk across the source, grabbing the bits from each byte and placing them
                // into the temporary arrays.
                pixTmp[0] = clipping.pixArray[srcOffset] & 0x80;
                maskTmp[0] = clipping.maskArray[srcOffset] & 0x80;
                for (let i = 0; i < clipping.byteStride; i++) {
                    let pixByte = clipping.pixArray[srcOffset + i];
                    let maskByte = clipping.maskArray[srcOffset + i];
                    pixTmp[i] |= (pixByte << shiftDist) & 0x7f;
                    maskTmp[i] |= (maskByte << shiftDist) & 0x7f;
                    pixTmp[i+1] = ((pixByte >> revShift) & shiftMaskHi) | (pixByte & 0x80);
                    maskTmp[i+1] = ((maskByte >> revShift) & shiftMaskHi) | (maskByte & 0x80);
                }
            }

            for (let byteCol = 0; byteCol < copyWidth; byteCol++) {
                let hgrByteCol = leftOutCol + byteCol;
                if (hgrByteCol < 0) {
                    continue;   // offscreen
                } else if (hgrByteCol >= StdHiRes.NUM_COL_BYTES) {
                    break;
                }
                Debug.assert(byteCol + adjustedStart < pixTmp.length);
                let srcByte = pixTmp[byteCol + adjustedStart];
                let srcMask = maskTmp[byteCol + adjustedStart];
                let curVal, newVal;
                switch (xferMode) {
                    case Clipping.XFER_MERGE:
                        // Merge bits with screen contents.
                        this.rawBytes[rowOffset + hgrByteCol] |= srcByte & srcMask;
                        break;
                    case Clipping.XFER_COPY:
                        // Overwrite the bits included by the mask.
                        curVal = this.rawBytes[rowOffset + hgrByteCol];
                        newVal = ((srcByte ^ curVal) & srcMask) ^ curVal;
                        this.rawBytes[rowOffset + hgrByteCol] = newVal;
                        break;
                    case Clipping.XFER_XOR:
                        // Exclusive-OR all the bits, including the MSB.
                        this.rawBytes[rowOffset + hgrByteCol] ^= srcByte & srcMask;
                        break;
                    default:
                        throw new Error("unhandled xferMode: " + xferMode);
                }
            }
        }
    }

    //
    // Determines whether the bounds are non-empty and fully within the screen dimensions.
    //
    //  (returns): true if all is well
    //
    static isValidScreenArea(left, top, width, height) {
        return  left >= 0 && left < StdHiRes.NUM_COLS &&
                top >= 0 && top < StdHiRes.NUM_ROWS &&
                width > 0 && width + left <= StdHiRes.NUM_COLS &&
                height > 0 && top + height <= StdHiRes.NUM_ROWS;
    }


    // ==============================================================================
    // Color patterns
    // ==============================================================================

    //
    // Returns an array of solid color patterns.
    //
    static getSolidPatterns() {
        let patarray = [];
        patarray.push(StdHiRes.createSimplePattern(0x00));  // hcolor=0
        patarray.push(StdHiRes.createSimplePattern(0x2a));  // hcolor=1
        patarray.push(StdHiRes.createSimplePattern(0x55));  // hcolor=2
        patarray.push(StdHiRes.createSimplePattern(0x7f));  // ...
        patarray.push(StdHiRes.createSimplePattern(0x1000));
        patarray.push(StdHiRes.createSimplePattern(0x80));
        patarray.push(StdHiRes.createSimplePattern(0xaa));
        patarray.push(StdHiRes.createSimplePattern(0xd5));
        patarray.push(StdHiRes.createSimplePattern(0xff));
        patarray.push(StdHiRes.createSimplePattern(0x1001));
        return patarray;
    }

    //
    // Creates a simple color pattern from a byte value.  Only useful for solid colors.
    //
    static createSimplePattern(even) {
        if (even == 0x1000) {
            return StdHiRes.HI_BIT_CLEAR;
        } else if (even == 0x1001) {
            return StdHiRes.HI_BIT_SET;
        } else if (even < 0 || even > 255) {
            throw new Error("bad simple pattern byte value: " + even);
        }
        let pat = new Uint8Array(StdHiRes.PATTERN_LEN);
        // Given the even-column color byte, generate the odd-column byte.  This isn't a simple
        // shift or rotation, e.g. x0101010 is paired with x1010101, which have different
        // numbers of bits set.  For black and white we do nothing, for color patterns we
        // invert bits, retaining the high bit.
        let stripHi = even & 0x7f;
        if (stripHi !== 0x00 && stripHi !== 0x7f) {
            stripHi ^= 0x7f;
        }
        let odd = stripHi | (even & 0x80);
        for (let i = 0; i < StdHiRes.PATTERN_LEN; ) {
            pat[i++] = even;
            pat[i++] = odd;
        }
        return pat;
    }

    //
    // Returns an array of dithered patterns.
    //
    static getDitherPatterns() {
        let patarray = [];
        for (let i = 0; i < StdHiRes.patternIndices.length; i += 2) {
            let pat = new Uint8Array(StdHiRes.PATTERN_LEN);

            let idx = StdHiRes.patternIndices[i] * 4;
            for (let j = 0; j < 4; j++) {
                pat[j] = StdHiRes.patternData[idx + j];
            }

            idx = StdHiRes.patternIndices[i + 1] * 4;
            for (let j = 0; j < 4; j++) {
                pat[j + 4] = StdHiRes.patternData[idx + j];
            }

            patarray.push(pat);
        }
        return patarray;
    }

    //
    // Returns 0x00, 0x80, or -1 depending on whether the pattern is transparent-low,
    // transparent-high, or opaque.
    //
    static checkMsbPattern(pat) {
        if (pat == StdHiRes.HI_BIT_CLEAR) {
            return 0x00;
        } else if (pat == StdHiRes.HI_BIT_SET) {
            return 0x80;
        } else {
            return -1;
        }
    }

    //
    // This comes from the 1984 release of The Graphics Magician, by Penguin Software.
    // These are the 108 color patterns used by the standard hi-res "picture painter".
    //
    // The pattern index table has two bytes per entry, each of which is an index
    // into the pattern data table.  The first byte is for even rows, the second byte
    // is for odd rows.
    //
    // Pattern data entries are four bytes each, numbered 0-29.  All bytes on a given
    // line of data will have the high bit set or clear, never mixed.
    //
    // Four-byte patterns are necessary because they allow us to have repeating 4-pixel
    // patterns, e.g. 110011001100.  Two-byte patterns suffice for solid colors.
    //

    static patternIndices = [
        0x03,0x07,0x16,0x07,0x1a,0x1d,0x1c,0x17,0x08,0x0b,0x00,0x1b,0x00,0x04,0x03,0x1b,
        0x03,0x06,0x1a,0x06,0x00,0x06,0x00,0x11,0x02,0x06,0x1c,0x13,0x10,0x13,0x10,0x07,
        0x02,0x1b,0x02,0x07,0x02,0x17,0x02,0x09,0x1a,0x04,0x10,0x04,0x02,0x05,0x12,0x17,
        0x1a,0x07,0x03,0x17,0x16,0x19,0x03,0x05,0x03,0x0d,0x1a,0x0d,0x1a,0x05,0x10,0x05,
        0x00,0x0d,0x00,0x17,0x08,0x05,0x16,0x05,0x01,0x05,0x16,0x0b,0x01,0x07,0x01,0x17,
        0x01,0x09,0x01,0x04,0x16,0x04,0x0c,0x0f,0x01,0x1b,0x01,0x11,0x0c,0x17,0x0c,0x04,
        0x16,0x13,0x01,0x06,0x16,0x06,0x0c,0x11,0x07,0x07,0x04,0x04,0x07,0x1b,0x1b,0x1d,
        0x07,0x11,0x06,0x07,0x17,0x06,0x06,0x1b,0x06,0x06,0x04,0x06,0x11,0x13,0x04,0x11,
        0x17,0x07,0x17,0x0b,0x17,0x19,0x05,0x07,0x17,0x05,0x07,0x0d,0x05,0x05,0x05,0x0d,
        0x0d,0x0f,0x04,0x0d,0x17,0x04,0x05,0x1b,0x05,0x06,0x03,0x03,0x16,0x03,0x03,0x0c,
        0x00,0x00,0x08,0x1a,0x02,0x16,0x1a,0x1c,0x03,0x10,0x02,0x03,0x02,0x1a,0x02,0x02,
        0x12,0x1c,0x00,0x1a,0x12,0x1a,0x10,0x12,0x00,0x10,0x03,0x1a,0x16,0x1a,0x16,0x12,
        0x01,0x02,0x16,0x18,0x01,0x03,0x01,0x1a,0x01,0x16,0x01,0x01,0x01,0x00,0x16,0x00,
        0x16,0x0c,0x16,0x0e,0x0c,0x0e,0x00,0x0c
    ];
    static patternData = [
        0x00,0x00,0x00,0x00,   // 0x00
        0x55,0x2a,0x55,0x2a,   // 0x01
        0x2a,0x55,0x2a,0x55,   // 0x02
        0x7f,0x7f,0x7f,0x7f,   // 0x03
        0x80,0x80,0x80,0x80,   // 0x04
        0xd5,0xaa,0xd5,0xaa,   // 0x05
        0xaa,0xd5,0xaa,0xd5,   // 0x06
        0xff,0xff,0xff,0xff,   // 0x07
        0x33,0x66,0x4c,0x19,   // 0x08
        0xb3,0xe6,0xcc,0x99,   // 0x09
        0x4c,0x19,0x33,0x66,   // 0x0a
        0xcc,0x99,0xb3,0xe6,   // 0x0b
        0x11,0x22,0x44,0x08,   // 0x0c
        0x91,0xa2,0xc4,0x88,   // 0x0d
        0x44,0x08,0x11,0x22,   // 0x0e
        0xc4,0x88,0x91,0xa2,   // 0x0f
        0x22,0x44,0x08,0x11,   // 0x10
        0xa2,0xc4,0x88,0x91,   // 0x11
        0x08,0x11,0x22,0x44,   // 0x12
        0x88,0x91,0xa2,0xc4,   // 0x13
        0xc9,0xa4,0x92,0x89,   // 0x14
        0x24,0x12,0x49,0x24,   // 0x15
        0x77,0x6e,0x5d,0x3b,   // 0x16
        0xf7,0xee,0xdd,0xbb,   // 0x17
        0x5d,0x3b,0x77,0x6e,   // 0x18
        0xdd,0xbb,0xf7,0xee,   // 0x19
        0x6e,0x5d,0x3b,0x77,   // 0x1a
        0xee,0xdd,0xbb,0xf7,   // 0x1b
        0x3b,0x77,0x6e,0x5d,   // 0x1c
        0xbb,0xf7,0xee,0xdd    // 0x1d
    ];
}
