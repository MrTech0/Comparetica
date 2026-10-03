import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRetentionPercent, moneyToCents, splitCommission, getCommissionSplit } from '../src/js/commission_split.js';

test('porcentajes: coma/punto, límites y dos decimales', () => {
  for (const [input, expected] of [['0', 0], ['100', 10000], ['20,25', 2025], [' 30.5 ', 3050], [20, 2000]]) {
    assert.equal(parseRetentionPercent(input), expected);
  }
  for (const value of ['', null, undefined, '-1', '100.01', '20.123', '1e2', Infinity, NaN, 'abc']) {
    assert.throws(() => parseRetentionPercent(value));
  }
});

test('redondeo monetario y reparto exacto en céntimos', () => {
  assert.equal(moneyToCents(1.005), 101);
  assert.equal(moneyToCents(1e-7), 0);
  for (const [total, pct, consultoria, comercial] of [[100, 2000, 2000, 8000], [250, 3000, 7500, 17500], [100, 0, 0, 10000], [100, 10000, 10000, 0], [0.01, 5000, 1, 0]]) {
    const result = splitCommission(total, pct);
    assert.deepEqual(result, { total_centimos: moneyToCents(total), consultoria_centimos: consultoria, comercial_centimos: comercial });
    assert.equal(result.total_centimos, result.consultoria_centimos + result.comercial_centimos);
  }
  for (const total of [null, '', -1, Infinity, NaN, Number.MAX_SAFE_INTEGER]) assert.throws(() => moneyToCents(total));
  for (const pct of [-1, 10001, 0.5, null, NaN]) assert.throws(() => splitCommission(100, pct));
  const large = splitCommission(90071992547409.9, 9999);
  assert.equal(large.total_centimos, large.consultoria_centimos + large.comercial_centimos);
});

test('solo se leen repartos coherentes guardados, sin inventar los históricos', () => {
  const snapshot = { version: 1, cliente_id: 1, cliente_nombre: 'Cliente', agente_id: 2, agente_nombre: 'Comercial', retencion_id: 3, retencion_nombre: 'General', porcentaje_centesimas: 2000, ...splitCommission(100, 2000) };
  const record = { comision_total: 100, reparto_comision_json: JSON.stringify(snapshot) };
  assert.deepEqual(getCommissionSplit(record), snapshot);
  assert.equal(getCommissionSplit({ comision_total: 100 }), null);
  const { retencion_nombre, ...nameless } = { ...snapshot, version: 2 };
  assert.deepEqual(getCommissionSplit({ ...record, reparto_comision_json: JSON.stringify(nameless) }), nameless);
  for (const changes of [{ version: 3 }, { consultoria_centimos: 1 }, { total_centimos: 9999 }, { porcentaje_centesimas: 10001 }, { agente_id: null }, { comercial_centimos: -1 }]) {
    assert.equal(getCommissionSplit({ ...record, reparto_comision_json: JSON.stringify({ ...snapshot, ...changes }) }), null);
  }
  assert.equal(getCommissionSplit({ ...record, reparto_comision_json: '{bad' }), null);
});
