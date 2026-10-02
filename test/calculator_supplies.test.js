import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { calculateLightBill, calculateGasBill, formatPriceDecimals } from '../src/js/calculator.js';
import { isValidSpanishCups, normalizeCups } from '../src/js/utils/validators.js';

const customers = [
  { id: 1, nombre_empresa: 'Veeam', cif: 'B12345678', estado: 'activo' },
  { id: 2, nombre_empresa: 'Solo Luz', cif: 'B22222222', estado: 'activo' },
  { id: 3, nombre_empresa: 'Solo Gas', cif: 'B33333333', estado: 'activo' },
  { id: 4, nombre_empresa: 'Sin puntos', cif: 'B44444444', estado: 'activo' }
];
const points = [
  { id: 1, cliente_id: 1, tipo_energia: 'LUZ', cups: 'ES0021000000000000AB', direccion_alias: 'Central' },
  { id: 2, cliente_id: 1, tipo_energia: 'LUZ', cups: 'ES0021000000000001CD', direccion_alias: 'Almacén' },
  { id: 3, cliente_id: 1, tipo_energia: 'GAS', cups: 'ES0031000000000000AB', direccion_alias: 'Central' },
  { id: 4, cliente_id: 1, tipo_energia: 'GAS', cups: 'ES0031000000000001CD', direccion_alias: 'Almacén' },
  { id: 5, cliente_id: 2, tipo_energia: 'LUZ', cups: 'ES0021000000000002EF', direccion_alias: 'Oficina' },
  { id: 6, cliente_id: 3, tipo_energia: 'GAS', cups: 'ES0031000000000002EF', direccion_alias: 'Oficina' }
];
const source = fs.readFileSync(new URL('../src/js/views/calculator_view.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

function element(tagName = 'div') {
  const listeners = new Map(), classes = new Set(), queries = new Map();
  return {
    tagName: tagName.toUpperCase(), children: [], style: {}, dataset: {}, value: '', checked: false, disabled: false,
    className: '', title: '', _text: '', attributes: {},
    classList: { add: (...values) => values.forEach(v => classes.add(v)), remove: (...values) => values.forEach(v => classes.delete(v)),
      contains: value => classes.has(value), toggle(value, force) { if (force ?? !classes.has(value)) classes.add(value); else classes.delete(value); } },
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this._text = String(value); this.children = []; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; this._text = ''; this.children = []; },
    get options() { return this.children; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    async fire(type, extra = {}) { await Promise.all((listeners.get(type) || []).map(fn => fn({ target: this, preventDefault() {}, ...extra }))); },
    dispatchEvent(event) { void this.fire(event.type, event); return true; },
    click() { return this.fire('click'); }, focus() {}, scrollIntoView() {},
    contains(target) { return target === this || this.children.some(child => child.contains(target)); },
    querySelectorAll(selector) { return selector === '.m3-autocomplete-item' ? this.children : []; },
    querySelector(selector) { if (!queries.has(selector)) queries.set(selector, element()); return queries.get(selector); }
  };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function mount(overrides = {}) {
  const nodes = new Map(), toasts = [], timers = [];
  const get = id => {
    if (id.startsWith('custom-select-for-')) return null;
    if (!nodes.has(id)) { const node = element(); node.id = id; nodes.set(id, node); }
    return nodes.get(id);
  };
  const light = { id: 10, tipo_tarifa: '2.0TD', nombre: 'Plan Luz', comercializadora_nombre: 'Demo', potencia_p1: 30,
    potencia_p2: 10, energia_p1: .1, energia_p2: .1, energia_p3: .1, comision: 10 };
  const gas = { id: 11, tipo_tarifa: 'RL.1', nombre: 'Plan Gas', comercializadora_nombre: 'Demo', termino_fijo: 9, termino_variable: .05, comision: 10 };
  const browser = vm.createContext({
    document: { getElementById: get, createElement: element, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null },
    Event: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } },
    console, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    getClientes: async () => customers,
    getPuntosSuministroAll: async () => points,
    getPuntosSuministroByCliente: async id => points.filter(point => point.cliente_id === id),
    getComparativas: async () => [], getTarifasLuz: async () => [light], getTarifasGas: async () => [gas],
    calculateLightBill, calculateGasBill, formatPriceDecimals, normalizeCups, isValidSpanishCups,
    showToast: (message, type) => toasts.push({ message, type }), emitAppEvent() {}, APP_EVENTS: {}, ...overrides
  });
  new vm.Script(source, { filename: 'calculator_view.js' }).runInContext(browser);
  for (const type of ['light', 'gas']) {
    const block = html.slice(html.indexOf(`id="calc-${type}-block"`)).split(type === 'light' ? '<!-- Bloque de Gas -->' : '<!-- Consentimiento')[0];
    const fields = [...block.matchAll(/<(input|select)\b[^>]*id="(calc-(?:light|gas)-[^"]+)"[^>]*>/g)]
      .filter(match => match[2].startsWith(`calc-${type}-`)).map(match => {
        const node = get(match[2]); node.tagName = match[1].toUpperCase();
        if (/\brequired\b/.test(match[0])) node.setAttribute('required', '');
        return node;
      });
    get(`calc-${type}-block`).querySelectorAll = selector => fields.filter(node =>
      Object.hasOwn(node.attributes, 'required') || (Object.hasOwn(node.attributes, 'data-req')
        && selector.includes(`${node.tagName.toLowerCase()}[data-req]`)));
  }
  get('calc-light-tariff-type').value = '2.0TD';
  get('calc-energy-type').value = 'LUZ';
  browser.initCalculatorView();
  const type = async value => { get('calc-client-name').value = value; await get('calc-client-name').fire('input'); await settle(); };
  const choose = async name => { await type(name); await get('clients-autocomplete-list').children[0].click(); await settle(); };
  const changeEnergy = async value => { get('calc-energy-type').value = value; await get('calc-energy-type').fire('change'); };
  const options = id => get(id).children.filter(option => option.value).map(option => option.value);
  const data = () => new vm.Script('lastComparisonData').runInContext(browser);
  const fillBill = () => {
    get('calc-client-consent').checked = true;
    const values = { 'calc-light-days': 30, 'calc-light-p1-pot': 4.6, 'calc-light-p2-pot': 4.6,
      'calc-light-p1-cons': 100, 'calc-light-p2-cons': 100, 'calc-light-p3-cons': 100,
      'calc-light-meter': .8, 'calc-light-tax': 5.11269632, 'calc-light-vat': 21,
      'calc-light-p1-pot-price': .1, 'calc-light-p2-pot-price': .04,
      'calc-light-p1-ene-price': .2, 'calc-light-p2-ene-price': .18, 'calc-light-p3-ene-price': .15,
      'calc-gas-days': 30, 'calc-gas-consumption': 300, 'calc-gas-meter': .6, 'calc-gas-tax': .00234,
      'calc-gas-vat': 21, 'calc-gas-fixed-price': 10, 'calc-gas-var-price': .08, 'calc-gas-tariff-type': 'RL.1' };
    for (const [id, value] of Object.entries(values)) get(id).value = String(value);
  };
  return { get, browser, type, choose, changeEnergy, options, toasts, data, fillBill, timers,
    submit: () => get('calc-form').fire('submit') };
}

test('customer autocomplete has one suggestion per client and searches only name or CIF', async () => {
  const f = mount();
  await f.type('Veeam');
  assert.equal(f.get('clients-autocomplete-list').children.length, 1);
  assert.doesNotMatch(f.get('clients-autocomplete-list').textContent, /ES00|Central|Almacén/);
  await f.type('B12345678');
  assert.equal(f.get('clients-autocomplete-list').children.length, 1);
  await f.type('ES0021');
  assert.equal(f.get('clients-autocomplete-list').children.length, 0);
});

test('mixed customers can change energy and choose only its registered CUPS', async () => {
  const f = mount(); await f.choose('Veeam');
  assert.equal(f.get('calc-energy-type').disabled, false);
  await f.changeEnergy('LUZ');
  assert.deepEqual(f.options('calc-client-cups'), points.slice(0, 2).map(point => point.cups));
  f.get('calc-client-cups').value = points[1].cups;
  await f.changeEnergy('GAS');
  assert.deepEqual(f.options('calc-client-cups'), points.slice(2, 4).map(point => point.cups));
  assert.equal(f.get('calc-client-cups').value, '');
  assert.equal(f.get('calc-client-cups').disabled, false);
  assert.equal(f.get('calc-light-block').style.display, 'none');
  assert.equal(f.get('calc-gas-block').style.display, 'block');
});

test('changing the supply preserves required field validation for the visible bill', async () => {
  const f = mount(); await f.choose('Veeam');
  assert.ok(Object.hasOwn(f.get('calc-light-tariff-type').attributes, 'required'));
  await f.changeEnergy('GAS');
  assert.equal(Object.hasOwn(f.get('calc-light-tariff-type').attributes, 'required'), false);
  assert.ok(Object.hasOwn(f.get('calc-gas-tariff-type').attributes, 'required'));
  await f.changeEnergy('LUZ');
  assert.ok(Object.hasOwn(f.get('calc-light-tariff-type').attributes, 'required'));
  assert.equal(Object.hasOwn(f.get('calc-gas-tariff-type').attributes, 'required'), false);
});

for (const [name, index] of [['Solo Luz', 4], ['Solo Gas', 5]]) {
  test(`${name}: the only energy and CUPS are selected automatically and locked`, async () => {
    const f = mount(); await f.choose(name);
    assert.equal(f.get('calc-energy-type').value, points[index].tipo_energia);
    assert.equal(f.get('calc-energy-type').disabled, true);
    assert.equal(f.get('calc-client-cups').value, points[index].cups);
    assert.equal(f.get('calc-client-cups').disabled, true);
  });
}

test('one energy with multiple points locks the energy but keeps the CUPS selectable', async () => {
  const f = mount({ getPuntosSuministroByCliente: async () => points.slice(0, 2) });
  await f.choose('Veeam');
  assert.equal(f.get('calc-energy-type').value, 'LUZ');
  assert.equal(f.get('calc-energy-type').disabled, true);
  assert.equal(f.get('calc-client-cups').disabled, false);
  assert.deepEqual(f.options('calc-client-cups'), points.slice(0, 2).map(point => point.cups));
});

test('editing the customer immediately clears its energy and CUPS; no points directs to the client record', async () => {
  const f = mount(); await f.choose('Solo Gas'); await f.type('Vee');
  assert.equal(f.get('calc-client-cups').value, '');
  assert.equal(f.get('calc-energy-type').disabled, true);
  await f.choose('Sin puntos');
  assert.deepEqual(f.options('calc-client-cups'), []);
  assert.equal(f.get('calc-client-cups').disabled, true);
  assert.match(f.get('calc-supply-help').textContent, /ficha/i);
});

test('late customer and supply responses cannot repopulate a cleared or different selection', async () => {
  const request = deferred();
  const f = mount({ getPuntosSuministroByCliente: id => id === 1 ? request.promise : Promise.resolve(points.filter(p => p.cliente_id === id)) });
  await f.type('Veeam');
  const selecting = f.get('clients-autocomplete-list').children[0].click();
  await settle(); await f.choose('Solo Gas'); request.resolve(points.slice(0, 4)); await selecting;
  assert.equal(f.get('calc-client-name').value, 'Solo Gas');
  assert.equal(f.get('calc-client-cups').value, points[5].cups);

  const clientsRequest = deferred();
  const late = mount({ getClientes: () => clientsRequest.promise });
  const typing = late.type('Veeam'); await settle(); await late.get('calc-form').fire('reset');
  clientsRequest.resolve(customers); await typing;
  assert.equal(late.get('clients-autocomplete-list').children.length, 0);
  assert.equal(late.get('calc-client-cups').value, '');
});

test('reset clears the selected registered point and closes customer suggestions', async () => {
  const f = mount(); await f.choose('Solo Gas'); await f.get('calc-client-name').fire('focus'); await settle();
  await f.get('calc-form').fire('reset');
  assert.equal(f.get('calc-client-cups').value, '');
  assert.equal(f.get('calc-client-cups').disabled, true);
  assert.equal(f.get('calc-energy-type').value, '');
  assert.equal(f.get('clients-autocomplete-list').children.length, 0);
});

test('renewal prefill selects the exact registered point and its matching history', async () => {
  const f = mount({ getComparativas: async () => [
    { cliente_nombre: 'Veeam', cliente_cups: points[0].cups, datos_cliente_json: { lightInput: { p1Cons: 999 } } },
    { cliente_nombre: 'Veeam', cliente_cups: points[1].cups, datos_cliente_json: { lightInput: { p1Cons: 123 } } }
  ] });
  await f.browser.prefillCalculatorForRenewal({ cliente_id: 1, cliente_nombre: 'Veeam', cups: points[1].cups, tipo_energia: 'Luz' });
  assert.deepEqual(f.options('calc-client-cups'), points.slice(0, 2).map(point => point.cups));
  assert.equal(f.get('calc-client-cups').value, points[1].cups);
  assert.equal(f.get('calc-energy-type').disabled, false);
  assert.equal(f.get('calc-light-p1-cons').value, 123);
});

test('prefill cannot inject an unregistered CUPS or automatically relaunch a missing supply', async () => {
  const f = mount();
  f.get('calc-form-container').style.display = 'none';
  const missing = { cliente_nombre: 'Solo Gas', cliente_cups: 'ES0031000000000009ZZ', tipo_energia: 'GAS' };
  await f.browser.relaunchComparisonForScoring(missing);
  assert.equal(f.get('calc-client-cups').value, '');
  assert.equal(f.timers.length, 0);
  assert.match(f.toasts.at(-1).message, /registrado/i);
  assert.equal(f.get('calc-form-container').style.display, 'block');
});

test('customer suggestions retain keyboard selection and Escape closes them', async () => {
  const f = mount(); await f.type('Solo');
  await f.get('calc-client-name').fire('keydown', { key: 'ArrowDown' });
  assert.equal(f.get('calc-client-name').attributes['aria-activedescendant'], 'calc-client-option-0');
  await f.get('calc-client-name').fire('keydown', { key: 'Enter' }); await settle();
  assert.equal(f.get('calc-client-name').value, 'Solo Luz');
  assert.equal(f.get('calc-client-cups').value, points[4].cups);
  await f.get('calc-client-name').fire('focus');
  await f.get('calc-client-name').fire('keydown', { key: 'Escape' });
  assert.equal(f.get('clients-autocomplete-list').children.length, 0);
});

test('a late renewal history response cannot overwrite a newly selected customer', async () => {
  const history = deferred();
  const f = mount({ getComparativas: () => history.promise });
  const prefill = f.browser.prefillCalculatorForRenewal({ cliente_id: 1, cliente_nombre: 'Veeam', cups: points[1].cups, tipo_energia: 'LUZ' });
  await settle(); await f.choose('Solo Gas');
  history.resolve([{ cliente_cups: points[1].cups, datos_cliente_json: { lightInput: { p1Cons: 999 } } }]);
  await prefill;
  assert.equal(f.get('calc-client-cups').value, points[5].cups);
  assert.equal(f.get('calc-light-p1-cons').value, '');
  assert.equal(f.toasts.some(toast => toast.type === 'success'), false);
});

test('changing customer during submission cannot finish a comparison for the previous point', async () => {
  const check = deferred(); let readCount = 0;
  const f = mount({ getPuntosSuministroByCliente: async id => ++readCount === 2 ? check.promise : points.filter(point => point.cliente_id === id) });
  await f.choose('Solo Luz'); f.fillBill(); const submitting = f.submit(); await settle();
  await f.choose('Solo Gas'); check.resolve([points[4]]); await submitting;
  assert.equal(f.data().clientCups, '');
  assert.equal(f.get('calc-client-cups').value, points[5].cups);
});

test('submission rejects a CUPS of another energy or a point removed from the client record', async () => {
  let removed = false;
  const f = mount({ getPuntosSuministroByCliente: async id => removed ? [] : points.filter(p => p.cliente_id === id) });
  await f.choose('Solo Gas'); f.fillBill(); f.get('calc-client-cups').value = points[0].cups;
  await f.submit(); assert.equal(f.data().clientCups, '');
  assert.match(f.toasts.at(-1).message, /registrado|suministro/i);
  f.get('calc-client-cups').value = points[5].cups; removed = true;
  await f.submit(); assert.equal(f.data().clientCups, '');
});

for (const [name, energy, index] of [['Solo Luz', 'LUZ', 4], ['Solo Gas', 'GAS', 5]]) {
  test(`registered ${energy} selection still calculates current costs and proposals`, async () => {
    const f = mount(); await f.choose(name); f.fillBill(); await f.submit();
    assert.equal(f.data().clientCups, points[index].cups);
    assert.equal(f.data().energyType, energy);
    const prefix = energy === 'LUZ' ? 'Light' : 'Gas';
    assert.ok(Number.isFinite(f.data()[`current${prefix}Cost`]) && f.data()[`current${prefix}Cost`] > 0);
    assert.ok(f.data()[`best${prefix}Tariff`]);
    assert.equal(f.get('calc-results-wrapper').style.display, 'block');
  });
}
