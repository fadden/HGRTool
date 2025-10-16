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
// This holds data clipped from a raw image.  These are created by the low-level
// graphics code and passed around as opaque blobs that can be pasted.
//
// Clippings contain an array with the raw data, and a parallel mask array.  The latter
// is useful for non-rectangular clippings, and to trim the left/right edges.  (We also
// take left/right edge offsets, but that's mostly for mapping the clipping to the
// original selection rect.)
//
// If the left edge of the clip is in the middle of a byte, we could shift the bits over
// to make them align to the byte start.  However, this would break the association between
// the color bits and the MSBs.  This may get messed up when we paste, but it's best to try
// to keep the original intact as long as possible.
//
export default class Clipping {
    static XFER_COPY = "copy";
    static XFER_MERGE = "merge";
    static XFER_XOR = "xor";

    //
    // Constructor.
    //
    //  source: clipping source, e.g. StdHiRes.FORMAT_NAME
    //  width: width, in pixels, of the clipping (may be much less than byteStride*8 if not 8bpB)
    //  height: height, in rows, of the clipping
    //  byteStride: width, in bytes, of the clipping
    //  leftOff: pixel offset of left edge from start of byte
    //  pixArray: array of raw byte values (Uint8Array, length = byteStride * height)
    //  maskArray: array of bit masks (Uint8Array, same length as pixArray)
    //
    constructor(source, width, height, byteStride, leftOff, pixArray, maskArray) {
        Debug.assert(width > 0 && height > 0 && leftOff >= 0,
            "bad numeric arg");
        Debug.assert(pixArray instanceof Uint8Array && maskArray instanceof Uint8Array,
            "bad array arg");

        this.source = source;
        this.width = width;
        this.height = height;
        this.byteStride = byteStride;
        this.leftOff = leftOff;
        this.pixArray = pixArray;
        this.maskArray = maskArray;
    }

    toString() {
        return `[Clipping src=${this.source} ${this.width}x${this.height} ` +
            `strd=${this.byteStride} off=${this.leftOff}]`;
    }

    static isValidXferMode(xferMode) {
        return xferMode == Clipping.XFER_COPY || xferMode == Clipping.XFER_MERGE ||
            xferMode == Clipping.XFER_XOR;
    }
}
