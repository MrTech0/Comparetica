import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initAuthGuard } from '../src/js/auth.js';

const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

function setup(t, { unlocked = true, logout = async () => {}, statusError = false } = {}) {
  const original = { document: globalThis.document, window: globalThis.window };
  const nodes = new Map();
  const calls = [];
  let reloads = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });

  function element(id = '', attributes = '') {
    const classes = new Set((attributes.match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean));
    return {
      id, children: [], value: '', type: 'password', disabled: false, style: {},
      inert: /\binert\b/.test(attributes),
      classList: {
        add(...items) { items.forEach(item => classes.add(item)); },
        remove(...items) { items.forEach(item => classes.delete(item)); },
        contains(item) { return classes.has(item); }
      },
      addEventListener(type, callback) { this[`on${type}`] = callback; },
      click() { return this.onclick?.(); },
      focus() { this.focused = true; },
      appendChild(child) { this.children.push(child); return child; },
      cloneNode() { return element(id, attributes); },
      replaceWith(replacement) { nodes.set(id, replacement); }
    };
  }

  for (const match of html.matchAll(/<[a-z][\w-]*\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    nodes.set(match[2], element(match[2], match[1]));
  }
  globalThis.document = {
    getElementById: id => nodes.get(id) || null,
    createElement: () => element()
  };
  globalThis.window = {
    location: { reload() { reloads++; } },
    __TAURI__: { core: { invoke: async command => {
      calls.push(command);
      if (command === 'db_check_status') {
        if (statusError) throw new Error('Status unavailable');
        return { is_initialized: true, is_unlocked: unlocked, needs_migration: false };
      }
      if (command === 'db_logout') return await logout();
      throw new Error(`Unexpected command: ${command}`);
    } } }
  };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  return { nodes, calls, get reloads() { return reloads; } };
}

function startLogout(context) {
  const button = context.nodes.get('nav-logout');
  assert.ok(button, 'La barra lateral debe ofrecer el botón de cerrar sesión');
  assert.equal(typeof button.onclick, 'function', 'El botón debe estar conectado al cierre de sesión');
  return button.click();
}

test('cancelar el cierre de sesión conserva el acceso sin llamar al backend ni recargar', async t => {
  const context = setup(t);
  await initAuthGuard();
  const pending = startLogout(context);
  assert.ok(context.nodes.get('dialog-confirm').classList.contains('active'));
  context.nodes.get('dialog-confirm-cancel').click();
  await pending;
  assert.deepEqual(context.calls, ['db_check_status']);
  assert.equal(context.reloads, 0);
  assert.equal(context.nodes.get('app-container').inert, false);
  assert.equal(context.nodes.get('nav-logout').disabled, false);
});

test('confirmar el cierre espera al bloqueo nativo antes de recargar y evita cierres duplicados', async t => {
  let finishLogout;
  const context = setup(t, { logout: () => new Promise(resolve => { finishLogout = resolve; }) });
  await initAuthGuard();
  const pending = startLogout(context);
  await context.nodes.get('dialog-confirm-accept').click();
  assert.deepEqual(context.calls, ['db_check_status', 'db_logout']);
  assert.equal(context.reloads, 0);
  await context.nodes.get('nav-logout').click();
  assert.deepEqual(context.calls, ['db_check_status', 'db_logout']);
  finishLogout();
  await pending;
  assert.equal(context.reloads, 1);
});

test('un error al guardar y cerrar la sesión permite reintentar sin recargar', async t => {
  t.mock.method(console, 'error', () => {});
  const context = setup(t, { logout: async () => { throw new Error('Disk unavailable'); } });
  await initAuthGuard();
  const pending = startLogout(context);
  context.nodes.get('dialog-confirm-accept').click();
  await pending;
  assert.equal(context.reloads, 0);
  assert.equal(context.nodes.get('nav-logout').disabled, false);
  assert.equal(context.nodes.get('app-container').inert, false);
  assert.equal(context.nodes.get('toast-container').children.at(-1)?.className, 'm3-toast error');
});

test('una bóveda bloqueada muestra el acceso y mantiene la aplicación fuera del foco', async t => {
  const context = setup(t, { unlocked: false });
  let unlockedCalls = 0;
  await initAuthGuard(() => { unlockedCalls++; });
  t.mock.timers.tick(100);
  assert.equal(context.nodes.get('auth-overlay').classList.contains('hidden'), false);
  assert.equal(context.nodes.get('auth-form-login').classList.contains('hidden'), false);
  assert.equal(context.nodes.get('app-container').inert, true);
  assert.equal(context.nodes.get('login-password').focused, true);
  assert.equal(unlockedCalls, 0);
});

test('una sesión desbloqueada permite interactuar con la aplicación', async t => {
  const context = setup(t);
  let unlockedCalls = 0;
  await initAuthGuard(() => { unlockedCalls++; });
  assert.equal(context.nodes.get('auth-overlay').classList.contains('hidden'), true);
  assert.equal(context.nodes.get('app-container').inert, false);
  assert.equal(unlockedCalls, 1);
});

test('si falla la comprobación de la bóveda se mantiene visible la pantalla de acceso', async t => {
  t.mock.method(console, 'error', () => {});
  const context = setup(t, { statusError: true });
  await initAuthGuard();
  assert.equal(context.nodes.get('auth-overlay').classList.contains('hidden'), false);
  assert.equal(context.nodes.get('app-container').inert, true);
});
