import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { invoke, listen } from '../src/js/ipc.js';
import { APP_EVENTS, emitAppEvent, onAppEvent } from '../src/js/events.js';
import { showToast, showActionToast, showConfirm } from '../src/js/ui.js';

describe('Tauri IPC Module (src/js/ipc.js)', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  describe('invoke()', () => {
    test('rechaza con error descriptivo cuando window.__TAURI__ está ausente', async () => {
      delete globalThis.window;
      await assert.rejects(
        async () => {
          await invoke('test_command', { key: 'val' });
        },
        {
          name: 'Error',
          message: "[Tauri IPC] Comando 'test_command' no disponible en este entorno."
        }
      );
    });

    test('rechaza con error descriptivo cuando window existe pero __TAURI__ no está definido', async () => {
      globalThis.window = {};
      await assert.rejects(
        async () => {
          await invoke('another_command');
        },
        {
          name: 'Error',
          message: "[Tauri IPC] Comando 'another_command' no disponible en este entorno."
        }
      );
    });

    test('delega a window.__TAURI__.core.invoke cuando está disponible', async () => {
      let calledCmd = null;
      let calledArgs = null;

      globalThis.window = {
        __TAURI__: {
          core: {
            invoke: async (cmd, args) => {
              calledCmd = cmd;
              calledArgs = args;
              return { success: true, count: 42 };
            }
          }
        }
      };

      const result = await invoke('calculate_quote', { tariffId: 'T1' });
      assert.strictEqual(calledCmd, 'calculate_quote');
      assert.deepStrictEqual(calledArgs, { tariffId: 'T1' });
      assert.deepStrictEqual(result, { success: true, count: 42 });
    });

    test('delega a window.__TAURI__.invoke cuando core no está presente (fallback)', async () => {
      let calledCmd = null;
      let calledArgs = null;

      globalThis.window = {
        __TAURI__: {
          invoke: async (cmd, args) => {
            calledCmd = cmd;
            calledArgs = args;
            return 'legacy-result';
          }
        }
      };

      const result = await invoke('legacy_ping');
      assert.strictEqual(calledCmd, 'legacy_ping');
      assert.deepStrictEqual(calledArgs, {});
      assert.strictEqual(result, 'legacy-result');
    });
  });

  describe('listen()', () => {
    test('devuelve una función no-op desuscriptora cuando window o __TAURI__ está ausente', async () => {
      delete globalThis.window;
      const unlisten = await listen('tauri://drag-drop', () => {});
      assert.strictEqual(typeof unlisten, 'function');
      assert.doesNotThrow(() => unlisten());
    });

    test('delega a window.__TAURI__.event.listen cuando está presente', async () => {
      let registeredEvent = null;
      let registeredHandler = null;
      let unlistenCalled = false;

      const mockUnlisten = () => {
        unlistenCalled = true;
      };

      const testHandler = () => {};

      globalThis.window = {
        __TAURI__: {
          event: {
            listen: async (event, handler) => {
              registeredEvent = event;
              registeredHandler = handler;
              return mockUnlisten;
            }
          }
        }
      };

      const unlisten = await listen('custom-event', testHandler);
      assert.strictEqual(registeredEvent, 'custom-event');
      assert.strictEqual(registeredHandler, testHandler);
      assert.strictEqual(typeof unlisten, 'function');

      unlisten();
      assert.strictEqual(unlistenCalled, true);
    });
  });
});

describe('Application Event Bus Module (src/js/events.js)', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  describe('APP_EVENTS catalog', () => {
    test('es un objeto congelado (Object.isFrozen)', () => {
      assert.strictEqual(Object.isFrozen(APP_EVENTS), true);
    });

    test('contiene todos los eventos de dominio esperados con sus nombres canónicos', () => {
      assert.deepStrictEqual(APP_EVENTS, {
        COMPARISON_SAVED: 'comparison-saved',
        CLIENTS_UPDATED: 'clients-updated',
        AGENTS_UPDATED: 'agents-updated',
        TARIFFS_UPDATED: 'tariffs-updated',
        SETTINGS_UPDATED: 'settings-updated'
      });
    });

    test('no permite mutación de valores ni adición de nuevas propiedades', () => {
      assert.throws(() => {
        APP_EVENTS.COMPARISON_SAVED = 'modified';
      }, TypeError);
      assert.throws(() => {
        APP_EVENTS.NEW_EVENT = 'new-event';
      }, TypeError);
    });
  });

  describe('emitAppEvent()', () => {
    test('emite un CustomEvent en window con el nombre y payload provistos', () => {
      let dispatchedEvent = null;
      globalThis.window = {
        dispatchEvent: (event) => {
          dispatchedEvent = event;
          return true;
        }
      };

      const payload = { comparisonId: 'comp-123', total: 45.67 };
      emitAppEvent(APP_EVENTS.COMPARISON_SAVED, payload);

      assert.ok(dispatchedEvent instanceof CustomEvent);
      assert.strictEqual(dispatchedEvent.type, 'comparison-saved');
      assert.deepStrictEqual(dispatchedEvent.detail, payload);
    });

    test('emite un CustomEvent con detail = null cuando no se pasa payload', () => {
      let dispatchedEvent = null;
      globalThis.window = {
        dispatchEvent: (event) => {
          dispatchedEvent = event;
          return true;
        }
      };

      emitAppEvent(APP_EVENTS.SETTINGS_UPDATED);

      assert.ok(dispatchedEvent instanceof CustomEvent);
      assert.strictEqual(dispatchedEvent.type, 'settings-updated');
      assert.strictEqual(dispatchedEvent.detail, null);
    });

    test('no lanza error si window es undefined', () => {
      delete globalThis.window;
      assert.doesNotThrow(() => {
        emitAppEvent(APP_EVENTS.CLIENTS_UPDATED, { count: 5 });
      });
    });

    test('no lanza error si window existe pero dispatchEvent no es una función', () => {
      globalThis.window = {};
      assert.doesNotThrow(() => {
        emitAppEvent(APP_EVENTS.AGENTS_UPDATED);
      });
    });
  });

  describe('onAppEvent()', () => {
    test('suscribe un handler en window y lo desuscribe al invocar la función devuelta', () => {
      let addedEvent = null;
      let addedHandler = null;
      let removedEvent = null;
      let removedHandler = null;

      globalThis.window = {
        addEventListener: (event, handler) => {
          addedEvent = event;
          addedHandler = handler;
        },
        removeEventListener: (event, handler) => {
          removedEvent = event;
          removedHandler = handler;
        }
      };

      const handler = (e) => {};
      const unsubscribe = onAppEvent(APP_EVENTS.TARIFFS_UPDATED, handler);

      assert.strictEqual(addedEvent, 'tariffs-updated');
      assert.strictEqual(addedHandler, handler);
      assert.strictEqual(typeof unsubscribe, 'function');

      unsubscribe();

      assert.strictEqual(removedEvent, 'tariffs-updated');
      assert.strictEqual(removedHandler, handler);
    });

    test('retorna función no-op sin lanzar error cuando window es undefined', () => {
      delete globalThis.window;
      let unsubscribe;
      assert.doesNotThrow(() => {
        unsubscribe = onAppEvent(APP_EVENTS.CLIENTS_UPDATED, () => {});
      });
      assert.strictEqual(typeof unsubscribe, 'function');
      assert.doesNotThrow(() => unsubscribe());
    });

    test('retorna función no-op sin lanzar error cuando addEventListener no está disponible', () => {
      globalThis.window = {};
      let unsubscribe;
      assert.doesNotThrow(() => {
        unsubscribe = onAppEvent(APP_EVENTS.CLIENTS_UPDATED, () => {});
      });
      assert.strictEqual(typeof unsubscribe, 'function');
      assert.doesNotThrow(() => unsubscribe());
    });

    test('flujo completo de broadcasting y desuscripción con EventTarget real', () => {
      const bus = new EventTarget();
      globalThis.window = bus;

      const received = [];
      const handler = (event) => {
        received.push(event.detail);
      };

      const unsubscribe = onAppEvent(APP_EVENTS.COMPARISON_SAVED, handler);

      emitAppEvent(APP_EVENTS.COMPARISON_SAVED, { id: 1 });
      emitAppEvent(APP_EVENTS.COMPARISON_SAVED, { id: 2 });
      assert.deepStrictEqual(received, [{ id: 1 }, { id: 2 }]);

      unsubscribe();

      emitAppEvent(APP_EVENTS.COMPARISON_SAVED, { id: 3 });
      assert.deepStrictEqual(received, [{ id: 1 }, { id: 2 }]);
    });
  });
});

describe('UI Notifications & Confirmation Module (src/js/ui.js)', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalConfirm = globalThis.confirm;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
    if (originalConfirm === undefined) {
      delete globalThis.confirm;
    } else {
      globalThis.confirm = originalConfirm;
    }
  });

  function createMockElement(tagName = 'div', idRegistry = null) {
    const classes = new Set();
    const listeners = {};
    const children = [];
    let innerTextVal = '';

    const el = {
      id: '',
      tagName: tagName.toUpperCase(),
      children,
      parentNode: null,
      get className() {
        return Array.from(classes).join(' ');
      },
      set className(val) {
        classes.clear();
        if (val) {
          val.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
        }
      },
      get innerText() {
        return innerTextVal;
      },
      set innerText(val) {
        innerTextVal = String(val);
      },
      classList: {
        add: (cls) => classes.add(cls),
        remove: (cls) => classes.delete(cls),
        contains: (cls) => classes.has(cls)
      },
      appendChild: (child) => {
        children.push(child);
        child.parentNode = el;
        return child;
      },
      remove: () => {
        if (el.parentNode && el.parentNode.children) {
          const idx = el.parentNode.children.indexOf(el);
          if (idx !== -1) {
            el.parentNode.children.splice(idx, 1);
          }
        }
      },
      addEventListener: (evt, cb) => {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(cb);
      },
      click: () => {
        const cbs = listeners['click'] || [];
        cbs.forEach((cb) => cb({ type: 'click', target: el }));
      },
      triggerAnimationEnd: () => {
        const cbs = listeners['animationend'] || [];
        cbs.forEach((cb) => cb({ type: 'animationend', target: el }));
      },
      cloneNode: () => {
        const clone = createMockElement(tagName, idRegistry);
        clone.id = el.id;
        clone.innerText = el.innerText;
        clone.className = el.className;
        return clone;
      },
      replaceWith: (newEl) => {
        el._replacedWith = newEl;
        if (el.id && idRegistry && idRegistry.has(el.id)) {
          idRegistry.set(el.id, newEl);
        }
        if (el.parentNode && el.parentNode.children) {
          const idx = el.parentNode.children.indexOf(el);
          if (idx !== -1) {
            el.parentNode.children[idx] = newEl;
            newEl.parentNode = el.parentNode;
          }
        }
      }
    };
    return el;
  }

  function setupModalDOM() {
    const elements = new Map();
    const overlay = createMockElement('div', elements);
    overlay.id = 'dialog-confirm';
    const titleEl = createMockElement('h3', elements);
    titleEl.id = 'dialog-confirm-title';
    const msgEl = createMockElement('p', elements);
    msgEl.id = 'dialog-confirm-message';
    const btnCancel = createMockElement('button', elements);
    btnCancel.id = 'dialog-confirm-cancel';
    const btnAccept = createMockElement('button', elements);
    btnAccept.id = 'dialog-confirm-accept';

    const dialogBox = createMockElement('div', elements);
    dialogBox.appendChild(titleEl);
    dialogBox.appendChild(msgEl);
    dialogBox.appendChild(btnCancel);
    dialogBox.appendChild(btnAccept);
    overlay.appendChild(dialogBox);

    elements.set('dialog-confirm', overlay);
    elements.set('dialog-confirm-title', titleEl);
    elements.set('dialog-confirm-message', msgEl);
    elements.set('dialog-confirm-cancel', btnCancel);
    elements.set('dialog-confirm-accept', btnAccept);

    globalThis.document = {
      getElementById: (id) => elements.get(id) || null,
      createElement: (tag) => createMockElement(tag, elements)
    };

    return { overlay, titleEl, msgEl, btnCancel, btnAccept, elements };
  }

  describe('Exportaciones y puente de compatibilidad global (window)', () => {
    test('exporta las funciones canónicas showToast, showActionToast y showConfirm', () => {
      assert.strictEqual(typeof showToast, 'function');
      assert.strictEqual(typeof showActionToast, 'function');
      assert.strictEqual(typeof showConfirm, 'function');
    });

    test('asigna showToast, showActionToast y showConfirm en window al evaluar el módulo', async () => {
      globalThis.window = {};
      await import(`../src/js/ui.js?bridgeTest=${Date.now()}`);
      assert.strictEqual(typeof globalThis.window.showToast, 'function');
      assert.strictEqual(typeof globalThis.window.showActionToast, 'function');
      assert.strictEqual(typeof globalThis.window.showConfirm, 'function');
    });
  });

  describe('showToast()', () => {
    test('no produce excepciones en entorno headless cuando document es undefined', () => {
      delete globalThis.document;
      assert.doesNotThrow(() => {
        showToast('Notificación sin DOM', 'info');
      });
    });

    test('no produce excepciones si document existe pero #toast-container no está presente', () => {
      globalThis.document = {
        getElementById: () => null,
        createElement: (tag) => createMockElement(tag)
      };
      assert.doesNotThrow(() => {
        showToast('Notificación sin contenedor', 'warning');
      });
    });

    test('crea el elemento toast en el contenedor con el tipo por defecto (success) y texto', () => {
      const toastContainer = createMockElement('div');
      globalThis.document = {
        getElementById: (id) => (id === 'toast-container' ? toastContainer : null),
        createElement: (tag) => createMockElement(tag)
      };

      showToast('Operación exitosa');
      assert.strictEqual(toastContainer.children.length, 1);
      const toast = toastContainer.children[0];
      assert.strictEqual(toast.className, 'm3-toast success');
      assert.strictEqual(toast.innerText, 'Operación exitosa');
    });

    test('soporta tipos de toast explícitos: error, warning, info', () => {
      const toastContainer = createMockElement('div');
      globalThis.document = {
        getElementById: (id) => (id === 'toast-container' ? toastContainer : null),
        createElement: (tag) => createMockElement(tag)
      };

      showToast('Fallo grave', 'error');
      showToast('Aviso importante', 'warning');
      showToast('Información', 'info');

      assert.strictEqual(toastContainer.children.length, 3);
      assert.strictEqual(toastContainer.children[0].className, 'm3-toast error');
      assert.strictEqual(toastContainer.children[1].className, 'm3-toast warning');
      assert.strictEqual(toastContainer.children[2].className, 'm3-toast info');
    });

    test('programa auto-fadeout a los 4000ms y auto-elimina en animationend', (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });

      const toastContainer = createMockElement('div');
      globalThis.document = {
        getElementById: (id) => (id === 'toast-container' ? toastContainer : null),
        createElement: (tag) => createMockElement(tag)
      };

      showToast('Auto remover', 'info');
      assert.strictEqual(toastContainer.children.length, 1);
      const toast = toastContainer.children[0];
      assert.strictEqual(toast.classList.contains('m3-toast-fadeout'), false);

      t.mock.timers.tick(4000);
      assert.strictEqual(toast.classList.contains('m3-toast-fadeout'), true);

      toast.triggerAnimationEnd();
      assert.strictEqual(toastContainer.children.length, 0);
    });
  });

  describe('showActionToast()', () => {
    test('no produce excepciones en entorno headless cuando document es undefined', () => {
      delete globalThis.document;
      assert.doesNotThrow(() => {
        showActionToast('Mensaje de acción', [{ text: 'OK', callback: () => {} }]);
      });
    });

    test('no produce excepciones si document existe pero #toast-container no está presente', () => {
      globalThis.document = {
        getElementById: () => null,
        createElement: (tag) => createMockElement(tag)
      };
      assert.doesNotThrow(() => {
        showActionToast('Mensaje de acción', []);
      });
    });

    test('crea toast con texto descriptivo y botones de acción en el DOM', () => {
      const toastContainer = createMockElement('div');
      globalThis.document = {
        getElementById: (id) => (id === 'toast-container' ? toastContainer : null),
        createElement: (tag) => createMockElement(tag)
      };

      showActionToast('Elemento borrado', [
        { text: 'Deshacer', class: 'btn-undo', callback: () => {} },
        { text: 'Cerrar', callback: () => {} }
      ]);

      assert.strictEqual(toastContainer.children.length, 1);
      const toast = toastContainer.children[0];
      assert.strictEqual(toast.className, 'm3-toast action-toast');

      const textSpan = toast.children[0];
      assert.strictEqual(textSpan.className, 'toast-text');
      assert.strictEqual(textSpan.innerText, 'Elemento borrado');

      const actionsDiv = toast.children[1];
      assert.strictEqual(actionsDiv.className, 'toast-actions');
      assert.strictEqual(actionsDiv.children.length, 2);
      assert.strictEqual(actionsDiv.children[0].innerText, 'Deshacer');
      assert.strictEqual(actionsDiv.children[0].className, 'btn-undo');
      assert.strictEqual(actionsDiv.children[1].innerText, 'Cerrar');
      assert.strictEqual(actionsDiv.children[1].className, '');
    });

    test('ejecuta el callback de acción al hacer clic y aplica clase de fadeout para auto-eliminación', () => {
      const toastContainer = createMockElement('div');
      globalThis.document = {
        getElementById: (id) => (id === 'toast-container' ? toastContainer : null),
        createElement: (tag) => createMockElement(tag)
      };

      let actionExecuted = false;
      showActionToast('Actualización disponible', [
        {
          text: 'Instalar ahora',
          callback: () => {
            actionExecuted = true;
          }
        }
      ]);

      const toast = toastContainer.children[0];
      const button = toast.children[1].children[0];

      assert.strictEqual(actionExecuted, false);
      button.click();
      assert.strictEqual(actionExecuted, true);
      assert.strictEqual(toast.classList.contains('m3-toast-fadeout'), true);

      toast.triggerAnimationEnd();
      assert.strictEqual(toastContainer.children.length, 0);
    });
  });

  describe('showConfirm()', () => {
    test('en entorno headless sin document y sin confirm() global, resuelve a true', async () => {
      delete globalThis.document;
      delete globalThis.confirm;

      const result = await showConfirm('¿Continuar sin confirm ni DOM?');
      assert.strictEqual(result, true);
    });

    test('en entorno headless sin document pero con confirm() global disponible, delega en confirm()', async () => {
      delete globalThis.document;
      let requestedMsg = null;
      globalThis.confirm = (msg) => {
        requestedMsg = msg;
        return false;
      };

      const resultFalse = await showConfirm('¿Confirmar acción crítica?');
      assert.strictEqual(requestedMsg, '¿Confirmar acción crítica?');
      assert.strictEqual(resultFalse, false);

      globalThis.confirm = () => true;
      const resultTrue = await showConfirm('¿Confirmar?');
      assert.strictEqual(resultTrue, true);
    });

    test('recurre a confirm() si los elementos del diálogo modal están incompletos en el DOM', async () => {
      const elements = new Map();
      elements.set('dialog-confirm', createMockElement('div'));
      // Faltan el resto de elementos requeridos (title, message, buttons)
      globalThis.document = {
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => createMockElement(tag)
      };

      let confirmCalled = false;
      globalThis.confirm = () => {
        confirmCalled = true;
        return true;
      };

      const result = await showConfirm('¿Proceder con DOM incompleto?');
      assert.strictEqual(confirmCalled, true);
      assert.strictEqual(result, true);
    });

    test('en entorno modal DOM completo: inyecta título y mensaje, y activa overlay', async () => {
      const { overlay, titleEl, msgEl, btnAccept } = setupModalDOM();

      const promise = showConfirm('¿Desea restablecer los valores?', 'Restablecer fábrica');

      assert.strictEqual(titleEl.innerText, 'Restablecer fábrica');
      assert.strictEqual(msgEl.innerText, '¿Desea restablecer los valores?');
      assert.strictEqual(overlay.classList.contains('active'), true);

      // Limpiamos la promesa aceptando
      btnAccept._replacedWith.click();
      const result = await promise;
      assert.strictEqual(result, true);
    });

    test('al hacer clic en aceptar, remueve la clase active y resuelve la promesa a true', async () => {
      const { overlay, btnAccept } = setupModalDOM();

      const promise = showConfirm('¿Guardar cambios?');
      assert.strictEqual(overlay.classList.contains('active'), true);

      btnAccept._replacedWith.click();
      const result = await promise;

      assert.strictEqual(result, true);
      assert.strictEqual(overlay.classList.contains('active'), false);
    });

    test('al hacer clic en cancelar, remueve la clase active y resuelve la promesa a false', async () => {
      const { overlay, btnCancel } = setupModalDOM();

      const promise = showConfirm('¿Descartar cambios?');
      assert.strictEqual(overlay.classList.contains('active'), true);

      btnCancel._replacedWith.click();
      const result = await promise;

      assert.strictEqual(result, false);
      assert.strictEqual(overlay.classList.contains('active'), false);
    });

    test('reemplaza los botones con clones (replaceWith) para prevenir acumulación de listeners', async () => {
      const { btnCancel, btnAccept } = setupModalDOM();

      const origCancel = btnCancel;
      const origAccept = btnAccept;

      const p1 = showConfirm('Pregunta 1');
      const clone1Accept = origAccept._replacedWith;
      assert.notStrictEqual(clone1Accept, origAccept);
      clone1Accept.click();
      await p1;

      const p2 = showConfirm('Pregunta 2');
      const clone2Accept = clone1Accept._replacedWith;
      assert.notStrictEqual(clone2Accept, clone1Accept);
      clone2Accept.click();
      await p2;
    });
  });

  describe('Tipografía y salto de línea en notificaciones y alertas', () => {
    test('.m3-toast no divide palabras a la mitad (word-break: normal y overflow-wrap: break-word)', () => {
      const cssPath = path.resolve('src/styles/components.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const toastMatch = css.match(/\.m3-toast\s*\{([^}]+)\}/);
      assert.ok(toastMatch, 'Debe existir la regla .m3-toast');
      const toastRules = toastMatch[1];

      assert.ok(!toastRules.includes('word-break: break-all'), '.m3-toast NO debe contener word-break: break-all');
      assert.ok(toastRules.includes('word-break: normal'), '.m3-toast debe especificar word-break: normal');
      assert.ok(toastRules.includes('overflow-wrap: break-word'), '.m3-toast debe especificar overflow-wrap: break-word');
      assert.ok(toastRules.includes('hyphens: none'), '.m3-toast debe especificar hyphens: none');
      // Verificación de sintaxis válida de 4 argumentos para la función de temporización cubic-bezier
      assert.ok(toastRules.includes('cubic-bezier(0.2, 0, 0, 1)'), '.m3-toast debe tener una curva bezier válida de 4 argumentos para animarse correctamente');
    });

    test('#toast-container dispone de ancho responsivo y z-index tipificado mediante tokens', () => {
      const cssPath = path.resolve('src/styles/components.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const containerMatch = css.match(/#toast-container\s*\{([^}]+)\}/);
      assert.ok(containerMatch, 'Debe existir la regla #toast-container');
      const containerRules = containerMatch[1];

      assert.ok(containerRules.includes('max-width: min(540px, calc(100vw - 32px))'), '#toast-container debe tener un max-width flexible y amplio');
      assert.ok(containerRules.includes('z-index: var(--z-toast);'), '#toast-container debe utilizar var(--z-toast)');
    });

    test('el sistema de capas z-index está normalizado con variables y sin números inflados ni !important', () => {
      const mainCss = fs.readFileSync(path.resolve('src/styles/main.css'), 'utf8');
      const compCss = fs.readFileSync(path.resolve('src/styles/components.css'), 'utf8');
      const html = fs.readFileSync(path.resolve('src/index.html'), 'utf8');

      // 1. Verificar tokens en :root de main.css
      const tokens = {
        sticky: parseInt(mainCss.match(/--z-sticky:\s*(\d+)/)?.[1], 10),
        dropdown: parseInt(mainCss.match(/--z-dropdown:\s*(\d+)/)?.[1], 10),
        modal: parseInt(mainCss.match(/--z-modal:\s*(\d+)/)?.[1], 10),
        modalPriority: parseInt(mainCss.match(/--z-modal-priority:\s*(\d+)/)?.[1], 10),
        auth: parseInt(mainCss.match(/--z-auth:\s*(\d+)/)?.[1], 10),
        toast: parseInt(mainCss.match(/--z-toast:\s*(\d+)/)?.[1], 10),
      };

      assert.ok(tokens.toast > tokens.auth, 'Toast debe estar por encima de Auth');
      assert.ok(tokens.auth > tokens.modalPriority, 'Auth debe estar por encima de Modal Priority');
      assert.ok(tokens.modalPriority > tokens.modal, 'Modal Priority debe estar por encima de Modal estándar');
      assert.ok(tokens.modal > tokens.dropdown, 'Modal debe estar por encima de Dropdown');
      assert.ok(tokens.dropdown > tokens.sticky, 'Dropdown debe estar por encima de Sticky');

      // 2. Ningún z-index debe llevar !important
      assert.ok(!compCss.match(/z-index:[^;]+!important/i), 'components.css no debe contener !important en z-index');
      assert.ok(!mainCss.match(/z-index:[^;]+!important/i), 'main.css no debe contener !important en z-index');
      assert.ok(!html.match(/z-index:[^;"]+!important/i), 'index.html no debe contener !important en z-index');

      // 3. Ningún z-index numérico debe ser superior a 9999
      const allZIndexNumbers = [
        ...(compCss.match(/z-index:\s*(\d+)/g) || []),
        ...(mainCss.match(/z-index:\s*(\d+)/g) || []),
        ...(html.match(/z-index:\s*(\d+)/g) || [])
      ].map(str => parseInt(str.replace(/\D/g, ''), 10));

      for (const num of allZIndexNumbers) {
        assert.ok(num <= 1100, `Ningún z-index numérico debe superar 1100 (encontrado: ${num})`);
      }
    });

    test('.m3-toast.warning define color de acento amber/amarillo', () => {
      const cssPath = path.resolve('src/styles/components.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const warningMatch = css.match(/\.m3-toast\.warning\s*\{([^}]+)\}/);
      assert.ok(warningMatch, 'Debe existir la regla .m3-toast.warning');
      assert.ok(warningMatch[1].includes('border-left-color: var(--color-warning, #f59e0b)'), 'Debe definir el color de advertencia');
    });

    test('.auth-alert no divide palabras a la mitad con overflow-wrap agresivo', () => {
      const cssPath = path.resolve('src/styles/components.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const alertMatch = css.match(/\.auth-alert\s*\{([^}]+)\}/);
      assert.ok(alertMatch, 'Debe existir la regla .auth-alert');
      const alertRules = alertMatch[1];

      assert.ok(!alertRules.includes('overflow-wrap: anywhere'), '.auth-alert NO debe tener overflow-wrap: anywhere');
      assert.ok(alertRules.includes('word-break: normal'), '.auth-alert debe especificar word-break: normal');
      assert.ok(alertRules.includes('overflow-wrap: break-word'), '.auth-alert debe especificar overflow-wrap: break-word');
      assert.ok(alertRules.includes('hyphens: none'), '.auth-alert debe especificar hyphens: none');
    });
  });
});


