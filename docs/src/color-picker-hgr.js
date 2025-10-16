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
import Debug from "./lib/debug.js";
import Settings from "./settings.js";

//
// Color picker implementation for Apple II standard hi-res images.  This implements the <dialog>
// in the main editor page.  The swatch buttons in the dialog are created dynamically by the
// class constructor.
//
// This class must be instantiated exactly once.
//
// The current color is maintained here, so that it doesn't change when you switch between
// images, unless you switch between images of different types (e.g. HGR vs. DHGR).
//
export default class ColorPickerHgr {
    static isInitialized = false;

    SELECTED = "selected";
    BUTTON_CLASS = "swatch-button";
    CANVAS_CLASS = "swatch-canvas";
    CANVAS_WIDTH = 56;
    CANVAS_HEIGHT = 56;

    // Currently-selected color pattern.
    mCurrentPat = undefined;
    get currentPat() { return this.mCurrentPat; }
    set currentPat(value) {
        Debug.assert(value !== undefined && value.length == 8, "bad pattern " + value);
        this.mCurrentPat = value;
    }
    get isPatTransparent() {
        return this.currentPat == StdHiRes.HI_BIT_CLEAR || this.currentPat == StdHiRes.HI_BIT_SET;
    }

    // Button associated with current color.
    currentButton = undefined;

    colorSwatchClose = undefined;

    solidPats = StdHiRes.getSolidPatterns();
    ditherPats = StdHiRes.getDitherPatterns();
    solidButtons = [];
    ditherButtons = [];

    //
    // Initializes the standard hi-res color picker.
    //
    // We need to generate HTML buttons and render a canvas for each.  This likely isn't cheap,
    // but we only have to do it once.
    //
    constructor(mainObj) {
        if (ColorPickerHgr.isInitialized != false) {
            throw new Error("ColorPicker HGR initialized twice");
        }

        this.mainObj = mainObj;

        let dialog = document.getElementById("color-picker-hgr");
        let closeButton = document.getElementById("hgr-picker-close");
        closeButton.addEventListener("click", () => {
            dialog.close();
        });

        let solidParts = document.getElementById("hgr-color-body");
        for (let index = 0; index < this.solidPats.length; index++) {
            let pat = this.solidPats[index];
            let button = this.createHgrSwatchButton(pat);
            button.addEventListener("click", (event) => {
                this.handleSwatchClick(event, true, index);
            });
            button.addEventListener("dblclick", (event) => {
                this.handleSwatchClick(event, true, index);
            });
            solidParts.append(button);
            this.solidButtons.push(button);
        }

        let ditherParts = document.getElementById("hgr-dither-body");
        for (let index = 0; index < this.ditherPats.length; index++) {
            let pat = this.ditherPats[index];
            let button = this.createHgrSwatchButton(pat);
            button.addEventListener("click", (event) => {
                this.handleSwatchClick(event, false, index);
            });
            button.addEventListener("dblclick", (event) => {
                this.handleSwatchClick(event, false, index);
            });
            ditherParts.append(button);
            this.ditherButtons.push(button);
        }

        this.setColor(true, 3);

        ColorPickerHgr.isInitialized = true;
        console.log("ColorPicker HGR initialized");
    }

    //
    // Creates a new HTML element filled with the specified color pattern.
    //
    createHgrSwatchButton(pat) {
        Debug.assert(pat !== undefined, `bad pat arg ${pat}`);
        let button = document.createElement("button");
        button.className = this.BUTTON_CLASS;
        let canvas = document.createElement("canvas");
        canvas.className = this.CANVAS_CLASS;
        canvas.width = this.CANVAS_WIDTH;
        canvas.height = this.CANVAS_HEIGHT;

        let ctx = canvas.getContext("2d");
        this.drawColorSwatch(ctx, pat, false);

        button.append(canvas);
        return button;
    }

    //
    // Draws a color swatch on a canvas, filling it completely.
    //
    drawColorSwatch(ctx, pat, asMono) {
        let canvas = ctx.canvas;
        // console.log(`draw color swatch: ${canvas.width}x${canvas.height} ` +
        //     `client ${canvas.clientWidth}x${canvas.clientHeight}`);
        ctx.imageSmoothingEnabled = false;      // prevent blurry upscaling
        if (pat == StdHiRes.HI_BIT_CLEAR) {
            let gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, "black");
            gradient.addColorStop(0.5, "#404040");
            gradient.addColorStop(1, "white");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else if (pat == StdHiRes.HI_BIT_SET) {
            let gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, "white");
            gradient.addColorStop(0.5, "#404040");
            gradient.addColorStop(1, "black");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
            let imageData = StdHiRes.renderSwatch(canvas.width, canvas.height, pat, asMono);
            ctx.putImageData(imageData, 0, 0);
        }
    }

    handleSwatchClick(event, isSolidColor, index) {
        // console.log("Swatch click (" + this + "): " + isSolidColor + " - " + index);
        this.setColor(isSolidColor, index);
        this.mainObj.onColorChanged();
        if (event.type === "dblclick" || this.colorSwatchClose == Settings.SWATCH_CLOSE_SINGLE) {
            document.getElementById("color-picker-hgr").close();
        }
    }

    setColor(isSolidColor, index) {
        // Update the selected item.
        let oldButton = this.currentButton;
        if (oldButton !== undefined) {
            oldButton.classList.remove(this.SELECTED);
        }
        let newButton, newPat;
        if (isSolidColor) {
            newButton = this.solidButtons[index];
            newPat = this.solidPats[index];
        } else {
            newButton = this.ditherButtons[index];
            newPat = this.ditherPats[index];
        }
        newButton.classList.add(this.SELECTED);
        this.currentPat = newPat;
        this.currentButton = newButton;
    }
}
