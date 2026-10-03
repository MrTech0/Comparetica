import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { updateComparativaEstado, updateComparativaContrato } from '../src/js/db.js';

const start = Date.parse('2026-10-03T12:00:00.000Z');

function setup(t, state = 'Pendiente de aceptación', changedAt = null) {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const originalWindow = globalThis.window;
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE comparativas (id INTEGER PRIMARY KEY, estado TEXT, estado_cambiado_en TEXT,
    estado_contrato TEXT, motivo_rechazo_scoring TEXT, estado_cobro TEXT DEFAULT 'Pendiente', fecha_cobro TEXT);`);
  sql.prepare('INSERT INTO comparativas (id, estado, estado_cambiado_en, estado_contrato, motivo_rechazo_scoring) VALUES (1, ?, ?, ?, ?)')
    .run(state, changedAt, 'Pendiente', '');
  globalThis.window = { __TAURI__: { core: { invoke: async (command, { query, params }) => {
    assert.equal(command, 'db_execute');
    // Rust enlaza por posición, en el orden de aparición de los parámetros de SQLite.
    const parameterNames = [...new Set(query.match(/\$\d+/g))];
    const bindings = Object.fromEntries(parameterNames.map((name, index) => [name, params[index]]));
    const result = sql.prepare(query).run(bindings);
    return { rowsAffected: result.changes, lastInsertId: result.lastInsertRowid };
  } } } };
  t.after(() => {
    sql.close();
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  });
  return { record: () => sql.prepare('SELECT * FROM comparativas WHERE id = 1').get() };
}

for (const state of ['Aceptada', 'Rechazada']) {
  test(`persistence allows editing ${state} at 4999 ms and resets the grace period`, async t => {
    const f = setup(t);
    await updateComparativaEstado(1, state);
    t.mock.timers.tick(4999);
    const next = state === 'Aceptada' ? 'Rechazada' : 'Aceptada';
    await updateComparativaEstado(1, next);
    assert.equal(f.record().estado, next);
    assert.equal(f.record().estado_cambiado_en, new Date(start + 4999).toISOString());
  });
  test(`persistence rejects changes to ${state} at 5000 ms, retaining its state and timestamp`, async t => {
    const f = setup(t);
    await updateComparativaEstado(1, state);
    const original = f.record();
    t.mock.timers.tick(5000);
    await assert.rejects(() => updateComparativaEstado(1, 'Pendiente de aceptación'));
    assert.deepEqual(f.record(), original);
  });
  for (const contract of ['En trámite', 'Firmado y Activado', 'Rechazado por Scoring']) {
    test(`persistence immediately retains ${state} when the contract becomes ${contract}`, async t => {
      const f = setup(t);
      await updateComparativaEstado(1, state);
      await updateComparativaContrato(1, contract, 'Motivo');
      const original = f.record();
      await assert.rejects(() => updateComparativaEstado(1, 'Pendiente de aceptación'));
      assert.deepEqual(f.record(), original);
    });
  }
}

test('returning to pending acceptance within the grace period clears the timestamp and permits later acceptance', async t => {
  const f = setup(t);
  await updateComparativaEstado(1, 'Aceptada');
  t.mock.timers.tick(4000);
  await updateComparativaEstado(1, 'Pendiente de aceptación');
  assert.equal(f.record().estado_cambiado_en, null);
  t.mock.timers.tick(10000);
  await updateComparativaEstado(1, 'Aceptada');
  assert.equal(f.record().estado, 'Aceptada');
});

for (const timestamp of [null, 'fecha inválida']) {
  test(`an accepted legacy record with timestamp ${timestamp} stays locked`, async t => {
    const f = setup(t, 'Aceptada', timestamp);
    await assert.rejects(() => updateComparativaEstado(1, 'Rechazada'));
    assert.equal(f.record().estado, 'Aceptada');
  });
}
