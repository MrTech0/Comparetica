/* Porcentajes en centésimas de punto porcentual; importes en céntimos. */
export function parseRetentionPercent(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Introduce un porcentaje entre 0 y 100, con hasta dos decimales.');
  const text = String(value).trim().replace(',', '.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) throw new Error('Introduce un porcentaje entre 0 y 100, con hasta dos decimales.');
  const [whole, decimal = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (result > 10000) throw new Error('La retención debe estar entre 0 y 100 %.');
  return result;
}

export function formatRetentionPercent(value) {
  return (value / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

export function moneyToCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('La comisión total no es válida.');
  // Convertir el decimal representado, sin multiplicación binaria (1.005 -> 101).
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [whole, decimal = ''] = mantissa.split('.');
  const digits = BigInt(whole + decimal);
  const scale = decimal.length - Number(exponent) - 2;
  const cents = scale <= 0 ? digits * 10n ** BigInt(-scale) : (digits + 10n ** BigInt(scale) / 2n) / 10n ** BigInt(scale);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('La comisión total supera el importe admitido.');
  return Number(cents);
}

export function splitCommission(total, percentage) {
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 10000) throw new Error('Porcentaje de retención inválido.');
  const total_centimos = moneyToCents(total);
  const consultoria_centimos = Number((BigInt(total_centimos) * BigInt(percentage) + 5000n) / 10000n);
  return { total_centimos, consultoria_centimos, comercial_centimos: total_centimos - consultoria_centimos };
}

export function getCommissionSplit(comparison) {
  if (!comparison?.reparto_comision_json) return null;
  try {
    const data = JSON.parse(comparison.reparto_comision_json);
    if (![1, 2].includes(data.version) || !Number.isSafeInteger(data.cliente_id) || data.cliente_id <= 0 || !Number.isSafeInteger(data.agente_id) || data.agente_id <= 0 || typeof data.cliente_nombre !== 'string' || typeof data.agente_nombre !== 'string') return null;
    if (data.version === 1 && typeof data.retencion_nombre !== 'string') return null;
    if (data.retencion_id !== null && (!Number.isSafeInteger(data.retencion_id) || data.retencion_id <= 0)) return null;
    if (data.retencion_id === null && data.porcentaje_centesimas !== 0) return null;
    const expected = splitCommission(comparison.comision_total, data.porcentaje_centesimas);
    for (const key of Object.keys(expected)) if (data[key] !== expected[key]) return null;
    return data;
  } catch { return null; }
}
