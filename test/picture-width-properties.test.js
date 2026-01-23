/**
 * Picture Width Properties Test Suite
 *
 * Tests the new width property contract:
 * - logicalWidth: always 280 for HGR (used for drawing tools and display scaling)
 * - physicalWidth: 280 for RGB/mono, 560 for NTSC (actual ImageData width)
 * - width: backward-compatible alias to logicalWidth
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// Set up DOM environment for Picture class
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.FileSystemFileHandle = class FileSystemFileHandle {};
global.ImageData = class ImageData {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
    }
};

let Picture;
let StdHiRes;

beforeEach(async () => {
    const pictureModule = await import('../docs/src/lib/picture.js');
    Picture = pictureModule.default;

    const stdHiResModule = await import('../docs/src/lib/std-hi-res.js');
    StdHiRes = stdHiResModule.default;
});

describe('Picture Width Properties', () => {
    describe('RGB Mode', () => {
        it('should have logicalWidth = 280', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            expect(picture.logicalWidth).toBe(280);
        });

        it('should have physicalWidth = 280', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('rgb');
            expect(picture.physicalWidth).toBe(280);
        });

        it('should have width alias = logicalWidth', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            expect(picture.width).toBe(picture.logicalWidth);
            expect(picture.width).toBe(280);
        });
    });

    describe('NTSC Mode', () => {
        it('should have logicalWidth = 280', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('ntsc');
            expect(picture.logicalWidth).toBe(280);
        });

        it('should have physicalWidth = 560', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('ntsc');
            expect(picture.physicalWidth).toBe(560);
        });

        it('should have width alias = logicalWidth (not physicalWidth)', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('ntsc');
            expect(picture.width).toBe(picture.logicalWidth);
            expect(picture.width).toBe(280);
            expect(picture.width).not.toBe(picture.physicalWidth);
        });
    });

    describe('Mono Mode', () => {
        it('should have logicalWidth = 280', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('mono');
            expect(picture.logicalWidth).toBe(280);
        });

        it('should have physicalWidth = 280', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('mono');
            expect(picture.physicalWidth).toBe(280);
        });

        it('should have width alias = logicalWidth', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('mono');
            expect(picture.width).toBe(picture.logicalWidth);
            expect(picture.width).toBe(280);
        });
    });

    describe('Mode Switching', () => {
        it('should maintain logicalWidth = 280 across mode changes', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);

            picture.render('rgb');
            expect(picture.logicalWidth).toBe(280);

            picture.render('ntsc');
            expect(picture.logicalWidth).toBe(280);

            picture.render('mono');
            expect(picture.logicalWidth).toBe(280);
        });

        it('should update physicalWidth when switching modes', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);

            picture.render('rgb');
            expect(picture.physicalWidth).toBe(280);

            picture.render('ntsc');
            expect(picture.physicalWidth).toBe(560);

            picture.render('rgb');
            expect(picture.physicalWidth).toBe(280);
        });

        it('should keep width alias stable at 280 regardless of mode', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);

            picture.render('rgb');
            const widthRgb = picture.width;

            picture.render('ntsc');
            const widthNtsc = picture.width;

            picture.render('mono');
            const widthMono = picture.width;

            expect(widthRgb).toBe(280);
            expect(widthNtsc).toBe(280);
            expect(widthMono).toBe(280);
        });
    });

    describe('ImageData Dimensions', () => {
        it('should create ImageData with physicalWidth in RGB mode', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('rgb');
            expect(picture.pixelImage.width).toBe(280);
            expect(picture.pixelImage.width).toBe(picture.physicalWidth);
        });

        it('should create ImageData with physicalWidth in NTSC mode', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);
            picture.render('ntsc');
            expect(picture.pixelImage.width).toBe(560);
            expect(picture.pixelImage.width).toBe(picture.physicalWidth);
        });

        it('should resize ImageData when switching from RGB to NTSC', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);

            picture.render('rgb');
            expect(picture.pixelImage.width).toBe(280);

            picture.render('ntsc');
            expect(picture.pixelImage.width).toBe(560);
        });

        it('should resize ImageData when switching from NTSC to RGB', () => {
            const picture = new Picture('test.hgr', StdHiRes.FORMAT_NAME, undefined, undefined);

            picture.render('ntsc');
            expect(picture.pixelImage.width).toBe(560);

            picture.render('rgb');
            expect(picture.pixelImage.width).toBe(280);
        });
    });
});
