import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, previousLogo, newLogo } from '../test-support/company_settings.js';

test('a native logo save failure preserves the stored logo and reports an error', async t => {
  const { get, settings, local, submitButton, submit } = await setup(t, { failNative: true });
  await submit();
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.equal(local.get('company_logo'), previousLogo);
  assert.equal(get('settings-company-logo-preview').children[0].src, previousLogo);
  assert.ok(get('toast-container').children.some(toast => toast.className === 'm3-toast error'));
  assert.ok(!get('toast-container').children.some(toast => toast.className === 'm3-toast success'));
  assert.equal(submitButton.disabled, false, 'saving must be retryable after a failure');
});

test('saving a supported logo updates the stored logo and preview', async t => {
  const { get, settings, local, submitButton, submit } = await setup(t);
  await submit();
  assert.equal(settings.get('company_logo'), newLogo);
  assert.equal(local.get('company_logo'), newLogo);
  assert.equal(get('settings-company-logo-preview').children[0].src, newLogo);
  assert.ok(get('toast-container').children.some(toast => toast.className === 'm3-toast success'));
  assert.equal(submitButton.disabled, false);
});

test('an unsupported logo format preserves the stored logo', async t => {
  const { get, settings, local, submit } = await setup(t, { extension: 'txt' });
  await submit();
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.equal(local.get('company_logo'), previousLogo);
  assert.ok(get('toast-container').children.some(toast => toast.className === 'm3-toast error'));
  assert.ok(!get('toast-container').children.some(toast => toast.className === 'm3-toast success'));
  assert.equal(get('settings-company-logo').files.length, 0, 'an invalid file must be removed from the picker');
  assert.equal(get('settings-company-logo').value, '');
});

test('the picker clears an invalid logo immediately and accepts a later valid selection', async t => {
  const { get, settings, submit } = await setup(t);
  const input = get('settings-company-logo');
  input.files = [{ name: 'invalido.txt' }];
  assert.equal(typeof input.onchange, 'function', 'file selection must validate the chosen logo');
  input.onchange({ target: input });
  assert.equal(input.files.length, 0);
  assert.equal(input.value, '');
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.equal(get('settings-company-logo-preview').children[0].src, previousLogo);
  assert.match(get('toast-container').children.at(-1).innerText, /Formato de imagen no soportado/);

  input.files = [{ name: 'nuevo.png' }];
  input.onchange({ target: input });
  assert.equal(input.files.length, 1);
  await submit();
  assert.equal(settings.get('company_logo'), newLogo);
});

test('saving company text without a new logo preserves the existing logo', async t => {
  const { get, settings, submit } = await setup(t);
  get('settings-company-logo').files = [];
  get('settings-company-name').value = 'Consultora Actualizada';
  await submit();
  assert.equal(JSON.parse(settings.get('company_config')).consultora_nombre, 'Consultora Actualizada');
  assert.equal(settings.get('company_logo'), previousLogo);
  assert.equal(get('settings-company-logo-preview').children[0].src, previousLogo);
});
