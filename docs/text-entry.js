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

//
// Text entry implementation.  This implements the <dialog> in the editor page.
//
// This class must be instantiated exactly once.
//
export default class TextEntry {
    static isInitialized = false;

    constructor(mainObj) {
        if (TextEntry.isInitialized != false) {
            throw new Error("TextEntry initialized twice");
        }

        this.mainObj = mainObj;

        this.dialog = document.getElementById("text-entry");
        this.textBoxElem = document.getElementById("text-entry-input");
        this.okButtonElem = document.getElementById("text-entry-ok");

        this.textBoxElem.addEventListener("keypress", this.handleKeyInput.bind(this));
        this.okButtonElem.addEventListener("click", this.handleDone.bind(this));

        TextEntry.isInitialized = true;
        console.log("TextEntry initialized");
    }

    //
    // Shows the text-entry dialog.
    //
    showDialog() {
        this.textBoxElem.value = "";        // clear field
        this.dialog.showModal();
    }

    //
    // Catches key input events, so we can close the dialog when the user hits Enter.
    //
    // (We might also be able to use this to react to entry of characters that aren't
    // represented in the selected font.)
    //
    handleKeyInput(event) {
        if (event.key == "Enter") {
            event.preventDefault();
            this.okButtonElem.click();
        }
    }

    //
    // Handles a click on the "OK" button.
    //
    handleDone() {
        let str = this.textBoxElem.value;
        this.dialog.close();
        if (str.length > 0) {
            this.mainObj.onTextEntered(str);
        }
    }
}
