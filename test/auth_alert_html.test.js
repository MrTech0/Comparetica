import test from 'node:test';
import assert from 'node:assert/strict';
import { initAuthGuard } from '../src/js/auth.js';

function element() {
  return {
    children: [],
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, callback) { this[`on${type}`] = callback; },
    appendChild(child) { this.children.push(child); return child; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; },
    get textContent() { return this._text || ''; },
    set textContent(value) { this._text = value; this.children = []; }
  };
}

test('auth alert renders backend errors and saved PDF paths without parsing HTML', async () => {
  const original = {
    document: globalThis.document,
    window: globalThis.window
  };
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const payload = '<img src=x onerror=alert(1)>';
  let setupShouldFail = true;

  globalThis.document = {
    getElementById: get,
    createElement: element
  };
  globalThis.window = {
    jspdf: {
      jsPDF: class {
        setFontSize() {}
        setTextColor() {}
        text() {}
        setLineWidth() {}
        setDrawColor() {}
        line() {}
        setFillColor() {}
        roundedRect() {}
        setFont() {}
        output() { return 'data:application/pdf;base64,QUJD'; }
      }
    },
    __TAURI__: {
      core: {
        invoke: async command => {
          if (command === 'db_check_status') return { is_unlocked: false, is_initialized: false, needs_migration: true };
          if (command === 'db_setup_master_password') {
            if (setupShouldFail) throw new Error(payload);
            return 'recovery-key';
          }
          if (command === 'save_pdf') return `C:\\Temp\\${payload}.pdf`;
          throw new Error(`Unexpected command: ${command}`);
        }
      }
    }
  };

  try {
    get('setup-password').value = 'password123';
    get('setup-password-confirm').value = 'password123';
    await initAuthGuard();
    await get('auth-form-setup').onsubmit({ preventDefault() {} });

    const alert = get('auth-alert');
    assert.equal(alert.textContent, `Error: ${payload}`);
    assert.ok(!alert.innerHTML.includes(payload), 'error text must not be assigned to innerHTML');

    setupShouldFail = false;
    await get('auth-form-setup').onsubmit({ preventDefault() {} });
    await get('btn-download-recovery-pdf').onclick();

    assert.ok(!alert.innerHTML.includes(payload), 'PDF path must not be assigned to innerHTML');
    assert.equal(alert.children[0]?.textContent, `C:\\Temp\\${payload}.pdf`);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
