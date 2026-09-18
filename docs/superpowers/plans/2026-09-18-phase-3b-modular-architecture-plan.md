# Phase 3B: Arquitectura Modular Nativa (UI, IPC y Eventos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modularizar la arquitectura frontend de Comparetica creando capas dedicadas para comunicación Tauri IPC (`src/js/ipc.js`), notificaciones y confirmaciones UI (`src/js/ui.js`) y bus de eventos (`src/js/events.js`), eliminando la repetición masiva de código de enlace IPC y las llamadas implícitas sobre `window`.

**Architecture:** Módulos ES6 puros sin bundler que operan directamente sobre el Webview de Tauri con `"frontendDist": "../src"`. Capa `ipc.js` con manejo seguro y tipado de llamadas nativas, capa `ui.js` desacoplada con puente de retrocompatibilidad sobre `window`, y catálogo inmutable `APP_EVENTS` con utilidades de suscripción desacopladas.

**Tech Stack:** JavaScript Vanilla (ES Modules), Tauri v2 IPC, Node.js (`node:test`, `node:assert/strict`), Rust (rusqlite v0.32).

**Spec:** [docs/superpowers/specs/2026-09-18-phase-3b-modular-architecture-design.md](file:///c:/Users/polca/Documents/github/Comparetica/docs/superpowers/specs/2026-09-18-phase-3b-modular-architecture-design.md)

## Global Constraints

- Preservar compatibilidad total con la base de datos cifrada existente `comparetica.db.enc`, `vault.json`, `.bak` y llamadas IPC de Tauri v2.
- Mantener `"withGlobalTauri": true` en `tauri.conf.json`.
- Cero dependencias npm añadidas.
- Mantener el puente de retrocompatibilidad en `window` para `showToast`, `showActionToast` y `showConfirm` para evitar roturas accidentales en código legado.
- Todos los archivos modificados deben compilar limpiamente con `node --check`.

---

### Task 1: Crear módulo `src/js/ipc.js` y primera prueba unitaria

**Files:**
- Create: [src/js/ipc.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/ipc.js)
- Create: [test/ipc_and_ui.test.js](file:///c:/Users/polca/Documents/github/Comparetica/test/ipc_and_ui.test.js)

**Interfaces:**
- Produces: `invoke(cmd, args)`, `listen(eventName, handler)` en `src/js/ipc.js`.

- [ ] **Paso 1: Escribir el test fallido para `src/js/ipc.js`**

  Crear `test/ipc_and_ui.test.js`:
  ```javascript
  import test, { describe } from 'node:test';
  import assert from 'node:assert/strict';
  import { invoke, listen } from '../src/js/ipc.js';

  describe('Módulo Tauri IPC (ipc.js)', () => {
    test('invoke rechaza con error explicativo si window.__TAURI__ no está disponible', async () => {
      const originalTauri = globalThis.window?.__TAURI__;
      try {
        if (!globalThis.window) globalThis.window = {};
        delete globalThis.window.__TAURI__;

        await assert.rejects(
          async () => {
            await invoke('test_command', { foo: 'bar' });
          },
          /\[Tauri IPC\] Comando 'test_command' no disponible/
        );
      } finally {
        if (originalTauri) globalThis.window.__TAURI__ = originalTauri;
      }
    });

    test('invoke ejecuta correctamente window.__TAURI__.core.invoke si está presente', async () => {
      const originalTauri = globalThis.window?.__TAURI__;
      try {
        if (!globalThis.window) globalThis.window = {};
        let calledCmd = null;
        let calledArgs = null;
        globalThis.window.__TAURI__ = {
          core: {
            invoke: async (cmd, args) => {
              calledCmd = cmd;
              calledArgs = args;
              return { success: true, count: 42 };
            }
          }
        };

        const res = await invoke('get_counts', { filter: 'active' });
        assert.strictEqual(calledCmd, 'get_counts');
        assert.deepStrictEqual(calledArgs, { filter: 'active' });
        assert.deepStrictEqual(res, { success: true, count: 42 });
      } finally {
        if (originalTauri) globalThis.window.__TAURI__ = originalTauri;
      }
    });

    test('listen se suscribe a eventos o devuelve no-op si no está disponible', async () => {
      const unlisten = await listen('tauri://file-drop', () => {});
      assert.strictEqual(typeof unlisten, 'function');
    });
  });
  ```

- [ ] **Paso 2: Ejecutar test para verificar que falla**

  ```powershell
  node --test test/ipc_and_ui.test.js
  ```
  Esperado: FAIL porque `src/js/ipc.js` no existe todavía.

- [ ] **Paso 3: Implementar `src/js/ipc.js`**

  Crear `src/js/ipc.js`:
  ```javascript
  /* src/js/ipc.js */

  /**
   * Invoca un comando expuesto por el backend de Tauri.
   * Soporta de forma transparente tanto window.__TAURI__.core.invoke (Tauri v2)
   * como window.__TAURI__.invoke.
   *
   * @template T
   * @param {string} cmd - Nombre del comando registrado en Tauri.
   * @param {Record<string, any>} [args={}] - Argumentos a transferir al comando.
   * @returns {Promise<T>} Resultado devuelto por el backend.
   */
  export async function invoke(cmd, args = {}) {
    if (typeof window !== 'undefined' && window.__TAURI__) {
      const fn = window.__TAURI__.core?.invoke || window.__TAURI__.invoke;
      if (typeof fn === 'function') {
        return await fn(cmd, args);
      }
    }
    throw new Error(`[Tauri IPC] Comando '${cmd}' no disponible en este entorno.`);
  }

  /**
   * Escucha eventos nativos emitidos desde el backend de Tauri.
   *
   * @param {string} eventName - Nombre del evento (ej: 'tauri://drag-drop').
   * @param {(event: any) => void} handler - Callback a ejecutar cuando se reciba el evento.
   * @returns {Promise<() => void>} Función para desuscribir el listener.
   */
  export async function listen(eventName, handler) {
    if (typeof window !== 'undefined' && window.__TAURI__?.event?.listen) {
      return await window.__TAURI__.event.listen(eventName, handler);
    }
    return () => {};
  }
  ```

- [ ] **Paso 4: Ejecutar test para verificar que pasa**

  ```powershell
  node --test test/ipc_and_ui.test.js
  ```
  Esperado: PASS (3/3 tests pasando).

- [ ] **Paso 5: Commit**

  ```bash
  git add src/js/ipc.js test/ipc_and_ui.test.js
  git commit -m "feat(ipc): create centralized Tauri IPC abstraction module"
  ```

---

### Task 2: Crear módulo `src/js/events.js` y ampliar pruebas unitarias

**Files:**
- Create: [src/js/events.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/events.js)
- Modify: [test/ipc_and_ui.test.js](file:///c:/Users/polca/Documents/github/Comparetica/test/ipc_and_ui.test.js)

**Interfaces:**
- Produces: `APP_EVENTS`, `emitAppEvent(eventName, detail)`, `onAppEvent(eventName, handler)` en `src/js/events.js`.

- [ ] **Paso 1: Añadir tests para `src/js/events.js` en `test/ipc_and_ui.test.js`**

  Añadir al final de `test/ipc_and_ui.test.js`:
  ```javascript
  import { APP_EVENTS, emitAppEvent, onAppEvent } from '../src/js/events.js';

  describe('Módulo de Bus de Eventos (events.js)', () => {
    test('APP_EVENTS es un catálogo inmutable y contiene eventos clave', () => {
      assert.ok(Object.isFrozen(APP_EVENTS));
      assert.strictEqual(APP_EVENTS.COMPARISON_SAVED, 'comparison-saved');
      assert.strictEqual(APP_EVENTS.CLIENTS_UPDATED, 'clients-updated');
      assert.strictEqual(APP_EVENTS.AGENTS_UPDATED, 'agents-updated');
    });

    test('emitAppEvent y onAppEvent transmiten y desuscriben correctamente', () => {
      let received = null;
      const unsubscribe = onAppEvent(APP_EVENTS.COMPARISON_SAVED, (e) => {
        received = e.detail;
      });

      emitAppEvent(APP_EVENTS.COMPARISON_SAVED, { id: 123 });
      assert.deepStrictEqual(received, { id: 123 });

      // Probar desuscripción
      received = null;
      unsubscribe();
      emitAppEvent(APP_EVENTS.COMPARISON_SAVED, { id: 456 });
      assert.strictEqual(received, null);
    });
  });
  ```

- [ ] **Paso 2: Ejecutar test para verificar que falla**

  ```powershell
  node --test test/ipc_and_ui.test.js
  ```
  Esperado: FAIL porque `src/js/events.js` no existe.

- [ ] **Paso 3: Implementar `src/js/events.js`**

  Crear `src/js/events.js`:
  ```javascript
  /* src/js/events.js */

  /**
   * Catálogo inmutable de nombres de eventos estándar de la aplicación.
   */
  export const APP_EVENTS = Object.freeze({
    COMPARISON_SAVED: 'comparison-saved',
    CLIENTS_UPDATED: 'clients-updated',
    AGENTS_UPDATED: 'agents-updated',
    TARIFFS_UPDATED: 'tariffs-updated',
    SETTINGS_UPDATED: 'settings-updated'
  });

  /**
   * Emite un evento de aplicación desacoplado a través del objeto global.
   *
   * @param {string} eventName - Nombre del evento (utilizar constantes de APP_EVENTS).
   * @param {any} [detail=null] - Payload asociado al evento.
   */
  export function emitAppEvent(eventName, detail = null) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
  }

  /**
   * Suscribe un manejador a un evento de aplicación y retorna la función de desuscripción.
   *
   * @param {string} eventName - Nombre del evento (utilizar constantes de APP_EVENTS).
   * @param {(event: CustomEvent) => void} handler - Callback a ejecutar al dispararse el evento.
   * @returns {() => void} Función para desuscribir el listener.
   */
  export function onAppEvent(eventName, handler) {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener(eventName, handler);
      return () => window.removeEventListener(eventName, handler);
    }
    return () => {};
  }
  ```

- [ ] **Paso 4: Ejecutar test para verificar que pasa**

  ```powershell
  node --test test/ipc_and_ui.test.js
  ```
  Esperado: PASS.

- [ ] **Paso 5: Commit**

  ```bash
  git add src/js/events.js test/ipc_and_ui.test.js
  git commit -m "feat(events): create application event bus and immutable event catalog"
  ```

---

### Task 3: Crear módulo `src/js/ui.js` y prueba unitaria

**Files:**
- Create: [src/js/ui.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/ui.js)
- Modify: [test/ipc_and_ui.test.js](file:///c:/Users/polca/Documents/github/Comparetica/test/ipc_and_ui.test.js)

**Interfaces:**
- Produces: `showToast(message, type)`, `showActionToast(message, actions)`, `showConfirm(mensaje, titulo)` en `src/js/ui.js` y puente global en `window`.

- [ ] **Paso 1: Añadir tests para `src/js/ui.js` en `test/ipc_and_ui.test.js`**

  Añadir al final de `test/ipc_and_ui.test.js`:
  ```javascript
  import { showToast, showActionToast, showConfirm } from '../src/js/ui.js';

  describe('Módulo Central de UI (ui.js)', () => {
    test('showToast, showActionToast y showConfirm están exportados y asignados a window', () => {
      assert.strictEqual(typeof showToast, 'function');
      assert.strictEqual(typeof showActionToast, 'function');
      assert.strictEqual(typeof showConfirm, 'function');

      if (typeof window !== 'undefined') {
        assert.strictEqual(window.showToast, showToast);
        assert.strictEqual(window.showActionToast, showActionToast);
        assert.strictEqual(window.showConfirm, showConfirm);
      }
    });

    test('showConfirm resuelve mediante confirm nativo si no existe el contenedor DOM', async () => {
      const originalConfirm = globalThis.confirm;
      try {
        globalThis.confirm = () => true;
        const result = await showConfirm('¿Continuar?');
        assert.strictEqual(result, true);
      } finally {
        globalThis.confirm = originalConfirm;
      }
    });
  });
  ```

- [ ] **Paso 2: Ejecutar test para verificar que falla**

  ```powershell
  node --test test/ipc_and_ui.test.js
  ```
  Esperado: FAIL porque `src/js/ui.js` no existe.

- [ ] **Paso 3: Implementar `src/js/ui.js`**

  Crear `src/js/ui.js`:
  ```javascript
  /* src/js/ui.js */

  /**
   * Muestra una notificación emergente Toast con estilo Material 3.
   *
   * @param {string} message - Mensaje a mostrar.
   * @param {'success'|'error'|'info'|'warning'} [type='success'] - Tipo de notificación.
   */
  export function showToast(message, type = 'success') {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `m3-toast ${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    // Auto-eliminar después de 4 segundos
    setTimeout(() => {
      toast.classList.add('m3-toast-fadeout');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    }, 4000);
  }

  /**
   * Muestra una notificación emergente con acciones interactivas.
   *
   * @param {string} message - Texto informativo.
   * @param {Array<{text: string, class?: string, callback: () => void}>} [actions=[]]
   */
  export function showActionToast(message, actions = []) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'm3-toast action-toast';

    const textSpan = document.createElement('span');
    textSpan.className = 'toast-text';
    textSpan.innerText = message;
    toast.appendChild(textSpan);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'toast-actions';

    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = action.class || '';
      btn.innerText = action.text;
      btn.addEventListener('click', () => {
        if (action.callback) action.callback();
        toast.classList.add('m3-toast-fadeout');
        toast.addEventListener('animationend', () => {
          toast.remove();
        });
      });
      actionsDiv.appendChild(btn);
    });

    toast.appendChild(actionsDiv);
    container.appendChild(toast);
  }

  /**
   * Muestra un diálogo modal de confirmación personalizado de Material Design 3.
   *
   * @param {string} mensaje - Mensaje a mostrar.
   * @param {string} [titulo="Confirmación"] - Título del diálogo.
   * @returns {Promise<boolean>} Resuelve a true si el usuario acepta, o false si cancela.
   */
  export function showConfirm(mensaje, titulo = "Confirmación") {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') {
        if (typeof confirm === 'function') {
          resolve(confirm(mensaje));
        } else {
          resolve(true);
        }
        return;
      }

      const overlay = document.getElementById('dialog-confirm');
      const titleEl = document.getElementById('dialog-confirm-title');
      const msgEl = document.getElementById('dialog-confirm-message');
      const btnCancel = document.getElementById('dialog-confirm-cancel');
      const btnAccept = document.getElementById('dialog-confirm-accept');

      if (!overlay || !titleEl || !msgEl || !btnCancel || !btnAccept) {
        if (typeof confirm === 'function') {
          resolve(confirm(mensaje));
        } else {
          resolve(true);
        }
        return;
      }

      titleEl.innerText = titulo;
      msgEl.innerText = mensaje;

      const cancelClone = btnCancel.cloneNode(true);
      const acceptClone = btnAccept.cloneNode(true);
      btnCancel.replaceWith(cancelClone);
      btnAccept.replaceWith(acceptClone);

      cancelClone.addEventListener('click', () => {
        overlay.classList.remove('active');
        resolve(false);
      });

      acceptClone.addEventListener('click', () => {
        overlay.classList.remove('active');
        resolve(true);
      });

      overlay.classList.add('active');
    });
  }

  // Puente de retrocompatibilidad global
  if (typeof window !== 'undefined') {
    window.showToast = showToast;
    window.showActionToast = showActionToast;
    window.showConfirm = showConfirm;
  }
  ```

- [ ] **Paso 4: Ejecutar test para verificar que pasa**

  ```powershell
  node --test test/ipc_and_ui.test.js
  ```
  Esperado: PASS (todos los tests de `test/ipc_and_ui.test.js` pasando).

- [ ] **Paso 5: Commit**

  ```bash
  git add src/js/ui.js test/ipc_and_ui.test.js
  git commit -m "feat(ui): create centralized UI notifications and confirmation modal module"
  ```

---

### Task 4: Refactorizar módulos núcleo y utilidades (`app.js`, `db.js`, `auth.js`, `pdf.js`, `csv_importer.js`)

**Files:**
- Modify: [src/js/app.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/app.js)
- Modify: [src/js/db.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/db.js)
- Modify: [src/js/auth.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/auth.js)
- Modify: [src/js/pdf.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/pdf.js)
- Modify: [src/js/csv_importer.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/csv_importer.js)

**Interfaces:**
- Consumes: `invoke`, `listen` desde `./ipc.js`; `showToast`, `showActionToast`, `showConfirm` desde `./ui.js`; `emitAppEvent`, `APP_EVENTS` desde `./events.js`.

- [ ] **Paso 1: Refactorizar `src/js/app.js`**
  - Importar `showToast`, `showActionToast`, `showConfirm` desde `./ui.js`.
  - Importar `emitAppEvent`, `APP_EVENTS` desde `./events.js`.
  - Eliminar las implementaciones inline de `window.showToast = ...`, `window.showActionToast = ...`, `window.showConfirm = ...`.
  - En la navegación (`item.btn === 'nav-history'`), usar `emitAppEvent(APP_EVENTS.COMPARISON_SAVED)`.

- [ ] **Paso 2: Refactorizar `src/js/db.js`**
  - Importar `invoke` desde `./ipc.js`.
  - Eliminar las múltiples repeticiones de `const invoke = window.__TAURI__.core ? ...` en `setupMasterPassword`, `loginDb`, `recoverDbAccess`, `changeMasterPassword`, `checkDbStatus`, `exportDbBackup`, `importDbBackup`, `getCompanyConfig`, `saveCompanyConfig`, `getCompanyLogo`, `deleteCompanyLogo`.
  - Sustituir por llamadas directas a `invoke(cmd, args)`.

- [ ] **Paso 3: Refactorizar `src/js/auth.js`**
  - Importar `invoke` desde `./ipc.js` y `showToast` desde `./ui.js`.
  - Sustituir `window.__TAURI__.core.invoke` y ternarios por `await invoke(...)`.

- [ ] **Paso 4: Refactorizar `src/js/pdf.js`**
  - Importar `invoke` desde `./ipc.js` y `showToast` desde `./ui.js`.
  - Sustituir `window.__TAURI__.core.invoke('save_pdf', ...)` por `await invoke('save_pdf', ...)`.
  - Sustituir `window.showToast(...)` por `showToast(...)`.

- [ ] **Paso 5: Refactorizar `src/js/csv_importer.js`**
  - Importar `invoke`, `listen` desde `./ipc.js` y `showToast` desde `./ui.js`.
  - Sustituir los listeners de eventos Tauri (`tauri://drag-drop`, etc.) por llamadas a `listen(...)`.
  - Sustituir `window.showToast(...)` por llamadas a `showToast(...)`.

- [ ] **Paso 6: Validar sintaxis y ejecutar tests**

  ```powershell
  node --check src/js/app.js
  node --check src/js/db.js
  node --check src/js/auth.js
  node --check src/js/pdf.js
  node --check src/js/csv_importer.js
  node --test
  ```
  Esperado: Sintaxis válida (0 errores) y tests pasando.

- [ ] **Paso 7: Commit**

  ```bash
  git add src/js/app.js src/js/db.js src/js/auth.js src/js/pdf.js src/js/csv_importer.js
  git commit -m "refactor(core): migrate core modules and utilities to ipc, ui and events modules"
  ```

---

### Task 5: Refactorizar vistas consumidoras (`views/backup.js`, `calculator_view.js`, `history.js`, `agents.js`, `clients.js`, `tariffs.js`, `settings.js`, `renewals.js`)

**Files:**
- Modify: [src/js/views/backup.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/backup.js)
- Modify: [src/js/views/calculator_view.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/calculator_view.js)
- Modify: [src/js/views/history.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/history.js)
- Modify: [src/js/views/agents.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/agents.js)
- Modify: [src/js/views/clients.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/clients.js)
- Modify: [src/js/views/tariffs.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/tariffs.js)
- Modify: [src/js/views/settings.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/settings.js)
- Modify: [src/js/views/renewals.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/renewals.js)

**Interfaces:**
- Consumes: `invoke` desde `../ipc.js`; `showToast`, `showConfirm` desde `../ui.js`; `emitAppEvent`, `onAppEvent`, `APP_EVENTS` desde `../events.js`.

- [ ] **Paso 1: Refactorizar `src/js/views/backup.js`**
  - Importar `invoke` desde `../ipc.js`.
  - Importar `showToast`, `showConfirm` desde `../ui.js`.
  - Sustituir los bloques `const invoke = ...` y las llamadas directas por `await invoke(...)`, `showToast(...)` y `await showConfirm(...)`.

- [ ] **Paso 2: Refactorizar `src/js/views/calculator_view.js`**
  - Importar `showToast` desde `../ui.js`.
  - Importar `emitAppEvent`, `APP_EVENTS` desde `../events.js`.
  - En el guardado de la comparativa, reemplazar `window.dispatchEvent(new CustomEvent('comparison-saved'))` por `emitAppEvent(APP_EVENTS.COMPARISON_SAVED)`.
  - Usar `showToast` explícito en lugar de `window.showToast`.

- [ ] **Paso 3: Refactorizar `src/js/views/history.js`**
  - Importar `showToast`, `showConfirm` desde `../ui.js`.
  - Importar `onAppEvent`, `APP_EVENTS` desde `../events.js`.
  - Reemplazar `window.addEventListener('comparison-saved', refreshHistory)` por `onAppEvent(APP_EVENTS.COMPARISON_SAVED, refreshHistory)`.

- [ ] **Paso 4: Refactorizar `src/js/views/agents.js`**
  - Importar `showToast`, `showConfirm` desde `../ui.js`.
  - Reemplazar `window.showToast` y `window.showConfirm`.
  - Eliminar el bloque de código muerto huérfano que llamaba a `window.reloadCurrentView()`.

- [ ] **Paso 5: Refactorizar `src/js/views/clients.js`, `views/tariffs.js`, `views/settings.js`, `views/renewals.js`**
  - Importar explícitamente `showToast` y `showConfirm` desde `../ui.js`.
  - Reemplazar usos de `window.showToast` y `window.showConfirm`.

- [ ] **Paso 6: Validar sintaxis y tests**

  ```powershell
  node --check src/js/views/backup.js
  node --check src/js/views/calculator_view.js
  node --check src/js/views/history.js
  node --check src/js/views/agents.js
  node --check src/js/views/clients.js
  node --check src/js/views/tariffs.js
  node --check src/js/views/settings.js
  node --check src/js/views/renewals.js
  node --test
  ```
  Esperado: 0 errores de sintaxis y todas las suites pasando.

- [ ] **Paso 7: Commit**

  ```bash
  git add src/js/views/*.js
  git commit -m "refactor(views): migrate all view modules to ui, ipc and events architecture"
  ```

---

### Task 6: Verificación Global de la Fase 3B

- [ ] **Paso 1: Ejecutar la suite completa de pruebas unitarias de JavaScript**

  ```powershell
  node --test test/calculator.test.js test/settings_dom.test.js test/ipc_and_ui.test.js
  ```
  Esperado: 100% de tests pasando (mínimo 16 tests).

- [ ] **Paso 2: Ejecutar la suite completa de pruebas unitarias de Rust**

  ```powershell
  cargo test --package comparetica
  ```
  Esperado: 5/5 tests pasando (`test result: ok. 5 passed; 0 failed`).

- [ ] **Paso 3: Chequeo de compilación de Rust**

  ```powershell
  cargo check
  ```
  Esperado: 0 errores, 0 warnings.

- [ ] **Paso 4: Comprobar el estado del repositorio (`git status`)**

  ```powershell
  git status
  ```
  Esperado: Árbol de trabajo limpio y commits atómicos completados.
