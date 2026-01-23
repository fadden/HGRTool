// Test setup file for vitest
import { vi } from 'vitest';

// Create mock canvas context factory
function createMockCanvasContext(canvasElement) {
  const mockGradient = {
    addColorStop: vi.fn(),
  };
  return {
    canvas: canvasElement,
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn((x, y, w, h) => {
      // Return ImageData with proper dimensions
      const data = new Uint8ClampedArray(w * h * 4);
      const imageData = new ImageData(w, h);
      imageData.data.set(data);
      return imageData;
    }),
    putImageData: vi.fn(),
    createImageData: vi.fn((w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      const imageData = new ImageData(w, h);
      imageData.data.set(data);
      return imageData;
    }),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    createLinearGradient: vi.fn(() => mockGradient),
    imageSmoothingEnabled: true,
    fillStyle: '#000',
  };
}

// Mock document.createElement to return properly mocked canvas elements
if (typeof document !== 'undefined') {
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = (tagName) => {
    if (tagName === 'canvas') {
      const canvas = originalCreateElement(tagName);
      // Override getContext to return our mock
      canvas.getContext = function(contextType) {
        if (contextType === '2d') {
          return createMockCanvasContext(this);
        }
        return null;
      };
      return canvas;
    }
    return originalCreateElement(tagName);
  };
}

// Mock Image
if (!global.Image) {
  global.Image = class Image {
    constructor() {
      setTimeout(() => {
        if (this.onload) this.onload();
      }, 0);
    }
  };
}

// Mock localStorage
if (!global.localStorage) {
  global.localStorage = {
    data: {},
    getItem(key) {
      return this.data[key] || null;
    },
    setItem(key, value) {
      this.data[key] = String(value);
    },
    removeItem(key) {
      delete this.data[key];
    },
    clear() {
      this.data = {};
    },
  };
}

// Mock ImageData
if (!global.ImageData) {
  global.ImageData = class ImageData {
    constructor(widthOrData, height) {
      if (typeof widthOrData === 'number') {
        // new ImageData(width, height)
        this.width = widthOrData;
        this.height = height;
        this.data = new Uint8ClampedArray(widthOrData * height * 4);
      } else {
        // new ImageData(data, width, height)
        this.data = widthOrData;
        this.width = height;
        this.height = arguments[2];
      }
    }
  };
}

// Mock OffscreenCanvas
if (!global.OffscreenCanvas) {
  global.OffscreenCanvas = class OffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext(contextType, options) {
      const mockGradient = {
        addColorStop: vi.fn(),
      };
      return {
        canvas: this,
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        getImageData: vi.fn((x, y, w, h) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h
        })),
        putImageData: vi.fn(),
        createImageData: vi.fn((w, h) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h
        })),
        drawImage: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        strokeRect: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn((text) => ({
          width: text.length * 8,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: text.length * 8,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 2
        })),
        setLineDash: vi.fn(),
        clip: vi.fn(),
        createLinearGradient: vi.fn(() => mockGradient),
        imageSmoothingEnabled: true,
        fillStyle: '#000',
        font: '12px sans-serif',
      };
    }
  };
}

// Mock fetch for LegalStuff.txt and other resources
if (!global.fetch) {
  global.fetch = vi.fn((url) => {
    // Return a mock response for LegalStuff.txt
    if (url.includes('LegalStuff.txt')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('Mock legal stuff content for testing'),
      });
    }
    // Return empty CSS for CSS files
    if (url.includes('.css')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('/* Mock CSS */'),
      });
    }
    // Return empty response for other resources to avoid test failures
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    });
  });
}

// Override fetch on window if it exists (for happy-dom environment)
if (typeof window !== 'undefined' && !window.fetch) {
  window.fetch = global.fetch;
}

// Mock HTMLDialogElement methods (showModal and close not supported by happy-dom)
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function() {
      this.open = true;
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function() {
      this.open = false;
      this.removeAttribute('open');
    };
  }
}

// Mock ResizeObserver
if (!global.ResizeObserver) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock window.gSettings for ImportDialog tests (Priority 1 fix)
if (typeof window !== 'undefined') {
  window.gSettings = {
    beamWidth: 4,
    ditherAlgorithm: 'hybrid',
    ntscHueAdjust: 0,
    ntscSaturationAdjust: 0,
    ntscBrightnessAdjust: 0,
    ntscContrastAdjust: 0,
  };
}

console.log('Test setup complete');
