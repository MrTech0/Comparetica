import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCommission } from '../src/js/commission_split.js';

function withSplit(record, percent = 10000) {
  return { ...record, reparto_comision_json: JSON.stringify({ version: 1, cliente_id: 1, cliente_nombre: record.cliente_nombre || '', agente_id: 1, agente_nombre: 'Ana', retencion_id: 1, retencion_nombre: 'General', porcentaje_centesimas: percent, ...splitCommission(record.comision_total, percent) }) };
}

const comparisons = [
  { id: 1, cliente_nombre: 'Consultoría Muñoz', cliente_cups: 'ES002100001ALPHA', fecha: '2026-10-01', estado: 'Aceptada', estado_contrato: 'En trámite', estado_cobro: 'Cobrado', ahorro_luz_anual: 200, tipo_energia: 'LUZ', comision_total: 20 },
  { id: 2, cliente_nombre: 'Consultoría Muñoz', cliente_cups: 'ES003100002BETA', fecha: '2026-10-02', estado: 'Pendiente de aceptación', ahorro_luz_anual: 100, tipo_energia: 'GAS', comision_total: 100 },
  { id: 3, cliente_nombre: 'Alpha Servicios', cliente_cups: 'ES002100003GAMMA', fecha: '2026-10-03', estado: 'Rechazada', ahorro_luz_anual: 300, tipo_energia: 'Luz', comision_total: 9.5 },
  { id: 4, cliente_nombre: null, cliente_cups: null, fecha: '2026-09-30', ahorro_luz_anual: 0, tipo_energia: 'DUAL', comision_total: 0 }
].map(c => withSplit({ tipo_energia: 'Luz', ahorro_gas_anual: 0, comision_total: 10, ...c }));
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

async function mount(t, records = comparisons) {
  const original = { document: globalThis.document, window: globalThis.window };
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const tbody = element();
  const container = element();
  const appListeners = new Map();
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
    addEventListener(name, handler) { appListeners.set(name, handler); },
    removeEventListener(name) { appListeners.delete(name); },
    __TAURI__: { core: { invoke: async (command, args) => {
      assert.equal(command, 'db_select');
      if (/^SELECT id FROM comparativas/.test(args.query)) return [];
      assert.match(args.query, /FROM comparativas c/);
      return records;
    } } }
  };
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const view = await import(`../src/js/views/history.js?column-search-case=${++caseId}`);
  await view.initHistoryView();
  const ids = () => tbody.children.map(row => Number(row.innerHTML.match(/data-id="(\d+)"/)[1]));
  const search = (column, value) => { const input = get(`search-history-${column}`); input.value = value; input.fire('input'); };
  const supply = value => { const select = get('filter-history-type'); select.value = value; select.fire('change'); };
  return { get, tbody, ids, search, supply, view, filters, refresh: () => appListeners.get('comparison-saved')() };
}

test('historial: neto de consultoría, comercial, detalle y ordenación sin mezclar históricos', async t => {
  const records = [withSplit({ ...comparisons[0], comision_total: 100 }, 2000), withSplit({ ...comparisons[1], comision_total: 50 }, 8000),
    { ...comparisons[2], comision_total: 900, reparto_comision_json: null }, { ...comparisons[3], comision_total: 500, reparto_comision_json: null }];
  const f = await mount(t, records);
  const first = f.tbody.children.find(row => row.innerHTML.includes('data-id="1"'));
  assert.match(first.innerHTML, /20,00 €/);
  const summary = first.innerHTML.match(/<summary\b([^>]*)>([\s\S]*?)<\/summary>/);
  const accessibleName = summary[1].match(/aria-label="([^"]*)"/)?.[1] ?? summary[2].replace(/<[^>]*>/g, '');
  assert.match(accessibleName, /20,00 €/, 'el lector de pantalla debe anunciar la comisión de la consultoría sin desplegar el detalle');
  assert.match(first.innerHTML, /80,00 €/);
  assert.match(first.innerHTML, /Total del contrato.*100,00 €/s);
  assert.match(first.innerHTML, /Ana/);
  assert.match(first.innerHTML, /Retención: 20 %/);
  assert.doesNotMatch(first.innerHTML, /General/, 'los repartos anteriores muestran el porcentaje sin el antiguo nombre de la retención');
  assert.match(f.tbody.children.find(row => row.innerHTML.includes('data-id="3"')).innerHTML, /Sin reparto registrado/);
  f.get('btn-history-commission-sort').fire('click');
  assert.deepEqual(f.ids(), [2, 1, 3, 4]);
  f.get('btn-history-commission-sort').fire('click');
  assert.deepEqual(f.ids(), [1, 2, 3, 4]);
});

test('resúmenes: aceptación, firma y solo comisiones de contratos activados pendientes de cobro', async t => {
  const accepted = { ...comparisons[0], estado: 'Aceptada', estado_contrato: 'Firmado y Activado' };
  const records = [withSplit({ ...accepted, id: 1, comision_total: 100, estado_cobro: 'Pendiente' }, 2000),
    withSplit({ ...accepted, id: 2, comision_total: 100, estado_cobro: 'Cobrado' }, 3000),
    { ...accepted, id: 3, comision_total: 400, estado_contrato: 'En trámite', estado_cobro: 'Pendiente', reparto_comision_json: null },
    { ...accepted, id: 4, comision_total: 500, estado_cobro: 'Cobrado', reparto_comision_json: null },
    withSplit({ ...accepted, id: 5, comision_total: 100, estado_cobro: 'Pendiente', estado_contrato: 'Rechazado por Scoring' }, 5000),
    { ...comparisons[1], id: 6 },
    { ...comparisons[3], id: 7, estado: null },
    withSplit({ ...accepted, id: 8, estado_contrato: 'Pendiente', comision_total: 100 }, 5000),
    withSplit({ ...accepted, id: 9, estado_contrato: 'En trámite', comision_total: 100 }, 5000),
    { ...accepted, id: 10, comision_total: 600, estado_cobro: 'Pendiente', reparto_comision_json: null }];
  const f = await mount(t, records);
  assert.equal(f.get('history-kpi-pendientes').textContent, '20,00 €');
  assert.equal(f.get('history-kpi-acceptance-pending').textContent, '2');
  assert.equal(f.get('history-kpi-signature-pending').textContent, '2');
  assert.equal(f.get('history-legacy-pendientes').textContent, '600,00 €');
  assert.equal(f.get('history-legacy-cobradas').textContent, '500,00 €');
  assert.equal(f.get('history-legacy-commissions').hidden, false);
});

function paginatedRecords(count = 51) {
  return Array.from({ length: count }, (_, index) => withSplit({
    ...comparisons[1], id: index + 1, cliente_nombre: index === 0 ? 'Fuera de página' : `Cliente ${index + 1}`,
    cliente_cups: `ES${index + 1}`, tipo_energia: index < 30 ? 'GAS' : 'LUZ', comision_total: index + 1,
    estado_contrato: 'Pendiente', fecha: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString()
  }));
}

test('paginación: 51 comparativas se reparten en 25, 25 y 1, sin perder ni repetir registros', async t => {
  const f = await mount(t, paginatedRecords());
  const pageOne = f.ids();
  assert.equal(pageOne.length, 25);
  assert.equal(pageOne[0], 51);
  assert.equal(pageOne.at(-1), 27);
  assert.equal(f.get('btn-prev-page-history').disabled, true);
  assert.equal(f.get('btn-next-page-history').disabled, false);
  assert.equal(f.get('history-pagination-info').textContent, 'Mostrando 1 - 25 de 51 comparativas');
  assert.equal(f.get('history-kpi-acceptance-pending').textContent, '51', 'los indicadores incluyen las páginas que no se ven');
  f.get('btn-next-page-history').fire('click');
  const pageTwo = f.ids();
  assert.equal(pageTwo.length, 25);
  assert.equal(pageTwo[0], 26);
  assert.equal(pageTwo.at(-1), 2);
  assert.equal(f.get('history-page-indicator').textContent, 'Página 2 de 3');
  f.get('btn-next-page-history').fire('click');
  assert.deepEqual(f.ids(), [1]);
  assert.equal(f.get('btn-next-page-history').disabled, true);
  assert.equal(new Set([...pageOne, ...pageTwo, ...f.ids()]).size, 51);
  f.get('btn-next-page-history').fire('click');
  assert.deepEqual(f.ids(), [1], 'una acción antigua no puede pasar de la última página');
  f.get('btn-prev-page-history').fire('click');
  assert.deepEqual(f.ids(), pageTwo);
});

for (const count of [0, 25]) {
  test(`paginación: ${count} resultados dejan ambos botones deshabilitados`, async t => {
    const f = await mount(t, paginatedRecords(count));
    assert.equal(f.ids().length, count);
    assert.equal(f.get('btn-prev-page-history').disabled, true);
    assert.equal(f.get('btn-next-page-history').disabled, true);
    assert.equal(f.get('history-page-indicator').textContent, 'Página 1 de 1');
    if (count === 0) assert.equal(f.get('history-pagination-info').textContent, 'Mostrando 0 - 0 de 0 comparativas');
  });
}

test('búsquedas y filtros abarcan todas las páginas y vuelven a la primera al cambiar', async t => {
  const f = await mount(t, paginatedRecords());
  f.get('btn-next-page-history').fire('click');
  f.search('client', 'Fuera de página');
  assert.deepEqual(f.ids(), [1]);
  assert.equal(f.get('history-page-indicator').textContent, 'Página 1 de 1');
  assert.equal(f.get('history-kpi-acceptance-pending').textContent, '51');
  f.get('btn-clear-history-client').fire('click');
  assert.equal(f.ids()[0], 51);
  f.get('btn-next-page-history').fire('click');
  f.supply('GAS');
  assert.equal(f.ids().length, 25);
  assert.equal(f.ids()[0], 30);
  assert.equal(f.get('history-page-indicator').textContent, 'Página 1 de 2');
  f.get('btn-next-page-history').fire('click');
  assert.deepEqual(f.ids(), [5, 4, 3, 2, 1]);
  f.search('cups', 'no existe');
  assert.deepEqual(f.ids(), []);
  assert.equal(f.get('history-page-indicator').textContent, 'Página 1 de 1');
  assert.equal(f.get('btn-next-page-history').disabled, true);
});

test('la ordenación se aplica a todo el historial antes de paginar y reinicia la página', async t => {
  const f = await mount(t, paginatedRecords());
  f.get('btn-next-page-history').fire('click');
  f.get('th-history-date').fire('click');
  assert.equal(f.ids().length, 25);
  assert.equal(f.ids()[0], 1);
  assert.equal(f.ids().at(-1), 25);
  assert.equal(f.get('history-page-indicator').textContent, 'Página 1 de 3');
  f.get('btn-next-page-history').fire('click');
  f.get('btn-history-commission-sort').fire('click');
  assert.equal(f.ids()[0], 51);
  assert.equal(f.ids().at(-1), 27);
  assert.equal(f.get('history-page-indicator').textContent, 'Página 1 de 3');
});

test('actualizar conserva la página si existe y retrocede cuando desaparece la última', async t => {
  const records = paginatedRecords();
  const f = await mount(t, records);
  f.get('btn-next-page-history').fire('click');
  await f.refresh();
  assert.equal(f.get('history-page-indicator').textContent, 'Página 2 de 3');
  f.get('btn-next-page-history').fire('click');
  records.splice(0, 1);
  await f.refresh();
  assert.equal(f.get('history-page-indicator').textContent, 'Página 2 de 2');
  assert.equal(f.ids().length, 25);
  await f.view.initHistoryView();
  assert.equal(f.get('history-page-indicator').textContent, 'Página 1 de 2');
  f.get('btn-next-page-history').fire('click');
  assert.equal(f.get('history-page-indicator').textContent, 'Página 2 de 2', 'reabrir no duplica las acciones de los botones');
});

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

test('history supply filter selects electricity, gas and dual comparisons', async t => {
  const f = await mount(t);
  f.supply('LUZ');
  assert.deepEqual(f.ids(), [3, 1], 'legacy mixed-case supply names still match');
  f.supply('GAS');
  assert.deepEqual(f.ids(), [2]);
  f.supply('DUAL');
  assert.deepEqual(f.ids(), [4]);
  f.supply('ALL');
  assert.deepEqual(f.ids(), [3, 2, 1, 4]);
});

test('history supply filter combines with both searches and all status filters', async t => {
  const f = await mount(t);
  f.search('client', 'Muñoz');
  f.search('cups', 'ALPHA');
  f.filters['dropdown-history-estado-filter'][1].fire('click');
  f.filters['dropdown-history-contract-filter'][1].fire('click');
  f.filters['dropdown-history-cobro-filter'][1].fire('click');
  f.supply('GAS');
  assert.deepEqual(f.ids(), []);
  assert.match(f.tbody.innerHTML, /No se encontraron comparativas con los filtros aplicados/);
  f.supply('LUZ');
  assert.deepEqual(f.ids(), [1]);
  f.supply('ALL');
  assert.deepEqual(f.ids(), [1], 'clearing type preserves the other filters');
});

test('history commission sorting is numeric in both directions, including zero amounts', async t => {
  const f = await mount(t);
  f.get('btn-history-commission-sort').fire('click');
  assert.deepEqual(f.ids(), [2, 1, 3, 4]);
  assert.equal(f.get('th-history-commission-sort-icon').textContent, '↓');
  assert.equal(f.get('th-history-commission').getAttribute('aria-sort'), 'descending');
  f.get('btn-history-commission-sort').fire('click');
  assert.deepEqual(f.ids(), [4, 3, 1, 2]);
  assert.equal(f.get('th-history-commission-sort-icon').textContent, '↑');
  assert.equal(f.get('th-history-commission').getAttribute('aria-sort'), 'ascending');
});

test('date, savings and commission sorting replace each other while preserving filters', async t => {
  const f = await mount(t);
  f.get('btn-history-commission-sort').fire('click');
  f.supply('LUZ');
  assert.deepEqual(f.ids(), [1, 3]);
  f.get('th-history-savings').fire('click');
  assert.deepEqual(f.ids(), [3, 1]);
  assert.equal(f.get('th-history-commission-sort-icon').textContent, '↕');
  f.get('btn-history-commission-sort').fire('click');
  assert.deepEqual(f.ids(), [1, 3]);
  assert.equal(f.get('th-history-savings-sort-icon').textContent, '↕');
  f.get('th-history-date').fire('click');
  assert.deepEqual(f.ids(), [3, 1]);
  assert.equal(f.get('th-history-date').getAttribute('aria-sort'), 'descending');
  f.get('th-history-date').fire('click');
  assert.deepEqual(f.ids(), [1, 3]);
  f.supply('ALL');
  f.get('btn-history-commission-sort').fire('click');
  assert.deepEqual(f.ids(), [2, 1, 3, 4]);
  f.search('cups', 'ES002');
  assert.deepEqual(f.ids(), [1, 3]);
});

test('reentering history preserves type and sorting without duplicate sort handlers', async t => {
  const f = await mount(t);
  f.supply('LUZ');
  f.get('btn-history-commission-sort').fire('click');
  await f.view.initHistoryView();
  assert.deepEqual(f.ids(), [1, 3]);
  assert.equal(f.get('filter-history-type').value, 'LUZ');
  f.get('btn-history-commission-sort').fire('click');
  assert.deepEqual(f.ids(), [3, 1], 'one click reverses the order exactly once');
  f.supply('GAS');
  assert.deepEqual(f.ids(), [2]);
});
