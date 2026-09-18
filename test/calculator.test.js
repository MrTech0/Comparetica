import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLightBill, calculateLightBill30TD, calculateGasBill } from '../src/js/calculator.js';

describe('Motor Matemático: Facturación Eléctrica 2.0TD', () => {
  const defaultTariff20TD = {
    tipo_tarifa: '2.0TD',
    potencia_p1: 30.50, // €/kW/año
    potencia_p2: 12.20, // €/kW/año
    energia_p1: 0.18,   // €/kWh
    energia_p2: 0.14,   // €/kWh
    energia_p3: 0.10,   // €/kWh
    excedente: 0.08     // €/kWh
  };

  test('Factura estándar de 30 días sin excedentes ni bono social', () => {
    const input = {
      dias: 30,
      p1Pot: 4.6,
      p2Pot: 4.6,
      p1Cons: 120,
      p2Cons: 90,
      p3Cons: 150,
      alquiler: 0.81,
      impuestoElectrico: 5.11269,
      iva: 21,
      excedenteCons: 0,
      bonoSocialPct: 0
    };

    const res = calculateLightBill(input, defaultTariff20TD);

    // 1. Potencias: P1 (11.53 €), P2 (4.61 €)
    assert.strictEqual(res.period.potenciaP1.toFixed(2), '11.53');
    assert.strictEqual(res.period.potenciaP2.toFixed(2), '4.61');
    assert.strictEqual(res.period.potenciaTotal.toFixed(2), '16.14');

    // 2. Energías: P1 (21.60 €), P2 (12.60 €), P3 (15.00 €)
    assert.strictEqual(res.period.energiaP1.toFixed(2), '21.60');
    assert.strictEqual(res.period.energiaP2.toFixed(2), '12.60');
    assert.strictEqual(res.period.energiaP3.toFixed(2), '15.00');
    assert.strictEqual(res.period.energiaTotal.toFixed(2), '49.20');

    // 3. IEE: 5.11269% sobre (16.1441 + 49.20 = 65.3441) => 3.34 €
    assert.strictEqual(res.period.iee.toFixed(2), '3.34');

    // 4. Bono Social diario: 0.038455 * 30 => 1.15 €
    assert.strictEqual(res.period.bonoSocial.toFixed(2), '1.15');

    // 5. Base Imponible: 65.3441 + 3.3408 + 0.81 + 1.15365 => 70.65 €
    assert.strictEqual(res.period.base.toFixed(2), '70.65');

    // 6. IVA (21%): 70.6486 * 0.21 => 14.84 €
    assert.strictEqual(res.period.impuestos.toFixed(2), '14.84');

    // 7. Total Factura: 70.6486 + 14.8362 => 85.48 €
    assert.strictEqual(res.period.total.toFixed(2), '85.48');

    // 8. Proyección anual escala exacta (365 / 30 = 12.1667)
    const expectedAnnualTotal = (res.period.total * (365 / 30)).toFixed(2);
    assert.strictEqual(res.annual.total.toFixed(2), expectedAnnualTotal);
  });

  test('Compensación parcial de excedentes de autoconsumo', () => {
    const input = {
      dias: 30,
      p1Pot: 4.6,
      p2Pot: 4.6,
      p1Cons: 100,
      p2Cons: 50,
      p3Cons: 50, // total 200 kWh * precio
      alquiler: 0.81,
      impuestoElectrico: 5.11269,
      iva: 21,
      excedenteCons: 100, // 100 kWh * 0.08 = 8.00 € descuento
      bonoSocialPct: 0
    };

    const res = calculateLightBill(input, defaultTariff20TD);
    // Coste energía bruto: (100*0.18)+(50*0.14)+(50*0.10) = 18 + 7 + 5 = 30.00 €
    assert.strictEqual(res.period.energiaTotal.toFixed(2), '30.00');
    assert.strictEqual(res.period.excedenteDiscount.toFixed(2), '8.00');

    // Base IEE debe calcularse sobre potencia (16.14) + energía neta (22.00) = 38.14 €
    const expectedIee = (16.144109589041098 + 22.00) * 0.0511269;
    assert.strictEqual(res.period.iee.toFixed(2), expectedIee.toFixed(2));
  });

  test('Tope legal de excedentes: nunca hace negativo el término de energía', () => {
    const input = {
      dias: 30,
      p1Pot: 3.3,
      p2Pot: 3.3,
      p1Cons: 10,
      p2Cons: 10,
      p3Cons: 10, // Energía bruta = 1.8 + 1.4 + 1.0 = 4.20 €
      alquiler: 0.81,
      impuestoElectrico: 5.11269,
      iva: 21,
      excedenteCons: 500, // 500 kWh * 0.08 = 40.00 € (muy superior a 4.20 €)
      bonoSocialPct: 0
    };

    const res = calculateLightBill(input, defaultTariff20TD);
    // El descuento real aplicado debe topar en el valor bruto de la energía
    assert.strictEqual(res.period.energiaTotal.toFixed(2), '4.20');
    assert.strictEqual(res.period.excedenteDiscount.toFixed(2), '4.20');
    assert.ok(res.period.total > 0, 'La factura no debe ser negativa');
  });

  test('Bono Social porcentual (descuento 40% en términos de potencia y energía)', () => {
    const input = {
      dias: 30,
      p1Pot: 4.0,
      p2Pot: 4.0,
      p1Cons: 100,
      p2Cons: 100,
      p3Cons: 100,
      alquiler: 0.81,
      impuestoElectrico: 5.11269,
      iva: 21,
      bonoSocialPct: 40
    };

    const res = calculateLightBill(input, defaultTariff20TD);
    const totalPot = (4.0 * 30.50 * 30 / 365) + (4.0 * 12.20 * 30 / 365);
    const totalEne = (100 * 0.18) + (100 * 0.14) + (100 * 0.10);
    const baseTerminos = totalPot + totalEne;
    const expectedDiscount = baseTerminos * 0.40;

    assert.strictEqual(res.period.bonoSocialDiscount.toFixed(2), expectedDiscount.toFixed(2));
    const expectedIee = (baseTerminos - expectedDiscount) * 0.0511269;
    assert.strictEqual(res.period.iee.toFixed(2), expectedIee.toFixed(2));
  });
});

describe('Motor Matemático: Facturación Eléctrica 3.0TD', () => {
  const defaultTariff30TD = {
    tipo_tarifa: '3.0TD',
    potencia_p1: 40.0, potencia_p2: 30.0, potencia_p3: 20.0,
    potencia_p4: 15.0, potencia_p5: 10.0, potencia_p6: 5.0,
    energia_p1: 0.22, energia_p2: 0.19, energia_p3: 0.16,
    energia_p4: 0.14, energia_p5: 0.12, energia_p6: 0.09,
    excedente: 0.07
  };

  test('Cálculo de 6 periodos con reactiva y conceptos opcionales', () => {
    const input = {
      dias: 30,
      p1Pot: 15, p2Pot: 15, p3Pot: 15, p4Pot: 15, p5Pot: 15, p6Pot: 15,
      p1Cons: 500, p2Cons: 400, p3Cons: 600, p4Cons: 700, p5Cons: 300, p6Cons: 800,
      alquiler: 3.50,
      impuestoElectrico: 5.11269,
      iva: 21,
      reactivePenalties: 25.00,
      otherConcepts: 12.00
    };

    const res = calculateLightBill30TD(input, defaultTariff30TD);

    // Verificar que los 6 tramos de potencia se calcularon
    assert.ok(res.period.potenciaTotal > 0);
    // Verificar que los 6 tramos de energía sumaron correctamente
    const expectedEne = (500*0.22) + (400*0.19) + (600*0.16) + (700*0.14) + (300*0.12) + (800*0.09);
    assert.strictEqual(res.period.energiaTotal.toFixed(2), expectedEne.toFixed(2));
    assert.strictEqual(res.period.reactivePenalties, 25.00);
    assert.strictEqual(res.period.otherConcepts, 12.00);
    assert.ok(res.period.total > res.period.base, 'Total factura debe ser mayor a base por IVA');
  });
});

describe('Motor Matemático: Facturación de Gas', () => {
  const defaultTariffGas = {
    tipo_tarifa: 'RL.2',
    termino_fijo: 6.50, // €/mes
    termino_variable: 0.055 // €/kWh
  };

  test('Factura estándar de 60 días con impuesto de hidrocarburos e IVA', () => {
    const input = {
      dias: 60,
      consumo: 1200,
      alquiler: 2.10,
      impuestoHidrocarburos: 0.00234,
      iva: 21
    };

    const res = calculateGasBill(input, defaultTariffGas);

    // Fijo: 6.50 * (60 * 12 / 365) = 12.82 €
    const expectedFijo = 6.50 * (60 * 12 / 365);
    assert.strictEqual(res.period.fijo.toFixed(2), expectedFijo.toFixed(2));

    // Variable: 1200 * 0.055 = 66.00 €
    assert.strictEqual(res.period.variable.toFixed(2), '66.00');

    // Hidrocarburos: 1200 * 0.00234 = 2.81 €
    assert.strictEqual(res.period.hidrocarburos.toFixed(2), '2.81');

    // Base: Fijo + Variable + Hidrocarburos + Alquiler
    const expectedBase = expectedFijo + 66.00 + (1200 * 0.00234) + 2.10;
    assert.strictEqual(res.period.base.toFixed(2), expectedBase.toFixed(2));

    // Total con IVA 21%
    const expectedTotal = expectedBase * 1.21;
    assert.strictEqual(res.period.total.toFixed(2), expectedTotal.toFixed(2));
  });
});

describe('Motor Matemático: Robustez y Casos Límite', () => {
  test('Consumos nulos (0 kWh) en luz y gas no generan NaN ni divisiones por cero', () => {
    const inputLuzZero = {
      dias: 30,
      p1Pot: 3.3, p2Pot: 3.3,
      p1Cons: 0, p2Cons: 0, p3Cons: 0,
      alquiler: 0.81,
      impuestoElectrico: 5.11269,
      iva: 21
    };
    const resLuz = calculateLightBill(inputLuzZero, {
      potencia_p1: 30, potencia_p2: 12,
      energia_p1: 0.15, energia_p2: 0.12, energia_p3: 0.09
    });
    assert.ok(!Number.isNaN(resLuz.period.total));
    assert.ok(resLuz.period.total > 0);

    const inputGasZero = {
      dias: 30, consumo: 0, alquiler: 1.0,
      impuestoHidrocarburos: 0.00234, iva: 21
    };
    const resGas = calculateGasBill(inputGasZero, {
      termino_fijo: 5.0, termino_variable: 0.05
    });
    assert.ok(!Number.isNaN(resGas.period.total));
    assert.ok(resGas.period.total > 0);
  });

  test('Consistencia con periodos arbitrarios (1 día, 365 días)', () => {
    const tariff = { potencia_p1: 36.5, potencia_p2: 0, energia_p1: 0.20, energia_p2: 0, energia_p3: 0 };
    // 1 kW a 36.5 €/año durante 10 días = 1.00 €
    const res10d = calculateLightBill({
      dias: 10, p1Pot: 1, p2Pot: 0, p1Cons: 0, p2Cons: 0, p3Cons: 0,
      alquiler: 0, impuestoElectrico: 0, iva: 0
    }, tariff);
    assert.strictEqual(res10d.period.potenciaP1.toFixed(2), '1.00');

    // Proyección anual de 1 kW debe ser exactamente 36.50 €
    assert.strictEqual(res10d.annual.potenciaTotal.toFixed(2), '36.50');
  });
});
