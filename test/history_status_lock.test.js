import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getComparisonStatusLock, canManageCommissionCollection } from '../src/js/comparison_status.js';
import { getCommissionSplit, formatRetentionPercent, moneyToCents, splitCommission } from '../src/js/commission_split.js';

const start = Date.parse('2026-10-03T12:00:00.000Z');
const source = fs.readFileSync(new URL('../src/js/views/history.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');

function element(tag = 'div') {
  const classes = new Set(), queries = new Map();
  const node = {
    children: [], style: {}, dataset: {}, value: '', textContent: '', attributes: {}, htmlWrites: [],
    classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name), toggle(name, force) {
        const add = force ?? !classes.has(name); if (add) classes.add(name); else classes.delete(name);
      } },
    addEventListener(type, fn) { this[`on${type}`] = fn; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    getAttribute(name) { return this.attributes[name]; },
    querySelector(selector) { if (!queries.has(selector)) queries.set(selector, element()); return queries.get(selector); },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    get innerHTML() { return this._html || ''; },
    set innerHTML(html) {
      this.htmlWrites.push(html); this._html = html; this.children = []; queries.clear();
      if (tag !== 'tr') return;
      for (const [kind, values] of [
        ['status', ['Pendiente de aceptación', 'Aceptada', 'Rechazada']],
        ['contract', ['Pendiente', 'En trámite', 'Firmado y Activado', 'Rechazado por Scoring']]
      ]) {
        const match = html.match(new RegExp(`class="(m3-custom-${kind}-select[^\"]*)"`));
        if (!match) { queries.set(`.m3-custom-${kind}-select`, null); continue; }
        const select = element(); match[1].split(/\s+/).forEach(name => select.classList.add(name));
        const options = values.map(value => { const option = element(); option.setAttribute('data-value', value); return option; });
        select.querySelectorAll = () => options;
        queries.set(`.m3-custom-${kind}-select`, select);
      }
      const paymentMatch = html.match(/<(button|div)\b([^>]*class="[^"]*btn-manage-cobro[^"]*"[^>]*)>/);
      if (paymentMatch) {
        const control = element(paymentMatch[1]);
        control.disabled = /\sdisabled(?:\s|=|$)/.test(paymentMatch[2]);
        queries.set('.btn-manage-cobro', control);
      } else queries.set('.btn-manage-cobro', null);
    }
  };
  return node;
}

async function mount(t, overrides = {}, updateContract) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start });
  const record = { id: 1, cliente_nombre: 'Cliente de prueba', cliente_cups: 'ES0031000000000001AB',
    tipo_energia: 'GAS', fecha: '2026-10-03', estado: 'Pendiente de aceptación', estado_contrato: 'Pendiente',
    estado_cambiado_en: null, ahorro_luz_anual: 0, ahorro_gas_anual: 100, comision_total: 10,
    reparto_comision_json: JSON.stringify({ version: 1, cliente_id: 1, cliente_nombre: 'Cliente de prueba', agente_id: 1, agente_nombre: 'Ana', retencion_id: 1, retencion_nombre: 'General', porcentaje_centesimas: 10000, ...splitCommission(10, 10000) }), ...overrides };
  const tbody = element(), nodes = new Map(), changes = [], collectionChanges = [], toasts = [], renewals = [], recomparisons = [];
  const dialogIds = ['dialog-scoring-rejection', 'dialog-scoring-client', 'dialog-scoring-id', 'dialog-scoring-reason',
    'btn-close-scoring-dialog-x', 'btn-scoring-save-only', 'btn-scoring-recompare', 'history-kpi-pendientes',
    'dialog-mark-cobro', 'dialog-cobro-id', 'dialog-cobro-client', 'dialog-cobro-amount', 'dialog-cobro-status-badge',
    'dialog-cobro-date', 'btn-close-cobro-dialog-x', 'form-mark-cobro', 'btn-cobro-mark-pending'];
  for (const id of dialogIds) nodes.set(id, element());
  const browser = vm.createContext({
    document: { getElementById: id => nodes.get(id) || null, createElement: element, addEventListener() {},
      querySelector: selector => selector === '#table-history tbody' ? tbody : null,
      querySelectorAll: () => tbody.children.flatMap(row => ['status', 'contract'].map(kind => row.querySelector(`.m3-custom-${kind}-select`)).filter(Boolean)) },
    window: { _historyScrollListenerAdded: true }, Date, setTimeout, clearTimeout, console: { error() {} },
    getComparisonStatusLock, canManageCommissionCollection,
    getCommissionSplit, formatRetentionPercent, moneyToCents,
    APP_EVENTS: { COMPARISON_SAVED: 'saved' }, onAppEvent: () => () => {},
    getComparativas: async () => [structuredClone(record)],
    updateComparativaEstado: async (id, value) => {
      changes.push({ id, value }); record.estado = value;
      record.estado_cambiado_en = value === 'Pendiente de aceptación' ? null : new Date().toISOString();
    },
    updateComparativaContrato: async (id, value, reason) => {
      if (updateContract) await updateContract(id, value);
      record.estado_contrato = value; record.motivo_rechazo_scoring = reason;
    },
    updateComparativaCobro: async (id, value, date) => {
      collectionChanges.push({ id, value, date }); record.estado_cobro = value; record.fecha_cobro = date;
    },
    openNewRenewalDialogFromHistory: (data, callbacks) => renewals.push(callbacks),
    relaunchComparisonForScoring: async data => recomparisons.push(data.id),
    showToast: (message, type) => toasts.push({ message, type })
  });
  new vm.Script(source, { filename: 'history.js' }).runInContext(browser);
  await browser.initHistoryView();
  const row = () => tbody.children[0];
  const select = kind => row().querySelector(`.m3-custom-${kind}-select`);
  const event = { preventDefault() {}, stopPropagation() {} };
  const choose = (kind, value, target = select(kind)) => target.querySelectorAll('.status-select-option')
    .find(option => option.getAttribute('data-value') === value).onclick(event);
  return { browser, record, changes, collectionChanges, toasts, renewals, recomparisons, nodes, tbody, row, select, choose, event,
    locked: () => select('status').classList.contains('disabled'), reload: () => browser.initHistoryView() };
}

for (const contract of ['Pendiente', 'En trámite', 'Rechazado por Scoring']) {
  for (const payment of ['Pendiente', 'Cobrado']) {
    test(`commission ${payment} cannot open its dialog while the contract is ${contract}`, async t => {
      const f = await mount(t, { estado: 'Aceptada', estado_contrato: contract, estado_cobro: payment });
      const control = f.row().querySelector('.btn-manage-cobro');
      assert.equal(control.disabled, true);
      control.onclick(); // Un evento antiguo tampoco debe permitir abrir el formulario.
      assert.equal(f.nodes.get('dialog-mark-cobro').classList.contains('active'), false);
    });
  }
}

test('signing enables commission collection in place and cancelling the renewal disables it again', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() });
  const row = f.row(), control = row.querySelector('.btn-manage-cobro');
  assert.equal(control.disabled, true);
  await f.choose('contract', 'Firmado y Activado');
  assert.equal(f.row(), row);
  assert.equal(f.row().querySelector('.btn-manage-cobro'), control);
  assert.equal(control.disabled, false);
  control.onclick();
  assert.equal(f.nodes.get('dialog-mark-cobro').classList.contains('active'), true);
  f.nodes.get('btn-close-cobro-dialog-x').onclick();
  await f.renewals[0].onCancelled();
  assert.equal(control.disabled, true);
  control.onclick();
  assert.equal(f.nodes.get('dialog-mark-cobro').classList.contains('active'), false);
});

test('a stored signed contract permits recording a pending commission', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_contrato: 'Firmado y Activado', estado_cobro: 'Pendiente' });
  const control = f.row().querySelector('.btn-manage-cobro');
  assert.equal(control.disabled, false);
  control.onclick();
  assert.equal(f.nodes.get('dialog-mark-cobro').classList.contains('active'), true);
});

test('a collected commission stays disabled even with a signed contract and cannot reopen its dialog', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_contrato: 'Firmado y Activado', estado_cobro: 'Cobrado', fecha_cobro: '2026-10-03' });
  const control = f.row().querySelector('.btn-manage-cobro');
  assert.equal(control.disabled, true);
  control.onclick();
  assert.equal(f.nodes.get('dialog-mark-cobro').classList.contains('active'), false);
});

test('recording a pending commission closes the form and locks the collected value permanently', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_contrato: 'Firmado y Activado', estado_cobro: 'Pendiente' });
  f.row().querySelector('.btn-manage-cobro').onclick();
  f.nodes.get('dialog-cobro-date').value = '2026-10-03';
  await f.nodes.get('form-mark-cobro').onsubmit(f.event);
  assert.deepEqual(f.collectionChanges, [{ id: 1, value: 'Cobrado', date: '2026-10-03' }]);
  assert.equal(f.nodes.get('dialog-mark-cobro').classList.contains('active'), false);
  const control = f.row().querySelector('.btn-manage-cobro');
  assert.equal(control.disabled, true);
  control.onclick();
  assert.equal(f.nodes.get('dialog-mark-cobro').classList.contains('active'), false);
  await f.nodes.get('form-mark-cobro').onsubmit(f.event);
  assert.equal(f.collectionChanges.length, 1, 'a stale form cannot change a recorded collection');
});

test('the collection dialog offers no action to revert a collected commission to pending', async t => {
  const f = await mount(t);
  assert.equal(f.nodes.get('btn-cobro-mark-pending').onclick, undefined);
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="btn-cobro-mark-pending"/);
});

test('a failed signature does not enable commission collection', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() },
    async () => { throw new Error('No se pudo guardar'); });
  const control = f.row().querySelector('.btn-manage-cobro');
  await f.choose('contract', 'Firmado y Activado');
  assert.equal(control.disabled, true);
  control.onclick();
  assert.equal(f.nodes.get('dialog-mark-cobro').classList.contains('active'), false);
});

test('changing an accepted contract to En trámite keeps the row in place without showing a loading placeholder', async t => {
  const f = await mount(t);
  await f.choose('status', 'Aceptada');
  const row = f.row(), status = f.select('status'), contract = f.select('contract');
  const writesBefore = f.tbody.htmlWrites.length;
  await f.choose('contract', 'En trámite');
  assert.equal(f.tbody.htmlWrites.length, writesBefore, 'the visible table must not be emptied during a contract change');
  assert.equal(f.row(), row, 'the original row must remain mounted');
  assert.equal(f.select('status'), status);
  assert.equal(f.select('contract'), contract);
  assert.equal(contract.querySelector('.status-select-trigger').querySelector('span').textContent, 'En trámite');
  assert.equal(contract.querySelector('.status-select-trigger').classList.contains('contrato-tramite'), true);
  assert.equal(f.locked(), true);
  assert.match(status.getAttribute('title'), /contrato/);
});

test('a failed contract save restores its status control in place without restarting the five second deadline', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() },
    async () => { throw new Error('No se pudo guardar'); });
  const row = f.row();
  t.mock.timers.tick(3000);
  await f.choose('contract', 'En trámite');
  assert.equal(f.row(), row);
  assert.equal(f.locked(), false);
  t.mock.timers.tick(1999); assert.equal(f.locked(), false);
  t.mock.timers.tick(1); assert.equal(f.locked(), true);
});

for (const state of ['Aceptada', 'Rechazada']) {
  test(`${state} remains editable for 4999 ms and locks at 5000 ms, closing its dropdown`, async t => {
    const f = await mount(t); await f.choose('status', state);
    assert.equal(f.locked(), false);
    t.mock.timers.tick(4999);
    const select = f.select('status');
    select.querySelector('.status-select-trigger').onclick(f.event);
    assert.equal(select.classList.contains('open'), true);
    t.mock.timers.tick(1);
    assert.equal(f.locked(), true);
    assert.equal(select.classList.contains('open'), false);
    await f.choose('status', 'Pendiente de aceptación', select);
    assert.equal(f.record.estado, state);
    assert.equal(f.changes.length, 1, 'a stale dropdown cannot bypass the lock');
  });
}

test('reloading history preserves the remaining time instead of restarting the grace period', async t => {
  const f = await mount(t); await f.choose('status', 'Aceptada');
  t.mock.timers.tick(3000); await f.reload();
  t.mock.timers.tick(1999); assert.equal(f.locked(), false);
  t.mock.timers.tick(1); assert.equal(f.locked(), true);
});

test('a queued timer cannot permit a status change after the deadline', async t => {
  const f = await mount(t); await f.choose('status', 'Aceptada');
  t.mock.timers.setTime(start + 5000);
  await f.choose('status', 'Rechazada');
  assert.equal(f.record.estado, 'Aceptada');
  assert.equal(f.changes.length, 1);
});

for (const state of ['Aceptada', 'Rechazada']) {
  for (const contract of ['En trámite', 'Firmado y Activado', 'Rechazado por Scoring']) {
    test(`${contract} immediately locks an existing ${state} record within its grace period`, async t => {
      const f = await mount(t, { estado: state, estado_cambiado_en: new Date(start).toISOString(), estado_contrato: contract });
      assert.equal(f.locked(), true);
      await f.choose('status', 'Pendiente de aceptación');
      assert.equal(f.record.estado, state);
      assert.equal(f.changes.length, 0);
    });
  }
}

test('choosing En trámite blocks acceptance immediately while the contract write is pending', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() }, () => pending);
  const oldStatus = f.select('status');
  const changing = f.choose('contract', 'En trámite');
  assert.equal(f.locked(), true);
  await f.choose('status', 'Rechazada', oldStatus);
  resolve(); await changing;
  assert.equal(f.record.estado, 'Aceptada');
  assert.equal(f.record.estado_contrato, 'En trámite');
  assert.equal(f.changes.length, 0);
});

test('cancelling the renewal after signing keeps acceptance locked when the contract returns to En trámite', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() });
  const row = f.row(), contract = f.select('contract');
  await f.choose('contract', 'Firmado y Activado');
  assert.equal(f.locked(), true);
  assert.equal(f.row(), row);
  assert.equal(contract.querySelector('.status-select-trigger').querySelector('.status-select-arrow').style.display, 'none');
  contract.querySelector('.status-select-trigger').onclick(f.event);
  assert.equal(contract.classList.contains('open'), false);
  await f.choose('contract', 'Pendiente');
  assert.equal(f.record.estado_contrato, 'Firmado y Activado', 'the retained control cannot edit a signed contract');
  await f.renewals[0].onCancelled();
  assert.equal(f.record.estado_contrato, 'En trámite');
  assert.equal(f.locked(), true);
  assert.equal(f.row(), row);
  assert.equal(contract.querySelector('.status-select-trigger').querySelector('span').textContent, 'En trámite');
  assert.equal(contract.querySelector('.status-select-trigger').querySelector('.status-select-arrow').style.display, '');
});

for (const action of ['btn-scoring-save-only', 'btn-scoring-recompare']) {
  test(`${action} locks acceptance as soon as scoring rejection is saved`, async t => {
    const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() });
    await f.choose('contract', 'Rechazado por Scoring');
    f.nodes.get('dialog-scoring-reason').value = 'Motivo de prueba';
    await f.nodes.get(action).onclick(f.event);
    assert.equal(f.record.estado_contrato, 'Rechazado por Scoring');
    assert.equal(f.locked(), true);
    await f.choose('status', 'Rechazada');
    assert.equal(f.changes.length, 0);
    if (action === 'btn-scoring-recompare') assert.deepEqual(f.recomparisons, [1]);
  });
}

test('a failed contract change keeps acceptance editable for the remaining grace period', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() },
    async () => { throw new Error('No se pudo guardar'); });
  await f.choose('contract', 'En trámite');
  assert.equal(f.locked(), false);
  await f.choose('status', 'Rechazada');
  assert.equal(f.record.estado, 'Rechazada');
  assert.ok(f.toasts.some(toast => toast.type === 'error'));
});

test('filtering during a pending contract write cannot unlock acceptance', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() }, () => pending);
  const changing = f.choose('contract', 'En trámite');
  f.browser.applyHistoryFilter();
  const row = f.row();
  assert.equal(f.locked(), true);
  await f.choose('status', 'Rechazada');
  resolve(); await changing;
  assert.equal(f.record.estado, 'Aceptada');
  assert.equal(f.changes.length, 0);
  assert.equal(f.row(), row);
  assert.equal(f.select('contract').querySelector('.status-select-trigger').querySelector('span').textContent, 'En trámite');
});

test('saving scoring rejection updates commission totals while keeping the original row mounted', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() });
  const row = f.row();
  assert.equal(f.nodes.get('history-kpi-pendientes').textContent, '10,00 €');
  await f.choose('contract', 'Rechazado por Scoring');
  await f.nodes.get('btn-scoring-save-only').onclick(f.event);
  assert.equal(f.nodes.get('history-kpi-pendientes').textContent, '0,00 €');
  assert.equal(f.row(), row);
});

test('a changed contract leaves the active Pending filter immediately without a loading placeholder', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() });
  for (const id of ['th-history-contract', 'dropdown-history-contract-filter']) f.nodes.set(id, element());
  const items = ['ALL', 'Pendiente', 'En trámite'].map(value => {
    const item = element(); item.setAttribute('data-contract', value); return item;
  });
  f.nodes.get('dropdown-history-contract-filter').querySelectorAll = () => items;
  f.browser.setupHistoryContractFilterDropdown();
  items[1].onclick(f.event);
  const writesBefore = f.tbody.htmlWrites.length;
  await f.choose('contract', 'En trámite');
  assert.equal(f.tbody.children.length, 0);
  assert.match(f.tbody.innerHTML, /No se encontraron comparativas con los filtros aplicados/);
  assert.ok(f.tbody.htmlWrites.slice(writesBefore).every(html => !html.includes('Cargando historial')));
  items[2].onclick(f.event);
  assert.equal(f.tbody.children.length, 1);
  assert.equal(f.locked(), true);
});

test('saving scoring rejection locks acceptance while its write is pending', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() }, () => pending);
  await f.choose('contract', 'Rechazado por Scoring');
  const saving = f.nodes.get('btn-scoring-save-only').onclick(f.event);
  assert.equal(f.locked(), true);
  assert.equal(f.nodes.get('btn-scoring-recompare').disabled, true);
  await f.choose('status', 'Rechazada');
  resolve(); await saving;
  assert.equal(f.record.estado, 'Aceptada');
  assert.equal(f.record.estado_contrato, 'Rechazado por Scoring');
  assert.equal(f.changes.length, 0);
});

test('cancelling scoring rejection leaves the existing state and remaining grace period intact', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() });
  await f.choose('contract', 'Rechazado por Scoring');
  f.nodes.get('btn-close-scoring-dialog-x').onclick();
  assert.equal(f.record.estado_contrato, 'Pendiente');
  assert.equal(f.locked(), false);
  t.mock.timers.tick(5000);
  assert.equal(f.locked(), true);
});

test('a failed scoring rejection neither locks acceptance early nor starts a recomparison', async t => {
  const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: new Date(start).toISOString() },
    async () => { throw new Error('No se pudo guardar'); });
  await f.choose('contract', 'Rechazado por Scoring');
  await f.nodes.get('btn-scoring-recompare').onclick(f.event);
  assert.equal(f.record.estado_contrato, 'Pendiente');
  assert.equal(f.locked(), false);
  assert.deepEqual(f.recomparisons, []);
  assert.equal(f.nodes.get('dialog-scoring-rejection').classList.contains('active'), true);
});

for (const timestamp of [null, 'fecha inválida']) {
  test(`an accepted record without a usable timestamp (${timestamp}) stays locked in the UI`, async t => {
    const f = await mount(t, { estado: 'Aceptada', estado_cambiado_en: timestamp });
    assert.equal(f.locked(), true);
    await f.choose('status', 'Rechazada');
    assert.equal(f.changes.length, 0);
  });
}
