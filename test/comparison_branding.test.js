import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  addComparativa, getComparativas, saveCompanyConfig, saveCompanyLogo, deleteCompanyLogo
} from '../src/js/db.js';

const logoA = 'data:image/png;base64,bG9nbyBB';
const logoB = 'data:image/png;base64,bG9nbyBC';
const originalConfig = { consultora_nombre: 'Consultora original', consultora_email: 'original@example.invalid' };

function setup(t, logo = logoA) {
  const original = { window: globalThis.window, localStorage: globalThis.localStorage };
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE ajustes (clave TEXT PRIMARY KEY, valor TEXT, actualizado_en TEXT);
    CREATE TABLE comparativas (id INTEGER PRIMARY KEY, cliente_nombre TEXT, cliente_cups TEXT,
      tipo_energia TEXT, datos_cliente_json TEXT, tarifa_luz_propuesta_id INTEGER, ahorro_luz_anual REAL,
      tarifa_gas_propuesta_id INTEGER, ahorro_gas_anual REAL, comision_total REAL, fecha TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE tarifas_luz (id INTEGER, nombre TEXT, comercializadora_id INTEGER);
    CREATE TABLE tarifas_gas (id INTEGER, nombre TEXT, comercializadora_id INTEGER);
    CREATE TABLE comercializadoras (id INTEGER, nombre TEXT);
    CREATE TABLE clientes (nombre_empresa TEXT, email TEXT);
  `);
  const local = new Map();
  let failPreserving = false;
  let nativeLogo = logo;
  sql.prepare('INSERT INTO ajustes VALUES (?, ?, NULL)').run('company_config', JSON.stringify(originalConfig));
  if (logo) sql.prepare('INSERT INTO ajustes VALUES (?, ?, NULL)').run('company_logo', logo);
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
  globalThis.window = { __TAURI__: { core: { invoke: async (command, { query, params = [], base64Data } = {}) => {
    if (command === 'get_company_logo') return nativeLogo;
    if (command === 'delete_company_logo') { nativeLogo = null; return; }
    if (command === 'save_company_logo') { nativeLogo = base64Data; return; }
    if (command === 'save_company_config') return;
    assert.ok(['db_select', 'db_execute'].includes(command), `unexpected command: ${command}`);
    if (failPreserving && /UPDATE comparativas/.test(query)) throw new Error('No se puede conservar el historial');
    const statement = sql.prepare(query);
    const bindings = Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]));
    return command === 'db_select' ? statement.all(bindings) : statement.run(bindings);
  } } } };
  t.after(() => {
    sql.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  const data = id => JSON.parse(sql.prepare('SELECT datos_cliente_json FROM comparativas WHERE id = ?').get(id).datos_cliente_json);
  const legacy = (id, input = { currentGasCost: 600, proposedTariffSnapshot: { nombre: 'Tarifa original' } }) => {
    sql.prepare('INSERT INTO comparativas (id, cliente_nombre, tipo_energia, datos_cliente_json) VALUES (?, ?, ?, ?)')
      .run(id, 'Cliente de prueba', 'GAS', JSON.stringify(input));
  };
  const add = (input = {}) => addComparativa('Cliente de prueba', 'ES0031000000000001AB', 'GAS', input, null, 0, 10, 100, 20);
  return { sql, data, legacy, add, failPreserving: () => { failPreserving = true; } };
}

for (const logo of [logoA, null]) {
  test(`a saved comparison keeps its ${logo ? 'custom' : 'default'} branding after settings change`, async t => {
    const f = setup(t, logo);
    await f.add({ currentGasCost: 600 });
    await saveCompanyConfig({ consultora_nombre: 'Consultora nueva' });
    await saveCompanyLogo(logoB);
    await deleteCompanyLogo();
    assert.deepEqual(f.data(1).companySnapshot, { config: originalConfig, logo });
    assert.equal(f.data(1).currentGasCost, 600);
  });
}

test('saving an already calculated comparison retains the captured branding', async t => {
  const f = setup(t, logoB);
  const companySnapshot = { config: { consultora_nombre: 'Consultora al calcular' }, logo: logoA };
  await f.add({ companySnapshot });
  assert.deepEqual(f.data(1).companySnapshot, companySnapshot);
});

test('loading legacy history freezes its available branding once and preserves the calculations', async t => {
  const f = setup(t);
  f.legacy(1);
  const rows = await getComparativas();
  assert.deepEqual(JSON.parse(rows[0].datos_cliente_json).companySnapshot, { config: originalConfig, logo: logoA });
  await saveCompanyLogo(logoB);
  await saveCompanyConfig({ consultora_nombre: 'Consultora nueva' });
  await getComparativas();
  assert.deepEqual(f.data(1), { currentGasCost: 600, proposedTariffSnapshot: { nombre: 'Tarifa original' },
    companySnapshot: { config: originalConfig, logo: logoA } });
});

for (const [name, update] of [
  ['removing the logo', () => deleteCompanyLogo()],
  ['replacing the logo', () => saveCompanyLogo(logoB)],
  ['editing the company', () => saveCompanyConfig({ consultora_nombre: 'Consultora nueva' })]
]) {
  test(`${name} preserves legacy comparisons before modifying settings`, async t => {
    const f = setup(t); f.legacy(1);
    await update();
    assert.deepEqual(f.data(1).companySnapshot, { config: originalConfig, logo: logoA });
  });
  test(`${name} is aborted if legacy branding cannot be preserved`, async t => {
    const f = setup(t); f.legacy(1); f.failPreserving();
    await assert.rejects(update, /conservar el historial/);
    assert.equal(f.sql.prepare("SELECT valor FROM ajustes WHERE clave = 'company_logo'").get().valor, logoA);
    assert.equal(JSON.parse(f.sql.prepare("SELECT valor FROM ajustes WHERE clave = 'company_config'").get().valor).consultora_nombre, 'Consultora original');
  });
}

test('a legacy comparison made with the default logo never adopts a later custom logo', async t => {
  const f = setup(t, null); f.legacy(1);
  await saveCompanyLogo(logoB);
  assert.deepEqual(f.data(1).companySnapshot, { config: originalConfig, logo: null });
});

test('legacy preservation skips damaged JSON and leaves existing snapshots intact', async t => {
  const f = setup(t);
  f.sql.prepare('INSERT INTO comparativas (id, datos_cliente_json) VALUES (?, ?)').run(1, '{invalid');
  const frozen = { companySnapshot: { config: { consultora_nombre: 'Otra consultora' }, logo: null }, currentGasCost: 123 };
  f.legacy(2, frozen); f.legacy(3);
  await deleteCompanyLogo();
  assert.equal(f.sql.prepare('SELECT datos_cliente_json FROM comparativas WHERE id = 1').get().datos_cliente_json, '{invalid');
  assert.deepEqual(f.data(2), frozen);
  assert.equal(f.data(3).companySnapshot.logo, logoA);
});
