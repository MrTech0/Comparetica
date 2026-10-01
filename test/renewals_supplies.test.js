import test from 'node:test';
import assert from 'node:assert/strict';

const luzCentral = 'ES0021000000000001AB';
const luzAlmacen = 'ES0021000000000002AB';
const gasCentral = 'ES0031000000000001CD';
const gasAlmacen = 'ES0031000000000002CD';
const otroGas = 'ES0031000000000003CD';
const clients = [{ id: 1, nombre_empresa: 'Veeam' }, { id: 2, nombre_empresa: 'Otro cliente' }];
const points = {
  1: [
    { cups: luzCentral, direccion_alias: 'Oficina central', tipo_energia: 'LUZ' },
    { cups: gasCentral, direccion_alias: 'Oficina central', tipo_energia: 'GAS' },
    { cups: luzAlmacen, direccion_alias: 'Almacén', tipo_energia: 'LUZ' },
    { cups: gasAlmacen, direccion_alias: 'Almacén', tipo_energia: 'GAS' }
  ],
  2: [{ cups: otroGas, direccion_alias: 'Principal', tipo_energia: 'GAS' }]
};
let caseId = 0;

function element(tag = 'div') {
  const listeners = new Map();
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, value: '', textContent: '',
    disabled: false, readOnly: false,
    classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    dispatchEvent(event) { this[`on${event.type}`]?.(event); for (const fn of listeners.get(event.type) || []) fn(event); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    get options() { return this.children; },
    get innerHTML() { return ''; },
    set innerHTML(value) { this.children = []; },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    querySelectorAll() { return []; }, contains(target) { return target === this || this.children.includes(target); },
    reset() {}, focus() {}, select() {}, remove() {}
  };
}

async function mount(t, getPoints = id => points[id] || [], getClients = () => clients) {
  const original = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const inserts = [];
  get('manual-ren-tipo').value = 'Luz';
  globalThis.document = { readyState: 'complete', getElementById: get, createElement: element, addEventListener() {} };
  globalThis.localStorage = { getItem: () => null };
  globalThis.window = { _renewalEscapeListenerAdded: true, __TAURI__: { core: { invoke: async (command, args = {}) => {
    if (command === 'db_execute') { if (args.query.includes('INSERT INTO renovaciones')) inserts.push(args.params); return {}; }
    assert.equal(command, 'db_select');
    if (args.query.includes('FROM puntos_suministro')) return await getPoints(args.params[0]);
    if (args.query.includes('FROM clientes')) return await getClients();
    if (args.query.includes('FROM ajustes')) return [];
    if (/FROM (renovaciones|comercializadoras|tarifas_luz|tarifas_gas)/.test(args.query)) return [];
    throw new Error(`Consulta inesperada: ${args.query}`);
  } } } };
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const view = await import(`../src/js/views/renewals.js?supplies-case=${++caseId}`);
  await view.openManualAddModal();
  async function suggestion(client) {
    const input = get('manual-ren-client-search');
    input.value = client.nombre_empresa;
    input.oninput();
    await new Promise(resolve => setTimeout(resolve, 180));
    return get('manual-ren-client-suggestions').children.find(item => item.children[0]?.textContent === client.nombre_empresa);
  }
  const selectClient = async client => { const item = await suggestion(client); assert.ok(item); await item.onclick(); };
  const changeEnergy = energy => { get('manual-ren-tipo').value = energy; get('manual-ren-tipo').dispatchEvent(new Event('change')); };
  const cupsOptions = () => get('manual-ren-cups').options.filter(option => option.value).map(option => option.value);
  const save = () => get('form-renewal-manual').onsubmit({ preventDefault() {} });
  return { get, view, selectClient, suggestion, changeEnergy, cupsOptions, save, inserts };
}

test('manual renewal filters the customer points by energy and shows each location', async t => {
  const f = await mount(t);
  await f.selectClient(clients[0]);
  assert.deepEqual(f.cupsOptions(), [luzCentral, luzAlmacen]);
  assert.ok(f.get('manual-ren-cups').options.some(option => option.textContent.includes('Almacén')));
  f.get('manual-ren-cups').value = luzAlmacen;
  f.changeEnergy('Gas');
  assert.deepEqual(f.cupsOptions(), [gasCentral, gasAlmacen]);
  assert.equal(f.get('manual-ren-cups').value, '', 'debe solicitar un punto cuando hay varias opciones');
  await f.selectClient(clients[1]);
  assert.equal(f.get('manual-ren-tipo').value, 'Gas');
  assert.deepEqual(f.cupsOptions(), [otroGas]);
  assert.equal(f.get('manual-ren-cups').value, otroGas, 'el único punto se selecciona automáticamente');
});

test('editing the customer search clears the previously selected supply', async t => {
  const f = await mount(t);
  await f.selectClient(clients[1]);
  f.get('manual-ren-client-search').value = '';
  f.get('manual-ren-client-search').oninput();
  assert.equal(f.get('manual-ren-client-id').value, '');
  assert.equal(f.get('manual-ren-cups').value, '');
  assert.deepEqual(f.cupsOptions(), []);
});

test('manual renewal rejects a CUPS for another energy and saves a registered matching point', async t => {
  const f = await mount(t);
  await f.selectClient(clients[0]);
  f.get('manual-ren-cups').value = gasCentral;
  await f.save();
  assert.equal(f.inserts.length, 0, 'no debe guardar un CUPS incompatible');
  f.get('manual-ren-cups').value = luzAlmacen;
  await f.save();
  assert.deepEqual(f.inserts[0]?.slice(0, 3), [1, 'Luz', luzAlmacen]);
});

test('a customer without registered points cannot create a manual renewal', async t => {
  const f = await mount(t, () => []);
  await f.selectClient(clients[0]);
  await f.save();
  assert.equal(f.inserts.length, 0);
  assert.match(f.get('manual-ren-supply-help').textContent, /Clientes|ficha/i);
});

test('history renewal fixes its customer and supply, and reopening manual creation clears the lock', async t => {
  const f = await mount(t);
  let saved = 0, cancelled = 0;
  await f.view.openNewRenewalDialogFromHistory({ cliente_nombre: 'Veeam', cliente_cups: gasAlmacen, tipo_energia: 'GAS' },
    { onSaved: () => { saved++; }, onCancelled: () => { cancelled++; } });
  assert.equal(f.get('manual-ren-client-search').readOnly, true);
  assert.equal(f.get('manual-ren-tipo').disabled, true);
  assert.equal(f.get('manual-ren-cups').disabled, true);
  assert.equal(f.get('manual-ren-cups').value, gasAlmacen);
  await f.save();
  assert.equal(saved, 1);
  assert.equal(cancelled, 0);
  assert.deepEqual(f.inserts[0]?.slice(0, 3), [1, 'Gas', gasAlmacen]);
  await f.view.openManualAddModal();
  assert.equal(f.get('manual-ren-client-search').readOnly, false);
  assert.equal(f.get('manual-ren-client-id').value, '');
  await f.selectClient(clients[1]);
  assert.equal(f.get('manual-ren-tipo').disabled, false);
  assert.equal(f.get('manual-ren-cups').disabled, false);
  assert.equal(f.get('manual-ren-cups').value, otroGas);
});

test('cancelling a history renewal calls its cancellation handler once without saving', async t => {
  const f = await mount(t);
  let saved = 0, cancelled = 0;
  await f.view.openNewRenewalDialogFromHistory({ cliente_nombre: 'Veeam', cliente_cups: gasAlmacen, tipo_energia: 'GAS' },
    { onSaved: () => { saved++; }, onCancelled: () => { cancelled++; } });
  f.view.handleRenewalModalCancel();
  f.view.handleRenewalModalCancel();
  assert.equal(cancelled, 1);
  assert.equal(saved, 0);
  assert.equal(f.inserts.length, 0);
});

test('a slow response for a previously selected customer cannot replace the current points', async t => {
  let resolveFirst;
  const pendingFirst = new Promise(resolve => { resolveFirst = resolve; });
  const f = await mount(t, id => id === 1 ? pendingFirst : points[id]);
  const firstItem = await f.suggestion(clients[0]);
  const firstSelection = firstItem.onclick();
  await f.selectClient(clients[1]);
  resolveFirst(points[1]);
  await firstSelection;
  assert.equal(f.get('manual-ren-client-id').value, '2');
  assert.deepEqual(f.cupsOptions(), [otroGas]);
  assert.equal(f.get('manual-ren-cups').value, otroGas);
});

test('a cancelled history preload cannot overwrite another comparison for the same customer', async t => {
  let resolvePoints, notifyWaiting;
  const pending = new Promise(resolve => { resolvePoints = resolve; });
  const waiting = new Promise(resolve => { notifyWaiting = resolve; });
  let calls = 0;
  const f = await mount(t, id => { if (++calls === 1) { notifyWaiting(); return pending; } return points[id]; });
  const first = f.view.openNewRenewalDialogFromHistory({ cliente_nombre: 'Veeam', cliente_cups: luzCentral, tipo_energia: 'LUZ', comercializadora_luz_nombre: 'Anterior', tarifa_luz_nombre: 'Tarifa anterior' });
  await waiting;
  f.view.handleRenewalModalCancel();
  await f.view.openNewRenewalDialogFromHistory({ cliente_nombre: 'Veeam', cliente_cups: gasAlmacen, tipo_energia: 'GAS', comercializadora_gas_nombre: 'Nueva', tarifa_gas_nombre: 'Tarifa nueva' });
  resolvePoints(points[1]);
  await first;
  assert.equal(f.get('manual-ren-comercializadora').value, 'Nueva');
  assert.equal(f.get('manual-ren-tarifa').value, 'Tarifa nueva');
  assert.equal(f.get('manual-ren-cups').value, gasAlmacen);
});

test('history locks the customer while the client lookup is still pending', async t => {
  let resolveClients, notifyWaiting;
  const pending = new Promise(resolve => { resolveClients = resolve; });
  const waiting = new Promise(resolve => { notifyWaiting = resolve; });
  const f = await mount(t, undefined, () => { notifyWaiting(); return pending; });
  const opening = f.view.openNewRenewalDialogFromHistory({ cliente_nombre: 'Veeam', cliente_cups: gasCentral, tipo_energia: 'GAS' });
  await waiting;
  const lockedDuringLookup = f.get('manual-ren-client-search').readOnly;
  resolveClients(clients);
  await opening;
  assert.equal(lockedDuringLookup, true);
});

test('saving captures the supply and offer together before asynchronous validation', async t => {
  let resolvePoints, notifyWaiting;
  const pending = new Promise(resolve => { resolvePoints = resolve; });
  const waiting = new Promise(resolve => { notifyWaiting = resolve; });
  let calls = 0;
  const f = await mount(t, id => { if (++calls === 2) { notifyWaiting(); return pending; } return points[id]; });
  await f.selectClient(clients[0]);
  f.get('manual-ren-cups').value = luzCentral;
  f.get('manual-ren-comercializadora').value = 'Oferta Luz';
  f.get('manual-ren-tarifa').value = 'Tarifa Luz';
  const saving = f.save();
  await waiting;
  f.changeEnergy('Gas');
  f.get('manual-ren-cups').value = gasCentral;
  f.get('manual-ren-comercializadora').value = 'Oferta Gas';
  f.get('manual-ren-tarifa').value = 'Tarifa Gas';
  resolvePoints(points[1]);
  await saving;
  assert.deepEqual(f.inserts[0]?.slice(0, 5), [1, 'Luz', luzCentral, 'Oferta Luz', 'Tarifa Luz']);
});
