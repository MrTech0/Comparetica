import test from 'node:test';
import assert from 'node:assert/strict';
import { initHomeView } from '../src/js/views/home.js';

function element() {
  return {
    style: {},
    children: [],
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    set innerHTML(value) { this._html = value; this.children = []; },
    get innerHTML() { return this._html || ''; }
  };
}

async function renderMarket(spotValues) {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  globalThis.document = { getElementById: get, createElement: element };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      included: [
        {
          id: '1001', type: 'PVPC',
          attributes: { values: [{ value: 100, datetime: '2026-09-29T10:00:00+02:00' }] }
        },
        ...(spotValues === null ? [] : [{
          id: '600', type: 'spot', attributes: { values: spotValues }
        }])
      ]
    })
  });
  try {
    await initHomeView();
    return {
      pvpc: get('market-avg-kwh').innerText,
      spot: get('market-avg-mwh').innerText,
      hourlyCards: get('market-hourly-grid').children.length,
      gridDisplay: get('market-hourly-grid').style.display,
      errorDisplay: get('market-error').style.display
    };
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
}

test('Inicio indica que el precio mayorista no está disponible cuando REE omite el indicador', async () => {
  const result = await renderMarket(null);
  assert.equal(result.spot, 'No disponible');
  assert.equal(result.pvpc, '0,10000 €/kWh');
  assert.equal(result.hourlyCards, 1);
  assert.equal(result.gridDisplay, 'grid');
  assert.equal(result.errorDisplay, 'none');
});

test('Inicio conserva el precio mayorista real cuando REE lo proporciona', async () => {
  const result = await renderMarket([{ value: 80, datetime: '2026-09-29T10:00:00+02:00' }]);
  assert.equal(result.spot, '80,00 €/MWh');
});
