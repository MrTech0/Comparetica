import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setup, previousLogo, newLogo } from '../test-support/company_settings.js';
import { initWizard } from '../src/js/views/wizard.js';
import { optimizeSvgLogo } from '../src/js/utils/logo.js';

const file = name => new File(['logo nuevo'], name, { type: 'image/svg+xml' });
const warnings = get => get('toast-container').children.filter(toast => toast.className === 'm3-toast warning');

test('logo dimensions can be read under the native image security policy', async t => {
  const originalImage = globalThis.Image;
  await setup(t);
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const imageSources = config.app.security.csp.match(/(?:^|;)\s*img-src\s+([^;]+)/)[1].split(/\s+/);
  t.after(() => { globalThis.Image = originalImage; });
  // Model the browser's CSP boundary; a blocked source must emit an error.
  globalThis.Image = class {
    naturalWidth = 3840;
    naturalHeight = 3840;
    set src(value) {
      const allowed = imageSources.includes(new URL(value).protocol);
      queueMicrotask(() => allowed ? this.onload() : this.onerror());
    }
  };
  assert.match((await optimizeSvgLogo(file('grande.svg'))).message, /3840 × 3840/,
    'the native policy must permit the source used to inspect an attached logo');
});

for (const [width, height] of [[3840, 3840], [512, 513]]) {
  test(`selecting a ${width}x${height} logo warns about PDF resizing and keeps it usable`, async t => {
    const { get, submit, settings } = await setup(t, { imageDimensions: { width, height } });
    const input = get('settings-company-logo');
    const selected = file('grande.svg');
    input.files = [selected];
    await input.onchange();
    assert.equal(warnings(get).length, 1);
    assert.match(warnings(get)[0].innerText, new RegExp(`${width}.*${height}`));
    assert.match(warnings(get)[0].innerText, /512/);
    assert.match(warnings(get)[0].innerText, /PDF/);
    assert.match(warnings(get)[0].innerText, /solo.*PNG optimizado/i);
    assert.equal(input.files[0], selected, 'the advisory must not clear or replace the image');
    assert.equal(settings.get('company_logo'), previousLogo);
    await submit();
    assert.equal(settings.get('company_logo'), newLogo);
  });
}

test('a logo exactly at 512 pixels is accepted without a resolution warning', async t => {
  const { get } = await setup(t, { imageDimensions: { width: 512, height: 512 } });
  const input = get('settings-company-logo');
  input.files = [file('limite.svg')];
  await input.onchange();
  assert.equal(warnings(get).length, 0);
  assert.equal(input.files[0].name, 'limite.svg');
});

test('HTML drag and drop warns for a large logo without saving or discarding it', async t => {
  const { get, settings } = await setup(t, { imageDimensions: { width: 2000, height: 1000 } });
  const selected = file('arrastrado.svg');
  await get('settings-company-logo-dropzone').ondrop({ dataTransfer: { files: [selected] }, preventDefault() {}, stopPropagation() {} });
  assert.equal(warnings(get).length, 1);
  assert.equal(get('settings-company-logo').files[0], selected);
  assert.equal(settings.get('company_logo'), previousLogo);
});

test('native drag and drop also warns after reading the image dimensions', async t => {
  const { get, emitNative } = await setup(t, { imageDimensions: { width: 3840, height: 3840 } });
  await emitNative('tauri://drag-drop', { paths: ['C:\\Temp\\logo-arrastrado.svg'], position: { x: 300, y: 300 } });
  assert.equal(warnings(get).length, 1);
  assert.equal(get('settings-company-logo').files[0].name, 'logo-arrastrado.svg');
});

test('a late dimension read cannot warn about an image that has been replaced', async t => {
  let release;
  let reads = 0;
  const { get } = await setup(t, { imageDimensions: () => ++reads === 1
    ? new Promise(resolve => { release = resolve; })
    : { width: 128, height: 128 } });
  const input = get('settings-company-logo');
  input.files = [file('anterior.svg')];
  const pending = input.onchange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  input.files = [file('actual.svg')];
  await input.onchange();
  release({ width: 3840, height: 3840 });
  await pending;
  assert.equal(warnings(get).length, 0);
  assert.equal(input.files[0].name, 'actual.svg');
});

test('a decoding failure clears the SVG so its original bytes cannot be saved', async t => {
  const { get } = await setup(t, { imageDimensions: null });
  const input = get('settings-company-logo');
  const selected = file('sin-dimensiones.svg');
  input.files = [selected];
  await input.onchange();
  assert.equal(warnings(get).length, 0);
  assert.equal(input.files.length, 0);
  assert.ok(get('toast-container').children.some(toast => toast.className === 'm3-toast error'));
});

test('initial setup warns about a large logo and keeps the original selected', async t => {
  const { get } = await setup(t, { includeWizard: true, imageDimensions: { width: 3840, height: 3840 } });
  await initWizard();
  const input = get('wizard-company-logo');
  const selected = file('inicial.svg');
  input.files = [selected];
  assert.equal(typeof input.onchange, 'function', 'initial setup must inspect a selected logo');
  await input.onchange();
  assert.equal(warnings(get).length, 1);
  assert.equal(input.files[0], selected);
});
