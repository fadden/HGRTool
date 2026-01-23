import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Render Mode Radio Buttons', () => {
  beforeEach(() => {
    // Read the actual HTML file
    const htmlContent = readFileSync(
      join(process.cwd(), 'docs/src/imgedit.html'),
      'utf-8'
    );
    document.body.innerHTML = htmlContent;
  });

  it('should have RGB radio button with correct ID', () => {
    const rgbRadio = document.getElementById('render-mode-rgb');
    expect(rgbRadio).toBeTruthy();
    expect(rgbRadio.type).toBe('radio');
    expect(rgbRadio.name).toBe('renderMode');
    expect(rgbRadio.value).toBe('rgb');
  });

  it('should have NTSC radio button with correct ID', () => {
    const ntscRadio = document.getElementById('render-mode-ntsc');
    expect(ntscRadio).toBeTruthy();
    expect(ntscRadio.type).toBe('radio');
    expect(ntscRadio.name).toBe('renderMode');
    expect(ntscRadio.value).toBe('ntsc');
  });

  it('should have Mono radio button with correct ID', () => {
    const monoRadio = document.getElementById('render-mode-mono');
    expect(monoRadio).toBeTruthy();
    expect(monoRadio.type).toBe('radio');
    expect(monoRadio.name).toBe('renderMode');
    expect(monoRadio.value).toBe('mono');
  });

  it('should have RGB radio button checked by default', () => {
    const rgbRadio = document.getElementById('render-mode-rgb');
    expect(rgbRadio.checked).toBe(true);
  });

  it('all radio buttons should be in the same group', () => {
    const rgbRadio = document.getElementById('render-mode-rgb');
    const ntscRadio = document.getElementById('render-mode-ntsc');
    const monoRadio = document.getElementById('render-mode-mono');

    expect(rgbRadio.name).toBe(ntscRadio.name);
    expect(rgbRadio.name).toBe(monoRadio.name);
  });
});
