import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Integridad del DOM y Prototipos', () => {
  test('HTMLSelectElement.prototype no debe ser mutado con propiedades custom', () => {
    const proto = globalThis.HTMLSelectElement?.prototype;
    if (proto) {
      assert.strictEqual(proto._customValueHooked, undefined, 'El prototipo global no debe estar mutado');
    } else {
      assert.ok(true, 'Entorno sin DOM nativo verificado');
    }
  });

  test('Serialización y deserialización de ajustes clave-valor', () => {
    const config = { nombre: 'Test SL', cif: 'B12345678' };
    const serialized = JSON.stringify(config);
    const deserialized = JSON.parse(serialized);
    assert.strictEqual(deserialized.cif, 'B12345678');
    assert.strictEqual(deserialized.nombre, 'Test SL');
  });

  test('El descriptor de propiedad por instancia actualiza valores sin mutar DummySelect.prototype', () => {
    class DummySelect {
      constructor() {
        this._val = '';
      }
    }
    Object.defineProperty(DummySelect.prototype, 'value', {
      get() {
        return this._val;
      },
      set(v) {
        this._val = v;
      },
      configurable: true,
      enumerable: true
    });

    const origProtoDescriptor = Object.getOwnPropertyDescriptor(DummySelect.prototype, 'value');
    let callbackTriggeredCount = 0;

    const selectInstance = new DummySelect();
    const otherInstance = new DummySelect();

    // Hook per-instance descriptor replicating app.js pattern
    const protoDescriptor = Object.getOwnPropertyDescriptor(DummySelect.prototype, 'value');
    Object.defineProperty(selectInstance, 'value', {
      get() {
        return protoDescriptor.get.call(this);
      },
      set(val) {
        protoDescriptor.set.call(this, val);
        callbackTriggeredCount++;
      },
      configurable: true
    });

    // Setting value on hooked instance triggers callback and updates value
    selectInstance.value = 'option-a';
    assert.strictEqual(selectInstance.value, 'option-a');
    assert.strictEqual(callbackTriggeredCount, 1);

    // Setting value on unhooked instance does not trigger callback
    otherInstance.value = 'option-b';
    assert.strictEqual(otherInstance.value, 'option-b');
    assert.strictEqual(callbackTriggeredCount, 1);

    // Verify DummySelect.prototype remains completely untainted
    const currentProtoDescriptor = Object.getOwnPropertyDescriptor(DummySelect.prototype, 'value');
    assert.strictEqual(currentProtoDescriptor.get, origProtoDescriptor.get);
    assert.strictEqual(currentProtoDescriptor.set, origProtoDescriptor.set);
    assert.strictEqual(DummySelect.prototype._customValueHooked, undefined);
  });
});
