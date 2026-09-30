import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { PDF_LOGO_MAX_SIDE, isOptimizedPngLogo } from '../src/js/utils/logo.js';

// Exercise the real PDF converter; only the unavailable browser image/canvas
// boundary is replaced. Actual PNG pixels are also checked in a browser.
export function setupLogoConverter({ width = 3840, height = 3840, broken = false, pngData = 'data:image/png;base64,test' } = {}) {
  const canvases = [];
  class BrowserImage {
    naturalWidth = width;
    naturalHeight = height;
    set src(value) {
      this.source = value;
      queueMicrotask(() => broken ? this.onerror() : this.onload());
    }
  }
  const document = {
    getElementById() { return null; },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const draws = [];
      const context = {
        drawImage(image, x, y, targetWidth = image.naturalWidth, targetHeight = image.naturalHeight) {
          draws.push({ image, coordinates: [x, y, targetWidth, targetHeight] });
        },
        ...Object.fromEntries(['clearRect', 'beginPath', 'arc', 'fill', 'rect', 'moveTo', 'lineTo', 'stroke'].map(name => [name, () => {}])),
      };
      const canvas = {
        width: 300, height: 150, draws,
        getContext(kind) { assert.equal(kind, '2d'); return context; },
        toDataURL(kind) { assert.equal(kind, 'image/png'); return pngData; },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  const source = fs.readFileSync(new URL('../src/js/pdf.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export /gm, '');
  const browser = vm.createContext({ Image: BrowserImage, document, console, PDF_LOGO_MAX_SIDE, isOptimizedPngLogo });
  new vm.Script(source, { filename: 'pdf.js' }).runInContext(browser);
  return { convert: browser.loadAndConvertLogo, canvases, browser };
}
