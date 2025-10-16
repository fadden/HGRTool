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

import Clipping from "./lib/clipping.js";

//
// Implements the Settings dialog, and holds the actual settings.
//
export default class Settings {
    static isInitialized = false;

    static PROTECT_EDITS = true;        // disable this feature when debugging

    static SWATCH_CLOSE_SINGLE = "single";
    static SWATCH_CLOSE_DOUBLE = "double";

    // The application settings are stored in window.localStorage.
    get colorSwatchClose() { return localStorage.colorSwatchClose; }
    set colorSwatchClose(value) { localStorage.colorSwatchClose = value; }
    get clipXferMode() { return localStorage.clipXferMode; }
    set clipXferMode(value) { localStorage.clipXferMode = value; }

    constructor(mainObj) {
        if (Settings.isInitialized != false) {
            throw new Error("Settings initialized twice");
        }

        this.mainObj = mainObj;

        // console.log("Contents of localStorage:");
        // for (let key in localStorage) {
        //     console.log(` ${key}=${localStorage.getItem(key)}`);
        // }

        this.dialog = document.getElementById("settings");
        document.getElementById("settings-ok").addEventListener("click", () => {
            this.dialog.close();
        });

        // Radio buttons.
        this.swatchSingleElem = document.getElementById("setting-swatch-single");
        this.swatchDoubleElem = document.getElementById("setting-swatch-double");
        this.xferCopyElem = document.getElementById("setting-xfer-copy");
        this.xferMergeElem = document.getElementById("setting-xfer-merge");
        this.xferXORElem = document.getElementById("setting-xfer-xor");

        let buttons = document.querySelectorAll("input[name=\"swatch\"]");
        for (let button of buttons) {
            button.addEventListener("change", this.handleRadioChange.bind(this));
        }
        buttons = document.querySelectorAll("input[name=\"xfer-mode\"]");
        for (let button of buttons) {
            button.addEventListener("change", this.handleRadioChange.bind(this));
        }

        // Initialize settings to defaults if no value is stored, or the stored value is bad.
        // Configure controls.
        switch (this.colorSwatchClose) {
            case Settings.SWATCH_CLOSE_DOUBLE:
            default:
                this.colorSwatchClose = Settings.SWATCH_CLOSE_DOUBLE;
                this.swatchDoubleElem.checked = true;
                break;
            case Settings.SWATCH_CLOSE_SINGLE:
                this.swatchSingleElem.checked = true;
                break;
        }
        switch (this.clipXferMode) {
            case Clipping.XFER_COPY:
            default:
                this.xferCopyElem.checked = true;
                this.clipXferMode = Clipping.XFER_COPY;
                break;
            case Clipping.XFER_MERGE:
                this.xferMergeElem.checked = true;
                break;
            case Clipping.XFER_XOR:
                this.xferXORElem.checked = true;
                break;
        }

        Settings.isInitialized = true;
        console.log("Settings initialized");
    }

    toString() {
        return `[Settings swClose=${this.colorSwatchClose} xferMode=${this.clipXferMode}]`;
    }

    showDialog() {
        this.dialog.showModal();
    }

    //
    // Handles a click on any of the radio buttons.
    //
    handleRadioChange(event) {
        let target = event.currentTarget;
        switch (target.value) {
            case Settings.SWATCH_CLOSE_SINGLE:
            case Settings.SWATCH_CLOSE_DOUBLE:
                this.colorSwatchClose = target.value;
                break;
            case Clipping.XFER_COPY:
            case Clipping.XFER_MERGE:
            case Clipping.XFER_XOR:
                this.clipXferMode = target.value;
                break;
            default:
                throw new Error("unexpected radio button value: " + target.value);
        }

        // Do this here, not on close, because we don't revert the settings if ESC is hit.
        this.mainObj.onSettingsChanged();
    }
}
