import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { formatRetentionPercent, parseRetentionPercent } from '../src/js/commission_split.js';

function element() {
  const events = new Map(), classes = new Set(), queries = new Map();
  return { value: '', dataset: {}, style: {}, children: [], innerHTML: '', textContent: '', disabled: false,
    classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v), toggle(v, on) { if(on) classes.add(v); else classes.delete(v); } },
    addEventListener(event, fn) { if (!events.has(event)) events.set(event, []); events.get(event).push(fn); },
    async fire(event) { for (const fn of events.get(event) || []) await fn({ preventDefault() {}, target: this }); },
    count(event) { return events.get(event)?.length || 0; },
    querySelector(selector) { if (!queries.has(selector)) queries.set(selector, element()); return queries.get(selector); },
    querySelectorAll(selector) {
      if (this.children.length) return this.children.flatMap(child => child.querySelectorAll(selector));
      if (!selector.startsWith('.')) return [];
      const matching = [...this.innerHTML.matchAll(/<button[^>]*class="([^"]*)"[^>]*data-id="(\d+)"/g)].filter(match => match[1].split(' ').includes(selector.slice(1)));
      return matching.map(match => { const button = this.querySelector(selector); button.setAttribute('data-id', match[2]); return button; });
    }, appendChild(el) { this.children.push(el); },
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; }, reset() {}, focus() {}
  };
}

function mount(view, overrides = {}) {
  const nodes = new Map(), calls = [], toasts = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const retentions = [{ id: 1, nombre: 'General', porcentaje_centesimas: 2025, num_agentes: 1 }];
  const context = vm.createContext({ document: { getElementById: get, createElement: element }, console,
    formatRetentionPercent, parseRetentionPercent,
    showToast: (...args) => toasts.push(args), showConfirm: async () => true,
    getRetenciones: async () => retentions,
    addRetencion: async (...args) => calls.push(['add', ...args]), updateRetencion: async (...args) => calls.push(['update', ...args]), deleteRetencion: async () => {},
    getAgentes: async () => [{ id: 1, nombre: 'Ana', retencion_id: 1, retencion_nombre: 'General', porcentaje_centesimas: 2025, activo: 1 }],
    addAgente: async (...args) => calls.push(['addAgent', ...args]), updateAgente: async (...args) => calls.push(['updateAgent', ...args]),
    toggleAgenteEstado: async () => {}, deleteAgente: async () => {}, reassignAgenteClientes: async () => {}, checkAgenteSetupStatus: async () => {}, initRetentionsView: async () => {},
    ...overrides
  });
  const source = fs.readFileSync(new URL(`../src/js/views/${view}.js`, import.meta.url), 'utf8').replace(/^import[\s\S]*?;\r?$/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
  return { get, calls, toasts, context };
}

test('retenciones: alta decimal, validación y reapertura sin duplicar guardados', async () => {
  const f = mount('retentions');
  await f.context.initRetentionsView(); await f.context.initRetentionsView();
  assert.equal(f.get('dialog-retention-form').count('submit'), 1);
  f.get('dialog-retention-percent').value = '20,25';
  await f.get('dialog-retention-form').fire('submit');
  assert.deepEqual(f.calls[0], ['add', '20,25']);
  assert.match(f.get('table-retentions-body').children[0].innerHTML, /20,25 %/);
  assert.doesNotMatch(f.get('table-retentions-body').children[0].innerHTML, /General/);
  f.get('dialog-retention-percent').value = '101';
  await f.get('dialog-retention-form').fire('submit');
  assert.equal(f.calls.length, 1);
  assert.equal(f.toasts.at(-1)[1], 'error');
});

test('error al guardar retención conserva el formulario y permite reintentar', async () => {
  const f = mount('retentions', { addRetencion: async () => { throw new Error('Ya existe'); } });
  await f.context.initRetentionsView();
  await f.get('open-retention-dialog-btn').fire('click');
  f.get('dialog-retention-percent').value = '20';
  await f.get('dialog-retention-form').fire('submit');
  assert.equal(f.get('dialog-retention').classList.contains('active'), true);
  assert.equal(f.get('dialog-retention-percent').value, '20');
  assert.equal(f.get('dialog-retention-form').querySelector('button[type="submit"]').disabled, false);
  assert.match(f.toasts.at(-1)[0], /Ya existe/);
});

test('agentes: opciones con porcentaje, retención opcional y eventos únicos', async () => {
  const f = mount('agents');
  await f.context.initAgentsView(); await f.context.initAgentsView();
  await f.get('open-agent-dialog-btn').fire('click');
  assert.match(f.get('dialog-agent-retention').innerHTML, /<option value="">0%<\/option>/);
  assert.match(f.get('dialog-agent-retention').innerHTML, /20,25 %/);
  assert.doesNotMatch(f.get('dialog-agent-retention').innerHTML, /General/);
  assert.match(f.get('table-agents-body').children[0].innerHTML, /20,25 %/);
  assert.doesNotMatch(f.get('table-agents-body').children[0].innerHTML, /General/);
  f.get('dialog-agent-name').value = 'Ana';
  f.get('dialog-agent-retention').value = '1';
  await f.get('dialog-agent-form').fire('submit');
  assert.deepEqual(f.calls[0], ['addAgent', 'Ana', null, null, 1]);
  f.get('dialog-agent-retention').value = '';
  await f.get('dialog-agent-form').fire('submit');
  assert.equal(f.calls[1].at(-1), null);
  assert.equal(f.get('dialog-agent-form').count('submit'), 1);
});

test('un error de catálogo impide abrir el editor de agente con opciones incorrectas', async () => {
  const f = mount('agents', { getRetenciones: async () => { throw new Error('Fallo de lectura'); } });
  await f.context.initAgentsView();
  await f.get('open-agent-dialog-btn').fire('click');
  assert.equal(f.get('dialog-agent').classList.contains('active'), false);
  assert.match(f.toasts.at(-1)[0], /Fallo de lectura/);
});

test('editar una retención rellena el porcentaje y guarda su ID; borrado en uso explica el bloqueo', async () => {
  const f = mount('retentions');
  await f.context.initRetentionsView();
  const row = f.get('table-retentions-body').children[0];
  await row.querySelector('.edit-retention-btn').fire('click');
  assert.equal(f.get('dialog-retention-id').value, 1);
  assert.equal(f.get('dialog-retention-percent').value, '20,25');
  f.get('dialog-retention-percent').value = '30';
  await f.get('dialog-retention-form').fire('submit');
  assert.deepEqual(f.calls[0], ['update', 1, '30']);
  await row.querySelector('.delete-retention-btn').fire('click');
  assert.match(f.toasts.at(-1)[0], /asignada.*comerciales/);
});

test('editar un agente conserva su retención y cambiar de pestaña refresca los datos', async () => {
  let catalogLoads = 0;
  const f = mount('agents', { initRetentionsView: async () => { catalogLoads++; } });
  await f.context.initAgentsView();
  await f.get('table-agents-body').children[0].querySelector('.edit-agent-btn').fire('click');
  assert.equal(f.get('dialog-agent-retention').value, 1);
  await f.get('dialog-agent-form').fire('submit');
  assert.deepEqual(f.calls[0], ['updateAgent', 1, 'Ana', null, null, 1]);
  await f.get('tab-btn-agents-retentions').fire('click');
  assert.equal(catalogLoads, 1);
  assert.equal(f.get('agents-panel-agents').hidden, true);
  assert.equal(f.get('agents-panel-retentions').hidden, false);
  await f.get('tab-btn-agents-agents').fire('click');
  assert.equal(f.get('agents-panel-agents').hidden, false);
});

test('un segundo envío mientras se guarda no crea dos retenciones', async () => {
  let writes = 0, finish;
  const f = mount('retentions', { addRetencion: async () => { writes++; await new Promise(resolve => { finish = resolve; }); } });
  await f.context.initRetentionsView();
  f.get('dialog-retention-percent').value = '20';
  const pending = f.get('dialog-retention-form').fire('submit');
  await f.get('dialog-retention-form').fire('submit');
  assert.equal(writes, 1);
  finish(); await pending;
});
