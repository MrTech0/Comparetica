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
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; this.children = []; }
  };
}

test('CSV mapping separates company and agent names, ignores empty headers and prefers exact matches', async () => {
  const original = { document: globalThis.document, window: globalThis.window };
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const nativeEvents = new Map();
  let csv;
  globalThis.document = { getElementById: get, createElement: element };
  globalThis.window = {
    __TAURI__: {
      core: { invoke: async command => {
        assert.equal(command, 'read_text_file');
        return Array.from(new TextEncoder().encode(csv));
      } },
      event: { listen: async (name, callback) => nativeEvents.set(name, callback) }
    }
  };
  const cases = [
    {
      name: 'Nombre is only the company name',
      csv: fs.readFileSync(new URL('fixtures/clientes-sin-agente.csv', import.meta.url), 'utf8'),
      expected: { nombre_empresa: '0', cif: '1', representante: '2', email: '3' }
    },
    {
      name: 'Agente is mapped to the agent',
      csv: fs.readFileSync(new URL('fixtures/clientes-con-agente.csv', import.meta.url), 'utf8'),
      expected: { nombre_empresa: '0', cif: '1', agente_nombre: '2', representante: '3', email: '4' }
    },
    {
      name: 'Comercial is mapped to the agent',
      csv: 'Nombre;CIF;Comercial\nEmpresa;B12345674;Ana López',
      expected: { nombre_empresa: '0', cif: '1', agente_nombre: '2' }
    },
    {
      name: 'empty headers do not match any CRM field',
      csv: ';Nombre;CIF\n;Empresa;B12345674',
      expected: { nombre_empresa: '1', cif: '2' }
    },
    {
      name: 'an exact synonym takes precedence over an earlier partial match',
      csv: 'Cliente nombre empresa;Nombre;CIF\nAnterior;Empresa;B12345674',
      expected: { nombre_empresa: '1', cif: '2' }
    },
    {
      name: 'short contract date headers remain recognized',
      csv: 'Nombre;CIF;Firma;Vencimiento\nEmpresa;B12345674;2026-09-01;2027-09-01',
      expected: { nombre_empresa: '0', cif: '1', fecha_firma: '2', fecha_vencimiento: '3' }
    }
  ];

  try {
    await initCsvImporter();
    for (const scenario of cases) {
      csv = scenario.csv;
      get('btn-csv-reset').onclick();
      await nativeEvents.get('tauri://drag-drop')({ payload: { paths: ['C:\\Temp\\clientes.csv'] } });
      const selects = get('csv-mapping-rows').children.map(row => row.children[1].children[0]);
      for (const select of selects) {
        const selected = select.children.find(option => option.selected)?.value || '-1';
        assert.equal(selected, scenario.expected[select.dataset.crmColumn] || '-1', `${scenario.name}: ${select.dataset.crmColumn}`);
      }
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
