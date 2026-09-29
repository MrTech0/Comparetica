import test from 'node:test';
import assert from 'node:assert/strict';
import { initRenewalsView, openManualAddModal } from '../src/js/views/renewals.js';

const payload = '<img src=x onerror=alert(1)>';

function element() {
  return {
    children: [],
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener(type, callback) { this[`on${type}`] = callback; },
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return []; },
    reset() {},
    get value() { return this._value || ''; },
    set value(value) { this._value = value; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; this.children = []; }
  };
}

test('renewals renders stored names as text in list, calendar and suggestions', async () => {
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage
  };
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const renewal = {
    id: 1,
    cliente_nombre: payload,
    cliente_cif: payload,
    tipo_energia: payload,
    cups: payload,
    comercializadora_actual: payload,
    tarifa_actual: payload,
    fecha_firma: date,
    fecha_vencimiento: date,
    estado_renovacion: 'Pendiente'
  };

  globalThis.document = {
    getElementById: get,
    createElement: element,
    addEventListener() {}
  };
  globalThis.localStorage = { getItem: () => null };
  globalThis.window = {
    _renewalEscapeListenerAdded: true,
    __TAURI__: {
      core: {
        invoke: async (command, { query } = {}) => {
          if (command === 'db_execute') return {};
          if (command !== 'db_select') throw new Error(`Unexpected command: ${command}`);
          if (query.includes('FROM ajustes')) return [{ valor: '{"critical":30,"warning":60,"radar":90}' }];
          if (query.includes('FROM renovaciones r')) return [renewal];
          if (query.includes('FROM clientes c')) return [{ id: 1, nombre_empresa: payload }];
          if (query.includes('FROM clientes')) return [{ id: 1, nombre_empresa: payload }];
          if (query.includes('FROM puntos_suministro')) return [];
          if (query.includes('FROM comercializadoras')) return [{ id: 1, nombre: payload }];
          if (query.includes('FROM tarifas_luz')) return [{ id: 1, nombre: payload, comercializadora_nombre: payload }];
          if (query.includes('FROM tarifas_gas')) return [];
          throw new Error(`Unexpected query: ${query}`);
        }
      }
    }
  };

  try {
    await initRenewalsView();
    const listRow = get('renewals-tbody').children[0];
    assert.ok(listRow, 'la lista debe mostrar la renovación');
    assert.ok(!listRow.innerHTML.includes(payload), 'la lista no debe interpretar nombres como HTML');
    assert.ok(listRow.innerHTML.includes('&lt;img'), 'la lista debe conservar el nombre visible');

    get('btn-renewals-view-calendar').onclick();
    const day = get('renewals-calendar-grid').children.find(child => child.onclick);
    assert.ok(day, 'el calendario debe contener la renovación');
    day.onclick();
    const calendarRow = get('calendar-day-renewals-tbody').children[0];
    assert.ok(!calendarRow.innerHTML.includes(payload), 'el detalle del calendario no debe interpretar nombres como HTML');
    assert.ok(calendarRow.innerHTML.includes('&lt;img'));

    await openManualAddModal();
    const clientInput = get('manual-ren-client-search');
    clientInput.value = 'img';
    clientInput.oninput();
    await new Promise(resolve => setTimeout(resolve, 250));
    const clientSuggestion = get('manual-ren-client-suggestions').children[0];
    assert.ok(clientSuggestion, 'debe aparecer la sugerencia de cliente');
    assert.ok(!clientSuggestion.innerHTML.includes(payload));
    assert.equal(clientSuggestion.children[0]?.textContent, payload);
    await clientSuggestion.onclick();
    assert.equal(clientInput.value, payload);
    assert.equal(get('manual-ren-client-id').value, '1');

    const retailerInput = get('manual-ren-comercializadora');
    retailerInput.value = 'img';
    await retailerInput.oninput();
    const retailerSuggestion = get('manual-ren-comercializadora-suggestions').children[0];
    assert.ok(!retailerSuggestion.innerHTML.includes(payload));
    assert.equal(retailerSuggestion.children[0]?.textContent, payload);
    retailerSuggestion.onclick();
    assert.equal(retailerInput.value, payload);

    const tariffInput = get('manual-ren-tarifa');
    retailerInput.value = payload;
    tariffInput.value = 'img';
    await tariffInput.oninput();
    const tariffSuggestion = get('manual-ren-tarifa-suggestions').children[0];
    assert.ok(tariffSuggestion, 'debe aparecer la sugerencia de tarifa');
    assert.ok(!tariffSuggestion.innerHTML.includes(payload));
    assert.equal(tariffSuggestion.children[0]?.textContent, payload);
    tariffSuggestion.onclick();
    assert.equal(tariffInput.value, payload);
    assert.equal(retailerInput.value, payload);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
