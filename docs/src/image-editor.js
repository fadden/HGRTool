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

import StdHiRes from "./lib/std-hi-res.js";
import Picture from "./lib/picture.js";
import Rect from "./lib/rect.js";
import Debug from "./lib/debug.js";
import ColorPickerHgr from "./color-picker-hgr.js";
import StylePicker from "./style-picker.js";
import FontPicker from "./font-picker.js";
import TextEntry from "./text-entry.js";
import Settings from "./settings.js";
import About from "./about.js";

//
// Image editor implementation, tied closely to the HTML page.  Only one instance of this
// class is created.
//
class ImageEditor {
    static TEST_OLD_IO = false;     // test the I/O compatibility routines

    // Constants.
    MAX_FILES = 8;                  // max number of open files; adjust CSS rightbar grid
    LEFT_BUTTON = 0;
    RIGHT_BUTTON = 2;

    // "Snackbar" for messages.
    snackbar = document.getElementById("snackbar");
    snackbarMsg = this.snackbar.firstChild;
    snackbarVisible = false;

    // Picture canvas.
    picCanvas = document.getElementById("edit-surface");
    picCtx = this.picCanvas.getContext("2d");

    // Panner canvas.
    pannerCanvas = document.getElementById("panner");
    pannerCtx = this.pannerCanvas.getContext("2d");

    // Color swatch canvas.
    colorSwatchCanvas = document.getElementById("curcolor-canvas");
    colorSwatchCtx = this.colorSwatchCanvas.getContext("2d");

    // Color picker.  Potentially changes for different types of images.
    colorPicker = undefined;

    // List of loaded pictures.
    pictureList = [];
    mCurrentPicture = undefined;
    get currentPicture() { return this.mCurrentPicture; }
    set currentPicture(value) {
        this.mCurrentPicture = value;
        this.setThumbnailHighlight();
    }

    // Thumbnail contexts, one per HTML element.
    thumbnailContexts = [];
    thumbnailButtons = [];

    // Color/mono checkbox.  We need to maintain our UI element, but the value is
    // picture-specific.
    useMonoElem = document.getElementById("useMono");

    constructor() {
        //
        // Top bar commands.
        //
        document.getElementById("btn-new").addEventListener("click",
            this.handleNew.bind(this));
        document.getElementById("btn-open").addEventListener("click",
            this.handleOpen.bind(this));
        document.getElementById("btn-save").addEventListener("click",
            this.handleSave.bind(this));
        document.getElementById("btn-save-as").addEventListener("click",
            this.handleSaveAs.bind(this));
        document.getElementById("btn-close").addEventListener("click",
            this.handleClose.bind(this));

        document.getElementById("btn-cut").addEventListener("click",
            this.handleCut.bind(this));
        document.getElementById("btn-copy").addEventListener("click",
            this.handleCopy.bind(this));
        document.getElementById("btn-paste").addEventListener("click",
            this.handlePaste.bind(this));
        document.getElementById("btn-undo").addEventListener("click",
            this.handleUndo.bind(this));
        document.getElementById("btn-redo").addEventListener("click",
            this.handleRedo.bind(this));

        document.getElementById("old-file-chooser").addEventListener("change",
             this.handleOldOpen.bind(this));
        document.getElementById("old-save-ok").addEventListener("click",
             this.handleOldSaveOk.bind(this));
        document.getElementById("old-save-name").addEventListener("keypress", (event) => {
            if (event.key == "Enter") {     // close dialog when enter hit
                event.preventDefault();
                document.getElementById("old-save-ok").click();
            }
        });

        //
        // Right bar thumbnails.
        //
        // Create thumbnail buttons and canvas contexts.
        //
        let rightBar = document.getElementById("rightbar");
        for (let i = 0; i < this.MAX_FILES; i++) {
            let name = "thumb" + i;
            let button = document.createElement("button");
            button.id = name;
            button.classList.add("right-pic");
            let canvas = document.createElement("canvas");
            canvas.classList.add("thumbnail-canvas");
            button.append(canvas);
            rightBar.append(button);

            button.addEventListener("click", this.handleThumbnailClick.bind(this, i));
            this.thumbnailButtons.push(button);
            canvas.width = 140;     // set proportions to match hi-res
            canvas.height = 96;
            let ctx = canvas.getContext("2d");
            this.thumbnailContexts.push(ctx);
        }

        //
        // Bottom bar controls.
        //
        this.useMonoElem.addEventListener("change", this.handleUseMono.bind(this));
        this.scaleSliderElem.addEventListener("input", this.handleScaleSlider.bind(this));
        document.getElementById("curcolor-button").addEventListener("click",
            this.handleSelectColor.bind(this));

        //
        // Left bar tools.
        //
        document.getElementById("btn-pan").addEventListener("click", (event) => {
            this.setTool(event, this.toolPan);
        });
        document.getElementById("btn-select-rect").addEventListener("click", (event) => {
            this.setTool(event, this.toolSelectRect);
        });
        document.getElementById("btn-scribble").addEventListener("click", (event) => {
            this.setTool(event, this.toolScribble);
        });
        document.getElementById("btn-line").addEventListener("click", (event) => {
            this.setTool(event, this.toolLine);
        });
        document.getElementById("btn-stroke-rect").addEventListener("click", (event) => {
            this.setTool(event, this.toolStrokeRect);
        });
        document.getElementById("btn-fill-rect").addEventListener("click", (event) => {
            this.setTool(event, this.toolFillRect);
        });
        document.getElementById("btn-stroke-ellipse").addEventListener("click", (event) => {
            this.setTool(event, this.toolStrokeEllipse);
        });
        document.getElementById("btn-fill-ellipse").addEventListener("click", (event) => {
            this.setTool(event, this.toolFillEllipse);
        });
        document.getElementById("btn-text").addEventListener("click", (event) => {
            this.setTool(event, this.toolText);
        });
        document.getElementById("btn-flood-fill").addEventListener("click", (event) => {
            this.setTool(event, this.toolFloodFill);
        });

        // Set initial tool, mark as selected.
        this.activeToolButton = document.getElementById("btn-pan");
        this.activeToolButton.classList.add("selected");
        this.activeTool = this.toolPan;

        document.getElementById("btn-choose-color").addEventListener("click",
            this.handleSelectColor.bind(this));
        document.getElementById("btn-choose-font").addEventListener("click",
            this.handleSelectFont.bind(this));
        document.getElementById("btn-choose-style").addEventListener("click",
            this.handleSelectStyle.bind(this));
        document.getElementById("btn-settings").addEventListener("click",
            this.handleSettings.bind(this));
        document.getElementById("btn-about").addEventListener("click",
            this.handleAbout.bind(this));

        //
        // Middle section resizing.
        //
        this.observer.observe(this.picCanvas);

        // Trap keyboard shortcuts.
        document.addEventListener("keydown", this.handleKeyDown.bind(this));

        if (Settings.PROTECT_EDITS) {
            window.addEventListener("beforeunload", this.handleBeforeUnload.bind(this));
        }

        // Allow image files to be dropped onto the right bar or main canvas.
        document.getElementById("rightbar").addEventListener("drop", this.handleFileDrop.bind(this));
        this.picCanvas.addEventListener("drop", this.handleFileDrop.bind(this));
        window.addEventListener("dragover", (event) => { event.preventDefault(); });
        window.addEventListener("drop", (event) => { event.preventDefault(); });
        // Never treat pointer drag in the drawing canvas as a drag & drop attempt.
        this.picCanvas.addEventListener("dragstart", (event) => { event.preventDefault(); });

        // Fancy mouse handling.
        this.picCanvas.addEventListener("pointerenter", this.handleCanvasPointerEnter.bind(this));
        this.picCanvas.addEventListener("pointerleave", this.handleCanvasPointerLeave.bind(this));
        this.picCanvas.addEventListener("pointermove", this.handleCanvasPointerMove.bind(this));
        this.picCanvas.addEventListener("pointerdown", this.handleCanvasPointerDown.bind(this),
            { passive: false });
        this.picCanvas.addEventListener("pointerup", this.handleCanvasPointerUp.bind(this),
            { passive: false });
        this.picCanvas.addEventListener("wheel", this.handleCanvasWheel.bind(this),
            { passive: false });

        this.pannerCanvas.addEventListener("pointermove", this.handlePannerPointerMove.bind(this));
        this.pannerCanvas.addEventListener("pointerdown", this.handlePannerPointerDown.bind(this),
            { passive: false });
        this.pannerCanvas.addEventListener("pointerup", this.handlePannerPointerUp.bind(this),
            { passive: false });
        this.pannerCanvas.addEventListener("wheel", this.handlePannerWheel.bind(this),
            { passive: false });

        // Disable right-click context menu.
        document.addEventListener("contextmenu", (event) => { event.preventDefault(); });

        // Init scale slider UI element.
        this.pictureScaleIndex = 0;

        this.setOutlineRect(Rect.EMPTY_RECT, false);

        console.log("ImageEditor initialized");
    }

    //
    // Image scaling.  We use a non-linear fixed set of multipliers.
    //
    scaleElem = document.getElementById("pictureScale");
    scaleSliderElem = document.getElementById("pictureScaleSlider");
    scaleMults = [ 1, 2, 3, 4, 6, 8, 16, 32 ];
    mPictureScaleIndex = 0;
    // Get/set the scale multiplier.  If the multiplier passed to the setter isn't in the
    // multiplier array, we pick the closest.
    get pictureScale() { return this.scaleMults[this.mPictureScaleIndex]; }
    set pictureScale(value) {
        Debug.assert(value >= 1 && value <= 256, "bad scale multiplier " + value);
        for (let i = 0; i < this.scaleMults.length; i++) {
            if (this.scaleMults[i] == value) {
                this.pictureScaleIndex = i;
                return;
            } else if (this.scaleMults[i] > value) {
                this.pictureScaleIndex = i - 1;
                return;
            }
        }
        this.pictureScaleIndex = 0;     // unexpected
    }
    get pictureScaleIndex() { return this.mPictureScaleIndex; }
    set pictureScaleIndex(value) {
        // console.log("setting pictureScaleIndex to " + value);
        Debug.assert(value >= 0 && value < this.scaleMults.length, "bad scale index " + value);
        this.mPictureScaleIndex = value;
        this.scaleSliderElem.value = value;                 // adjust slider position
        this.scaleElem.textContent = this.pictureScale;     // show multiplier

        if (this.currentPicture != undefined) {
            this.currentPicture.scale = this.pictureScale;
        }
    }

    //
    // Prevents leaving the page while there are unsaved changes.
    //
    handleBeforeUnload(event) {
        let changesPending = false;
        for (let pic of this.pictureList) {
            if (pic.isDirty) {
                changesPending = true;
                break;
            }
        }
        if (changesPending) {
            event.preventDefault();
            event.returnValue = true;
        }
    }

    //
    // Receives size change events for the Canvas.
    // Connect with "observer.observe(object)".
    //
    // https://stackoverflow.com/a/73831830/294248
    //
    observer = new ResizeObserver(() => {
        this.picCanvas.width = this.picCanvas.clientWidth;
        this.picCanvas.height = this.picCanvas.clientHeight;
        //console.log(`resize: ${this.canvasWidth}x${this.canvasHeight}`);

        this.drawCurrentPicture();
    });

    //
    // Handles change to the "use mono" checkbox.
    //
    handleUseMono(event) {
        if (this.currentPicture != undefined) {
            this.currentPicture.useMono = event.currentTarget.checked;
            this.currentPicture.render();
            this.drawCurrentPicture();
            this.onColorChanged();          // redraw color swatch
        }
    }

    setInitialScale(pic) {
        let maxWScale = Math.trunc(this.picCanvas.clientWidth / pic.width);
        let maxHScale = Math.trunc(this.picCanvas.clientHeight / pic.height);
        let scale = Math.min(maxWScale, maxHScale);
        if (scale < 1) {
            scale = 1;
        }
        this.pictureScale = scale;      // actual value may be modified...
        pic.scale = this.pictureScale;  // ...so be sure to use modified value
    }

    //
    // Show a message in the "snackbar".  It will appear briefly then vanish, so this should
    // only be used for status updates.
    //
    // The timer doesn't reset if additional messages arrive.
    //
    showMessage(msg) {
        const msgTimeoutMsec = 3000;
        const className = "show";
        this.snackbarMsg.textContent = msg;
        // Add the "show" class to the DIV to make it appear.
        this.snackbar.classList.add(className);
        // After a brief delay, remove the "show" class to make it vanish.  Don't add
        // additional timers if we already have one started.
        if (!this.snackbarVisible) {
            setTimeout(() => {
                this.snackbar.classList.remove(className);
                this.snackbarVisible = false;
            }, msgTimeoutMsec);
        }
        this.snackbarVisible = true;
    }

    setThumbnailHighlight() {
        let index = -1;
        if (this.currentPicture !== undefined) {
            index = this.getCurrentPictureIndex();
        }
        for (let i = 0; i < this.thumbnailButtons.length; i++) {
            let elem = this.thumbnailButtons[i];
            if (i == index) {
                elem.classList.add("selected");
            } else {
                elem.classList.remove("selected");
            }
        }
    }

    handleFileDrop(event) {
        event.preventDefault();
        if (this.pictureList.length == this.MAX_FILES) {
            this.showMessage(`You have ${this.pictureList.length} images open.  Please` +
                ` close one before dragging more in.`);
            return;
        }
        // event.dataTransfer.items is a DataTransferItemList
        for (let item of event.dataTransfer.items) {
            if (item.kind === "file") {
                let file = item.getAsFile();
                this.loadFile(file, undefined);
            } else {
                console.log("got non-file drop item: " + item);
            }
        }
    }

    //
    // Handles the details of loading a file and adding it to the list.
    //
    //  file: File object
    //  handle: FileSystemFileHandle object, may be undefined (e.g. file drop)
    //
    async loadFile(file, handle) {
        let buffer = await file.arrayBuffer();
        let newPic;
        if (StdHiRes.checkMatch(buffer.byteLength)) {
             newPic = new Picture(file.name, StdHiRes.FORMAT_NAME, handle, buffer);
        } else {
            this.showMessage("File not recognized");
            return;
        }

        // Successfully loaded, add it to our set.
        // We can't do this test earlier because we can be in here multiple times (async).
        if (this.pictureList.length === this.MAX_FILES) {
            // Do we need to notify the user?
            console.log("ran out of room to open files");
            return;
        }
        this.pictureList.push(newPic);
        this.setInitialScale(newPic);
        this.switchToPicture(newPic);
    }

    //
    // Handles a keypress.  Some hotkeys replace browser defaults, e.g. Ctrl+S to save.
    //
    handleKeyDown(event) {
        let handled = false;

        // Handle Ctrl keys for Windows and Command keys for Mac OS.
        if ((event.ctrlKey || event.metaKey)) {
            handled = true;
            switch (event.key) {
                case 'o':
                    this.handleOpen();
                    break;
                case 's':
                    this.handleSave();
                    break;
                case 'y':
                    this.handleRedo();
                    break;
                case 'z':
                    this.handleUndo();
                    break;
                default:
                    handled = false;
                    break;
            }
        } else {
            switch (event.key) {
                case "Enter":
                    handled = this.handleEnterKey();
                    break;
                case "Escape":
                    handled = this.handleEscapeKey();
                    break;
                case "ArrowLeft":
                case "ArrowRight":
                case "ArrowUp":
                case "ArrowDown":
                    handled = this.handleArrowKey(event.key);
                    break;
                default:
                    // do nothing
                    break;
            }
        }

        if (handled) {
            event.preventDefault();
        }
    }

    //
    // Special handling for ESC key.  If a clipping is visible, clear it.
    //
    //  (returns): true if we acted, false if we did nothing
    //
    handleEscapeKey() {
        if (!this.outlineRect.isEmpty || this.visClipping !== undefined) {
            console.log("ESC hit, clearing selection/clipping");
            this.clearOutlineRect();
            this.clearClipping();
            this.drawCurrentPicture();
            return true;
        } else {
            return false;
        }
    }

    //
    // Special handling for Enter key.  If a clipping is visible, paste it and clear it.
    //
    //  (returns): true if we acted, false if we did nothing
    //
    handleEnterKey() {
        if (!this.outlineRect.isEmpty && this.visClipping !== undefined) {
            console.log("Enter hit, pasting and clearing");
            this.handlePaste();
            this.handleEscapeKey();
            return true;
        } else {
            return false;
        }
    }

    //
    // Special handling for arrow keys.  If a clipping is visible, reposition it.
    //
    //  (returns): true if we acted, false if we did nothing
    //
    handleArrowKey(key) {
        if (this.outlineRect.isEmpty || this.visClipping === undefined) {
            return false;
        }
        let dx = 0;
        let dy = 0;
        switch (key) {
            case "ArrowLeft": dx = -1; break;
            case "ArrowRight": dx = 1; break;
            case "ArrowUp": dy = -1; break;
            case "ArrowDown": dy = 1; break;
            default: throw new Error("not an arrow key");
        }
        // Compute new position.
        let newRect = this.outlineRect.translate(dx, dy);
        // Don't move if it would put the clipping completely off the screen.
        let isect = newRect.intersect(
                new Rect(0, 0, this.currentPicture.width, this.currentPicture.height));
        if (!isect.isEmpty) {
            this.setOutlineRect(newRect, true);
            this.redrawClipping();
        }
        return true;
    }

    handleNew() {
        if (this.pictureList.length == this.MAX_FILES) {
            this.showMessage(`You have ${this.pictureList.length} images open.  Please` +
                ` close one before creating another.`);
            return;
        }
        let newPic = new Picture("", StdHiRes.FORMAT_NAME, undefined, undefined);
        this.pictureList.push(newPic);
        this.setInitialScale(newPic);
        this.switchToPicture(newPic);
    }

    async handleOpen() {
        if (this.pictureList.length == this.MAX_FILES) {
            this.showMessage(`You have ${this.pictureList.length} images open.  Please` +
                ` close one before opening another.`);
            return;
        }
        if (!("showOpenFilePicker" in window) || ImageEditor.TEST_OLD_IO) {
            document.getElementById("old-open").showModal();
            return;
        }
        const pickerOpts = {
            multiple:true
        }
        // Get an array of FileSystemFileHandle objects from the picker.
        let fileHandles;
        try {
            fileHandles = await window.showOpenFilePicker(pickerOpts);
        } catch (error) {
            // We get an AbortError if the user cancels.
            console.log(error);
            return;
        }
        console.log(`got ${fileHandles.length} handles`);
        for (let handle of fileHandles) {
            try {
                let file = await handle.getFile();
                this.loadFile(file, handle);
            } catch(error) {
                console.log(error);
            }
        }
    }

    async handleOldOpen(event) {
        // The event holds a FileList object, which has a list of File objects.  These are
        // a subclass of Blob, so we can convert them directly to ArrayBuffers.
        const fileList = event.currentTarget.files;
        for (let file of fileList) {
            this.loadFile(file, undefined);
        }

        // Clear value.  If we don't do this, you won't be able to reload the file if you
        // decide to abandon your changes, because selecting the same file again doesn't
        // result in a change to the value.
        event.currentTarget.value = "";

        document.getElementById("old-open").close();
    }

    //
    // Attempts to save the current picture to the file it was loaded from.  If that's not
    // possible, punt to handleSaveAs().
    //
    async handleSave() {
        if (this.currentPicture == undefined) {
            this.showMessage("No picture.");
            return;
        }
        let fileHandle = this.currentPicture.fileHandle;
        if (fileHandle === undefined) {
            return this.handleSaveAs();
        }

        let contents = this.currentPicture.getRawData();
        try {
            let writable = await fileHandle.createWritable();
            await writable.truncate(0);
            await writable.write(contents);
            await writable.close();
            this.markAsSaved();
            this.showMessage(`Saved '${this.currentPicture.name}'`);
        } catch (error) {
            console.log(error);
            this.showMessage("ERROR: save failed: " + error);
            return;
        }
    }

    async handleSaveAs() {
        if (this.currentPicture == undefined) {
            this.showMessage("No picture.");
            return;
        }
        if (!("showSaveFilePicker" in window) || ImageEditor.TEST_OLD_IO) {
            this.handleOldSaveAs();
            return;
        }

        let contents = this.currentPicture.getRawData();
        try {
            // Get a handle from the browser.  If the user cancels, this will throw AbortError.
            let fileOptions = { suggestedName: this.currentPicture.name };
            let fileHandle = await window.showSaveFilePicker(fileOptions);
            // Create a FileSystemWritableFileStream.
            let writable = await fileHandle.createWritable();
            await writable.truncate(0);
            await writable.write(contents);
            await writable.close();
            console.log("saved '" + this.currentPicture.name + "' as '" + fileHandle.name + "'");
            // Replace the filename and handle in the Picture object, so that future
            // Save invocations use that one.
            this.markAsSaved();
            this.currentPicture.name = fileHandle.name;
            this.currentPicture.fileHandle = fileHandle;
            this.showMessage("Image saved");
        } catch (error) {
            console.log(error);
            if (error.name === "AbortError") {
                // save cancelled
            } else {
                this.showMessage("ERROR: save-as failed: " + error);
            }
            return;
        }
    }

    handleOldSaveAs() {
        document.getElementById("old-save-name").value = this.currentPicture.name;
        document.getElementById("old-save").showModal();
    }
    handleOldSaveOk() {
        document.getElementById("old-save").close();
        let contents = this.currentPicture.getRawData();
        let fileName = document.getElementById("old-save-name").value;
        if (fileName.length == 0) {
            return;
        }
        let blob = new Blob([contents], { type: "application/octet-stream" });
        // Create a temporary anchor and URL.
        let tempUrl = URL.createObjectURL(blob);
        let tempAnchor = document.createElement("a");
        tempAnchor.href = tempUrl;
        tempAnchor.download = fileName;
        // Add the anchor, click it, then remove it.
        document.body.appendChild(tempAnchor);
        tempAnchor.click();
        document.body.removeChild(tempAnchor);
        URL.revokeObjectURL(tempUrl);

        this.markAsSaved();
        this.showMessage(`Downloaded '${fileName}'`);
    }

    markAsSaved() {
        this.currentPicture.updateSaveIndex();
        this.drawCurrentPicture();      // redraw thumbnail
    }

    handleClose() {
        if (this.currentPicture === undefined) {
            console.log("current picture is " + this.currentPicture);
            return;
        }
        if (this.currentPicture.isDirty) {
            let confirmed = confirm("The image has unsaved changes. Close it anyway?");
            if (!confirmed) {
                return;
            }
        }

        // Discard anything in progress.
        this.clearClipping();
        this.clearOutlineRect();
        if (this.currentPicture.isUndoContextOpen()) {
            this.currentPicture.closeUndoContext(false);
        }

        let index = this.getCurrentPictureIndex();
        this.pictureList.splice(index, 1);      // remove one element
        if (index == this.pictureList.length) {
            // We deleted the last element, use the one above.
            this.currentPicture = (index == 0) ? undefined : this.pictureList[index - 1];
        } else {
            // We deleted an element in the middle, use whatever slid down.
            this.currentPicture = this.pictureList[index];
        }
        // We need the thumbnail images in the right bar to move up to fill the gap.
        for (let i = index; i < this.pictureList.length; i++) {
            this.pictureList[i].drawThumbnail(this.thumbnailContexts[i]);
        }
        // If we've selected a new image, draw it and update the controls.
        if (this.currentPicture !== undefined) {
            this.switchToPicture(this.currentPicture);
        } else {
            this.onColorChanged();      // clear the color swatch
        }

        // Clear the thumbnail for the bottom-most entry.  If we have no loaded images, clear the
        // picture and panner canvases as well.
        let thumbCtx = this.thumbnailContexts[this.pictureList.length];
        thumbCtx.clearRect(0, 0, thumbCtx.canvas.width, thumbCtx.canvas.height);
        if (this.pictureList.length == 0) {
            this.picCtx.clearRect(0, 0, this.picCtx.canvas.width, this.picCtx.canvas.height);
            this.pannerCtx.clearRect(0, 0,
                this.pannerCtx.canvas.width, this.pannerCtx.canvas.height);
        }
    }

    handleCut() {
        if (this.currentPicture === undefined || this.outlineRect.isEmpty) {
            return;
        }
        if (this.currentPicture.isUndoContextOpen()) {
            // Discard current undo context.  Maybe they hit "copy", then "cut"?
            this.currentPicture.closeUndoContext(false);
        }

        this.visClipping = this.currentPicture.clipArea(this.outlineRect);
        this.enableMarch();

        // Clear the area.
        this.currentPicture.openUndoContext("cut");
        this.dirtyRect = this.currentPicture.clearRect(this.outlineRect);
        this.currentPicture.closeUndoContext(true);

        // Create an undo context and render the clipping.
        this.currentPicture.openUndoContext("clipping");
        this.dirtyRect = this.currentPicture.putClipping(this.visClipping,
            this.outlineRect.left, this.outlineRect.top, gSettings.clipXferMode);
        this.drawCurrentPicture();
    }

    handleCopy() {
        if (this.currentPicture === undefined || this.outlineRect.isEmpty) {
            this.showMessage("Nothing is selected");
            return;
        }
        if (this.currentPicture.isUndoContextOpen()) {
            // Discard current undo context.  This can happen if e.g. they hit "copy" twice.
            this.currentPicture.closeUndoContext(false);
        }

        this.visClipping = this.currentPicture.clipArea(this.outlineRect);
        this.enableMarch();

        // Create an undo context and render the clipping.  (This should have no visible effect,
        // but it ensures we have the correct dirty rect.)
        this.currentPicture.openUndoContext("clipping");
        this.dirtyRect = this.currentPicture.putClipping(this.visClipping,
            this.outlineRect.left, this.outlineRect.top, gSettings.clipXferMode);
        this.drawCurrentPicture();
    }

    handlePaste() {
        if (this.currentPicture === undefined || this.visClipping === undefined) {
            this.showMessage("Nothing has been cut or copied");
            return;
        }
        if (!this.currentPicture.isUndoContextOpen()) {
            // Not sure how we got here.
            throw new Error("we have a clipping but no undo context?");
        }

        // We've already drawn it, just make it official.  Open a new undo context so they
        // can stamp the same selection elsewhere.
        this.currentPicture.closeUndoContext(true);
        this.currentPicture.openUndoContext("clipping+");
    }

    handleUndo() {
        this.clearClipping();
        if (this.currentPicture !== undefined) {
            if (this.currentPicture.undoAction()) {
                this.drawCurrentPicture();
            }
        }
    }

    handleRedo() {
        this.clearClipping();
        if (this.currentPicture !== undefined) {
            if (this.currentPicture.redoAction()) {
                this.drawCurrentPicture();
            }
        }
    }

    handleSelectColor() {
        if (this.currentPicture === undefined) {
            return;
        }
        document.getElementById("color-picker-hgr").showModal();
    }
    // Callback function from color picker, and when switching images (because we could
    // be changing to a different type of picker).
    onColorChanged() {
        this.colorSwatchCanvas.width = this.colorSwatchCanvas.clientWidth;
        this.colorSwatchCanvas.height = this.colorSwatchCanvas.clientHeight;
        if (this.currentPicture === undefined) {
            this.colorSwatchCtx.clearRect(0, 0,
                this.colorSwatchCanvas.width, this.colorSwatchCanvas.height);
        } else {
            // console.log("pattern is now " + this.colorPicker.currentPat);
            this.colorPicker.drawColorSwatch(this.colorSwatchCtx, this.colorPicker.currentPat,
                this.currentPicture.useMono);
        }
    }

    handleSelectFont() {
        gFontPicker.showDialog();
    }

    handleSelectStyle() {
        gStylePicker.showDialog();
    }

    handleSettings() {
        gSettings.showDialog();
    }
    onSettingsChanged() {
        // Copy setting so we don't have to put Settings in globalThis.
        gColorPickerHgr.colorSwatchClose = gSettings.colorSwatchClose;
        // Redraw the clipping, if any, in case the transfer mode changed.
        this.redrawClipping();
    }

    handleAbout() {
        gAbout.showDialog();
    }

    getCurrentPictureIndex() {
        if (this.currentPicture === undefined) {
            throw new Error("no current picture");
        }
        return this.getPictureIndex(this.currentPicture);
    }
    getPictureIndex(pic) {
        let index = 0;
        for ( ; index < this.pictureList.length; index++) {
            if (this.pictureList[index] == pic) {
                break;
            }
        }
        if (index == this.pictureList.length) {
            throw new Error("couldn't find picture " + pic);
        }
        return index;
    }

    //
    // Draws the current picture.  If there is no current picture, this returns without doing
    // anything.
    //
    drawCurrentPicture() {
        if (this.currentPicture !== undefined) {
            let index = this.getCurrentPictureIndex();
            this.currentPicture.drawPicture(this.picCtx, this.pannerCtx,
                 this.thumbnailContexts[index]);
        }
    }

    //
    // Handles scale slider movement.
    //
    handleScaleSlider(event) {
        let newScaleIndex = event.currentTarget.value;
        this.pictureScaleIndex = newScaleIndex;
        this.drawCurrentPicture();
    }

    //
    // Switches to a different picture.  The image will be redrawn and the bottom-row GUI elements
    // updated appropriately.
    //
    switchToPicture(pic) {
        if (this.currentPicture !== undefined) {
            // Check for pending actions and clippings.
            if (this.currentPicture.isUndoContextOpen()) {
                console.log("canceling pending undo action on pic switch");
                this.currentPicture.closeUndoContext(false);
                this.currentPicture.renderArea(this.dirtyRect);
                // Redraw so the thumbnail is correct.
                this.drawCurrentPicture();
            }
        }
        this.currentPicture = pic;
        this.colorPicker = gColorPickerHgr;     // this may need to change based on pic type
        this.pictureScale = this.currentPicture.scale;
        this.useMonoElem.checked = this.currentPicture.useMono;
        pic.outlineRect = this.outlineRect;     // transfer the outline rect

        // If we have a visible clipping, get that set up.
        if (this.visClipping !== undefined) {
            this.currentPicture.openUndoContext("clipping");
            this.dirtyRect = this.currentPicture.putClipping(this.visClipping,
                this.outlineRect.left, this.outlineRect.top, gSettings.clipXferMode);
        }

        this.drawCurrentPicture();

        // Redraw color swatch in case we changed to different type of picker.
        this.onColorChanged();
    }

    //
    // Handles a click on a thumbnail.
    //
    handleThumbnailClick(index) {
        if (index < this.pictureList.length && this.pictureList[index] != this.currentPicture) {
            // Switch to a different picture.  Update GUI elements to match.
            this.switchToPicture(this.pictureList[index]);
            console.log(`switched to ${index}:'${this.currentPicture.name}'`);
        }
    }

    // ======================================================================
    // Outline rect management
    // ======================================================================

    // The selection rect is a dashed-line rectangle that is used to outline a rectangular
    // area.

    rectLeftElem = document.getElementById("rect-left");
    rectTopElem = document.getElementById("rect-top");
    rectRightElem = document.getElementById("rect-right");
    rectBottomElem = document.getElementById("rect-bottom");
    rectWidthElem = document.getElementById("rect-width");
    rectHeightElem = document.getElementById("rect-height");

    outlineRect = Rect.EMPTY_RECT;
    outlineRectMarchEnabled = false;

    //
    // Sets the outline rect.  Updates the HTML coordinate display.
    // Stops the rect animation on any change.
    //
    //  rect: Rect object to use; may be empty
    //  doShow: if true, add it to the current picture's display set
    //
    setOutlineRect(rect, doShow) {
        Debug.assert(rect instanceof Rect && (doShow == true || doShow == false));
        this.outlineRect = rect;
        if (this.currentPicture !== undefined) {
            // Add it to (or remove it from) the Picture's list of things to draw.
            if (doShow || rect.isEmpty) {
                this.currentPicture.outlineRect = rect;
            }
        }
        if (rect.isEmpty) {
            this.rectLeftElem.textContent = "-";
            this.rectTopElem.textContent = "-";
            this.rectRightElem.textContent = "-";
            this.rectBottomElem.textContent = "-";
            this.rectWidthElem.textContent = "0";
            this.rectHeightElem.textContent = "0";
        } else {
            this.rectLeftElem.textContent = rect.left;
            this.rectTopElem.textContent = rect.top;
            this.rectRightElem.textContent = rect.right - 1;        // show inclusive coords
            this.rectBottomElem.textContent = rect.bottom - 1;
            this.rectWidthElem.textContent = rect.width;
            this.rectHeightElem.textContent = rect.height;
        }
    }

    //
    // Clears the outline rect.
    //
    clearOutlineRect() {
        this.setOutlineRect(Rect.EMPTY_RECT, false);
        this.disableMarch();
    }

    enableMarch() {
        console.log("march enabled");
        this.outlineRectMarchEnabled = true;
        setTimeout(() => this.marchFunc(), 50 /*ms*/);
    }
    disableMarch() {
        if (this.outlineRectMarchEnabled) {
            this.outlineRectMarchEnabled = false;
            console.log("march disabled");      // timeout will fire one more time
        }
    }
    marchFunc() {
        // If the picture is cleared or the outline rect is set to empty, stop animating.
        if (this.currentPicture !== undefined && !this.outlineRect.isEmpty) {
            if (this.outlineRectMarchEnabled) {
                this.currentPicture.incMarch();
                this.drawCurrentPicture();
                setTimeout(() => this.marchFunc(), 50 /*ms*/);
            }
        }
    }

    //
    // Visible clipping object.  If this isn't undefined, we draw the clipping on top of the
    // current picture, with an animated outline rect around it.
    //
    visClipping = undefined;
    inClipDrag = false;

    //
    // Returns true if the specified picture coordinates are inside the active clipping.
    // Returns false if there is no active clipping, or the point is outside.
    //
    isInsideClipping(picX, picY) {
        let result = this.visClipping !== undefined && this.outlineRect.contains(picX, picY);
        // console.log(`isInside: ${picX},${picY} ${this.visClipping} -> ${result}`);
        return result;
    }

    //
    // Clears the clipping and disables marching ants.  The pending undo item is canceled.
    // Does not clear the outline rect.
    //
    clearClipping() {
        if (this.visClipping !== undefined) {
            console.log(`clipping cleared (was ${this.visClipping})`);
            this.visClipping = undefined;
            this.disableMarch();
            // If we were showing the "move" cursor, switch.
            this.picCanvas.style.cursor = this.picCursor;
        }
        if (this.currentPicture !== undefined) {
            // Remove the rendered clip from the screen by canceling the undo item,
            // re-rendering the area it occupied, and redrawing the scren.
            if (this.currentPicture.isUndoContextOpen()) {
                this.currentPicture.closeUndoContext(false);
                this.currentPicture.renderArea(this.dirtyRect);
                this.drawCurrentPicture();
            }
        }
    }

    //
    // Redraws the clipping, e.g. after moving the outline rect.
    //
    redrawClipping() {
        if (this.currentPicture === undefined || this.visClipping === undefined) {
            return;     // no clipping to redraw
        }
        this.currentPicture.revert();
        this.currentPicture.renderArea(this.dirtyRect);
        this.dirtyRect = this.currentPicture.putClipping(this.visClipping,
            this.outlineRect.left, this.outlineRect.top, gSettings.clipXferMode);
        this.drawCurrentPicture();
    }


    // ======================================================================
    // Tools
    // ======================================================================

    // The active tool function receives events:
    // - pointerdown
    // - pointerup
    // - pointermove (between down/up)
    //
    // We use setPointerCapture() to ensure that we get the pointerup event even if the cursor
    // is moved outside the canvas.  We can get mystery pointerups if the pointerdown happened
    // outside the canvas and the cursor was dragged in.
    //
    // Also, pointerup can get lost if we're debugging, so we want to be sure to handle
    // pointerdown while already in a tool.  (We could catch this behavior in the general
    // pointerdown code and send a fake "glitch" event to the active tool to make it clean
    // its state.  Might be simpler to just have the tool pointerdown handlers watch for it.)

    isToolActive = false;
    activeTool = undefined;
    activeToolButton = undefined;

    dirtyRect = undefined;                  // instance of Rect
    startPicX = -1;                         // starting coord for click+drag operations
    startPicY = -1;
    lastPicX = -1;                          // detect if movement actually moved
    lastPicY = -1;

    //
    // Sets the current tool.
    //
    setTool(event, toolFunc) {
        Debug.assert(event.type == "click", "shouldn't be here");   // expecting a Button click
        if (toolFunc == this.activeTool) {
            console.log("tool already selected");
            return;
        }

        // Update selection indicator.
        this.activeToolButton.classList.remove("selected");
        let button = event.currentTarget;
        button.classList.add("selected");
        this.activeToolButton = button;

        this.activeTool = toolFunc;
        this.isToolActive = false;
        console.log("selected tool: " + this.activeToolButton.id);

        // Clear selection and clipping.
        this.clearOutlineRect();
        this.clearClipping();

        if (this.currentPicture !== undefined) {
            if (this.currentPicture.isUndoContextOpen()) {
                // Somehow we're switching tools while drawing, probably by missing a pointerup.
                // We can either discard what they were doing or keep it and let them undo it if
                // they don't like it.
                console.log("HEY: switching tools while undo context is open");
                this.currentPicture.closeUndoContext(true);
            }

            this.drawCurrentPicture();      // in case we cleared sel/clip rect
        }
    }

    //
    // Tool: pan.  Click and drag to move picture around.
    //
    toolPan(event /*, picX, picY*/) {
        // The implementation is shared with right-click, so we don't need to do much here.
        switch (event.type) {
            case "pointerdown":
                this.grabPanActive = true;
                break;
            case "pointerup":
                this.grabPanActive = false;
                break;
        }
    }

    //
    // Tool: select a rectangular area.
    //
    toolSelectRect(event, picX, picY) {
        switch (event.type) {
            case "pointerdown":
                if (this.isInsideClipping(picX, picY)) {
                    console.log("inside clip");
                    this.inClipDrag = true;
                } else {
                    // Clear clipping if we have one.  Create a 1x1 selection rect.
                    this.clearClipping();
                    this.setOutlineRect(Rect.fromCoords(picX, picY, picX, picY), true);
                    this.drawCurrentPicture();
                }
                break;
            case "pointermove":
                if (picX == this.lastPicX && picY == this.lastPicY) {
                    break;      // still in same pixel cell, nothing to do
                }
                if (this.inClipDrag) {
                    if (!this.currentPicture.isUndoContextOpen()) {
                        // should have been opened by cut/copy
                        console.log("can't drag, no context open");
                    } else {
                        // Move rect.
                        this.setOutlineRect(
                            this.outlineRect.translate(picX - this.lastPicX, picY - this.lastPicY),
                            true);
                        this.redrawClipping();
                    }
                } else {
                    this.setOutlineRect(
                        Rect.fromCoords(this.startPicX, this.startPicY, picX, picY), true);
                }
                this.drawCurrentPicture();
                break;
            case "pointerup":
                if (this.inClipDrag) {
                    this.inClipDrag = false;
                }
                break;
        }
    }

    //
    // Tool: scribble.  Click to draw a single pixel, drag to draw more.
    //
    toolScribble(event, picX, picY) {
        switch (event.type) {
            case "pointerdown":
                if (this.currentPicture.isUndoContextOpen()) {
                    break;      // pointerup was missed, e.g. while in debugger
                }
                this.currentPicture.openUndoContext("scribble");
                this.dirtyRect =
                    this.currentPicture.setPixel(picX, picY, this.colorPicker.currentPat);
                this.currentPicture.renderArea(this.dirtyRect);
                this.drawCurrentPicture();
                break;
            case "pointermove":
                if (picX == this.lastPicX && picY == this.lastPicY) {
                    break;
                }
                // Draw a thin line so we don't get gaps if the mouse is moved quickly.
                this.dirtyRect =
                    this.currentPicture.drawLine(this.startPicX, this.startPicY,
                        picX, picY, this.colorPicker.currentPat, Picture.STROKE_THIN);
                this.drawCurrentPicture();
                // Move the "start" point.
                this.startPicX = picX;
                this.startPicY = picY;
                break;
            case "pointerup":
                this.currentPicture.closeUndoContext(true);
                this.drawCurrentPicture();      // update the is-dirty indicator
                break;
        }
    }

    //
    // Tool: draw line.  Click to set the start point, drag, release to draw.
    //
    toolLine(event, picX, picY) {
        // console.log(`line: ${event.type} ${event.offsetX},${event.offsetY}`);
        switch (event.type) {
            case "pointerdown":
                if (this.currentPicture.isUndoContextOpen()) {
                    break;      // pointerup was missed, e.g. while in debugger
                }
                this.currentPicture.openUndoContext("line");
                this.dirtyRect = this.currentPicture.drawLine(picX, picY, picX, picY,
                    this.colorPicker.currentPat, gStylePicker.strokeStyle);
                this.drawCurrentPicture();
                break;
            case "pointermove":
                if (!this.currentPicture.isUndoContextOpen()) {
                    break;      // pointerdown happened outside the canvas
                }
                if (picX == this.lastPicX && picY == this.lastPicY) {
                    break;
                }
                // Erase previous line, draw new.
                this.currentPicture.revert();
                this.currentPicture.renderArea(this.dirtyRect);
                this.dirtyRect = this.currentPicture.drawLine(this.startPicX, this.startPicY,
                    picX, picY, this.colorPicker.currentPat, gStylePicker.strokeStyle);
                this.drawCurrentPicture();
                break;
            case "pointerup":
                this.currentPicture.closeUndoContext(true);
                this.drawCurrentPicture();      // update the is-dirty indicator
                break;
        }
    }

    //
    // Tool: draw stroke/filled rect.  Click to set one corner, drag any direction to set size.
    //
    toolStrokeRect(event, picX, picY) {
        this.doRect(event, picX, picY, false);
    }
    toolFillRect(event, picX, picY) {
        this.doRect(event, picX, picY, true);
    }
    doRect(event, picX, picY, doFill) {
        // console.log(`rect: ${event.type} ${event.offsetX},${event.offsetY} pic ${picX},${picY}`);
        switch (event.type) {
            case "pointerdown":
                if (this.currentPicture.isUndoContextOpen()) {
                    break;
                }
                this.currentPicture.openUndoContext(`rect(${doFill})`);
                if (doFill) {
                    this.dirtyRect = this.currentPicture.drawFillRect(picX, picY, picX, picY,
                        this.colorPicker.currentPat);
                } else {
                    this.dirtyRect = this.currentPicture.drawStrokeRect(picX, picY, picX, picY,
                        this.colorPicker.currentPat, gStylePicker.strokeStyle);
                }
                this.drawCurrentPicture();
                this.setOutlineRect(Rect.fromCoords(picX, picY, picX, picY),
                    this.colorPicker.isPatTransparent);
                break;
            case "pointermove":
                if (!this.currentPicture.isUndoContextOpen()) {
                    break;      // pointerdown happened outside the canvas
                }
                if (picX == this.lastPicX && picY == this.lastPicY) {
                    break;
                }
                this.currentPicture.revert();
                this.currentPicture.renderArea(this.dirtyRect);
                if (doFill) {
                    this.dirtyRect = this.currentPicture.drawFillRect(
                        this.startPicX, this.startPicY, picX, picY,
                        this.colorPicker.currentPat);
                } else {
                    this.dirtyRect = this.currentPicture.drawStrokeRect(
                        this.startPicX, this.startPicY, picX, picY,
                        this.colorPicker.currentPat, gStylePicker.strokeStyle);
                }
                // Draw the selection rect if we're drawing a transparent pattern.
                this.setOutlineRect(Rect.fromCoords(this.startPicX, this.startPicY, picX, picY),
                    this.colorPicker.isPatTransparent);
                this.drawCurrentPicture();
                break;
            case "pointerup":
                this.currentPicture.closeUndoContext(true);
                this.clearOutlineRect();
                this.drawCurrentPicture();
                break;
        }
    }

    //
    // Tool: draw stroke/filled ellipse.  Click to set one corner, drag any direction to set size.
    //
    toolStrokeEllipse(event, picX, picY) {
        this.doEllipse(event, picX, picY, false);
    }
    toolFillEllipse(event, picX, picY) {
        this.doEllipse(event, picX, picY, true);
    }
    doEllipse(event, picX, picY, doFill) {
        // console.log(`ellipse: ${event.type} ${event.offsetX},${event.offsetY}`);
        switch (event.type) {
            case "pointerdown":
                if (this.currentPicture.isUndoContextOpen()) {
                    break;
                }
                this.currentPicture.openUndoContext(`ellipse(${doFill})`);
                if (doFill) {
                    this.dirtyRect = this.currentPicture.drawFillEllipse(picX, picY, picX, picY,
                        this.colorPicker.currentPat);
                } else {
                    this.dirtyRect = this.currentPicture.drawStrokeEllipse(picX, picY, picX, picY,
                        this.colorPicker.currentPat, gStylePicker.strokeStyle);
                }
                this.setOutlineRect(Rect.fromCoords(picX, picY, picX, picY), true);
                this.drawCurrentPicture();
                break;
            case "pointermove":
                if (!this.currentPicture.isUndoContextOpen()) {
                    break;      // pointerdown happened outside the canvas
                }
                if (picX == this.lastPicX && picY == this.lastPicY) {
                    break;
                }
                this.currentPicture.revert();
                this.currentPicture.renderArea(this.dirtyRect);
                if (doFill) {
                    this.dirtyRect = this.currentPicture.drawFillEllipse(
                        this.startPicX, this.startPicY, picX, picY,
                        this.colorPicker.currentPat);
                } else {
                    this.dirtyRect = this.currentPicture.drawStrokeEllipse(
                        this.startPicX, this.startPicY, picX, picY,
                        this.colorPicker.currentPat, gStylePicker.strokeStyle);
                }
                this.setOutlineRect(
                    Rect.fromCoords(this.startPicX, this.startPicY, picX, picY), true);
                this.drawCurrentPicture();
                break;
            case "pointerup":
                this.currentPicture.closeUndoContext(true);
                this.clearOutlineRect();
                this.drawCurrentPicture();
                break;
        }
    }

    //
    // Tool: draw text into a clipping, or move the clipping around.
    //
    toolText(event, picX, picY) {
        switch (event.type) {
            case "pointerdown":
                if (this.isInsideClipping(picX, picY)) {
                    console.log("inside clip");
                    this.inClipDrag = true;
                } else {
                    // do nothing
                }
                break;
            case "pointermove":
                // This is essentially a clone of the toolSelectRect code.  We could have just
                // switched the active tool, but that would be tedious if you wanted to enter
                // multiple text items.
                if (picX == this.lastPicX && picY == this.lastPicY) {
                    break;      // still in same pixel cell, nothing to do
                }
                if (this.inClipDrag) {
                    if (!this.currentPicture.isUndoContextOpen()) {
                        // should have been opened by cut/copy
                        console.log("can't drag, no context open");
                    } else {
                        // Move rect.
                        this.setOutlineRect(
                            this.outlineRect.translate(picX - this.lastPicX, picY - this.lastPicY),
                            true);
                        this.redrawClipping();
                    }
                }
                this.drawCurrentPicture();
                break;
            case "pointerup":
                if (this.inClipDrag) {
                    this.inClipDrag = false;
                    break;
                }
                if (this.currentPicture.isUndoContextOpen()) {
                    // A clipping is open, so cancel it.
                    console.log("canceling text in progress");
                    this.clearClipping();
                    this.clearOutlineRect();
                    this.drawCurrentPicture();
                    break;      // confused
                }
                // Just open the dialog.  The actual work happens in the callback.
                this.textPicX = this.lastPicX;
                this.textPicY = this.lastPicY;
                gTextEntry.showDialog();
                break;
        }
    }
    textPicX = -1;
    textPicY = -1;
    onTextEntered(str) {
        // Draw text string into a bitmap.
        let [array,stride,width] = gFontPicker.currentFont.drawText(str);
        console.log(`text: str='${str}'(${str.length}) -> ` +
            `len=${array.length} st=${stride} w=${width}`);
        // Generate a clipping from the bitmap.
        let clipping = this.currentPicture.bitmapToClipping(array, stride, width,
            this.colorPicker.currentPat);
        console.log("  clipping: " + clipping);
        // Set up the clipping as if we copied it from offscreen.  The initial location is
        // the coordinates where the user clicked.
        this.setOutlineRect(
            new Rect(this.textPicX, this.textPicY, clipping.width, clipping.height), true);
        this.visClipping = clipping;
        this.enableMarch();
        // Show it on the screen.  From here on it works like copy/paste.
        this.currentPicture.openUndoContext("text");
        this.dirtyRect = this.currentPicture.putClipping(this.visClipping,
            this.outlineRect.left, this.outlineRect.top, gSettings.clipXferMode);
        this.drawCurrentPicture();
    }

    //
    // Tool: flood fill.
    //
    toolFloodFill(event, picX, picY) {
        switch (event.type) {
            case "pointerdown":
                if (this.currentPicture.isUndoContextOpen()) {
                    break;      // confused
                }
                this.currentPicture.openUndoContext("flood-fill");
                this.dirtyRect =
                    this.currentPicture.drawFloodFill(picX, picY, this.colorPicker.currentPat);
                this.currentPicture.closeUndoContext(!this.dirtyRect.isEmpty);
                this.drawCurrentPicture();
                break;
            case "pointermove":
            case "pointerup":
                break;
        }
    }

    // ======================================================================
    // Mouse & picture canvas
    // ======================================================================

    mouseInCanvas = false;      // true when mouse is in picture canvas
    xposnElem = document.getElementById("xposn");
    yposnElem = document.getElementById("yposn");
    mousePicX = -1;
    mousePicY = -1;
    picCursor = "crosshair";

    mGrabPanActive = false;
    get grabPanActive() { return this.mGrabPanActive; }
    set grabPanActive(value) {
        if (value) {
            this.mGrabPanActive = true;
            this.picCanvas.style.cursor = this.picCursor = "grabbing";
        } else {
            this.mGrabPanActive = false;
            this.picCanvas.style.cursor = this.picCursor = "crosshair";
        }
    }

    //
    // Converts canvas coordinates to picture coordinates, factoring in the current zoom
    // and pan.  Returns [-1,-1] if there is no picture.  If the specified coordinate is outside
    // the picture, or entirely outside the canvas, this will either return [-1,-1] or a
    // clamped coordinate within the picture, depending on the "doClamp" argument.
    //
    //  canvasX, canvasY: offset from top-left corner of canvas (e.g. from mousemove event)
    //  doClamp: if true, clamp position to fall within picture
    //  (returns): [X,Y] picture coordinates
    //
    canvasToPictureCoords(canvasX, canvasY, doClamp) {
        if (this.currentPicture === undefined) {
            return [-1, -1];
        }
        let scaledCenterX = this.currentPicture.scaledCenterX;
        let scaledCenterY = this.currentPicture.scaledCenterY;
        let leftEdge = Math.trunc((this.picCanvas.width / 2) - scaledCenterX);
        let topEdge = Math.trunc((this.picCanvas.height / 2) - scaledCenterY);
        let picX = Math.trunc((canvasX - leftEdge) / this.pictureScale);
        let picY = Math.trunc((canvasY - topEdge) / this.pictureScale);
        if (picX < 0 || picY < 0 ||
                picX >= this.currentPicture.width || picY >= this.currentPicture.height) {
            if (doClamp) {
                picX = Math.max(0, Math.min(picX, this.currentPicture.width - 1));
                picY = Math.max(0, Math.min(picY, this.currentPicture.height - 1));
            } else {
                picX = picY = -1;
            }
        }
        return [picX, picY];
    }

    handleCanvasPointerEnter() {
        this.mouseInCanvas = true;
    }
    handleCanvasPointerLeave() {
        this.mouseInCanvas = false;
        this.mousePicX = this.mousePicY = -1;
        this.xposnElem.textContent = this.yposnElem.textContent = "-";
    }
    handleCanvasPointerDown(event) {
        if (event.button === this.LEFT_BUTTON) {
            if (this.currentPicture !== undefined) {
                this.isToolActive = true;
                this.picCanvas.setPointerCapture(event.pointerId);
                let [picX, picY] = this.canvasToPictureCoords(event.offsetX, event.offsetY, true);
                this.activeTool(event, picX, picY);
                this.startPicX = this.lastPicX = picX;
                this.startPicY = this.lastPicY = picY;
            }
        } else if (event.button === this.RIGHT_BUTTON) {
            event.preventDefault();
            // If we're inside the picture, grab it for panning.
            let [xc,] = this.canvasToPictureCoords(event.offsetX, event.offsetY, false);
            if (xc >= 0) {
                this.grabPanActive = true;
                // Capture the pointer, so that panning continues even if the pointer
                // moves outside the canvas.  More importantly, the pointer capture stuff
                // will send us a pointerup event when the mouse button is released, even
                // if it's outside the window, so we can reset the mouse cursor.
                this.picCanvas.setPointerCapture(event.pointerId);
            }
        }
    }
    handleCanvasPointerUp(event) {
        if (event.button == this.LEFT_BUTTON) {
            if (this.currentPicture !== undefined) {
                if (this.isToolActive) {
                    let [picX, picY] =
                        this.canvasToPictureCoords(event.offsetX, event.offsetY, true);
                    this.activeTool(event, picX, picY);
                    this.lastPicX = this.lastPicY = -1;
                }
                this.isToolActive = false;
            }
        } else if (event.button == this.RIGHT_BUTTON && this.grabPanActive) {
            // Note: calling preventDefault() here doesn't prevent the context menu from
            // opening; that's a different event.
            event.preventDefault();
            if (this.grabPanActive) {
                // Restore cursor.
                this.grabPanActive = false;
            }
        }
    }
    handleCanvasPointerMove(event) {
        let [picX, picY] = this.canvasToPictureCoords(event.offsetX, event.offsetY, false);
        // console.log(`offset ${picX},${picY}`);
        if (picX < 0) {
            this.xposnElem.textContent = this.yposnElem.textContent = "-";
        } else {
            if (this.grabPanActive) {
                // console.log(`pan: ${event.movementX} ${event.movementY}`);
                this.currentPicture.shiftCenter(-event.movementX, -event.movementY,
                    this.picCanvas.width, this.picCanvas.height);
                this.drawCurrentPicture();
                // Re-compute the position of the mouse cursor within the image, now that
                // we have shifted the image.  If we don't do this, the displayed pointer
                // X,Y position will flicker between adjacent values as we move.
                [picX, picY] = this.canvasToPictureCoords(event.offsetX, event.offsetY, false);
            }
            // Inside canvas, update pixel coordinate display.
            this.xposnElem.textContent = picX;
            this.yposnElem.textContent = picY;
        }
        // Track this at all times for mouse-wheel zoom.
        this.mousePicX = picX;
        this.mousePicY = picY;

        if (this.isToolActive) {
            // Convert coords again, this time with clamping.
            [picX, picY] = this.canvasToPictureCoords(event.offsetX, event.offsetY, true);
            this.activeTool(event, picX, picY);
            this.lastPicX = picX;
            this.lastPicY = picY;
        }

        // Switch to the 4-way-arrow cursor when inside a clipping rect.  We want to use the
        // clamped coords for consistency.
        if (this.isInsideClipping(picX, picY)) {
            this.picCanvas.style.cursor = "move";
        } else {
            this.picCanvas.style.cursor = this.picCursor;
        }
    }
    handleCanvasWheel(event) {
        event.preventDefault();
        let redraw = false;
        if (event.deltaY > 0) {
            // down -> zoom out
            if (this.pictureScaleIndex > 0) {
                this.pictureScaleIndex--;
                redraw = true;
            }
        } else {
            // up -> zoom in
            if (this.pictureScaleIndex < this.scaleMults.length - 1) {
                this.pictureScaleIndex++;
                redraw = true;
            }
        }
        if (redraw && this.currentPicture != undefined) {
            // Try to shift the center to the mouse location.
            let centerX = (this.mousePicX < 0) ? 0 : this.mousePicX;
            let centerY = (this.mousePicY < 0) ? 0 : this.mousePicY;
            this.currentPicture.setScaledCenter(centerX * this.currentPicture.scale,
                centerY * this.currentPicture.scale,
                this.picCanvas.width, this.picCanvas.height);
            this.drawCurrentPicture();
        }
    }

    inPannerPan = false;
    handlePannerPointerDown(event) {
        if (event.button == this.LEFT_BUTTON) {
            event.preventDefault();
            if (this.currentPicture != undefined) {
                this.inPannerPan = true;
                this.pannerCanvas.setPointerCapture(event.pointerId);
                this.setCenterFromPanner(event.offsetX, event.offsetY);
                this.pannerCanvas.style.cursor = "grabbing";
            }
        }
    }
    handlePannerPointerUp(event) {
        if (event.button == this.LEFT_BUTTON && this.inPannerPan) {
            event.preventDefault();
            this.inPannerPan = false;
            this.pannerCanvas.style.cursor = "grab";
        }
    }
    handlePannerPointerMove(event) {
        if (this.inPannerPan) {
            this.setCenterFromPanner(event.offsetX, event.offsetY);
            this.drawCurrentPicture();
        }
    }
    setCenterFromPanner(panX, panY) {
        // Panner is half size, so mult should be 2.
        const mult = Math.round(this.currentPicture.width / this.pannerCanvas.clientWidth);
        if (mult != 2) {
            console.log("panner mult=" + mult);
        }
        this.currentPicture.setScaledCenter(panX * mult * this.currentPicture.scale,
            panY * mult * this.currentPicture.scale,
            this.picCanvas.width, this.picCanvas.height);
        this.drawCurrentPicture();
    }
    handlePannerWheel(event) {
        event.preventDefault();
        let redraw = false;
        if (event.deltaY > 0) {
            // down -> zoom out
            if (this.pictureScaleIndex > 0) {
                this.pictureScaleIndex--;
                redraw = true;
            }
        } else {
            // up -> zoom in
            if (this.pictureScaleIndex < this.scaleMults.length - 1) {
                this.pictureScaleIndex++;
                redraw = true;
            }
        }
        if (redraw && this.currentPicture != undefined) {
            // Don't move the center, just zoom in closer.  We still need to call the shift
            // code in case we zoom out far enough that we want to snap inside window bounds.
            this.currentPicture.shiftCenter(0, 0, this.picCanvas.width, this.picCanvas.height);
            this.drawCurrentPicture();
        }
    }
}

// Create singleton instance of this class.
const imgEdit = new ImageEditor();

// Initialize style picker dialog.
const gStylePicker = new StylePicker(imgEdit);

// Initialize color picker dialog.  This generates HTML elements.
const gColorPickerHgr = new ColorPickerHgr(imgEdit);

// Initialize font picker dialog.
const gFontPicker = new FontPicker(imgEdit);

// Initialize text entry dialog.
const gTextEntry = new TextEntry(imgEdit);

// Initialize settings dialog.
const gSettings = new Settings(imgEdit);
// Configure defaults.
gColorPickerHgr.colorSwatchClose = gSettings.colorSwatchClose;

const gAbout = new About();
