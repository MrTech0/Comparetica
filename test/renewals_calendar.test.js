import test from 'node:test';
import assert from 'node:assert/strict';
function element() {
  return {
    children: [],
    style: {},
    listeners: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
    click() { for (const callback of this.listeners.click || []) callback({ currentTarget: this }); },
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return []; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; this.children = []; }
  };
}

test('calendar navigation visits every month when today is the 31st', async () => {
  const original = {
    Date: globalThis.Date,
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage
  };
  const RealDate = original.Date;
  let today = [2027, 7, 31, 12];
  class TestDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(...today);
      else super(...args);
    }
  }
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const documentEvents = {};
  globalThis.Date = TestDate;
  globalThis.document = {
    readyState: 'loading',
    getElementById: get,
    createElement: element,
    addEventListener(type, callback) { documentEvents[type] = callback; }
  };
  globalThis.localStorage = { getItem: () => null };
  globalThis.window = {
    _renewalEscapeListenerAdded: true,
    __TAURI__: {
      core: {
        invoke: async (command, { query } = {}) => {
          if (command !== 'db_select') throw new Error(`Unexpected command: ${command}`);
          if (query.includes('FROM ajustes')) return [{ valor: '{"critical":30,"warning":60,"radar":90}' }];
          if (query.includes('FROM clientes c')) return [];
          if (query.includes('FROM renovaciones r')) return [];
          throw new Error(`Unexpected query: ${query}`);
        }
      }
    }
  };

  try {
    const { initRenewalsView } = await import('../src/js/views/renewals.js?calendar-navigation-test');
    documentEvents.DOMContentLoaded();
    await initRenewalsView();
    get('btn-renewals-view-calendar').click();
    get('btn-calendar-today').click();
    const month = () => get('calendar-month-year-title').textContent;
    assert.equal(month(), 'Agosto 2027');

    get('btn-calendar-next-month').click();
    assert.equal(month(), 'Septiembre 2027');
    get('btn-calendar-next-month').click();
    assert.equal(month(), 'Octubre 2027');
    get('btn-calendar-prev-month').click();
    assert.equal(month(), 'Septiembre 2027');
    get('btn-calendar-prev-month').click();
    assert.equal(month(), 'Agosto 2027');

    get('btn-calendar-next-month').click();
    get('btn-calendar-today').click();
    assert.equal(month(), 'Agosto 2027');

    today = [2026, 8, 15, 12];
    get('btn-calendar-today').click();
    assert.equal(month(), 'Septiembre 2026');
    get('btn-calendar-next-month').click();
    assert.equal(month(), 'Octubre 2026');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
