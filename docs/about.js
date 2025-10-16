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

import VERSION from "./version.js";

//
// Implements the "about" box.
//
export default class About {
    constructor() {
        this.dialog = document.getElementById("about");
        document.getElementById("about-ok").addEventListener("click", () => {
            this.dialog.close();
        });

        let versionTextElem = document.getElementById("about-version");
        versionTextElem.innerText = VERSION;

        // This will complete later.
        this.fetchLegalStuff();

        console.log("About initialized");
    }

    showDialog() {
        document.getElementById("about-legal-stuff").value = this.legalStuff
        this.dialog.showModal();
    }

    //
    // Retrieves "LegalStuff.txt" from the web server and puts it in the About box.
    //
    async fetchLegalStuff() {
        console.log("(fetching legalities)");
        let response = await fetch("./LegalStuff.txt");
        let text;
        if (response.ok) {
            text = await response.text();
        } else {
            text = "[ unable to retrieve LegalStuff.txt ]";
        }

        // If I set the <textarea> value here, Chrome usually loses the line breaks, and shows
        // it as one long line.  This appears to be a race condition.  Deferring the set until
        // the dialog is opened seems to avoid the problem.  (Edge works correctly either way.)
        this.legalStuff = text;

        console.log("(legalities fetched)");
    }
}
