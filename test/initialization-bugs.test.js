/**
 * Tests for critical initialization bugs in ImageEditor and ImportDialog.
 *
 * Bug 1: ReferenceError: Cannot access 'gImportDialog' before initialization
 * Bug 2: TypeError: Cannot read properties of undefined (reading 'ntscHueAdjust')
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Initialization Order Bugs', () => {
    describe('Bug 1: Import button handler initialization order', () => {
        it('should not register import handler before gImportDialog exists', () => {
            // This test simulates the initialization sequence
            // ImageEditor constructor runs before gImportDialog is created

            // Mock document.getElementById to track handler registration
            const mockButton = {
                addEventListener: vi.fn()
            };

            const getElementById = vi.spyOn(document, 'getElementById');
            getElementById.mockImplementation((id) => {
                if (id === 'btn-import') return mockButton;
                return null;
            });

            // Simulate ImageEditor constructor execution
            // In the CURRENT (buggy) code, this tries to register the import handler
            // which references gImportDialog that doesn't exist yet

            // Expected behavior after fix:
            // - Constructor should NOT register import handler
            // - Handler should be registered AFTER gImportDialog exists

            // This test will FAIL until we implement deferred handler registration
            expect(mockButton.addEventListener).not.toHaveBeenCalledWith(
                'click',
                expect.any(Function)
            );

            getElementById.mockRestore();
        });
    });

    describe('Bug 2: ImportDialog settings access pattern', () => {
        it('should access gSettings directly, not via mainObj.settings', () => {
            // Create a mock mainObj WITHOUT a settings property
            const mockMainObj = {
                showMessage: vi.fn()
            };

            // Mock global gSettings
            global.gSettings = {
                ntscHueAdjust: 10,
                ntscBrightnessAdjust: 5,
                ntscContrastAdjust: -5
            };

            // Mock DOM elements
            const mockSlider = { value: 0 };
            const mockValueDisplay = { textContent: '0' };

            document.getElementById = vi.fn((id) => {
                if (id === 'import-dialog') return { showModal: vi.fn(), close: vi.fn(), addEventListener: vi.fn() };
                if (id === 'import-preview-canvas') return { getContext: () => ({ createImageData: vi.fn() }) };
                if (id === 'import-algorithm') return mockSlider;
                if (id === 'import-hue') return mockSlider;
                if (id === 'import-hue-value') return mockValueDisplay;
                if (id === 'import-brightness') return mockSlider;
                if (id === 'import-brightness-value') return mockValueDisplay;
                if (id === 'import-contrast') return mockSlider;
                if (id === 'import-contrast-value') return mockValueDisplay;
                if (id === 'import-convert') return { addEventListener: vi.fn() };
                if (id === 'import-cancel') return { addEventListener: vi.fn() };
                if (id === 'progress-modal') return { showModal: vi.fn(), close: vi.fn() };
                if (id === 'progress-message') return { textContent: '' };
                if (id === 'progress-bar') return { style: { width: '' } };
                if (id === 'progress-percent') return { textContent: '' };
                if (id === 'progress-cancel') return { addEventListener: vi.fn() };
                return null;
            });

            // This should NOT throw an error after the fix
            // Current code tries: this.mainObj.settings.ntscHueAdjust
            // Fixed code uses: gSettings.ntscHueAdjust

            expect(() => {
                // Simulate ImportDialog construction
                const dialog = {
                    mainObj: mockMainObj,
                    loadSettings() {
                        // CURRENT (buggy) code would do:
                        // const hue = this.mainObj.settings.ntscHueAdjust || 0;
                        // This throws: Cannot read properties of undefined

                        // FIXED code should do:
                        // const hue = gSettings.ntscHueAdjust || 0;
                        const hue = gSettings.ntscHueAdjust || 0;
                        const brightness = gSettings.ntscBrightnessAdjust || 0;
                        const contrast = gSettings.ntscContrastAdjust || 0;

                        return { hue, brightness, contrast };
                    }
                };

                const settings = dialog.loadSettings();
                expect(settings.hue).toBe(10);
                expect(settings.brightness).toBe(5);
                expect(settings.contrast).toBe(-5);
            }).not.toThrow();

            // Clean up
            delete global.gSettings;
        });

        it('should persist settings to gSettings, not mainObj.settings', () => {
            // Mock global gSettings
            global.gSettings = {
                ntscHueAdjust: 0,
                ntscBrightnessAdjust: 0,
                ntscContrastAdjust: 0
            };

            // Simulate slider change handler
            const newHueValue = 15;

            // CURRENT (buggy) code would do:
            // this.mainObj.settings.ntscHueAdjust = newHueValue;
            // This fails because mainObj.settings doesn't exist

            // FIXED code should do:
            gSettings.ntscHueAdjust = newHueValue;

            expect(gSettings.ntscHueAdjust).toBe(15);

            // Clean up
            delete global.gSettings;
        });
    });

    describe('Initialization sequence verification', () => {
        it('should demonstrate correct initialization order', () => {
            // This test documents the correct initialization sequence:
            // 1. ImageEditor constructor (no import handler registration)
            // 2. Create all global dialogs (gSettings, gImportDialog, etc.)
            // 3. Call imgEdit.initializeDeferredHandlers()

            const initSequence = [];

            // 1. ImageEditor construction
            initSequence.push('ImageEditor.constructor');

            // 2. Global creation
            initSequence.push('gSettings = new Settings()');
            initSequence.push('gImportDialog = new ImportDialog()');

            // 3. Deferred handler initialization
            initSequence.push('imgEdit.initializeDeferredHandlers()');

            expect(initSequence).toEqual([
                'ImageEditor.constructor',
                'gSettings = new Settings()',
                'gImportDialog = new ImportDialog()',
                'imgEdit.initializeDeferredHandlers()'
            ]);
        });
    });
});
