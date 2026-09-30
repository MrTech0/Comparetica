import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, previousLogo, newLogo } from '../test-support/company_settings.js';
import { initWizard } from '../src/js/views/wizard.js';

const rejectedNames = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'logo.avif', 'logo.svg.webp', 'svg'];
const dropEvent = file => ({ dataTransfer: { files: [file] }, preventDefault() {}, stopPropagation() {} });

for (const route of ['picker', 'HTML drop', 'native drop']) {
  test(`${route} rejects raster logos and explains that only SVG is accepted`, async t => {
    const { get, settings, reads, emitNative } = await setup(t);
    const input = get('settings-company-logo');
    for (const name of rejectedNames) {
      input.files = [new File(['previous selection'], 'seleccion.svg')];
      const file = new File(['raster image'], name);
      if (route === 'picker') {
        input.files = [file];
        await input.onchange();
      } else if (route === 'HTML drop') {
        await get('settings-company-logo-dropzone').ondrop(dropEvent(file));
      } else {
        await emitNative('tauri://drag-drop', { paths: [`C:\\Temp\\${name}`], position: { x: 300, y: 300 } });
      }
      assert.equal(input.files.length, 0, `${name} must be removed from the field`);
      assert.equal(settings.get('company_logo'), previousLogo);
      assert.match(get('toast-container').children.at(-1)?.innerText ?? '', /solo.*\.svg/i);
    }
    assert.deepEqual(reads, [], 'unsupported native files must not be read');
  });
}

test('an SVG with uppercase extension can be selected and saved', async t => {
  const { get, submit, settings } = await setup(t);
  const input = get('settings-company-logo');
  const svg = new File(['logo nuevo'], 'empresa.SVG', { type: 'image/svg+xml' });
  input.files = [svg];
  await input.onchange();
  assert.equal(input.files[0], svg);
  await submit();
  assert.equal(settings.get('company_logo'), newLogo);
});

test('saving cannot bypass SVG-only selection validation', async t => {
  const { get, submit, settings } = await setup(t);
  const initialConfig = settings.get('company_config');
  get('settings-company-logo').files = [new File(['raster'], 'logo.png')];
  await submit();
  assert.equal(get('settings-company-logo').files.length, 0);
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.equal(settings.get('company_config'), initialConfig);
});

test('initial setup clears unsupported logo selections and accepts a later SVG', async t => {
  const { get } = await setup(t, { includeWizard: true });
  await initWizard();
  const input = get('wizard-company-logo');
  for (const name of rejectedNames) {
    input.files = [new File(['raster'], name)];
    await input.onchange();
    assert.equal(input.files.length, 0, `${name} must be cleared during initial setup`);
    assert.match(get('toast-container').children.at(-1)?.innerText ?? '', /solo.*\.svg/i);
  }
  const svg = new File(['svg'], 'empresa.SVG');
  input.files = [svg];
  await input.onchange();
  assert.equal(input.files[0], svg);
});

test('initial setup validates the logo before saving any configuration', async t => {
  const { get, settings } = await setup(t, { includeWizard: true });
  await initWizard();
  const initialConfig = settings.get('company_config');
  get('wizard-company-logo').files = [new File(['raster'], 'logo.webp')];
  await get('wizard-form').onsubmit({ preventDefault() {} });
  assert.equal(get('wizard-company-logo').files.length, 0);
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.equal(settings.get('company_config'), initialConfig);
});
