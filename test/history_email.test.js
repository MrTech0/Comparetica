import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getComparisonStatusLock, canManageCommissionCollection } from '../src/js/comparison_status.js';
import { getCommissionSplit, formatRetentionPercent, moneyToCents } from '../src/js/commission_split.js';

const backend = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const registeredCommands = backend.match(/generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(name => name.trim());
const emailArguments = backend.match(/fn open_email_with_attachment\(([\s\S]*?)\) ->/)[1]
  .split(',').map(parameter => parameter.trim().split(':')[0])
  .filter(name => name && name !== 'app_handle')
  .map(name => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()));
const pdfBase64 = Buffer.from('%PDF-1.7\nPDF de prueba').toString('base64');

function element() {
  const queries = new Map();
  return {
    children: [], style: {}, dataset: {},
    setAttribute(name, value) { this[name] = value; },
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener(type, callback) { this[`on${type}`] = callback; },
    querySelector(selector) { if (!queries.has(selector)) queries.set(selector, element()); return queries.get(selector); },
    querySelectorAll: () => [],
    appendChild(child) { this.children.push(child); },
    get innerHTML() { return this._html || ''; },
    set innerHTML(value) { this._html = value; this.children = []; }
  };
}

async function mount({ email = 'cliente@example.invalid', cancel = false, failOpening = false, companySnapshot } = {}) {
  const tbody = element();
  const calls = [];
  const toasts = [];
  const reports = [];
  const record = {
    id: 1, cliente_nombre: 'Cliente de prueba', cliente_email: email, cliente_cups: 'ES003100001AB',
    tipo_energia: 'GAS', fecha: '2026-10-02', ahorro_luz_anual: 0, ahorro_gas_anual: 100,
    comision_total: 10, datos_cliente_json: JSON.stringify({ currentGasCost: 600, companySnapshot })
  };
  const browser = vm.createContext({
    document: {
      getElementById: () => null, createElement: element, querySelectorAll: () => [], addEventListener() {},
      querySelector: selector => selector === '#table-history tbody' ? tbody : null
    },
    window: { __TAURI__: {}, _historyScrollListenerAdded: true },
    console: { error() {} }, setTimeout, clearTimeout,
    getComparisonStatusLock, canManageCommissionCollection,
    getCommissionSplit, formatRetentionPercent, moneyToCents,
    APP_EVENTS: { COMPARISON_SAVED: 'comparison-saved' }, onAppEvent: () => () => {},
    getComparativas: async () => [record],
    generatePDFReport: async (data, preview, base64) => {
      reports.push({ data, preview, base64 });
      return cancel ? null : pdfBase64;
    },
    showToast: (message, type) => toasts.push({ message, type }),
    invoke: async (command, args) => {
      calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
      if (!registeredCommands.includes(command)) throw new Error(`Command ${command} not found`);
      for (const name of emailArguments) assert.equal(typeof args[name], 'string', `missing native argument: ${name}`);
      if (failOpening) throw new Error('No hay una aplicación asociada para abrir el correo');
      return 'Correo abierto correctamente';
    }
  });
  const source = fs.readFileSync(new URL('../src/js/views/history.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
  new vm.Script(source, { filename: 'history.js' }).runInContext(browser);
  await browser.initHistoryView();
  assert.equal(tbody.children.length, 1);
  return { calls, reports, toasts, click: () => tbody.children[0].querySelector('.btn-email-history').onclick(),
    preview: () => tbody.children[0].querySelector('.btn-preview-history').onclick(),
    print: () => tbody.children[0].querySelector('.btn-print-history').onclick() };
}

test('all historical PDF actions pass the saved branding including a default logo', async () => {
  const snapshot = { config: { consultora_nombre: 'Consultora original' }, logo: null };
  const f = await mount({ companySnapshot: snapshot });
  f.preview(); f.print(); await f.click();
  assert.equal(f.reports.length, 3);
  for (const report of f.reports) {
    assert.ok(report.data.companySnapshot, 'history must pass the saved branding to PDF generation');
    assert.deepEqual(JSON.parse(JSON.stringify(report.data.companySnapshot)), snapshot);
  }
});

test('history email opens the registered native command with the recipient and generated PDF', async () => {
  const f = await mount();
  await f.click();
  assert.deepEqual(f.calls, [{ command: 'open_email_with_attachment', args: {
    recipient: 'cliente@example.invalid', pdfFilename: 'comparativa_cliente_de_prueba.pdf', pdfBase64
  } }]);
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].data.clientName, 'Cliente de prueba');
  assert.equal(f.reports[0].data.energyType, 'GAS');
  assert.equal(f.reports[0].preview, false);
  assert.equal(f.reports[0].base64, true);
  assert.equal(f.toasts.at(-1).type, 'success');
  assert.match(f.toasts.at(-1).message, /borrador.*PDF adjunto/i);
  assert.doesNotMatch(f.toasts.at(-1).message, /enviado/i);
});

test('cancelling the PDF password prompt does not open a draft or report success', async () => {
  const f = await mount({ cancel: true });
  await f.click();
  assert.equal(f.calls.length, 0);
  assert.equal(f.toasts.some(toast => toast.type === 'success'), false);
});

test('a client without an email address does not generate a PDF or open a draft', async () => {
  const f = await mount({ email: null });
  await f.click();
  assert.equal(f.reports.length, 0);
  assert.equal(f.calls.length, 0);
  assert.match(f.toasts.at(-1).message, /no tiene un correo/);
});

test('failure to open the mail app displays an error without reporting success', async () => {
  const f = await mount({ failOpening: true });
  await f.click();
  assert.equal(f.calls[0].command, 'open_email_with_attachment');
  assert.equal(f.toasts.at(-1).type, 'error');
  assert.match(f.toasts.at(-1).message, /No hay una aplicación asociada/);
  assert.equal(f.toasts.some(toast => toast.type === 'success'), false);
});
