import test from 'node:test';
import assert from 'node:assert/strict';
import { setupLogoConverter } from '../test-support/pdf_logo.js';
import { jsPDF } from 'jspdf';

// Real 8x8 RGBA PNG with a translucent red pixel; only canvas encoding is doubled.
const translucentLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFUlEQVR4nGN85WzawIAHMOGTHD4KAPZYAfKVaiJXAAAAAElFTkSuQmCC';

test('stored optimized PNG is passed directly to the PDF without a canvas conversion', async () => {
  const { convert, canvases } = setupLogoConverter();
  assert.equal(await convert(translucentLogo), translucentLogo);
  assert.equal(await convert(translucentLogo), translucentLogo);
  assert.equal(canvases.length, 0, 'PDF generation must not rasterize an optimized attachment again');
});

for (const kind of ['report', 'certificate']) {
 for (const corrupted of [false, true]) {
  test(`${kind} embeds ${corrupted ? 'the default bulb for a corrupted stored PNG' : 'the optimized logo'} with lossless compression`, async t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
    const { browser, canvases } = setupLogoConverter({ width: 8, height: 8, pngData: translucentLogo });
    let savedBase64;
    Object.assign(browser, {
      window: { jspdf: { jsPDF }, __TAURI__: {} },
      getCompanyConfig: async () => ({ consultora_nombre: 'Consultora de prueba' }),
    getCompanyLogo: async () => corrupted ? 'data:image/png;base64,' + Buffer.from(translucentLogo.split(',')[1], 'base64').subarray(0, 33).toString('base64') : translucentLogo,
      formatPriceDecimals: value => String(value),
      showToast() {},
      invoke: async (command, args) => {
        assert.equal(command, 'save_pdf');
        savedBase64 = args.base64Data;
        return 'synthetic.pdf';
      },
    });
    if (kind === 'report') {
      savedBase64 = await browser.generatePDFReport({
        energyType: 'GAS', clientName: 'Cliente de prueba', currentCost: 600, proposedCost: 500, ahorro: 100,
        tariffDetails: { comercializadora_nombre: 'Demo', nombre: 'Tarifa Demo', termino_fijo: 10, termino_variable: 0.05 },
        inputDetails: { dias: 30 },
        costDetail: { annual: { fijo: 100, variable: 300, hidrocarburos: 10, alquiler: 5, impuestos: 85 } },
      }, false, true);
    } else {
      await browser.generateLopdCertificatePdf({ nombre_empresa: 'Cliente de prueba', cif: 'B12345674' });
    }
    const pdf = Buffer.from(savedBase64, 'base64').toString('latin1');
    const imageHeaders = pdf.match(/<<\n\/Type \/XObject\n\/Subtype \/Image[\s\S]*?>>\nstream/g) ?? [];
    assert.equal(imageHeaders.length, 2, 'the PDF must contain the logo color and transparency streams');
    assert.ok(imageHeaders.every(header => header.includes('/Filter /FlateDecode')),
      'logo color and transparency streams must be compressed in the PDF');
    assert.equal(canvases.length, corrupted ? 1 : 0, 'only the fallback should create a canvas');
  });
 }
}

for (const [name, width, height, expectedWidth, expectedHeight] of [
  ['large square logo', 3840, 3840, 512, 512],
  ['wide logo', 2000, 1000, 512, 256],
  ['tall logo', 1000, 2000, 256, 512],
  ['small logo without enlarging it', 120, 60, 120, 60],
  ['very narrow logo without a zero width', 1, 4096, 1, 512],
]) {
  test(`PDF rasterizes a ${name} at bounded dimensions`, async () => {
    const { convert, canvases } = setupLogoConverter({ width, height });
    await convert('data:image/webp;base64,fixture');
    assert.equal(canvases.length, 1);
    const canvas = canvases[0];
    assert.equal(canvas.width, expectedWidth);
    assert.equal(canvas.height, expectedHeight);
    assert.equal(canvas.draws.length, 1);
    assert.equal(canvas.draws[0].image.source, 'data:image/webp;base64,fixture');
    assert.deepEqual(Array.from(canvas.draws[0].coordinates), [0, 0, expectedWidth, expectedHeight]);
  });
}

test('PDF still draws the default bulb when no custom logo is stored', async () => {
  const { convert, canvases } = setupLogoConverter();
  const result = await convert(null);
  assert.match(result, /^data:image\/png;/);
  assert.equal(canvases[0].width, 128);
  assert.equal(canvases[0].height, 128);
});

test('an unreadable logo still falls back to the default bulb', async () => {
  const { convert, canvases } = setupLogoConverter({ broken: true });
  const result = await convert('data:image/webp;base64,broken');
  assert.match(result, /^data:image\/png;/);
  assert.equal(canvases[0].width, 128);
  assert.equal(canvases[0].height, 128);
});
