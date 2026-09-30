import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, newLogo, previousLogo } from '../test-support/company_settings.js';
import { optimizeSvgLogo } from '../src/js/utils/logo.js';
import { initWizard } from '../src/js/views/wizard.js';

for (const [width, height, expectedWidth, expectedHeight] of [
  [3840, 3840, 512, 512], [2000, 1000, 512, 256], [1000, 2000, 256, 512],
  [120, 60, 120, 60], [1, 4096, 1, 512],
]) {
  test(`attachment optimizes ${width}x${height} to PNG at ${expectedWidth}x${expectedHeight}`, async t => {
    const { conversions } = await setup(t, { imageDimensions: { width, height } });
    const result = await optimizeSvgLogo(new File(['svg source'], 'logo.svg'));
    assert.equal(result.dataUri, newLogo);
    assert.equal(result.extension, 'png');
    assert.deepEqual(conversions, [{ width: expectedWidth, height: expectedHeight }]);
  });
}

test('selecting then saving twice reuses the single optimized logo and stores no SVG', async t => {
  const { get, submit, settings, local, conversions } = await setup(t);
  await get('settings-company-logo').onchange();
  assert.equal(conversions.length, 1, 'conversion happens on attachment');
  assert.equal(settings.get('company_logo'), previousLogo, 'the saved logo changes only on submit');
  await submit();
  await submit();
  assert.equal(conversions.length, 1, 'saving must reuse the optimized bytes');
  assert.equal(settings.get('company_logo'), newLogo);
  assert.equal(local.get('company_logo'), newLogo);
});

test('save waits for the pending attachment conversion', async t => {
  let release;
  const { get, submit, settings, conversions } = await setup(t, {
    imageDimensions: () => new Promise(resolve => { release = resolve; }),
  });
  const preparing = get('settings-company-logo').onchange();
  await new Promise(resolve => setImmediate(resolve));
  const saving = submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.get('company_logo'), previousLogo);
  release({ width: 2000, height: 1000 });
  await Promise.all([preparing, saving]);
  assert.deepEqual(conversions, [{ width: 512, height: 256 }]);
  assert.equal(settings.get('company_logo'), newLogo);
});

test('a decode failure clears the attached SVG and preserves the saved logo', async t => {
  const { get, settings, conversions } = await setup(t, { imageDimensions: null });
  await get('settings-company-logo').onchange();
  assert.equal(get('settings-company-logo').files.length, 0);
  assert.match(get('toast-container').children.at(-1).innerText, /SVG.*(válido|leer)/i);
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.equal(conversions.length, 0);
});

test('initial setup also converts on attachment and saves only PNG', async t => {
  const { get, settings, conversions } = await setup(t, { includeWizard: true });
  await initWizard();
  get('wizard-company-logo').files = [new File(['source'], 'inicial.svg')];
  await get('wizard-company-logo').onchange();
  assert.equal(conversions.length, 1);
  await get('wizard-form').onsubmit({ preventDefault() {} });
  assert.equal(settings.get('company_logo'), newLogo);
  assert.equal(conversions.length, 1);
});

test('a late failure cannot clear a newer valid logo selection', async t => {
  let release;
  let reads = 0;
  const { get, submit, conversions, settings } = await setup(t, {
    imageDimensions: () => ++reads === 1 ? new Promise(resolve => { release = resolve; }) : { width: 64, height: 64 },
  });
  const input = get('settings-company-logo');
  const pending = input.onchange();
  await new Promise(resolve => setImmediate(resolve));
  input.files = [new File(['replacement'], 'actual.svg')];
  await input.onchange();
  release(null);
  await pending;
  assert.equal(input.files[0].name, 'actual.svg');
  await submit();
  assert.equal(settings.get('company_logo'), newLogo);
  assert.equal(conversions.length, 1);
});

for (const view of ['settings', 'wizard']) {
  test(`${view} prevents a conflicting logo selection while saving and unlocks afterward`, async t => {
    let release;
    const { get, submit, emitNative, reads, settings, conversions } = await setup(t, {
      includeWizard: view === 'wizard', saveConfig: () => new Promise(resolve => { release = resolve; }),
    });
    if (view === 'wizard') await initWizard();
    const input = get(`${view}-company-logo`);
    input.files = [new File(['svg source'], 'guardando.svg')];
    await input.onchange();
    const saving = view === 'settings' ? submit() : get('wizard-form').onsubmit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, 'function', 'configuration save must be pending');
    assert.equal(input.disabled, true, 'the picker must be locked until persistence completes');
    await input.onchange();
    if (view === 'settings') {
      assert.equal(get('settings-company-logo-clear-btn').disabled, true);
      await get('settings-company-logo-clear-btn').onclick();
      await emitNative('tauri://drag-drop', { paths: ['C:\\Temp\\replacement.svg'], position: { x: 300, y: 300 } });
      await get('settings-company-logo-dropzone').ondrop({ dataTransfer: { files: [new File(['replacement'], 'replacement.svg')] }, preventDefault() {}, stopPropagation() {} });
      assert.deepEqual(reads, [], 'a drop during saving must not read a replacement');
    }
    release();
    await saving;
    assert.equal(input.disabled, false, 'the picker must remain usable after saving');
    if (view === 'settings') assert.equal(get('settings-company-logo-clear-btn').disabled, false);
    assert.equal(input.files[0].name, 'guardando.svg');
    assert.equal(settings.get('company_logo'), newLogo);
    assert.equal(conversions.length, 1);
  });
}

for (const fails of [false, true]) {
  test(`clearing the logo locks editing and saving until deletion ${fails ? 'fails' : 'completes'}`, async t => {
    let release;
    const { get, submit, submitButton, emitNative, reads, settings } = await setup(t, {
      deleteLogo: () => new Promise((resolve, reject) => { release = () => fails ? reject(new Error('database unavailable')) : resolve(); }),
    });
    const initialConfig = settings.get('company_config');
    const input = get('settings-company-logo');
    await input.onchange();
    const clearing = get('settings-company-logo-clear-btn').onclick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, 'function');
    assert.equal(input.disabled, true);
    assert.equal(submitButton.disabled, true);
    assert.equal(input.files.length, 0, 'pending selection must be invalidated before deletion');
    await emitNative('tauri://drag-drop', { paths: ['C:\\Temp\\new.svg'], position: { x: 300, y: 300 } });
    assert.deepEqual(reads, [], 'deletion must also block native replacement reads');
    await submit();
    assert.equal(settings.get('company_config'), initialConfig, 'saving must not overlap deletion');
    release();
    await clearing;
    assert.equal(input.disabled, false);
    assert.equal(submitButton.disabled, false);
    assert.equal(get('settings-company-logo-clear-btn').disabled, false);
    assert.equal(input.files.length, 0);
    assert.equal(settings.get('company_logo'), fails ? previousLogo : undefined);
  });
}
