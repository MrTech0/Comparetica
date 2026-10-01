import test from 'node:test';
import assert from 'node:assert/strict';
import { initCsvImporter } from '../src/js/csv_importer.js';

function element() {
  const classes = new Set();
  return {
    children: [], dataset: {}, style: {}, files: [],
    get value() { return this._value || ''; },
    set value(value) { this._value = value; if (value === '') this.files = []; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; this.children = []; },
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name)
    },
    getClientRects() { return [{ left: 0, top: 0, right: 500, bottom: 500 }]; },
    getBoundingClientRect() { return this.getClientRects()[0]; },
    addEventListener(type, callback) { this[`on${type}`] = callback; },
    appendChild(child) { this.children.push(child); return child; },
    remove() {}
  };
}

async function importerFixture(t, importBatch) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const nativeEvents = new Map();
  const bytes = new TextEncoder().encode('Nombre;CIF\nEmpresa de prueba;B12345674');
  let fileRead;
  const original = Object.fromEntries(['document', 'window', 'FileReader'].map(key => [key, globalThis[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  globalThis.document = { getElementById: get, createElement: element };
  globalThis.window = {
    __TAURI__: {
      core: { invoke: async (command, args) => {
        if (command === 'read_text_file') return Array.from(bytes);
        if (command === 'db_select') return [];
        assert.equal(command, 'db_import_clientes_batch');
        return importBatch(args);
      } },
      event: { listen: async (name, callback) => nativeEvents.set(name, callback) }
    }
  };
  globalThis.FileReader = class {
    readAsArrayBuffer(file) { fileRead = this.onload({ target: { result: file.bytes } }); }
  };
  for (const id of ['csv-step-2', 'csv-step-3', 'csv-progress-container']) get(id).classList.add('hidden');
  get('btn-csv-process-import').innerHTML = '<span>Iniciar Importación Masiva</span>';
  await initCsvImporter();
  return {
    get,
    async load(source = 'selection') {
      if (source === 'drop') {
        await nativeEvents.get('tauri://drag-drop')({ payload: { paths: ['C:\\Temp\\clientes.csv'] } });
      } else {
        const input = get('csv-file-input');
        input.value = 'C:\\fakepath\\clientes.csv';
        input.files = [{ name: 'clientes.csv', bytes }];
        input.onchange({ target: input });
        await fileRead;
      }
      assert.match(get('csv-file-info').textContent, /clientes.csv/);
      assert.equal(get('csv-preview-tbody').children.length, 1);
    },
    process: () => get('btn-csv-process-import').onclick()
  };
}

function assertReadyForNewFile(get) {
  assert.equal(get('csv-file-input').value, '');
  assert.equal(get('csv-file-input').files.length, 0);
  assert.equal(get('csv-file-info').textContent, '');
  for (const id of ['csv-mapping-rows', 'csv-preview-thead', 'csv-preview-tbody']) {
    assert.equal(get(id).children.length, 0, `${id} must release the previous file's content`);
  }
  assert.equal(get('csv-step-1').classList.contains('hidden'), false);
  for (const id of ['csv-step-2', 'csv-step-3', 'csv-progress-container']) {
    assert.equal(get(id).classList.contains('hidden'), true, id);
  }
  assert.equal(get('csv-progress-percent').textContent, '0%');
  assert.equal(get('csv-progress-bar').style.width, '0%');
  assert.equal(get('btn-csv-process-import').disabled, false);
  assert.equal(get('btn-csv-process-import').innerHTML, '<span>Iniciar Importación Masiva</span>');
  assert.match(get('toast-container').children.at(-1).innerText, /Importación completada: 1 creados, 0 actualizados/);
}

for (const source of ['selection', 'drop']) {
  test(`successful CSV import clears the ${source} and allows importing the same file again`, async t => {
    let batches = 0;
    const { get, load, process } = await importerFixture(t, args => {
      assert.equal(get('csv-step-2').classList.contains('hidden'), false, 'keep the file until the backend completes');
      assert.equal(get('btn-csv-process-import').disabled, true);
      assert.equal(args.rows.length, 1);
      assert.equal(args.rows[0].nombre_empresa, 'Empresa de prueba');
      assert.equal(args.rows[0].cif, 'B12345674');
      batches++;
      return [1, 0, 0];
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await load(source);
      await process();
      assertReadyForNewFile(get);
    }
    assert.equal(batches, 2);
  });
}

test('failed CSV import keeps the selected file and mappings so it can be retried', async t => {
  t.mock.method(console, 'error', () => {});
  let attempts = 0;
  const { get, load, process } = await importerFixture(t, args => {
    assert.equal(args.updateExisting, true);
    if (++attempts === 1) throw new Error('La base de datos no está disponible');
    return [1, 0, 0];
  });
  await load();
  get('csv-duplicate-update').checked = true;
  const mapping = get('csv-mapping-rows').children[0];
  const preview = get('csv-preview-tbody').children[0];
  await process();
  assert.equal(get('csv-file-input').files.length, 1);
  assert.match(get('csv-file-input').value, /clientes.csv/);
  assert.equal(get('csv-mapping-rows').children[0], mapping);
  assert.equal(get('csv-preview-tbody').children[0], preview);
  assert.equal(get('csv-step-2').classList.contains('hidden'), false);
  assert.equal(get('btn-csv-process-import').disabled, false);
  assert.match(get('toast-container').children.at(-1).innerText, /Error durante la importación/);
  await process();
  assertReadyForNewFile(get);
  assert.equal(attempts, 2);
});
