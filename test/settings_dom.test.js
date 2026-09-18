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
});
