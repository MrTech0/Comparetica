import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { invoke, listen } from '../src/js/ipc.js';

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
