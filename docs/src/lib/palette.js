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
// Apple II color palette, for lo-res, hi-res, and double hi-res.  The colors were selected
// to match Apple IIgs RGB output.
//
// RGBA8888 format.
//
const gColorPalette = new Map([
    [ "Black",      0x000000ff ],
    [ "DeepRed",    0xdd0033ff ],
    [ "DarkBlue",   0x000099ff ],
    [ "Purple",     0xdd22ddff ],
    [ "DarkGreen",  0x007722ff ],
    [ "DarkGray",   0x555555ff ],
    [ "MediumBlue", 0x2222ffff ],
    [ "LightBlue",  0x66aaffff ],
    [ "Brown",      0x885500ff ],
    [ "Orange",     0xff6600ff ],
    [ "LightGray",  0xaaaaaaff ],
    [ "Pink",       0xff9988ff ],
    [ "LightGreen", 0x11dd00ff ],
    [ "Yellow",     0xffff00ff ],
    [ "Aquamarine", 0x44ff99ff ],
    [ "White",      0xffffffff ]
]);
export default gColorPalette;
