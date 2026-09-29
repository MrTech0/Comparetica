import assert from 'node:assert/strict';
import { initSettingsView } from '../src/js/views/settings.js';

export const previousLogo = 'data:image/png;base64,bG9nbyBhbnRlcmlvcg==';
export const newLogo = 'data:image/png;base64,bG9nbyBudWV2bw==';

function element() {
  const classes = new Set();
  return {
    value: '', children: [], style: {}, files: [],
    dataset: {}, visible: true,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    getClientRects() { return this.visible ? [this.getBoundingClientRect()] : []; },
    getBoundingClientRect() { return { left: 100, top: 100, right: 400, bottom: 200 }; },
    addEventListener(type, callback) { this[`on${type}`] = callback; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    remove() {}
  };
}

export async function setup(t, { failNative = false, extension = 'png', includeCsv = false, readLogo = null } = {}) {
  const original = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, FileReader: globalThis.FileReader, DataTransfer: globalThis.DataTransfer };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});

  const nodes = new Map();
  for (const id of ['settings-company-form', 'settings-company-logo', 'settings-company-logo-preview', 'settings-company-logo-dropzone', 'toast-container',
    ...['name', 'street', 'number', 'cp', 'city', 'province', 'web', 'email', 'phone'].map(field => `settings-company-${field}`)]) {
    nodes.set(id, element());
  }
  const get = id => {
    if (includeCsv && /^(csv-|btn-csv-|btn-select-csv-|dialog-csv-)/.test(id) && !nodes.has(id)) {
      const node = element(); node.visible = false; nodes.set(id, node);
    }
    return nodes.get(id) || null;
  };
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
  const nativeEvents = new Map();
  const reads = [];
  globalThis.window = {
    devicePixelRatio: 2,
    __TAURI__: { core: { invoke: async (command, args = {}) => {
      if (command === 'read_dropped_logo_file') {
        reads.push(command);
        assert.equal(args.path, 'C:\\Temp\\logo-arrastrado.png');
        return readLogo ? await readLogo() : Array.from(new TextEncoder().encode('logo nuevo'));
      }
      if (command === 'read_text_file') {
        reads.push(command);
        return Array.from(new TextEncoder().encode('Nombre;CIF;Representante;Email\nConsultoría Muñoz;B12345674;José Núñez;prueba@example.com'));
      }
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
    } }, event: { listen: async (name, callback) => {
      if (!nativeEvents.has(name)) nativeEvents.set(name, []);
      nativeEvents.get(name).push(callback);
      return () => {};
    } } }
  };
  globalThis.DataTransfer = class {
    constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
  };
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = newLogo;
      queueMicrotask(() => this.onload());
    }
  };
  await initSettingsView();
  await new Promise(resolve => setImmediate(resolve));
  get('settings-company-logo').files = [{ name: `nuevo.${extension}` }];
  return { get, settings, local, submitButton, reads,
    emitNative: (name, payload) => Promise.all((nativeEvents.get(name) || []).map(callback => callback({ payload }))),
    submit: () => get('settings-company-form').onsubmit({ preventDefault() {} }) };
}
