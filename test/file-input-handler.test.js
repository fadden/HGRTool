import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

describe('FileInputHandler', () => {
    let FileInputHandler;

    beforeEach(async () => {
        // Set up DOM environment
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
            resources: 'usable'
        });
        global.window = dom.window;
        global.document = dom.window.document;
        global.Image = dom.window.Image;
        global.URL = dom.window.URL;
        global.Blob = dom.window.Blob;

        // Import the module
        const module = await import('../docs/src/file-input-handler.js');
        FileInputHandler = module.FileInputHandler;
    });

    describe('validateImageFile', () => {
        it('should accept PNG files', () => {
            const file = new File([''], 'test.png', { type: 'image/png' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should accept JPG files', () => {
            const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should accept JPEG files', () => {
            const file = new File([''], 'test.jpeg', { type: 'image/jpeg' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should accept GIF files', () => {
            const file = new File([''], 'test.gif', { type: 'image/gif' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should accept WEBP files', () => {
            const file = new File([''], 'test.webp', { type: 'image/webp' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('should reject non-image files by MIME type', () => {
            const file = new File([''], 'test.txt', { type: 'text/plain' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('File format not supported');
        });

        it('should reject unsupported image formats', () => {
            const file = new File([''], 'test.bmp', { type: 'image/bmp' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('File format not supported');
        });

        it('should validate by extension if MIME type is generic', () => {
            const file = new File([''], 'test.png', { type: 'application/octet-stream' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(true);
        });

        it('should reject by extension if both MIME and extension are invalid', () => {
            const file = new File([''], 'test.txt', { type: 'application/octet-stream' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('File format not supported');
        });

        it('should handle files with no extension', () => {
            const file = new File([''], 'testfile', { type: 'text/plain' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('File format not supported');
        });

        it('should handle files with uppercase extensions', () => {
            const file = new File([''], 'test.PNG', { type: 'image/png' });
            const result = FileInputHandler.validateImageFile(file);
            expect(result.valid).toBe(true);
        });
    });

    describe('loadImageAsImageData', () => {
        it('should be defined as a static method', () => {
            expect(typeof FileInputHandler.loadImageAsImageData).toBe('function');
        });

        // Note: Full testing of loadImageAsImageData requires canvas support
        // which is better tested in E2E tests with real browser environment
    });
});
