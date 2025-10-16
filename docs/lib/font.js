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

import Debug from "./debug.js";

//
// This holds information for a font.  For browser fonts it just has the CSS-style font selection
// information.  For Apple II bitmap fonts it will hold the glyph data.
//
export default class Font {
    static TYPE_HI_RES = "hi-res";
    static TYPE_BROWSER = "browser";

    // Alpha value threshold above which a pixel is considered to be lit.  This is used to
    // de-anti-alias the output.  The obvious choice is 128 (50%), but the output can
    // look a bit blocky in curves.  160-192 is pretty good, though thin lines will start to
    // disappear at smaller point sizes.
    static ALPHA_THRESHOLD = 160;


    // Off-screen canvas, used when rendering a browser font.  This is shared between all
    // instances.  The actual size is adjusted to match the text metrics before rendering.
    static offCanvas = new OffscreenCanvas(1024, 256);
    static offCtx = this.offCanvas.getContext("2d", { willReadFrequently: true });

    //
    // Constructor.
    //
    //  type: font type identifier
    //  fontData: type-specific font data
    //
    constructor(type, fontData) {
        Debug.assert(type === Font.TYPE_HI_RES || type === Font.TYPE_BROWSER);
        this.type = type;
        this.fontData = fontData;

        switch (type) {
            case Font.TYPE_HI_RES:
                // Identify the range of characters included in the font.
                if (fontData.length == 768) {
                    this.firstChar = 32;
                } else if (fontData.length == 1024) {
                    this.firstChar = 0;
                } else {
                    throw new Error("invalid hi-res font length " + fontData.length);
                }
                this.lastChar = 127;
                break;
            case Font.TYPE_BROWSER:
                // Expecting a CSS-style string, e.g. "bold 12px Arial".  The Canvas will do its
                // best, but will use fallbacks rather than throw an error for invalid values.
                this.fontData = fontData;
                break;
            default:
                throw new Error("bad type " + type);
        }
    }

    //
    // Measures the dimensions of a string when rendered with this font.
    //
    //  str: string to measure
    //  (returns): [width, height] in pixels
    //
    measureText(str) {
        let width, height, metrics;
        switch (this.type) {
            case Font.TYPE_HI_RES:
                // Glyphs are monospace, 7x8.
                return [str.length * 7, 8];
            case Font.TYPE_BROWSER:
                // Use the off-screen canvas to get metrics.
                Font.offCtx.font = this.fontData;
                metrics = Font.offCtx.measureText(str);
                width = Math.ceil(metrics.width);
                height = Math.ceil(metrics.actualBoundingBoxAscent +
                    metrics.actualBoundingBoxDescent);
                return [width, height];
            default:
                throw new Error("unknown font type " + this.type);
        }
    }

    //
    // Renders the string into a 1bpp bitmap.
    //
    // The bitmap will be sized to match the output.  It will have one bit per pixel, with
    // the leftmost pixel in the leftmost (high) bit.  The top row is stored, followed by
    // the next.  Any padding between rows is indicated by the "stride" result parameter.
    //
    //  str: string to render
    //  (returns): [bitmap,stride,width]
    //    bitmap: Uint8Array with the rendered string; will be (stride * height) bytes long
    //    stride: width of a line stored in the bitmap, in bytes
    //    width: width of the longest line, in pixels
    //
    drawText(str) {
        Debug.assert(typeof str === "string");
        switch (this.type) {
            case Font.TYPE_HI_RES:
                return this.drawTextHiRes(str);
            case Font.TYPE_BROWSER:
                return this.drawBrowser(str);
            default:
                throw new Error("unknown font type " + this.type);
        }
    }

    //
    // Renders string with glyphs from a hi-res bitmap.
    //
    //  str: string to render
    //  (returns): [bitmap,stride,width]
    //
    drawTextHiRes(str) {
        const GLYPH_WIDTH = 7;
        const GLYPH_HEIGHT = 8;
        let pixelWidth = str.length * GLYPH_WIDTH;
        let pixelHeight = GLYPH_HEIGHT;
        let stride = (pixelWidth + 7) >> 3;         // 8 bits per byte
        let bitmap = new Uint8Array(stride * pixelHeight);

        // Draw the bitmap one row at a time.
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
            let outOffset = row * stride;
            let outBit = 0;
            for (let strIndex = 0; strIndex < str.length; strIndex++) {
                let ch = str.charCodeAt(strIndex);
                if (ch < this.firstChar || ch > this.lastChar) {
                    // No glyph for this character.  Use ch=0x7f (DEL) instead.
                    ch = this.lastChar;
                }
                let srcOffset = (ch - this.firstChar) * GLYPH_HEIGHT;   // offset to glyph data
                let gdat = this.fontData[srcOffset + row];
                for (let col = 0; col < GLYPH_WIDTH; col++) {
                    if ((gdat & 0x01) != 0) {
                        bitmap[outOffset] |= 0x80 >> outBit;
                    }
                    gdat >>= 1;
                    outBit++;
                    if (outBit == 8) {
                        outBit = 0;
                        outOffset++;
                    }
                }
            }
        }

        return [bitmap, stride, pixelWidth];
    }

    //
    // Renders string with glyphs using the browser canvas renderer.
    //
    //  str: string to render
    //  (returns): [bitmap,stride,width]
    //
    drawBrowser(str) {
        let ctx = Font.offCtx;
        ctx.font = this.fontData;
        let metrics = Font.offCtx.measureText(str);
        let width = Math.ceil(metrics.width);
        let height = Math.ceil(metrics.actualBoundingBoxAscent +
            metrics.actualBoundingBoxDescent);
        console.log(`Metrics for '${str}' in '${this.fontData}': ${width}x${height} ` +
            `abbl=${metrics.actualBoundingBoxLeft} abbr=${metrics.actualBoundingBoxRight} ` +
            `abba=${metrics.actualBoundingBoxAscent} abbd=${metrics.actualBoundingBoxDescent}`);

        // Configure the canvas to match the size of the rendered string, then draw it.
        // This will draw white text with varying alpha levels for anti-aliasing.
        ctx.width = width;
        ctx.height = height;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#fff";
        ctx.fillText(str, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxAscent);

        // Get access to the RGBA data.
        let rgbaData = ctx.getImageData(0, 0, width, height).data;
        const BYTES_PER_PIXEL = 4;

        // Create the bitmap, using the alpha value to determine whether a pixel should be lit.
        let stride = (width + 7) >> 3;       // 8 bits per byte
        let bitmap = new Uint8Array(stride * height);
        for (let row = 0; row < height; row++) {
            let outOffset = row * stride;
            let srcOffset = row * width * BYTES_PER_PIXEL + 3;
            let outVal = 0;
            let col;
            for (col = 0; col < width; col++) {
                let alpha = rgbaData[srcOffset];
                if (alpha >= Font.ALPHA_THRESHOLD) {
                    outVal |= 0x01;
                }
                if ((col & 0x07) == 7) {
                    bitmap[outOffset++] = outVal;
                    outVal = 0;
                }
                outVal <<= 1;

                srcOffset += BYTES_PER_PIXEL;
            }
            if ((col & 0x07) != 0) {
                outVal <<= 8 - (col & 0x07);
                bitmap[outOffset++] = outVal;
            }
        }

        return [bitmap, stride, width];
    }
}
