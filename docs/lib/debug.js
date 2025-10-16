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
// Debugging helper functions.
//
export default class Debug {
    // Set to false to disable assertions.  The boolean condition is evaluated at the call site,
    // so this doesn't actually save much time.
    static ENABLED = true;

    constructor() { throw new Error("do not instantiate"); }

    //
    // Asserts that a condition is true.  Throws an Error if it is not.
    //
    //  condition: boolean condition to test
    //  message: (optional) message to log
    //
    static assert(condition, message) {
        if (!Debug.ENABLED) {
            return;
        }
        if (typeof condition !== "boolean") {
            throw new Error("invalid assert condition");
        }
        if (!condition) {
            throw new Error(message || "assertion failed");
        }
    }
}
