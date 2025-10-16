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

import Picture from "./lib/picture.js";

//
// Style picker implementation.
//
// This class must be instantiated exactly once.
//
export default class StylePicker {
    static isInitialized = false;

    SELECTED = "selected";                  // CSS class indicating button is selected
    STYLE_STROKE_PREFIX = "style-stroke-";  // common prefix used on HTML button IDs
    strokeList = [
        Picture.STROKE_THIN,
        Picture.STROKE_THICK,
        Picture.STROKE_APPLESOFT
    ];

    // currently selected stroke style
    strokeStyle = Picture.STROKE_THICK;
    // button associated with current stroke style
    strokeButton = document.getElementById(this.STYLE_STROKE_PREFIX + Picture.STROKE_THICK);

    constructor() {
        if (StylePicker.isInitialized != false) {
            throw new Error("StylePicker initialized twice");
        }

        let dialog = document.getElementById("style-picker");

        for (let strokeName of this.strokeList) {
            let buttonName = this.STYLE_STROKE_PREFIX + strokeName;
            let button = document.getElementById(buttonName);

            button.addEventListener("click", (event) => {
                this.handleStrokeClick(event, strokeName);
            });
            button.addEventListener("dblclick", (event) => {
                this.handleStrokeClick(event, strokeName);
            });
        }

        // Mark button for highlight.
        this.strokeButton.classList.add(this.SELECTED);

        let closeButton = document.getElementById("style-picker-close");
        closeButton.addEventListener("click", () => {
            dialog.close();
        });

        StylePicker.isInitialized = true;
        console.log("StylePicker initialized");
    }

    showDialog() {
        document.getElementById("style-picker").showModal();
    }

    //
    // Handles a click on any of the stroke-width buttons.
    //
    handleStrokeClick(event, strokeName) {
        let button = event.currentTarget;
        this.strokeStyle = strokeName;
        this.strokeButton.classList.remove(this.SELECTED);
        this.strokeButton = button;
        button.classList.add(this.SELECTED);
        if (event.type === "dblclick") {
            document.getElementById("style-picker").close();
        }
    }
}
