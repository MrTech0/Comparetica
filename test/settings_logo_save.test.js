import test from 'node:test';
import assert from 'node:assert/strict';
import { initSettingsView } from '../src/js/views/settings.js';

const previousLogo = 'data:image/png;base64,bG9nbyBhbnRlcmlvcg==';
const newLogo = 'data:image/png;base64,bG9nbyBudWV2bw==';

function element() {
  return {
    value: '', children: [], style: {}, files: [],
    classList: { add() {}, remove() {} },
    addEventListener(type, callback) { this[`on${type}`] = callback; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    remove() {}
  };
}

async function setup(t, { failNative = false, extension = 'png' } = {}) {
  const original = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, FileReader: globalThis.FileReader };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});

  const nodes = new Map();
  for (const id of ['settings-company-form', 'settings-company-logo', 'settings-company-logo-preview', 'toast-container',
    ...['name', 'street', 'number', 'cp', 'city', 'province', 'web', 'email', 'phone'].map(field => `settings-company-${field}`)]) {
    nodes.set(id, element());
  }
  const get = id => nodes.get(id) || null;
  const logoInput = get('settings-company-logo');
  let selectedFiles = [];
  Object.defineProperties(logoInput, {
    files: { get: () => selectedFiles, set: files => { selectedFiles = files; } },
    value: {
      get: () => selectedFiles[0] ? `C:\\fakepath\\${selectedFiles[0].name}` : '',
      set: value => { assert.equal(value, ''); selectedFiles = []; }
    }
  });
  const submitButton = element();
  get('settings-company-form').querySelector = selector => {
    assert.equal(selector, 'button[type="submit"]');
    return submitButton;
  };
  const settings = new Map([
    ['company_config', JSON.stringify({ consultora_nombre: 'Consultora Demo' })],
    ['company_logo', previousLogo],
    ['renewal_thresholds', JSON.stringify({ critical: 30, warning: 60, radar: 90 })],
    ['client_inactivity_params', JSON.stringify({ mesesNuevo: 3, diasVencimiento: 30 })]
  ]);
  const local = new Map([['company_logo', previousLogo]]);
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
  globalThis.document = { getElementById: get, createElement: element, querySelectorAll: () => [], documentElement: { setAttribute() {} } };
  globalThis.window = {
    __TAURI__: { core: { invoke: async (command, args = {}) => {
      if (command === 'db_select') {
        assert.match(args.query, /SELECT valor FROM ajustes/);
        assert.ok(settings.has(args.params[0]));
        return [{ valor: settings.get(args.params[0]) }];
      }
      if (command === 'db_execute') {
        assert.match(args.query, /INSERT INTO ajustes/);
        settings.set(args.params[0], args.params[1]);
        return { rows_affected: 1, last_insert_id: 0 };
      }
      if (command === 'save_company_config') return;
      if (command === 'save_company_logo') {
        assert.equal(args.base64Data, 'bG9nbyBudWV2bw==');
        assert.equal(args.extension, extension);
        if (failNative) throw new Error('No se puede escribir el archivo de logotipo');
        if (extension === 'txt') throw new Error('Formato de imagen no soportado');
        return `logo.${extension}`;
      }
      throw new Error(`Unexpected command: ${command}`);
    } } }
  };
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = newLogo;
      queueMicrotask(() => this.onload());
    }
  };
  await initSettingsView();
  get('settings-company-logo').files = [{ name: `nuevo.${extension}` }];
  return { get, settings, local, submitButton, submit: () => get('settings-company-form').onsubmit({ preventDefault() {} }) };
}

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
