import test from 'node:test';
import assert from 'node:assert/strict';

const comparisons = [
  { id: 1, cliente_nombre: 'Consultoría Muñoz', cliente_cups: 'ES002100001ALPHA', fecha: '2026-10-01', estado: 'Aceptada', estado_contrato: 'En trámite', estado_cobro: 'Cobrado', ahorro_luz_anual: 200 },
  { id: 2, cliente_nombre: 'Consultoría Muñoz', cliente_cups: 'ES003100002BETA', fecha: '2026-10-02', estado: 'Pendiente de aceptación', ahorro_luz_anual: 100 },
  { id: 3, cliente_nombre: 'Alpha Servicios', cliente_cups: 'ES002100003GAMMA', fecha: '2026-10-03', estado: 'Rechazada', ahorro_luz_anual: 300 },
  { id: 4, cliente_nombre: null, cliente_cups: null, fecha: '2026-09-30', ahorro_luz_anual: 0 }
].map(c => ({ tipo_energia: 'Luz', ahorro_gas_anual: 0, comision_total: 10, ...c }));
let caseId = 0;

function element() {
  const classes = new Set();
  const listeners = new Map();
  const queries = new Map();
  return {
    children: [], dataset: {}, style: {}, value: '', textContent: '', open: false,
    classList: {
      add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
      toggle(x, force) { const add = force ?? !classes.has(x); if (add) classes.add(x); else classes.delete(x); }
    },
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    fire(type, event = {}) { for (const callback of listeners.get(type) || []) callback({ target: this, preventDefault() {}, stopPropagation() {}, ...event }); },
    get listenerCount() { return listeners.get('input')?.length || 0; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(html) { this._html = html; this.children = []; },
    appendChild(child) { this.children.push(child); return child; },
    querySelector(selector) { if (!queries.has(selector)) queries.set(selector, element()); return queries.get(selector); },
    querySelectorAll() { return []; },
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name]; },
    contains(target) { return target === this; },
    focus() { this.focused = true; }
  };
}

async function mount(t) {
  const original = { document: globalThis.document, window: globalThis.window };
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const tbody = element();
  const container = element();
  const filters = {
    'dropdown-history-estado-filter': ['ALL', 'Aceptada', 'Pendiente de aceptación', 'Rechazada'].map(value => Object.assign(element(), { 'data-estado': value })),
    'dropdown-history-contract-filter': ['ALL', 'En trámite'].map(value => Object.assign(element(), { 'data-contract': value })),
    'dropdown-history-cobro-filter': ['ALL', 'COBRADO', 'PENDIENTE'].map(value => Object.assign(element(), { 'data-cobro': value }))
  };
  for (const [id, items] of Object.entries(filters)) get(id).querySelectorAll = () => items;
  globalThis.document = {
    getElementById: get, createElement: element, addEventListener() {},
    querySelector: selector => selector === '#table-history tbody' ? tbody : container,
    querySelectorAll: () => []
  };
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    __TAURI__: { core: { invoke: async (command, args) => {
      assert.equal(command, 'db_select');
      if (/^SELECT id FROM comparativas/.test(args.query)) return [];
      assert.match(args.query, /FROM comparativas c/);
      return comparisons;
    } } }
  };
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const view = await import(`../src/js/views/history.js?column-search-case=${++caseId}`);
  await view.initHistoryView();
  const ids = () => tbody.children.map(row => Number(row.innerHTML.match(/data-id="(\d+)"/)[1]));
  const search = (column, value) => { const input = get(`search-history-${column}`); input.value = value; input.fire('input'); };
  return { get, tbody, ids, search, view, filters };
}

test('history client and CUPS searches match only their own column', async t => {
  const f = await mount(t);
  f.search('client', '  MUNOZ  ');
  assert.deepEqual(f.ids(), [2, 1], 'client search ignores case, accents and outer whitespace');
  f.search('client', 'ES002');
  assert.deepEqual(f.ids(), [], 'a client search must not match a CUPS');
  assert.match(f.tbody.innerHTML, /No se encontraron comparativas con los filtros aplicados/);
  f.search('client', '');
  f.search('cups', 'muñoz');
  assert.deepEqual(f.ids(), [], 'a CUPS search must not match a client name');
  f.search('cups', ' es002 ');
  assert.deepEqual(f.ids(), [3, 1]);
});

test('history column searches combine and clearing one preserves the other', async t => {
  const f = await mount(t);
  f.search('client', 'Muñoz');
  f.search('cups', '0021');
  assert.deepEqual(f.ids(), [1]);
  assert.equal(f.get('history-client-search').classList.contains('is-filtered'), true);
  assert.equal(f.get('history-cups-search').classList.contains('is-filtered'), true);
  f.get('btn-clear-history-client').fire('click');
  assert.equal(f.get('search-history-client').value, '');
  assert.deepEqual(f.ids(), [3, 1]);
  assert.equal(f.get('history-client-search').classList.contains('is-filtered'), false);
  assert.equal(f.get('search-history-cups').value, '0021');
  f.get('btn-clear-history-cups').fire('click');
  assert.deepEqual(f.ids(), [3, 2, 1, 4]);
});

test('history column search preserves status filtering and date or savings ordering', async t => {
  const f = await mount(t);
  f.search('client', 'Muñoz');
  f.get('th-history-date').fire('click');
  assert.deepEqual(f.ids(), [1, 2]);
  f.get('th-history-savings').fire('click');
  assert.deepEqual(f.ids(), [1, 2]);
  f.filters['dropdown-history-estado-filter'][1].fire('click');
  assert.deepEqual(f.ids(), [1]);
  f.search('cups', 'BETA');
  assert.deepEqual(f.ids(), []);
  f.filters['dropdown-history-estado-filter'][0].fire('click');
  assert.deepEqual(f.ids(), [2]);
});

test('history search disclosures focus the field and Escape closes without clearing its filter', async t => {
  const f = await mount(t);
  const details = f.get('history-client-search');
  details.open = true;
  details.fire('toggle');
  assert.equal(f.get('search-history-client').focused, true);
  f.search('client', 'Muñoz');
  f.get('search-history-client').fire('keydown', { key: 'Escape' });
  assert.equal(details.open, false);
  assert.equal(details.querySelector('summary').focused, true);
  assert.deepEqual(f.ids(), [2, 1]);
  assert.equal(details.classList.contains('is-filtered'), true);
});

test('reentering history resets both searches without installing duplicate input handlers', async t => {
  const f = await mount(t);
  f.search('client', 'Muñoz');
  f.search('cups', 'BETA');
  f.get('history-client-search').open = true;
  await f.view.initHistoryView();
  assert.equal(f.get('search-history-client').value, '');
  assert.equal(f.get('search-history-cups').value, '');
  assert.equal(f.get('history-client-search').open, false);
  assert.equal(f.get('history-client-search').classList.contains('is-filtered'), false);
  assert.deepEqual(f.ids(), [3, 2, 1, 4]);
  assert.equal(f.get('search-history-client').listenerCount, 1);
});
