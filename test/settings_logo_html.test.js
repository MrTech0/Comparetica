import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings } from '../src/js/views/settings.js';

function element(tagName = 'div') {
  return {
    tagName,
    children: [],
    style: {},
    replaceChildren(...children) { this._html = ''; this.children = children; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; this.children = []; }
  };
}

test('company logo preview treats a stored URI as an image source without parsing HTML', async () => {
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage
  };
  const preview = element();
  const payload = 'x" onerror="alert(1)"><img src=x onerror=alert(2)>';
  const validLogo = 'data:image/png;base64,iVBORw0KGgo=';
  let storedLogo = payload;

  globalThis.document = {
    getElementById: id => id === 'settings-company-logo-preview' ? preview : null,
    createElement: element
  };
  globalThis.localStorage = { getItem: () => null };
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: async (command, { params } = {}) => {
          if (command === 'get_company_logo') return null;
          if (command !== 'db_select') throw new Error(`Unexpected command: ${command}`);
          const values = {
            company_config: {},
            company_logo: storedLogo,
            renewal_thresholds: { critical: 30, warning: 60, radar: 90 },
            client_inactivity_params: { mesesNuevo: 3, diasVencimiento: 30 }
          };
          assert.ok(params[0] in values, `Unexpected setting: ${params[0]}`);
          return [{ valor: JSON.stringify(values[params[0]]) }];
        }
      }
    }
  };

  try {
    await loadSettings();
    assert.ok(!preview.innerHTML.includes(payload), 'stored logo must not be interpolated into HTML');
    assert.equal(preview.children.length, 1);
    assert.equal(preview.children[0].tagName, 'img');
    assert.equal(preview.children[0].src, payload);
    assert.equal(preview.children[0].onerror, undefined);

    storedLogo = validLogo;
    await loadSettings();
    assert.equal(preview.children.length, 1, 'reloading settings must replace the previous logo');
    assert.equal(preview.children[0].src, validLogo);

    storedLogo = null;
    await loadSettings();
    assert.equal(preview.children.length, 0, 'clearing the logo must remove the image');
    assert.ok(preview.innerHTML.includes('Bombilla (Defecto)'));
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
