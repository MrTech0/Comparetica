import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initCsvImporter } from '../src/js/csv_importer.js';

function element() {
  const classes = new Set();
  return {
    children: [],
    dataset: {},
    style: {},
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name)
    },
    addEventListener(type, callback) { this[`on${type}`] = callback; },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; this.children = []; }
  };
}

test('CSV drop and file selection preserve encoding, multiline records and reject malformed quoting', async () => {
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    FileReader: globalThis.FileReader
  };
  const utf8 = fs.readFileSync(new URL('fixtures/clientes-utf8.csv', import.meta.url));
  const windows1252 = fs.readFileSync(new URL('fixtures/clientes-windows1252.csv', import.meta.url));
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const nativeEvents = new Map();
  let droppedBytes = utf8;
  let fileRead;
  globalThis.document = { getElementById: get, createElement: element };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async command => {
          assert.equal(command, 'read_text_file');
          return Array.from(droppedBytes);
        }
      },
      event: { listen: async (name, callback) => nativeEvents.set(name, callback) }
    }
  };
  globalThis.FileReader = class {
    readAsArrayBuffer(file) {
      fileRead = this.onload({ target: { result: file.bytes } });
    }
  };

  const assertPreview = () => {
    const cells = get('csv-preview-tbody').children[0]?.children;
    assert.ok(cells, 'CSV data must reach the preview');
    const headings = get('csv-preview-thead').children[0].children.map(cell => cell.textContent);
    assert.equal(cells[headings.indexOf('Nombre / Empresa')].textContent, 'Consultoría Muñoz');
    assert.equal(cells[headings.indexOf('Representante')].textContent, 'José Núñez');
    assert.ok(get('csv-step-1').classList.contains('hidden'));
  };
  const drop = () => nativeEvents.get('tauri://drag-drop')({ payload: { paths: ['C:\\Temp\\clientes.csv'] } });

  try {
    await initCsvImporter();
    await drop();
    assertPreview();
    assert.ok(!get('dialog-csv-encoding').classList.contains('active'), 'UTF-8 must not ask for conversion');

    get('btn-csv-reset').onclick();
    droppedBytes = windows1252;
    await drop();
    assert.ok(get('dialog-csv-encoding').classList.contains('active'), 'Windows-1252 must offer conversion');
    assert.ok(!get('csv-step-1').classList.contains('hidden'), 'preview must wait for confirmation');
    get('btn-csv-encoding-cancel').onclick();
    assert.ok(!get('dialog-csv-encoding').classList.contains('active'));
    assert.ok(!get('csv-step-1').classList.contains('hidden'));

    await drop();
    await get('btn-csv-encoding-convert').onclick();
    assertPreview();

    get('btn-csv-reset').onclick();
    const multiline = fs.readFileSync(new URL('fixtures/clientes-multilinea.csv', import.meta.url));
    const newline = multiline.toString('utf8').includes('\r\n') ? '\r\n' : '\n';
    get('csv-file-input').onchange({ target: { files: [{ name: 'clientes.csv', bytes: multiline }] } });
    await fileRead;
    const headings = get('csv-preview-thead').children[0].children.map(cell => cell.textContent);
    const preview = get('csv-preview-tbody').children;
    assert.equal(preview.length, 2);
    assert.match(get('csv-file-info').textContent, /2 filas encontradas/);
    assert.equal(preview[0].children[headings.indexOf('Nombre / Empresa')].textContent, 'Consultoría "Muñoz"');
    assert.equal(preview[0].children[headings.indexOf('Representante')].textContent, `José${newline}Núñez`);
    assert.equal(preview[1].children[headings.indexOf('Nombre / Empresa')].textContent, 'Luz, Gas y Servicios; S.L.');

    get('btn-csv-reset').onclick();
    get('csv-file-input').onchange({ target: { files: [{ name: 'clientes.csv', bytes: windows1252 }] } });
    await fileRead;
    assert.ok(get('dialog-csv-encoding').classList.contains('active'), 'file selection must also offer conversion');
    await get('btn-csv-encoding-convert').onclick();
    assertPreview();

    get('btn-csv-reset').onclick();
    droppedBytes = fs.readFileSync(new URL('fixtures/clientes-comillas-sin-cerrar.csv', import.meta.url));
    await drop();
    assert.ok(!get('csv-step-1').classList.contains('hidden'), 'an invalid CSV must not reach the preview');
    assert.ok(get('csv-step-2').classList.contains('hidden'));
    assert.ok(!get('dialog-csv-encoding').classList.contains('active'), 'invalid quoting must not be treated as an encoding problem');
    assert.match(get('toast-container').children.at(-1)?.innerText || '', /comillas sin cerrar/);

    droppedBytes = utf8;
    await drop();
    assertPreview();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
