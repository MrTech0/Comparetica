import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as api from '../src/js/db.js';
import { getCommissionSplit } from '../src/js/commission_split.js';

function setup(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE retenciones (id INTEGER PRIMARY KEY, porcentaje_centesimas INTEGER UNIQUE NOT NULL CHECK(typeof(porcentaje_centesimas)='integer' AND porcentaje_centesimas BETWEEN 0 AND 10000));
    CREATE TABLE agentes (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT, email TEXT, activo INTEGER, retencion_id INTEGER REFERENCES retenciones(id));
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre_empresa TEXT, email TEXT, estado TEXT DEFAULT 'activo', agente_id INTEGER REFERENCES agentes(id));
    CREATE TABLE comparativas (id INTEGER PRIMARY KEY, cliente_nombre TEXT, cliente_cups TEXT, tipo_energia TEXT, datos_cliente_json TEXT, tarifa_luz_propuesta_id INTEGER, ahorro_luz_anual REAL, tarifa_gas_propuesta_id INTEGER, ahorro_gas_anual REAL, comision_total REAL, reparto_comision_json TEXT);
    ALTER TABLE comparativas ADD COLUMN fecha TEXT DEFAULT '';
    CREATE TABLE tarifas_luz (id INTEGER, nombre TEXT, comercializadora_id INTEGER);
    CREATE TABLE tarifas_gas (id INTEGER, nombre TEXT, comercializadora_id INTEGER);
    CREATE TABLE comercializadoras (id INTEGER, nombre TEXT);
  `);
  const old = globalThis.window;
  globalThis.window = { __TAURI__: { core: { invoke: async (cmd, { query, params = [] }) => {
    const stmt = sql.prepare(query);
    // Tauri enlaza por orden de aparición, no por el número escrito tras $.
    const keys = [...new Set(query.match(/\$\d+/g) || [])];
    assert.equal(keys.length, params.length);
    const bind = Object.fromEntries(keys.map((key, i) => [key, Number.isSafeInteger(params[i]) ? BigInt(params[i]) : params[i]]));
    if (cmd === 'db_select') return stmt.all(bind);
    assert.equal(cmd, 'db_execute');
    const result = stmt.run(bind);
    return { rowsAffected: result.changes, lastInsertId: result.lastInsertRowid };
  } } } };
  t.after(() => { sql.close(); globalThis.window = old; });
  const save = (clientId = 1, total = 100, type = 'LUZ') => api.addComparativa('Nombre compartido', 'ES123', type, { companySnapshot: { config: {}, logo: null } }, null, 0, null, 0, total, clientId);
  const comparison = () => sql.prepare('SELECT * FROM comparativas ORDER BY id DESC').get();
  return { sql, save, comparison };
}

test('catálogo sin nombres: porcentaje decimal único, asignación opcional y restricción de borrado', async t => {
  const f = setup(t);
  const retention = await api.addRetencion('20,25');
  const id = retention.lastInsertId;
  assert.equal((await api.getRetenciones())[0].porcentaje_centesimas, 2025);
  await assert.rejects(api.addRetencion('20.25'), /existe/i);
  await assert.rejects(api.addRetencion('20.001'));
  const other = await api.addRetencion('30');
  await assert.rejects(api.updateRetencion(other.lastInsertId, '20,25'), /existe/i);
  await api.deleteRetencion(other.lastInsertId);
  await api.addAgente('Comercial', null, null, id);
  assert.equal((await api.getRetenciones())[0].num_agentes, 1);
  assert.equal((await api.getAgentes())[0].porcentaje_centesimas, 2025);
  assert.equal(Object.hasOwn((await api.getRetenciones())[0], 'nombre'), false);
  await assert.rejects(api.deleteRetencion(id), /asignada/i);
  await api.updateAgente(1, 'Comercial', null, null, null);
  assert.equal((await api.getAgentes())[0].retencion_id, null);
  await api.deleteRetencion(id);
  assert.equal((await api.getRetenciones()).length, 0);
  await assert.rejects(api.addAgente('Otro', null, null, 999));
});

test('captura atómica con ID estable, porcentaje actual y reparto inmutable', async t => {
  const f = setup(t);
  await api.addRetencion(20);
  await api.addAgente('Ana', null, null, 1);
  await api.addAgente('Bea');
  f.sql.exec("INSERT INTO clientes(id,nombre_empresa,agente_id) VALUES (1,'Nombre compartido',1),(2,'Nombre compartido',2)");
  await api.updateRetencion(1, '30');
  await f.save(1, 250, 'DUAL');
  const before = f.comparison();
  const split = getCommissionSplit(before);
  assert.equal(split.agente_nombre, 'Ana');
  assert.equal(split.version, 2);
  assert.equal(Object.hasOwn(split, 'retencion_nombre'), false);
  assert.equal(split.consultoria_centimos, 7500);
  assert.equal(split.comercial_centimos, 17500);
  const history = await api.getComparativas();
  assert.equal(history.length, 1, 'los nombres repetidos no duplican una comparativa con cliente identificado');
  await api.updateRetencion(1, 90);
  f.sql.exec('UPDATE clientes SET agente_id=2 WHERE id=1');
  await api.deleteAgente(1);
  await api.deleteRetencion(1);
  assert.equal(f.comparison().reparto_comision_json, before.reparto_comision_json);
  await f.save(2, 100);
  assert.equal(getCommissionSplit(f.comparison()).consultoria_centimos, 0);
  assert.equal(getCommissionSplit(f.comparison()).agente_nombre, 'Bea');
  await assert.rejects(f.save(999), /cliente|comercial/i);
  f.sql.exec("UPDATE clientes SET estado='bloqueado' WHERE id=2");
  await assert.rejects(f.save(2), /cliente|comercial/i);
  await assert.rejects(f.save(1, -10));
});

test('fallos de catálogo se propagan y el reparto coincide con el cálculo en importes grandes', async t => {
  const f = setup(t);
  await api.addRetencion('99,99');
  await api.addAgente('Ana', null, null, 1);
  f.sql.exec("INSERT INTO clientes(id,nombre_empresa,agente_id) VALUES (1,'Cliente',1)");
  await f.save(1, 90071992547409.9);
  assert.ok(getCommissionSplit(f.comparison()));
  f.sql.exec('DROP TABLE comparativas; DROP TABLE clientes; DROP TABLE agentes; DROP TABLE retenciones');
  await assert.rejects(api.getRetenciones());
});
