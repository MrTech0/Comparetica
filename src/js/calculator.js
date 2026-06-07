/* src/js/calculator.js */

const BONO_SOCIAL_DAILY_RATE = 0.038455; // Cargo regulado diario aproximado en España (€/día)

/**
 * Calcula el coste detallado de una factura de Luz (Tarifa 2.0TD).
 * @param {Object} input - Datos introducidos en el formulario.
 * @param {number} input.dias - Días del periodo de facturación.
 * @param {number} input.p1Pot - Potencia contratada en P1 (kW).
 * @param {number} input.p2Pot - Potencia contratada en P2 (kW).
 * @param {number} input.p1Cons - Consumo en P1 (kWh).
 * @param {number} input.p2Cons - Consumo en P2 (kWh).
 * @param {number} input.p3Cons - Consumo en P3 (kWh).
 * @param {number} input.alquiler - Coste de alquiler de contador para el periodo (€).
 * @param {number} input.impuestoElectrico - Porcentaje del impuesto eléctrico (normalmente 5.11269%).
 * @param {number} input.iva - Porcentaje de IVA / IGIC (ej. 21, 10, 7).
 * @param {Object} tariff - Tarifa a aplicar.
 * @param {number} tariff.potencia_p1 - Precio potencia P1 (€/kW/año).
 * @param {number} tariff.potencia_p2 - Precio potencia P2 (€/kW/año).
 * @param {number} tariff.energia_p1 - Precio energía P1 (€/kWh).
 * @param {number} tariff.energia_p2 - Precio energía P2 (€/kWh).
 * @param {number} tariff.energia_p3 - Precio energía P3 (€/kWh).
 * @returns {Object} Desglose detallado del coste de la factura y su proyección anual.
 */
export function calculateLightBill(input, tariff) {
  if (tariff && (tariff.tipo_tarifa === '3.0TD' || input.p3Pot !== undefined)) {
    return calculateLightBill30TD(input, tariff);
  }

  const {
    dias,
    p1Pot,
    p2Pot,
    p1Cons,
    p2Cons,
    p3Cons,
    alquiler,
    impuestoElectrico,
    iva
  } = input;

  // 1. Término de Potencia (€) = Potencia (kW) * Precio (€/kW/año) * (días / 365)
  const costPotP1 = p1Pot * tariff.potencia_p1 * (dias / 365);
  const costPotP2 = p2Pot * tariff.potencia_p2 * (dias / 365);
  const totalPot = costPotP1 + costPotP2;

  // 2. Término de Energía (€) = Consumo (kWh) * Precio (€/kWh)
  const costEneP1 = p1Cons * tariff.energia_p1;
  const costEneP2 = p2Cons * tariff.energia_p2;
  const costEneP3 = p3Cons * tariff.energia_p3;
  const totalEne = costEneP1 + costEneP2 + costEneP3;

  // 3. Impuesto sobre la Electricidad (IEE)
  const ieeBase = totalPot + totalEne;
  const ieeCost = ieeBase * (impuestoElectrico / 100);

  // 4. Bono Social
  const bonoSocialCost = BONO_SOCIAL_DAILY_RATE * dias;

  // 5. Base Imponible
  const baseImponible = ieeBase + ieeCost + alquiler + bonoSocialCost;

  // 6. IVA/IGIC
  const taxCost = baseImponible * (iva / 100);

  // 7. Total Factura
  const totalBill = baseImponible + taxCost;

  // Proyecciones Anuales (multiplicar conceptos prorrateables por 365 / dias)
  const scale = 365 / dias;
  
  return {
    period: {
      potenciaP1: costPotP1,
      potenciaP2: costPotP2,
      potenciaTotal: totalPot,
      energiaP1: costEneP1,
      energiaP2: costEneP2,
      energiaP3: costEneP3,
      energiaTotal: totalEne,
      iee: ieeCost,
      bonoSocial: bonoSocialCost,
      alquiler: alquiler,
      base: baseImponible,
      impuestos: taxCost,
      total: totalBill
    },
    annual: {
      potenciaTotal: totalPot * scale,
      energiaTotal: totalEne * scale,
      iee: ieeCost * scale,
      bonoSocial: bonoSocialCost * scale,
      alquiler: alquiler * scale,
      base: baseImponible * scale,
      impuestos: taxCost * scale,
      total: totalBill * scale
    }
  };
}

/**
 * Calcula el coste detallado de una factura de Gas (Tarifa RL.1 / TUR 1).
 * @param {Object} input - Datos introducidos en el formulario.
 * @param {number} input.dias - Días del periodo de facturación.
 * @param {number} input.consumo - Consumo en el periodo (kWh).
 * @param {number} input.alquiler - Alquiler de contador del periodo (€).
 * @param {number} input.impuestoHidrocarburos - Impuesto especial sobre hidrocarburos (€/kWh, default 0.00234).
 * @param {number} input.iva - Porcentaje de IVA / IGIC (ej. 21, 10, 7).
 * @param {Object} tariff - Tarifa a aplicar.
 * @param {number} tariff.termino_fijo - Término fijo mensual (€/mes).
 * @param {number} tariff.termino_variable - Término variable (€/kWh).
 * @returns {Object} Desglose detallado del coste de la factura y su proyección anual.
 */
export function calculateGasBill(input, tariff) {
  const {
    dias,
    consumo,
    alquiler,
    impuestoHidrocarburos,
    iva
  } = input;

  // 1. Término Fijo (€) = Término Fijo Mensual * (días * 12 / 365)
  const fixedTermCost = tariff.termino_fijo * (dias * 12 / 365);

  // 2. Término Variable (€) = Consumo (kWh) * Precio Variable (€/kWh)
  const variableTermCost = consumo * tariff.termino_variable;

  // 3. Impuesto de Hidrocarburos
  const taxHidrocarburos = consumo * impuestoHidrocarburos;

  // 4. Base Imponible
  const baseImponible = fixedTermCost + variableTermCost + taxHidrocarburos + alquiler;

  // 5. IVA / IGIC
  const taxCost = baseImponible * (iva / 100);

  // 6. Total Factura
  const totalBill = baseImponible + taxCost;

  // Proyección Anual
  const scale = 365 / dias;

  return {
    period: {
      fijo: fixedTermCost,
      variable: variableTermCost,
      hidrocarburos: taxHidrocarburos,
      alquiler: alquiler,
      base: baseImponible,
      impuestos: taxCost,
      total: totalBill
    },
    annual: {
      fijo: fixedTermCost * scale,
      variable: variableTermCost * scale,
      hidrocarburos: taxHidrocarburos * scale,
      alquiler: alquiler * scale,
      base: baseImponible * scale,
      impuestos: taxCost * scale,
      total: totalBill * scale
    }
  };
}

/**
 * Calcula el coste detallado de una factura de Luz (Tarifa 3.0TD).
 */
export function calculateLightBill30TD(input, tariff) {
  const {
    dias,
    p1Pot, p2Pot, p3Pot, p4Pot, p5Pot, p6Pot,
    p1Cons, p2Cons, p3Cons, p4Cons, p5Cons, p6Cons,
    alquiler,
    impuestoElectrico,
    iva
  } = input;

  // 1. Término de Potencia (€) = Potencia (kW) * Precio (€/kW/año) * (días / 365)
  const costPotP1 = p1Pot * (tariff.potencia_p1 || 0) * (dias / 365);
  const costPotP2 = p2Pot * (tariff.potencia_p2 || 0) * (dias / 365);
  const costPotP3 = p3Pot * (tariff.potencia_p3 || 0) * (dias / 365);
  const costPotP4 = p4Pot * (tariff.potencia_p4 || 0) * (dias / 365);
  const costPotP5 = p5Pot * (tariff.potencia_p5 || 0) * (dias / 365);
  const costPotP6 = p6Pot * (tariff.potencia_p6 || 0) * (dias / 365);
  const totalPot = costPotP1 + costPotP2 + costPotP3 + costPotP4 + costPotP5 + costPotP6;

  // 2. Término de Energía (€) = Consumo (kWh) * Precio (€/kWh)
  const costEneP1 = p1Cons * (tariff.energia_p1 || 0);
  const costEneP2 = p2Cons * (tariff.energia_p2 || 0);
  const costEneP3 = p3Cons * (tariff.energia_p3 || 0);
  const costEneP4 = p4Cons * (tariff.energia_p4 || 0);
  const costEneP5 = p5Cons * (tariff.energia_p5 || 0);
  const costEneP6 = p6Cons * (tariff.energia_p6 || 0);
  const totalEne = costEneP1 + costEneP2 + costEneP3 + costEneP4 + costEneP5 + costEneP6;

  // 3. Impuesto sobre la Electricidad (IEE)
  const ieeBase = totalPot + totalEne;
  const ieeCost = ieeBase * (impuestoElectrico / 100);

  // 4. Bono Social
  const bonoSocialCost = BONO_SOCIAL_DAILY_RATE * dias;

  // 5. Base Imponible
  const baseImponible = ieeBase + ieeCost + alquiler + bonoSocialCost;

  // 6. IVA/IGIC
  const taxCost = baseImponible * (iva / 100);

  // 7. Total Factura
  const totalBill = baseImponible + taxCost;

  // Proyecciones Anuales
  const scale = 365 / dias;
  
  return {
    period: {
      potenciaP1: costPotP1,
      potenciaP2: costPotP2,
      potenciaP3: costPotP3,
      potenciaP4: costPotP4,
      potenciaP5: costPotP5,
      potenciaP6: costPotP6,
      potenciaTotal: totalPot,
      energiaP1: costEneP1,
      energiaP2: costEneP2,
      energiaP3: costEneP3,
      energiaP4: costEneP4,
      energiaP5: costEneP5,
      energiaP6: costEneP6,
      energiaTotal: totalEne,
      iee: ieeCost,
      bonoSocial: bonoSocialCost,
      alquiler: alquiler,
      base: baseImponible,
      impuestos: taxCost,
      total: totalBill
    },
    annual: {
      potenciaTotal: totalPot * scale,
      energiaTotal: totalEne * scale,
      iee: ieeCost * scale,
      bonoSocial: bonoSocialCost * scale,
      alquiler: alquiler * scale,
      base: baseImponible * scale,
      impuestos: taxCost * scale,
      total: totalBill * scale
    }
  };
}
