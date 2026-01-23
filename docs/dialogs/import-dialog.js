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

import ImageDither from "../lib/image-dither.js";
import NTSCRenderer from "../lib/ntsc-renderer.js";
import { FileInputHandler } from "../file-input-handler.js";

/**
 * Progress modal for showing conversion progress.
 */
export class ProgressModal {
    constructor() {
        this.dialog = document.getElementById('progress-modal');
        this.messageElem = document.getElementById('progress-message');
        this.progressBar = document.getElementById('progress-bar');
        this.progressPercent = document.getElementById('progress-percent');
        this.cancelButton = document.getElementById('progress-cancel');
        this.cancelCallback = null;
        this.cancelled = false;

        // Bind cancel handler
        this.cancelButton.addEventListener('click', () => {
            this.cancelled = true;
            if (this.cancelCallback) {
                this.cancelCallback();
            }
            this.hide();
        });
    }

    /**
     * Show the progress modal.
     * @param {string} message - Message to display
     * @param {Function} cancelCallback - Optional callback when cancel is clicked
     */
    show(message, cancelCallback = null) {
        this.messageElem.textContent = message;
        this.cancelCallback = cancelCallback;
        this.cancelled = false;
        this.updateProgress(0);
        this.dialog.showModal();
    }

    /**
     * Update progress bar.
     * @param {number} percent - Progress percentage (0-100)
     */
    updateProgress(percent) {
        const clampedPercent = Math.max(0, Math.min(100, percent));
        this.progressBar.style.width = `${clampedPercent}%`;
        this.progressPercent.textContent = `${Math.round(clampedPercent)}%`;
    }

    /**
     * Hide the progress modal.
     */
    hide() {
        this.dialog.close();
        this.cancelCallback = null;
    }

    /**
     * Check if conversion was cancelled.
     * @returns {boolean}
     */
    isCancelled() {
        return this.cancelled;
    }
}

/**
 * Import dialog with preview and NTSC adjustment controls.
 */
export class ImportDialog {
    constructor(mainObj) {
        this.mainObj = mainObj;
        this.imageData = null;
        this.originalFile = null;
        this.previewUpdateTimeout = null;
        this.previewAbortController = null; // Track active preview operation
        this.progressModal = new ProgressModal();
        this.ntscRenderer = new NTSCRenderer();
        this.pasteHandler = null;

        // Track preview state for convert button optimization
        this.lastPreviewSettings = null; // Store settings used for last preview
        this.lastPreviewResult = null;   // Store preview HGR data

        // DOM elements
        this.dialog = document.getElementById('import-dialog');
        this.previewCanvas = document.getElementById('import-preview-canvas');
        this.previewCtx = this.previewCanvas.getContext('2d');
        this.previewSpinner = document.getElementById('import-preview-spinner');
        this.previewSpinnerPercent = this.previewSpinner.querySelector('.spinner-percent');

        // Set canvas to NTSC resolution (560x192) for proper color rendering
        this.previewCanvas.width = 560;
        this.previewCanvas.height = 192;

        // File selection elements
        this.fileSelectionSection = document.getElementById('import-file-selection');
        this.previewSection = document.getElementById('import-preview-section');
        this.selectFileButton = document.getElementById('import-select-file');
        this.changeFileButton = document.getElementById('import-change-file');
        this.dropZone = document.getElementById('import-drop-zone');

        this.algorithmSelect = document.getElementById('import-algorithm');

        this.beamWidthSlider = document.getElementById('import-beam-width');
        this.beamWidthValue = document.getElementById('import-beam-width-value');

        this.hueSlider = document.getElementById('import-hue');
        this.hueValue = document.getElementById('import-hue-value');

        this.saturationSlider = document.getElementById('import-saturation');
        this.saturationValue = document.getElementById('import-saturation-value');

        this.brightnessSlider = document.getElementById('import-brightness');
        this.brightnessValue = document.getElementById('import-brightness-value');

        this.contrastSlider = document.getElementById('import-contrast');
        this.contrastValue = document.getElementById('import-contrast-value');

        this.convertButton = document.getElementById('import-convert');
        this.cancelButton = document.getElementById('import-cancel');
        this.cancelNoFileButton = document.getElementById('import-cancel-no-file');

        // Initialize event handlers
        this.initializeHandlers();

        // Load settings from localStorage
        this.loadSettings();
    }

    /**
     * Initialize event handlers for all controls.
     */
    initializeHandlers() {
        // Select file button
        this.selectFileButton.addEventListener('click', () => {
            this.handleSelectFile();
        });

        // Change file button
        this.changeFileButton.addEventListener('click', () => {
            this.handleSelectFile();
        });

        // Drag-and-drop: Click on drop zone to open file picker
        this.dropZone.addEventListener('click', () => {
            this.handleSelectFile();
        });

        // Drag-and-drop: Prevent default behavior for drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Drag-and-drop: Visual feedback
        ['dragenter', 'dragover'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => {
                this.dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, () => {
                this.dropZone.classList.remove('drag-over');
            });
        });

        // Drag-and-drop: Handle file drop
        this.dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                // Take the first file if multiple are dropped
                this.processImageFile(files[0]);
            }
        });

        // Hue slider
        this.hueSlider.addEventListener('input', () => {
            const value = parseInt(this.hueSlider.value);
            this.hueValue.textContent = value;
            window.gSettings.ntscHueAdjust = value;
            this.debouncedPreviewUpdate();
        });

        // Saturation slider
        this.saturationSlider.addEventListener('input', () => {
            const value = parseInt(this.saturationSlider.value);
            this.saturationValue.textContent = value;
            window.gSettings.ntscSaturationAdjust = value;
            this.debouncedPreviewUpdate();
        });

        // Brightness slider
        this.brightnessSlider.addEventListener('input', () => {
            const value = parseInt(this.brightnessSlider.value);
            this.brightnessValue.textContent = value;
            window.gSettings.ntscBrightnessAdjust = value;
            this.debouncedPreviewUpdate();
        });

        // Contrast slider
        this.contrastSlider.addEventListener('input', () => {
            const value = parseInt(this.contrastSlider.value);
            this.contrastValue.textContent = value;
            window.gSettings.ntscContrastAdjust = value;
            this.debouncedPreviewUpdate();
        });

        // Beam width slider
        this.beamWidthSlider.addEventListener('input', () => {
            const value = parseInt(this.beamWidthSlider.value);
            this.beamWidthValue.textContent = `K=${value}`;
            window.gSettings.beamWidth = value;
            this.debouncedPreviewUpdate();
        });

        // Algorithm dropdown
        this.algorithmSelect.addEventListener('change', () => {
            this.debouncedPreviewUpdate();
        });

        // Convert button
        this.convertButton.addEventListener('click', () => {
            this.handleConvert();
        });

        // Cancel buttons
        this.cancelButton.addEventListener('click', () => {
            this.dialog.close();
        });

        this.cancelNoFileButton.addEventListener('click', () => {
            this.dialog.close();
        });

        // Clear image data when dialog is closed
        this.dialog.addEventListener('close', () => {
            this.imageData = null;
            this.originalFile = null;
            // Remove paste listener when dialog closes
            if (this.pasteHandler) {
                document.removeEventListener('paste', this.pasteHandler);
                this.pasteHandler = null;
            }
            // Reset to file selection view
            this.showFileSelection();
        });
    }

    /**
     * Get current preview settings for comparison.
     * @returns {Object} Current settings object
     */
    getCurrentSettings() {
        return {
            algorithm: this.algorithmSelect.value,
            beamWidth: parseInt(this.beamWidthSlider.value),
            hue: parseInt(this.hueSlider.value),
            saturation: parseInt(this.saturationSlider.value),
            brightness: parseInt(this.brightnessSlider.value),
            contrast: parseInt(this.contrastSlider.value)
        };
    }

    /**
     * Check if current settings match last preview settings.
     * @returns {boolean} True if settings match
     */
    settingsMatchPreview() {
        if (!this.lastPreviewSettings || !this.lastPreviewResult) {
            return false;
        }

        const current = this.getCurrentSettings();
        return (
            current.algorithm === this.lastPreviewSettings.algorithm &&
            current.beamWidth === this.lastPreviewSettings.beamWidth &&
            current.hue === this.lastPreviewSettings.hue &&
            current.saturation === this.lastPreviewSettings.saturation &&
            current.brightness === this.lastPreviewSettings.brightness &&
            current.contrast === this.lastPreviewSettings.contrast
        );
    }

    /**
     * Load NTSC settings from localStorage.
     * Access global Settings singleton directly (matches existing pattern).
     */
    loadSettings() {
        const beamWidth = window.gSettings.beamWidth || 16;
        const hue = window.gSettings.ntscHueAdjust || 0;
        const saturation = window.gSettings.ntscSaturationAdjust || 0;
        const brightness = window.gSettings.ntscBrightnessAdjust || 0;
        const contrast = window.gSettings.ntscContrastAdjust || 0;

        this.beamWidthSlider.value = beamWidth;
        this.beamWidthValue.textContent = `K=${beamWidth}`;

        this.hueSlider.value = hue;
        this.hueValue.textContent = hue;

        this.saturationSlider.value = saturation;
        this.saturationValue.textContent = saturation;

        this.brightnessSlider.value = brightness;
        this.brightnessValue.textContent = brightness;

        this.contrastSlider.value = contrast;
        this.contrastValue.textContent = contrast;
    }

    /**
     * Debounce preview updates to avoid excessive rendering.
     * Cancels any in-progress preview operation.
     */
    debouncedPreviewUpdate() {
        // Cancel any pending debounce timer
        if (this.previewUpdateTimeout) {
            clearTimeout(this.previewUpdateTimeout);
        }

        // Cancel any in-progress preview operation
        if (this.previewAbortController) {
            this.previewAbortController.abort();
            this.previewAbortController = null;
        }

        // Clear cached preview since settings changed
        this.lastPreviewSettings = null;
        this.lastPreviewResult = null;

        this.previewUpdateTimeout = setTimeout(() => {
            if (this.imageData) {
                this.renderPreview(this.imageData);
            }
        }, 200); // 200ms debounce
    }

    /**
     * Handle clipboard paste event.
     * @param {ClipboardEvent} e - Paste event
     */
    async handlePaste(e) {
        const items = e.clipboardData.items;

        // Find the first image in clipboard
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    await this.processImageFile(file);
                    return;
                }
            }
        }
    }

    /**
     * Show the dialog in file selection mode (no image loaded yet).
     */
    show() {
        // Clear the preview canvas when dialog opens
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

        // Reset algorithm to Greedy (fast by default)
        this.algorithmSelect.value = 'greedy';

        // Reset all sliders to defaults
        this.beamWidthSlider.value = 16;
        this.beamWidthValue.textContent = 'K=16';
        window.gSettings.beamWidth = 16;

        this.hueSlider.value = 0;
        this.hueValue.textContent = '0';
        window.gSettings.ntscHueAdjust = 0;

        this.saturationSlider.value = 0;
        this.saturationValue.textContent = '0';
        window.gSettings.ntscSaturationAdjust = 0;

        this.brightnessSlider.value = 0;
        this.brightnessValue.textContent = '0';
        window.gSettings.ntscBrightnessAdjust = 0;

        this.contrastSlider.value = 0;
        this.contrastValue.textContent = '0';
        window.gSettings.ntscContrastAdjust = 0;

        this.showFileSelection();
        this.dialog.showModal();

        // Add paste listener when dialog opens
        if (!this.pasteHandler) {
            this.pasteHandler = (e) => this.handlePaste(e);
            document.addEventListener('paste', this.pasteHandler);
        }
    }

    /**
     * Show the file selection section and hide the preview section.
     */
    showFileSelection() {
        this.fileSelectionSection.style.display = 'block';
        this.previewSection.style.display = 'none';
        document.getElementById('import-file-selection-buttons').style.display = 'flex';
    }

    /**
     * Show the preview section and hide the file selection section.
     */
    showPreview() {
        this.fileSelectionSection.style.display = 'none';
        this.previewSection.style.display = 'block';
        document.getElementById('import-file-selection-buttons').style.display = 'none';
    }

    /**
     * Process an image file from any source (picker, drag-drop, paste).
     * @param {File} file - Image file to process
     */
    async processImageFile(file) {
        try {
            // Validate the file
            const validation = FileInputHandler.validateImageFile(file);
            if (!validation.valid) {
                this.mainObj.showMessage(validation.error);
                return;
            }

            // Load image at HGR resolution (280x192)
            const imageData = await FileInputHandler.loadImageAsImageData(file, 280, 192);

            // Show preview with the loaded image
            this.showWithImage(imageData, file);
        } catch(error) {
            console.log("Image load error:", error);
            this.mainObj.showMessage("ERROR: Failed to load image: " + error.message);
        }
    }

    /**
     * Handle the select file button click - trigger file picker.
     */
    async handleSelectFile() {
        const pickerOpts = {
            types: [
                {
                    description: 'Images',
                    accept: {
                        'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
                    }
                }
            ],
            multiple: false
        };

        let fileHandle;
        try {
            if (!("showOpenFilePicker" in window)) {
                this.mainObj.showMessage("Import feature requires a modern browser with File System Access API");
                return;
            }
            [fileHandle] = await window.showOpenFilePicker(pickerOpts);
        } catch (error) {
            // User canceled - just return without closing dialog
            console.log("File selection cancelled:", error);
            return;
        }

        try {
            const file = await fileHandle.getFile();
            await this.processImageFile(file);
        } catch(error) {
            console.log("Image load error:", error);
            this.mainObj.showMessage("ERROR: Failed to load image: " + error.message);
        }
    }

    /**
     * Show the dialog with an image to import.
     * @param {ImageData} imageData - Image data to preview
     * @param {File} file - Original file object
     */
    showWithImage(imageData, file) {
        this.imageData = imageData;
        this.originalFile = file;
        this.showPreview();
        this.renderPreview(imageData);
    }

    /**
     * Apply NTSC adjustments to image data.
     * @param {ImageData} imageData - Original image data
     * @returns {ImageData} - Adjusted image data
     */
    applyNTSCAdjustments(imageData) {
        const hue = parseInt(this.hueSlider.value);
        const saturation = parseInt(this.saturationSlider.value);
        const brightness = parseInt(this.brightnessSlider.value);
        const contrast = parseInt(this.contrastSlider.value);

        // If no adjustments, return original
        if (hue === 0 && saturation === 0 && brightness === 0 && contrast === 0) {
            return imageData;
        }

        // Create adjusted image data
        const adjusted = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
        );

        // Apply adjustments pixel by pixel
        for (let i = 0; i < adjusted.data.length; i += 4) {
            let r = adjusted.data[i];
            let g = adjusted.data[i + 1];
            let b = adjusted.data[i + 2];

            // Convert to HSL for hue and saturation adjustments
            if (hue !== 0 || saturation !== 0) {
                const hsl = this.rgbToHsl(r, g, b);

                // Apply hue adjustment
                if (hue !== 0) {
                    hsl.h = (hsl.h + hue / 360) % 1;
                    if (hsl.h < 0) hsl.h += 1;
                }

                // Apply saturation adjustment
                if (saturation !== 0) {
                    // Convert saturation range from -50/50 to multiplier
                    const satFactor = 1 + (saturation / 100);
                    hsl.s = Math.max(0, Math.min(1, hsl.s * satFactor));
                }

                const rgb = this.hslToRgb(hsl.h, hsl.s, hsl.l);
                r = rgb.r;
                g = rgb.g;
                b = rgb.b;
            }

            // Apply brightness (simple additive)
            if (brightness !== 0) {
                r = Math.max(0, Math.min(255, r + brightness));
                g = Math.max(0, Math.min(255, g + brightness));
                b = Math.max(0, Math.min(255, b + brightness));
            }

            // Apply contrast
            if (contrast !== 0) {
                const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
                r = Math.max(0, Math.min(255, factor * (r - 128) + 128));
                g = Math.max(0, Math.min(255, factor * (g - 128) + 128));
                b = Math.max(0, Math.min(255, factor * (b - 128) + 128));
            }

            adjusted.data[i] = r;
            adjusted.data[i + 1] = g;
            adjusted.data[i + 2] = b;
        }

        return adjusted;
    }

    /**
     * Convert RGB to HSL color space.
     * @param {number} r - Red (0-255)
     * @param {number} g - Green (0-255)
     * @param {number} b - Blue (0-255)
     * @returns {{h: number, s: number, l: number}} - HSL values (0-1)
     */
    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0; // achromatic
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return { h, s, l };
    }

    /**
     * Convert HSL to RGB color space.
     * @param {number} h - Hue (0-1)
     * @param {number} s - Saturation (0-1)
     * @param {number} l - Lightness (0-1)
     * @returns {{r: number, g: number, b: number}} - RGB values (0-255)
     */
    hslToRgb(h, s, l) {
        let r, g, b;

        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;

            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    /**
     * Render preview using selected algorithm.
     * @param {ImageData} imageData - Image data to preview
     */
    async renderPreview(imageData) {
        // Create new AbortController for this preview operation
        this.previewAbortController = new AbortController();
        const signal = this.previewAbortController.signal;

        // Show spinner
        this.previewSpinner.style.display = 'block';
        this.previewSpinnerPercent.textContent = '0%';

        try {
            // Apply NTSC adjustments
            const adjustedData = this.applyNTSCAdjustments(imageData);

            // Get selected algorithm and beam width
            const algorithm = this.algorithmSelect.value;
            const beamWidth = parseInt(this.beamWidthSlider.value);

            // Progress callback for spinner
            const progressCallback = (completed, total) => {
                const percent = Math.round((completed / total) * 100);
                this.previewSpinnerPercent.textContent = `${percent}%`;
            };

            // Use selected algorithm for preview
            const ditherer = new ImageDither();
            const hgrData = await ditherer.ditherToHgrAsync(
                adjustedData,
                40,
                192,
                algorithm, // Use user-selected algorithm
                progressCallback, // Update spinner progress
                beamWidth, // Pass beam width for Viterbi algorithms
                signal // Pass AbortSignal for cancellation
            );

            // Check if aborted after async operation
            if (signal.aborted) {
                return;
            }

            // Render the HGR data to preview canvas
            // We need to convert back to RGB for display
            this.renderHgrToCanvas(hgrData);

            // Store preview settings and result for convert button optimization
            this.lastPreviewSettings = this.getCurrentSettings();
            this.lastPreviewResult = hgrData;
        } catch (error) {
            // Ignore abort errors - they're expected when canceling
            if (error.name === 'AbortError') {
                return;
            }
            console.error('Preview render failed:', error);
        } finally {
            // Hide spinner
            this.previewSpinner.style.display = 'none';

            // Clear abort controller reference if this was the active one
            if (this.previewAbortController && this.previewAbortController.signal === signal) {
                this.previewAbortController = null;
            }
        }
    }

    /**
     * Render HGR byte data to the preview canvas using NTSC color rendering.
     * @param {Uint8Array} hgrData - HGR screen data (linear, not interleaved)
     */
    renderHgrToCanvas(hgrData) {
        const width = 560;  // NTSC resolution (double width for color artifacts)
        const height = 192;
        const imageData = this.previewCtx.createImageData(width, height);

        // Render each scanline using NTSC renderer for proper color display
        for (let row = 0; row < height; row++) {
            const rowOffset = row * 40;
            this.ntscRenderer.renderHgrScanline(imageData, hgrData, row, rowOffset);
        }

        this.previewCtx.putImageData(imageData, 0, 0);
    }

    /**
     * Handle convert button click.
     */
    async handleConvert() {
        if (!this.imageData || !this.originalFile) {
            return;
        }

        // Save references BEFORE closing dialog (dialog close event nullifies these)
        const imageData = this.imageData;
        const fileName = this.originalFile.name;

        try {
            // Close import dialog
            this.dialog.close();

            let linearScreenData;

            // Check if we can reuse the preview result
            if (this.settingsMatchPreview()) {
                // Reuse preview result - no need for progress modal
                linearScreenData = this.lastPreviewResult;
            } else {
                // Settings differ - need full conversion with progress modal
                const algorithm = this.algorithmSelect.value;
                const beamWidth = parseInt(this.beamWidthSlider.value);

                // Show progress modal
                this.progressModal.show(`Converting ${fileName}...`);

                // Apply NTSC adjustments to original image
                const adjustedData = this.applyNTSCAdjustments(imageData);

                // Create a temporary image element for the dithering process
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = adjustedData.width;
                tempCanvas.height = adjustedData.height;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.putImageData(adjustedData, 0, 0);

                const tempImg = new Image();
                const dataUrl = tempCanvas.toDataURL();

                await new Promise((resolve, reject) => {
                    tempImg.onload = resolve;
                    tempImg.onerror = reject;
                    tempImg.src = dataUrl;
                });

                // Progress callback
                const progressCallback = (completed, total) => {
                    const percent = Math.round((completed / total) * 100);
                    this.progressModal.updateProgress(percent);

                    // Check if cancelled
                    if (this.progressModal.isCancelled()) {
                        throw new Error('Conversion cancelled by user');
                    }
                };

                // Convert using selected algorithm
                const ditherer = new ImageDither();
                linearScreenData = await ditherer.ditherToHgrAsync(
                    tempImg,
                    40,
                    192,
                    algorithm,
                    progressCallback,
                    beamWidth // Pass beam width for Viterbi algorithms
                );

                // Check if cancelled before proceeding
                if (this.progressModal.isCancelled()) {
                    this.progressModal.hide();
                    return;
                }

                // Hide progress modal
                this.progressModal.hide();
            }

            // Convert to interleaved format and create Picture
            await this.mainObj.createPictureFromLinearData(
                linearScreenData,
                fileName
            );

        } catch (error) {
            this.progressModal.hide();
            if (error.message !== 'Conversion cancelled by user') {
                console.error('Conversion failed:', error);
                this.mainObj.showMessage(`Conversion failed: ${error.message}`);
            }
        }
    }
}
