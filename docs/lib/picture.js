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

import StdHiRes from "./std-hi-res.js";
import UndoItem from "./undo-item.js";
import Rect from "./rect.js";
import Debug from "./debug.js";

//
// Our graphics system has three distinct layers:
//  1. Raw data.  For example, an Apple II hi-res screen is 8KB of data with a unique
//     memory layout and approach to representing color.  This is managed by a separate
//     object, such as StdHiRes.
//  2. ImageData.  This class is provided by the JavaScript library, and provides a way
//     to access RGBA pixels.  This class holds an ImageData object whose dimensions match
//     the image we want to display.  For standard hi-res this is 280x192, unless we wanted
//     to model half-pixel shifts, in which case it would be doubled in both dimensions.
//  3. Canvas.  This class is provided by the JavaScript library, and can be referenced
//     from HTML+CSS.  It supports a variety of drawing operations through "context"
//     objects.  We use the "2d" context here.  The ImageData may be drawn on multiple
//     canvases, e.g. the main edit window and a thumbnail view.
//
// Changes to the image are made to the raw data first, through the raw-data object.  The
// raw-data drawing calls return a dirty rect that spans the changes.  This is used to
// re-render the parts of the ImageData that were affected.  The Canvas objects are then
// fully redrawn.  The ImageData can be rendered with scaling and positioning for zooming
// and panning.
//
// This class also manages the undo/redo lists for each picture.
//

//
// Object that represents a single image, such as a hi-res screen.  This encapsulates the
// raw data object and the RGBA rendered form, and handles rendering onto canvases for the
// main image, panner window, and thumbnail.
//
export default class Picture {
    // Line stroke styles, used when drawing lines and stroked shapes.  Image formats may not
    // support all of these, e.g. Applesoft-style lines are probably only interesting for HGR.
    static STROKE_THIN = "thin";
    static STROKE_THICK = "thick";
    static STROKE_APPLESOFT = "applesoft";

    //
    // Constructor.
    //
    //  name: filename (not path), or the empty string if this is a new image
    //  type: file type, e.g. StdHiRes.FORMAT_NAME (determined from name and file length)
    //  fileHandle: FileSystemFileHandle if available; may be undefined (new image or old browser)
    //  arrayBuffer: file data if available, or undefined for a new image
    //
    constructor(name, type, fileHandle, arrayBuffer) {
        // Images are 1:1; scaling up and panning around is handled by drawImage().
        if (type == StdHiRes.FORMAT_NAME) {
            this.rawImage = new StdHiRes(arrayBuffer);
            this.pixelImage = new ImageData(StdHiRes.NUM_COLS, StdHiRes.NUM_ROWS);
        } else {
            throw new Error("unknown type " + type);
        }

        if (name.length === 0) {
            this.mName = "Untitled#062000";
        } else {
            this.mName = name;
        }
        this.mFileHandle = fileHandle;

        // Create an intermediary canvas that we can draw the pixel image data onto.  The ImageData
        // object can only be drawn at 1:1, so we want to draw it onto a temporary canvas that
        // we can then render with scaling.
        this.tempCanvas = document.createElement("canvas");
        this.tempCtx = this.tempCanvas.getContext("2d");
        this.tempCanvas.width = this.pixelImage.width;
        this.tempCanvas.height = this.pixelImage.height;

        // Set initial scale and center position.
        this.mScale = 1;
        this.mScaledCenterX = this.pixelImage.width / 2;
        this.mScaledCenterY = this.pixelImage.height / 2;

        this.mUseMono = false;          // TODO: get from picture metadata, when available

        // Generate initial rendering.
        this.render();
    }

    toString() {
        return `[Picture: name='${this.name}' handle=${this.fileHandle} rawImage=${this.rawImage}]`;
    }

    //
    // Filename, or empty string if this is a new image.
    //
    get name() {
        return this.mName;
    }
    set name(value) {
        this.mName = value;
    }

    //
    // FileSystemFileHandle object.  Will be undefined if this is a new image that has never
    // been saved, or if the browser doesn't support the new File System API.
    //
    get fileHandle() {
        return this.mFileHandle;
    }
    set fileHandle(value) {
        Debug.assert(value instanceof FileSystemFileHandle, "invalid file handle object: " + value);
        this.mFileHandle = value;
    }

    //
    // Returns a reference to the raw data array, for saving the file to disk.  This will be
    // a Uint8Array.
    //
    getRawData() {
        return this.rawImage.rawData;
    }

    //
    // Width/height of pixel image, e.g. will be 280 / 192 for standard hi-res.
    //
    get width() {
        return this.pixelImage.width;
    }
    get height() {
        return this.pixelImage.height;
    }

    //
    // If true, render in monochrome.
    //
    get useMono() {
        return this.mUseMono;
    }
    set useMono(value) {
        this.mUseMono = !!value;
    }

    //
    // Scale multiplier for this image (1-N).
    //
    get scale() {
        return this.mScale;
    }
    set scale(value) {
        Debug.assert(value >= 1 && value <= 256, "bad scale value " + value);
        // Re-scale center position.
        this.mScaledCenterX = Math.round((this.mScaledCenterX / this.mScale) * value);
        this.mScaledCenterY = Math.round((this.mScaledCenterY / this.mScale) * value);

        this.mScale = value;
    }

    //
    // Scaled center point for display.
    //
    get scaledCenterX() {
        return this.mScaledCenterX;
    }
    get scaledCenterY() {
        return this.mScaledCenterY;
    }

    //
    // Sets the center position of the image to a new value, in scaled coordinates.
    //
    setScaledCenter(newX, newY, canvasWidth, canvasHeight) {
        Debug.assert(canvasWidth !== undefined && canvasHeight !== undefined,
            `bad canvas dimensions: ${canvasWidth}x${canvasHeight}`);
        let scaledWidth = this.width * this.scale;
        let scaledHeight = this.height * this.scale;
        // console.log(`setScaledCenter(${newX},${newY}, ${canvasWidth},${canvasHeight});` +
        //     ` image=${scaledWidth}x${scaledHeight}`);

        // If the image fits completely vertically or horizontally, reset the center for that axis.
        // Otherwise, when zoomed in, we want to avoid showing empty space past the edge of the
        // image.  Clamp the position to the edge of the screen.
        if (scaledWidth <= canvasWidth) {
            newX = scaledWidth / 2;
        } else {
            if (newX < canvasWidth / 2) {
                newX = Math.trunc(canvasWidth / 2);
            } else if (newX > scaledWidth - Math.ceil(canvasWidth / 2)) {
                newX = scaledWidth - Math.ceil(canvasWidth / 2);
            }
        }
        if (scaledHeight < canvasHeight) {
            newY = scaledHeight / 2;
        } else {
            if (newY < canvasHeight / 2) {
                newY = Math.trunc(canvasHeight / 2);
            } else if (newY > scaledHeight - Math.ceil(canvasHeight / 2)) {
                newY = scaledHeight - Math.ceil(canvasHeight / 2);
            }
        }

        this.mScaledCenterX = newX;
        this.mScaledCenterY = newY;
        // console.log(`  set scaled center ${newX},${newY}`);
    }

    //
    // Shifts the center position by the specified number of scaled pixels.
    //
    shiftCenter(deltaX, deltaY, canvasWidth, canvasHeight) {
        this.setScaledCenter(this.scaledCenterX + deltaX, this.scaledCenterY + deltaY,
            canvasWidth, canvasHeight);
    }

    //
    // Dashed-line rectangle, used to highlight a region.  The coordinates are in unscaled raw
    // image coords.
    //
    mOutlineRect = Rect.EMPTY_RECT;
    get outlineRect() { return this.mOutlineRect; }
    set outlineRect(value) {
        Debug.assert(value instanceof Rect, "bad rect: " + value);
        this.mOutlineRect = value;
    }
    // Marching ant iteration step.  The specific value doesn't matter, so we don't need to reset
    // this when marching stops/starts.
    outlineRectMarch = 0;
    incMarch() {
        this.outlineRectMarch++;
        if (this.outlineRectMarch > 5) {
            this.outlineRectMarch = 0;
        }
    }

    //
    // Renders the raw image data to our JavaScript ImageData object.  Call this
    // whenever the raw image data changes.
    //
    // This is a lossy transformation, e.g. the RGBA output does not note the difference between
    // black0 and black1.
    //
    render() {
        this.rawImage.renderFull(this.pixelImage, this.useMono);
    }

    //
    // Renders an area of the ImageData object.  The actual area updated in our ImageData may be
    // larger than what is requested.
    //
    //  left: leftmost X coordinate
    //  top: topmost Y coordinate
    //  width: width of region
    //  height: height of region
    //
    renderArea(rect) {
        if (rect.isEmpty) {
            console.log("renderArea(): rect is empty");
            return;
        }
        this.rawImage.renderArea(this.pixelImage, this.useMono,
            rect.left, rect.top, rect.width, rect.height);
    }

    //
    // Draws the picture on the canvases.
    //
    //  picCtx: 2D context for main image.
    //  pannerCtx: 2D context for panner image.
    //  thumbnailCtx: 2D context for thumbnail image.
    //
    drawPicture(picCtx, pannerCtx, thumbnailCtx) {
        Debug.assert(picCtx !== undefined || pannerCtx !== undefined || thumbnailCtx !== undefined,
            `bad canvas: ${picCtx} ${pannerCtx} ${thumbnailCtx}`);

        let picCanvas = picCtx.canvas;
        // console.log(`drawPicture: ${picCanvas.width}x${picCanvas.height} ` +
        //     `scale=${this.scale} mono=${this.useMono} ` +
        //     `scaledCenter=${this.scaledCenterX},${this.scaledCenterY}`);

        picCtx.clearRect(0, 0, picCanvas.width, picCanvas.height);

        // We need to render the ImageData object onto a temporary canvas, which we can then
        // pass to the drawImage() call.  This adds some overhead whenever the image changes, but
        // allows us to freely scale and position the image within the Canvas.
        this.tempCtx.putImageData(this.pixelImage, 0, 0);

        picCtx.imageSmoothingEnabled = false;      // prevent blurry upscaling

        // Compute top/left edge that will result in the drawn image being centered.  If the
        // image is larger than the canvas, parts will be clipped.  The offsets may be negative.
        //
        // We don't want to set the scale on the canvas object, because that will affect these
        // coordinates as well.
        let canvasOffX = Math.trunc((picCanvas.width / 2) - this.scaledCenterX);
        let canvasOffY = Math.trunc((picCanvas.height / 2) - this.scaledCenterY);

        // Draw primary image, scaling up.
        // console.log(`draw ${this.width}x${this.height} at ${canvasOffX},${canvasOffY}`);
        picCtx.drawImage(this.tempCanvas, canvasOffX, canvasOffY,
                this.width * this.scale, this.height * this.scale);

        if (this.nope) {
            // Draw an overlay that dims alternate 7-pixel sections.
            picCtx.fillStyle = "#80808080";
            let blockWidth = 7 * this.scale;
            for (let i = 1; i < Math.trunc(this.pixelImage.width / 7); i += 2) {
                let xc = Math.trunc(canvasOffX + (i * 7 * this.scale));
                picCtx.fillRect(xc, canvasOffY, blockWidth, this.pixelImage.height * this.scale);
            }
        }

        // Draw a scaled-down copy in the thumbnail canvas.  We draw it at full size and let
        // the browser scale it, on the assumption that the CSS dimensions are at the correct
        // aspect ratio.
        this.drawThumbnail(thumbnailCtx);

        // Draw it again in the panner canvas.
        let pannerCanvas = pannerCtx.canvas;
        pannerCanvas.width = this.pixelImage.width;
        pannerCanvas.height = this.pixelImage.height;
        pannerCtx.drawImage(this.tempCanvas, 0, 0);

        // Compute the visibility rect, using unscaled image coordinates.  We know the
        // center position within the image.
        let vx = Math.trunc((this.scaledCenterX - (picCanvas.width / 2)) / this.scale);
        let vy = Math.trunc((this.scaledCenterY - (picCanvas.height / 2)) / this.scale);
        let vwidth = Math.ceil(picCanvas.width / this.scale);
        let vheight = Math.ceil(picCanvas.height / this.scale);
        // console.log(`vis: ${vx},${vy} ${vwidth}x${vheight}`);
        // Create an inverted clip rect, so we draw everywhere except the visible region.  Use
        // this to grey out the parts of the panner image that are offscreen.
        pannerCtx.save();
        let clipPath = new Path2D();
        clipPath.rect(0, 0, pannerCanvas.width, pannerCanvas.height);   // full canvas
        clipPath.rect(vx, vy, vwidth, vheight);                         // visible region
        pannerCtx.clip(clipPath, "evenodd");                            // use even-odd fill rule
        pannerCtx.fillStyle = "#808080c0";                              // gray, 75% opacity
        pannerCtx.fillRect(0, 0, pannerCanvas.width, pannerCanvas.height);
        pannerCtx.restore();

        if (this.scale >= 8) {
            // At larger scales, frame pixel cells with faint lines.  We can use the visibility
            // rect we just computed to reduce offscreen rendering.
            for (let i = vx; i < vx + vwidth; i++) {
                if (i % 7 == 6) {
                    picCtx.strokeStyle = "#a0a0a080";   // highlight byte boundaries
                } else {
                    picCtx.strokeStyle = "#60606080";
                }
                let xc = canvasOffX + (i * this.scale) + this.scale;
                picCtx.beginPath();
                picCtx.moveTo(xc, canvasOffY);
                picCtx.lineTo(xc, canvasOffY + this.pixelImage.height * this.scale);
                picCtx.stroke();
            }
            picCtx.strokeStyle = "#80808080";
            for (let i = vy; i < vy + vheight; i++) {
                let yc = canvasOffY + (i * this.scale) + this.scale;
                picCtx.beginPath();
                picCtx.moveTo(canvasOffX, yc);
                picCtx.lineTo(canvasOffX + this.pixelImage.width * this.scale, yc);
                picCtx.stroke();
            }
        }

        // Draw outline rect.
        let outRect = this.outlineRect;
        if (!outRect.isEmpty) {
            picCtx.save();
            picCtx.lineWidth = 2;
            picCtx.setLineDash([4, 2]);
            picCtx.strokeStyle = "#b0b0b0";
            picCtx.lineDashOffset = this.outlineRectMarch;
            picCtx.strokeRect(canvasOffX + outRect.left * this.scale,
                canvasOffY + outRect.top * this.scale,
                outRect.width * this.scale, outRect.height * this.scale);
            picCtx.restore();
        }
    }

    //
    // Draws the image in the specified canvas.  Intended for rendering down-scaled
    // thumbnail images.
    //
    drawThumbnail(thumbnailCtx) {
        let thumbnailCanvas = thumbnailCtx.canvas;
        thumbnailCanvas.width = this.pixelImage.width;
        thumbnailCanvas.height = this.pixelImage.height;
        thumbnailCtx.drawImage(this.tempCanvas, 0, 0);

        if (this.isDirty) {
            // Show a "picture has been modified" indicator.
            thumbnailCtx.fillStyle = "#ff000080";
            thumbnailCtx.beginPath();
            thumbnailCtx.moveTo(0, 0);
            thumbnailCtx.lineTo(thumbnailCanvas.width / 4, 0);
            thumbnailCtx.lineTo(0, thumbnailCanvas.height / 3);
            thumbnailCtx.fill();
        }
    }

    // ======================================================================
    // Drawing and undo/redo
    // ======================================================================

    undoList = [];
    undoIndex = 0;      // index of entry that the next operation will replace
    saveIndex = 0;      // index when file was last saved

    undoContext = undefined;

    get isDirty() { return this.undoIndex != this.saveIndex; }

    updateSaveIndex() {
        this.saveIndex = this.undoIndex;
    }

    openUndoContext(comment) {
        if (this.undoContext !== undefined) {
            throw new Error("undo context already open");
        }
        this.undoContext = new UndoItem(this.rawImage.rawData, comment)
    }

    closeUndoContext(keep) {
        if (this.undoContext === undefined) {
            throw new Error("undo context not open");
        }
        if (keep) {
            this.undoContext.finalize(this.rawImage.rawData);
            this.undoList[this.undoIndex] = this.undoContext;
            this.undoIndex++;
            this.undoList.length = this.undoIndex;      // trim anything that used to come after

            // console.log(`Undo list now (index=${this.undoIndex} save=${this.saveIndex}):`);
            // for (let i = 0; i < this.undoList.length; i++) {
            //     console.log(`  ${i}: ${this.undoList[i]}`);
            // }
        } else {
            // Discard changes.
            console.log("discarding undo context (" + this.undoContext.comment + ")");
            this.revert();
        }
        this.undoContext = undefined;
    }

    revert() {
        if (this.undoContext === undefined) {
            throw new Error("undo context not open");
        }
        // Copy the buffer from the undo item over the raw image buffer.  We expect to be doing
        // this frequently, e.g. when dragging a line endpoint around, so we want to avoid
        // allocating a new buffer each time.
        this.undoContext.copyOriginal(this.rawImage.rawData);
    }

    isUndoContextOpen() {
        return this.undoContext !== undefined;
    }

    undoAction() {
        if (this.undoIndex === 0) {
            console.log("no actions to undo");
            return false;
        }
        let undoItem = this.undoList[this.undoIndex - 1];
        this.undoIndex--;
        let undoBuf = undoItem.generateUndo(this.rawImage.rawData);
        this.rawImage.rawData = undoBuf;
        this.render();
        return true;
    }

    redoAction() {
        if (this.undoIndex === this.undoList.length) {
            console.log("no actions to redo");
            return false;
        }
        let redoItem = this.undoList[this.undoIndex];
        this.undoIndex++;
        let redoBuf = redoItem.generateRedo(this.rawImage.rawData);
        this.rawImage.rawData = redoBuf;
        this.render();
        return true;
    }

    //
    // Creates a clipping from an area of the screen.
    //
    clipArea(rect) {
        return this.rawImage.createClipping(rect.left, rect.top, rect.width, rect.height);
    }

    //
    // Converts a 1bpp bitmap to a clipping, applying the color pattern to the set pixels.
    //
    bitmapToClipping(bitmap, stride, width, pat) {
        return this.rawImage.bitmapToClipping(bitmap, stride, width, pat);
    }

    //
    // Renders a clipping onto the screen.
    //
    //  clipping: Clipping object to render
    //  xc, yc: top-left corner; may be offscreen
    //  xferMode: transfer mode
    //  (returns): dirty rect
    //
    putClipping(clipping, xc, yc, xferMode) {
        this.rawImage.putClipping(clipping, xc, yc, xferMode);
        let dirtyRect = new Rect(xc, yc, clipping.width, clipping.height);
        // The rect can extend offscreen, so clamp to screen bounds.
        dirtyRect = dirtyRect.intersect(new Rect(0, 0, this.width, this.height));
        this.renderArea(dirtyRect);
        // this.render();      // DEBUG - re-render everything to watch for artifacts
        return dirtyRect;
    }

    //
    // Sets one pixel.
    //
    //  x: X coordinate
    //  y: Y coordinate
    //  pat: color pattern
    //  (returns): dirty rect
    //
    setPixel(x, y, pat) {
        // console.log(`scribble: ${x},${y} ${pat}`);
        this.rawImage.setPixel(x, y, pat);
        let dirtyRect = new Rect(x, y, 1, 1);
        this.renderArea(dirtyRect);
        return dirtyRect;
    }

    //
    // Draws a line with the specified style.  The end point is inclusive.
    //
    //  x0, y0: first coordinate
    //  x1, y1: second coordinate
    //  pat: color pattern
    //  style: line stroke style
    //  (returns): dirty rect
    //
    drawLine(x0, y0, x1, y1, pat, style) {
        let doublePix = (style === Picture.STROKE_THICK);

        if (style === Picture.STROKE_APPLESOFT) {
            this.drawLineApplesoft(x0, y0, x1, y1, pat);
        } else {
            this.doDrawLine(x0, y0, x1, y1, pat, doublePix);
        }

        let dirtyRect = Rect.fromCoords(x0, y0, x1, y1);
        if (doublePix && dirtyRect.right < this.width) {
            dirtyRect = dirtyRect.adjustSize(1, 0);
        }
        this.renderArea(dirtyRect);
        return dirtyRect;
    }

    //
    // Standard all-octant Bresenham line algorithm.
    //
    doDrawLine(x0, y0, x1, y1, pat, doublePix) {
        let maxDouble = this.width - 1;
        let deltaX = Math.abs(x1 - x0);
        let moveX = (x0 < x1) ? 1 : -1;
        let deltaY = -Math.abs(y1 - y0);
        let moveY = (y0 < y1) ? 1: - 1;
        let error = deltaX + deltaY;

        while (true) {
            this.rawImage.setPixel(x0, y0, pat);
            if (doublePix && x0 < maxDouble) {
                this.rawImage.setPixel(x0+1, y0, pat);
            }
            let error2 = error * 2;
            if (error2 >= deltaY) {
                if (x0 === x1) {
                    break;
                }
                error += deltaY;
                x0 += moveX;
            }
            if (error2 <= deltaX) {
                if (y0 === y1) {
                    break;
                }
                error += deltaX;
                y0 += moveY;
            }
        }
    }

    //
    // Draws a line the way Applesoft does it.
    //
    // TODO(someday): the math doesn't quite match.  The line (0,0)-(279,191) has
    //   the right overall style but it's stepping at different places.
    //
    drawLineApplesoft(x0, y0, x1, y1, pat) {
        let deltaX = Math.abs(x1 - x0);
        let moveX = (x0 < x1) ? 1 : -1;
        let deltaY = -Math.abs(y1 - y0);
        let moveY = (y0 < y1) ? 1: - 1;
        let error = deltaX + deltaY;

        this.rawImage.setPixel(x0, y0, pat);
        while (true) {
            if (x0 == x1 && y0 == y1) {
                break;
            }
            let error2 = error * 2;
            if (error2 >= deltaY) {
                error += deltaY;
                x0 += moveX;
                this.rawImage.setPixel(x0, y0, pat);
            }
            if (error2 <= deltaX) {
                error += deltaX;
                y0 += moveY;
                this.rawImage.setPixel(x0, y0, pat);
            }
        }
    }

    //
    // Draws a stroke rect with the specified style.
    //
    //  x0, y0: first corner
    //  x1, y1: second corner
    //  pat: color pattern
    //  style: line stroke style
    //  (returns): dirty rect
    //
    drawStrokeRect(x0, y0, x1, y1, pat, style) {
        this.drawLine(x0, y0, x0, y1, pat, style);
        this.drawLine(x0, y1, x1, y1, pat, style);
        this.drawLine(x1, y1, x1, y0, pat, style);
        this.drawLine(x1, y0, x0, y0, pat, style);

        let dirtyRect = Rect.fromCoords(x0, y0, x1, y1);
        if (style === Picture.STROKE_THICK && dirtyRect.right < this.width) {
            dirtyRect = dirtyRect.adjustSize(1, 0);
        }
        // this.renderArea(dirtyRect);
        return dirtyRect;
    }

    //
    // Draws a filled rect.
    //
    //  x0, y0: first corner
    //  x1, y1: second corner
    //  pat: color pattern
    //  (returns): dirty rect
    //
    drawFillRect(x0, y0, x1, y1, pat) {
        let dirtyRect = Rect.fromCoords(x0, y0, x1, y1);
        for (let yc = dirtyRect.top; yc < dirtyRect.top + dirtyRect.height; yc++) {
            this.rawImage.plotHorizSegment(dirtyRect.left, yc, dirtyRect.width, pat);
        }
        this.renderArea(dirtyRect);
        return dirtyRect;
    }

    //
    // Clears a rectangular area to black.
    //
    //  rect: area to clear
    //  (returns): dirty rect
    //
    clearRect(rect) {
        let pat = this.rawImage.CLEAR_PATTERN;
        this.drawFillRect(rect.left, rect.top, rect.right - 1, rect.bottom - 1, pat);
        this.renderArea(rect);
        return rect;
    }

    //
    // Draws a stroke ellipse that fills the bounding box.
    //
    //  x0, y0: first corner
    //  x1, y1: second corner
    //  pat: color pattern
    //  style: line stroke style
    //  (returns): dirty rect
    //
    drawStrokeEllipse(x0, y0, x1, y1, pat, style) {
        return this.doDrawEllipse(x0, y0, x1, y1, pat, style, false);
    }

    //
    // Draws a filled ellipse that fills the bounding box.
    //
    drawFillEllipse(x0, y0, x1, y1, pat) {
        return this.doDrawEllipse(x0, y0, x1, y1, pat, Picture.STROKE_THIN, true);
    }

    //
    // Draws an ellipse.
    //
    // From an implementation by Alois Zingl (https://zingl.github.io/bresenham.html). MIT license.
    //
    doDrawEllipse(x0, y0, x1, y1, pat, style, fill) {
        // console.log(`ellipse ${x0},${y0} ${x1},${y1} style=${style} fill=${fill}`);
        let doublePix = (style === Picture.STROKE_THICK);
        let maxDouble = this.width - 1;
        let dirtyRect = Rect.fromCoords(x0, y0, x1, y1);
        if (doublePix && dirtyRect.right < this.width) {
            dirtyRect = dirtyRect.adjustSize(1, 0);
        }

        let a = Math.abs(x1 - x0);
        let b = Math.abs(y1 - y0);
        let b1 = b & 0x01;
        let dx = 4 * (1 - a) * b * b;
        let dy = 4 * (b1 + 1) * a * a;
        let error = dx + dy + b1 * a * a;

        if (x0 > x1) {
            x0 = x1;        // ensure x0 is smaller X coord
            x1 += a;
        }
        if (y0 > y1) {
            y0 = y1;        // ensure y0 is smaller Y coord
        }
        y0 += Math.trunc((b + 1) / 2);
        y1 = y0 - b1;
        a = a * a * 8;
        b1 = b * b * 8;

        let lastY = -1;
        do {
            if (fill) {
                // Only render if we've moved to a different line, to avoid overdraw.  This
                // works because we render the widest part first.
                if (y0 != lastY) {
                    this.rawImage.plotHorizSegment(x0, y0, x1 - x0 + 1, pat);
                    this.rawImage.plotHorizSegment(x0, y1, x1 - x0 + 1, pat);
                    lastY = y0;
                }
            } else {
                this.rawImage.setPixel(x1, y0, pat);
                this.rawImage.setPixel(x0, y0, pat);
                this.rawImage.setPixel(x0, y1, pat);
                this.rawImage.setPixel(x1, y1, pat);
                if (doublePix) {
                    this.rawImage.setPixel(x0 + 1, y0, pat);
                    this.rawImage.setPixel(x0 + 1, y1, pat);
                    if (x1 < maxDouble) {
                        this.rawImage.setPixel(x1 + 1, y0, pat);
                        this.rawImage.setPixel(x1 + 1, y1, pat);
                    }
                }
            }
            let error2 = error * 2;
            if (error2 <= dy) {
                // Y step
                y0++;
                y1--;
                dy += a;
                error += dy;
            }
            if (error2 >= dx || error * 2 > dy) {
                // X step
                x0++;
                x1--;
                dx += b1;
                error += dx;
            }
        } while (x0 <= x1);
        // "too early stop of flat ellipses a=1" ... needed for very narrow ellipses
        while (y0-y1 < b) {
            if (fill) {
                this.rawImage.plotHorizSegment(x0 - 1, y0, (x1+1) - (x0-1) + 1, pat);
                y0++, y1--;
            } else {
                this.rawImage.setPixel(x0-1, y0, pat);
                this.rawImage.setPixel(x1+1, y0++, pat);
                this.rawImage.setPixel(x0-1, y1, pat);
                this.rawImage.setPixel(x1+1, y1--, pat);
            }
        }

        this.renderArea(dirtyRect);
        return dirtyRect;
    }

    //
    // Flood-fills a region.
    //
    //  xc, yc: starting coordinate
    //  pat: color pattern
    //  (returns): rect that encompasses modified area
    //
    drawFloodFill(xc, yc, pat) {
        // We're doing a pattern fill, so we can't do the fill directly on the image itself
        // without risking an infinite loop.  Instead, we obtain a one-byte-per-pixel linear
        // map, do the fill on that, and then tell the graphics object to perform color
        // replacement.
        let colorMap = this.rawImage.generateColorMap(this.useMono);

        // Do the fill, replacing the color with 0xff.
        this.doFlood(xc, yc, 0xff, colorMap);
        // Replace the fill with the pattern.
        this.rawImage.replaceColor(colorMap, 0xff, pat);

        // Calculate dirty rect.
        let minX = this.width;
        let minY = this.height;
        let maxX = -1;
        let maxY = -1;
        for (let row = 0; row < this.height; row++) {
            let rowOffset = row * this.width;
            for (let col = 0; col < this.width; col++) {
                if (colorMap[rowOffset + col] == 0xff) {
                    if (col < minX) { minX = col; }
                    if (col > maxX) { maxX = col; }
                    if (row < minY) { minY = row; }
                    if (row > maxY) { maxY = row; }
                }
            }
        }
        let dirtyRect = Rect.fromCoords(minX, minY, maxX, maxY);
        // console.log("flood fill area: " + dirtyRect);
        this.renderArea(dirtyRect);
        return dirtyRect;
    }

    doFlood(xc, yc, newColor, colorMap) {
        let width = this.width;
        let height = this.height;
        let repColor = colorMap[yc * width + xc];   // color we will be replacing
        let toVisit = [];

        // Use the simple algorithm.
        toVisit.push([xc, yc]);
        while (toVisit.length != 0) {
            let [nx, ny] = toVisit.pop();

            // Replace the color.
            colorMap[ny * width + nx] = newColor;

            // Check N/S/E/W.  We only add to the queue if it needs to be filled.
            if (nx > 0 && colorMap[ny * width + nx - 1] == repColor) {
                toVisit.push([nx - 1, ny]);
            }
            if (nx < width - 1 && colorMap[ny * width + nx + 1] == repColor) {
                toVisit.push([nx + 1, ny]);
            }
            if (ny > 0 && colorMap[(ny - 1) * width + nx] == repColor) {
                toVisit.push([nx, ny - 1]);
            }
            if (ny < height - 1 && colorMap[(ny + 1) * width + nx] == repColor) {
                toVisit.push([nx, ny + 1]);
            }
        }
    }
}
