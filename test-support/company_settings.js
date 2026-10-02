import assert from 'node:assert/strict';
import { initSettingsView } from '../src/js/views/settings.js';
import { showToast } from '../src/js/ui.js';

export const previousLogo = 'data:image/png;base64,bG9nbyBhbnRlcmlvcg==';
export const newLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFUlEQVR4nGN85WzawIAHMOGTHD4KAPZYAfKVaiJXAAAAAElFTkSuQmCC';

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

export async function setup(t, { failNative = false, extension = 'svg', includeCsv = false, includeWizard = false, readLogo = null, saveConfig = null, deleteLogo = null, imageDimensions = { width: 128, height: 128 } } = {}) {
  const original = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, FileReader: globalThis.FileReader, DataTransfer: globalThis.DataTransfer, Image: globalThis.Image };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});

  const nodes = new Map();
  for (const id of ['settings-company-form', 'settings-company-logo', 'settings-company-logo-preview', 'settings-company-logo-dropzone', 'settings-company-logo-clear-btn', 'toast-container',
    ...(includeWizard ? ['dialog-welcome-wizard', 'wizard-company-logo', 'wizard-form', 'wizard-submit-btn',
      ...['name', 'street', 'number', 'cp', 'city', 'province', 'web', 'email', 'phone'].map(field => `wizard-company-${field}`), 'wizard-agent-name'] : []),
    ...['name', 'street', 'number', 'cp', 'city', 'province', 'web', 'email', 'phone'].map(field => `settings-company-${field}`)]) {
    nodes.set(id, element());
  }
  const get = id => {
    if (includeCsv && /^(csv-|btn-csv-|btn-select-csv-|dialog-csv-)/.test(id) && !nodes.has(id)) {
      const node = element(); node.visible = false; nodes.set(id, node);
    }
    return nodes.get(id) || null;
  };
  for (const logoInput of [get('settings-company-logo'), get('wizard-company-logo')].filter(Boolean)) {
    let selectedFiles = [];
    Object.defineProperties(logoInput, {
      files: { get: () => selectedFiles, set: files => { selectedFiles = files; } },
      value: {
        get: () => selectedFiles[0] ? `C:\\fakepath\\${selectedFiles[0].name}` : '',
        set: value => { assert.equal(value, ''); selectedFiles = []; }
      }
    });
  }
  if (includeWizard) {
    get('wizard-company-name').value = 'Consultora Demo';
    get('wizard-agent-name').value = 'Agente Demo';
  }
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
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
  const conversions = [];
  globalThis.document = { getElementById: get, createElement: tag => {
    if (tag !== 'canvas') return element();
    const canvas = { width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: type => { assert.equal(type, 'image/png'); conversions.push({ width: canvas.width, height: canvas.height }); return newLogo; } };
    return canvas;
  }, querySelectorAll: () => [], documentElement: { setAttribute() {} } };
  const nativeEvents = new Map();
  const reads = [];
  globalThis.window = {
    showToast,
    devicePixelRatio: 2,
    __TAURI__: { core: { invoke: async (command, args = {}) => {
      if (command === 'read_dropped_logo_file') {
        reads.push(command);
        assert.match(args.path, /^C:\\Temp\\[^\\]+$/);
        return readLogo ? await readLogo() : Array.from(new TextEncoder().encode('logo nuevo'));
      }
      if (command === 'read_text_file') {
        reads.push(command);
        return Array.from(new TextEncoder().encode('Nombre;CIF;Representante;Email\nConsultoría Muñoz;B12345674;José Núñez;prueba@example.com'));
      }
      if (command === 'db_select') {
        if (/^SELECT id FROM comparativas/.test(args.query)) return [];
        assert.match(args.query, /SELECT valor FROM ajustes/);
        if (args.params[0] === 'company_logo' && !settings.has('company_logo')) return [];
        assert.ok(settings.has(args.params[0]));
        return [{ valor: settings.get(args.params[0]) }];
      }
      if (command === 'db_execute') {
        if (args.query === "DELETE FROM ajustes WHERE clave = 'company_logo';") {
          if (deleteLogo) await deleteLogo();
          settings.delete('company_logo');
          return { rows_affected: 1 };
        }
        assert.match(args.query, /INSERT INTO ajustes/);
        settings.set(args.params[0], args.params[1]);
        return { rows_affected: 1, last_insert_id: 0 };
      }
      if (command === 'save_company_config') return saveConfig ? await saveConfig() : undefined;
      if (command === 'delete_company_logo') return;
      if (command === 'get_company_logo') return null;
      if (command === 'get_default_backup_path') return 'C:\\Temp\\Comparetica_backups';
      if (command === 'setup_backup_directory') return;
      if (command === 'save_company_logo') {
        assert.equal(args.base64Data, newLogo.split(',')[1]);
        assert.equal(args.extension, 'png');
        if (failNative) throw new Error('No se puede escribir el archivo de logotipo');
        if (extension === 'txt') throw new Error('Formato de imagen no soportado');
        return 'logo.png';
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
  if (imageDimensions !== undefined) {
    globalThis.Image = class {
      set src(value) {
        queueMicrotask(async () => {
          const dimensions = typeof imageDimensions === 'function' ? await imageDimensions(value) : imageDimensions;
          if (!dimensions) { this.onerror(); return; }
          this.naturalWidth = dimensions.width;
          this.naturalHeight = dimensions.height;
          this.onload();
        });
      }
    };
  }
  await initSettingsView();
  await new Promise(resolve => setImmediate(resolve));
  get('settings-company-logo').files = [new File(['logo nuevo'], `nuevo.${extension}`, { type: 'image/svg+xml' })];
  return { get, settings, local, submitButton, reads, conversions,
    emitNative: (name, payload) => Promise.all((nativeEvents.get(name) || []).map(callback => callback({ payload }))),
    submit: () => get('settings-company-form').onsubmit({ preventDefault() {} }) };
}
