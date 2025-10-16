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
// Simple rectangle class.  Assumes framebuffer-style coordinates, where top < bottom.
//
// Instances are immutable (to the extent that's possible in JavaScript).
//
export default class Rect {
    static EMPTY_RECT = new Rect(0, 0, 0, 0);

    constructor(left, top, width, height) {
        this.mLeft = left;
        this.mTop = top;
        this.mWidth = width;
        this.mHeight = height;
    }

    get left() { return this.mLeft; }
    get top() { return this.mTop; }
    get width() { return this.mWidth; }
    get height() { return this.mHeight; }
    // Right coordinate (exclusive).
    get right() { return this.mLeft + this.mWidth; }
    // Bottom coordinate (exclusive).
    get bottom() { return this.mTop + this.mHeight; }

    //
    // Creates a rectangle from a pair of coordinates.  These can be top/left+bottom/right or
    // top/right+bottom/left, and passed in either order.  All coordinates are inclusive.
    //
    static fromCoords(x0, y0, x1, y1) {
        return new Rect(
            Math.min(x0, x1), Math.min(y0, y1),
            Math.abs(x0 - x1) + 1, Math.abs(y0 - y1) + 1);
    }

    //
    // Copy constructor.
    //
    static fromRect(rect) {
        return new Rect(rect.left, rect.top, rect.width, rect.height);
    }

    toString() {
        return `[Rect L=${this.left} T=${this.top} W=${this.width} H=${this.height}]`;
    }

    //
    // Returns true if the rect's area is zero.
    //
    get isEmpty() {
        return this.mWidth === 0 || this.mHeight === 0;
    }

    //
    // Returns true if the point falls within the rect bounds.
    //
    contains(xc, yc) {
        return xc >= this.mLeft && xc < this.mLeft + this.mWidth &&
               yc >= this.mTop && yc < this.mTop + this.mHeight;
    }

    //
    // Returns a new rect with an offset position.
    //
    translate(deltaX, deltaY) {
        return new Rect(this.mLeft + deltaX, this.mTop + deltaY, this.mWidth, this.mHeight);
    }

    //
    // Returns a new rect with an altered size.
    //
    adjustSize(deltaWidth, deltaHeight) {
        if (this.mWidth + deltaWidth < 0 || this.mHeight + deltaHeight < 0) {
            throw new Error(`invalid size adjustment: ${deltaWidth} ${deltaHeight}`);
        }
        return new Rect(this.mLeft, this.mTop,
            this.mWidth + deltaWidth, this.mHeight + deltaHeight);
    }

    //
    // Returns a new rect that is the intersection of the current rect with another.  If the
    // rectangles don't intersect, an empty rectangle is returned.
    //
    intersect(otherRect) {
        Debug.assert(otherRect instanceof Rect);
        let newLeft = Math.max(this.left, otherRect.left);
        let newTop = Math.max(this.top, otherRect.top);
        let newRight = Math.min(this.right, otherRect.right);
        let newBottom = Math.min(this.bottom, otherRect.bottom);
        if (newLeft >= newRight || newTop >= newBottom) {
            // no intersection
            return Rect.EMPTY_RECT;
        }
        return new Rect(newLeft, newTop, newRight - newLeft, newBottom - newTop);
    }
}
