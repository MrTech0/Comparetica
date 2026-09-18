import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { invoke, listen } from '../src/js/ipc.js';
import { APP_EVENTS, emitAppEvent, onAppEvent } from '../src/js/events.js';

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

