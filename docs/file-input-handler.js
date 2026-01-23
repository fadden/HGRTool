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

/**
 * Utility class for handling image file input from various sources
 * (file picker, drag-drop, clipboard paste).
 */
export class FileInputHandler {
    /**
     * Supported image MIME types.
     */
    static SUPPORTED_MIME_TYPES = [
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp'
    ];

    /**
     * Supported image file extensions.
     */
    static SUPPORTED_EXTENSIONS = [
        'png',
        'jpg',
        'jpeg',
        'gif',
        'webp'
    ];

    /**
     * Validate that a file is a supported image format.
     * @param {File} file - File to validate
     * @returns {{valid: boolean, error?: string}} - Validation result
     */
    static validateImageFile(file) {
        if (!file) {
            return { valid: false, error: 'No file provided' };
        }

        // Check MIME type first
        const mimeValid = this.SUPPORTED_MIME_TYPES.includes(file.type);

        // Check file extension as fallback (for generic MIME types)
        const extension = file.name.split('.').pop()?.toLowerCase();
        const extensionValid = extension && this.SUPPORTED_EXTENSIONS.includes(extension);

        // Valid if either MIME type or extension is supported
        if (mimeValid || extensionValid) {
            return { valid: true };
        }

        return {
            valid: false,
            error: `File format not supported. Please use PNG, JPG, JPEG, GIF, or WEBP.`
        };
    }

    /**
     * Load an image file and convert to ImageData at the specified dimensions.
     * @param {File} file - Image file to load
     * @param {number} width - Target width for ImageData
     * @param {number} height - Target height for ImageData
     * @returns {Promise<ImageData>} - Loaded and scaled ImageData
     */
    static async loadImageAsImageData(file, width, height) {
        // Validate file first
        const validation = this.validateImageFile(file);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Load image into HTMLImageElement
        const img = new Image();
        const url = URL.createObjectURL(file);

        try {
            await new Promise((resolve, reject) => {
                img.onload = () => {
                    URL.revokeObjectURL(url);
                    resolve();
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error("Failed to load image"));
                };
                img.src = url;
            });

            // Create a canvas to get ImageData at target resolution
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, width, height);

            return ctx.getImageData(0, 0, width, height);
        } catch (error) {
            URL.revokeObjectURL(url);
            throw error;
        }
    }
}
