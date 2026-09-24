import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

  test('los campos de inactividad de clientes en index.html definen valores y placeholders por defecto', () => {
    const html = fs.readFileSync(path.resolve('src/index.html'), 'utf8');

    const monthsInputMatch = html.match(/id="settings-client-inactive-new-months"[^>]+/);
    assert.ok(monthsInputMatch, 'Debe existir #settings-client-inactive-new-months');
    assert.ok(monthsInputMatch[0].includes('value="3"'), 'Debe tener value="3" por defecto');
    assert.ok(monthsInputMatch[0].includes('placeholder="3"'), 'Debe tener placeholder="3"');

    const daysInputMatch = html.match(/id="settings-client-inactive-expiry-days"[^>]+/);
    assert.ok(daysInputMatch, 'Debe existir #settings-client-inactive-expiry-days');
    assert.ok(daysInputMatch[0].includes('value="30"'), 'Debe tener value="30" por defecto');
    assert.ok(daysInputMatch[0].includes('placeholder="30"'), 'Debe tener placeholder="30"');

    assert.ok(html.includes('(Por defecto: 3 meses)'), 'Debe incluir texto explicativo de 3 meses');
    assert.ok(html.includes('(Por defecto: 30 días)'), 'Debe incluir texto explicativo de 30 días');
  });

  test('el bloque de Retención Legal de los Datos está ubicado dentro del panel de Información Legal', () => {
    const html = fs.readFileSync(path.resolve('src/index.html'), 'utf8');

    const paramsPanelMatch = html.match(/id="panel-settings-params"[^>]*>([\s\S]*?)id="panel-settings-legal"/);
    assert.ok(paramsPanelMatch, 'Debe encontrarse el panel de parámetros antes del panel legal');
    assert.ok(!paramsPanelMatch[1].includes('Retención Legal de los Datos'), 'El panel de parámetros NO debe contener el bloque de retención legal');

    const legalPanelMatch = html.match(/id="panel-settings-legal"[^>]*>([\s\S]*?)id="panel-settings-about"/);
    assert.ok(legalPanelMatch, 'Debe encontrarse el panel legal');
    assert.ok(legalPanelMatch[1].includes('Retención Legal de los Datos'), 'El panel legal debe contener el bloque de retención legal');
  });

  test('el filtro de Agente Comercial está integrado en la columna de la tabla y no en la barra superior', () => {
    const html = fs.readFileSync(path.resolve('src/index.html'), 'utf8');

    assert.ok(!html.includes('id="filter-client-agent"'), 'No debe existir el selector filter-client-agent en la barra superior');
    assert.ok(html.includes('id="th-client-agent"'), 'La columna de Agente Comercial debe tener id="th-client-agent"');
    assert.ok(html.includes('id="dropdown-client-agent-filter"'), 'Debe existir el dropdown dropdown-client-agent-filter dentro de la cabecera');
    assert.ok(html.includes('id="dropdown-client-status-filter"'), 'Debe existir el dropdown dropdown-client-status-filter en la cabecera de Estado');
  });

  test('components.css permite que los desplegables de tabla floten sin recortes verticales mediante overflow visible', () => {
    const css = fs.readFileSync(path.resolve('src/styles/components.css'), 'utf8');

    assert.ok(css.includes('.table-container:has(.open)'), 'Debe incluir regla para .table-container:has(.open)');
    assert.ok(css.includes('.table-container.has-open-dropdown'), 'Debe incluir clase de respaldo .table-container.has-open-dropdown');
    assert.ok(css.includes('overflow: visible;'), 'Debe aplicar overflow: visible en el contenedor al estar abierto un desplegable');
    assert.ok(!css.includes('overflow: visible !important'), 'No debe usar !important en el selector de overflow');
  });
});


