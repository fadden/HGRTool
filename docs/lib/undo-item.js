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
// These objects capture the "before" and "after" states of an image in a compact form.
// This allows us to perform undo/redo without having to re-execute the actual drawing
// operations (with all associated state).
//
// This is expected to work for different image formats.  An easy way to do this is to
// take the full binary "before" image when the undo object is created, and generate a
// binary diff vs. the "after" image.  If the number of changes is small, we create a diff
// list; if it's large, we just store the binary blob.
//
// For small operations it could be more efficient to allow changes to be added incrementally.
// For example, when dragging the end point of a line or filled rect, we're constantly reverting
// the image before re-drawing it.  In that case it's faster and easier to just memcpy
// the entire buffer.
//
export default class UndoItem {
    static SIMPLE_UNDO = false;

    // We can store the full before/after (undo/redo) buffers, or a two-way diff list.  Each
    // entry in the diff list is a 32-bit integer:
    //   [after][before][addr-hi][addr-lo]
    // Compared to simply storing the before+after buffers, that's a 2:1 expansion, ignoring
    // JavaScript array overhead, and restoring the diff will quickly become more expensive
    // than a memcpy.  However, we don't expect to be doing these in rapid succession, so our
    // primary concern is memory footprint.

    //
    // Constructor.
    //
    //  buffer: Uint8Array with raw image data (e.g. 8KB hi-res screen)
    //  comment: human-readable message, for debugging
    //
    constructor(buffer, comment) {
        if (!(buffer instanceof Uint8Array)) {
            throw new Error("bad before");
        }
        this.beforeBuffer = new Uint8Array(buffer);
        this.comment = comment;
        this.isProcessed = false;
        this.undoBuffer = undefined;
        this.redoBuffer = undefined;
        this.diffList = [];
    }

    toString() {
        return `[Undo ${this.comment} diffList=${this.diffList.length}]`;
    }

    //
    // Copies the initial buffer contents into the provided buffer, which must be the same
    // length.
    //
    copyOriginal(outBuf) {
        if (outBuf.length != this.beforeBuffer.length) {
            throw new Error(
                `buffer lengths differ: ${outBuf.Length} / ${this.beforeBuffer.length}`);
        }
        outBuf.set(this.beforeBuffer);
    }

    //
    // Processes the new buffer, generating a list of differences with the old buffer.
    //
    // On completion, any excess data (such as the full original buffer) will be discarded
    // to reduce memory footprint.
    //
    //  newBuf: Uint8Array with raw image data
    //
    finalize(newBuf) {
        Debug.assert(newBuf.length < 65536);
        if (this.isProcessed) {
            throw new Error("can't re-process");
        }
        this.isProcessed = true;

        if (UndoItem.SIMPLE_UNDO) {
            // Always keep the full buffers around.
            this.undoBuffer = this.beforeBuffer;
            this.redoBuffer = new Uint8Array(newBuf);
            Debug.assert(this.diffList.length == 0);
        } else {
            for (let i = 0; i < newBuf.length; i++) {
                if (this.beforeBuffer[i] != newBuf[i]) {
                    let diffEntry = i | (this.beforeBuffer[i] << 16) | (newBuf[i] << 24);
                    this.diffList.push(diffEntry);
                }
            }
            if (this.diffList.length > newBuf.length / 2) {
                // Too big, just capture the buffers.
                this.diffList = [];
                this.undoBuffer = this.beforeBuffer;
                this.redoBuffer = new Uint8Array(newBuf);
            }
        }

        // Discard reference to state we no longer need.
        this.beforeBuffer = undefined;
    }

    //
    // Generates a new buffer of raw image data, representing the current buffer without
    // the most recent change.
    //
    //  buffer: current raw image buffer
    //
    generateUndo(buffer) {
        if (!this.isProcessed) {
            throw new Error("undo item not finalized");
        }
        if (this.undoBuffer != undefined) {
            return new Uint8Array(this.undoBuffer);     // return copy of buffer contents
        } else {
            let newBuf = new Uint8Array(buffer);
            this.applyDiff(newBuf, true);
            return newBuf;
        }
    }

    //
    // Generates a new buffer of raw image data, representing the current buffer with the
    // most recently undone change reapplied.
    //
    //  buffer: current raw image buffer
    //
    generateRedo(buffer) {
        if (!this.isProcessed) {
            throw new Error("undo item not finalized");
        }
        if (this.redoBuffer != undefined) {
            return new Uint8Array(this.redoBuffer);     // return copy of buffer contents
        } else {
            let newBuf = new Uint8Array(buffer);
            this.applyDiff(newBuf, false);
            return newBuf;
        }
    }

    //
    // Applies a diff list to a buffer.
    //
    applyDiff(buffer, isUndo) {
        let beforeShift = isUndo ? 24 : 16;
        let afterShift = isUndo ? 16 : 24;
        for (let i = 0; i < this.diffList.length; i++) {
            let diffEntry = this.diffList[i];
            let addr = diffEntry & 0xffff;
            let before = (diffEntry >> beforeShift) & 0xff;
            let after = (diffEntry >> afterShift) & 0xff;
            if (buffer[addr] != before) {
                throw new Error(`bad diff before: ${i} ${addr} ${before} ${after} vs. ` +
                    ` ${buffer[addr]}`);
            }
            buffer[addr] = after;
        }
    }
}
