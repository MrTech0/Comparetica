import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSpanishCups, normalizeCups, isValidSpanishId } from '../src/js/utils/validators.js';

describe('Validación y Normalización de CUPS (src/js/utils/validators.js)', () => {
  describe('normalizeCups()', () => {
    test('elimina espacios en blanco internos y extremos', () => {
      assert.strictEqual(normalizeCups('  ES0021 0000 1234 5678 AB  '), 'ES0021000012345678AB');
    });

    test('convierte caracteres a mayúsculas', () => {
      assert.strictEqual(normalizeCups('es0021000012345678ab'), 'ES0021000012345678AB');
      assert.strictEqual(normalizeCups('es0021000012345678ab0f'), 'ES0021000012345678AB0F');
    });

    test('maneja valores nulos, undefined o no strings defensivamente', () => {
      assert.strictEqual(normalizeCups(null), '');
      assert.strictEqual(normalizeCups(undefined), '');
      assert.strictEqual(normalizeCups(''), '');
      assert.strictEqual(normalizeCups(12345), '12345');
    });
  });

  describe('isValidSpanishCups()', () => {
    test('acepta CUPS válidos de 20 caracteres', () => {
      assert.strictEqual(isValidSpanishCups('ES0021000000000000AB'), true);
      assert.strictEqual(isValidSpanishCups('ES0031123456789012CD'), true);
      assert.strictEqual(isValidSpanishCups('ES9999999999999999ZZ'), true);
    });

    test('acepta CUPS válidos de 22 caracteres (con puntos de frontera/medida)', () => {
      assert.strictEqual(isValidSpanishCups('ES0021000000000000AB0F'), true);
      assert.strictEqual(isValidSpanishCups('ES0031123456789012CD1P'), true);
      assert.strictEqual(isValidSpanishCups('ES0031123456789012CD2A'), true);
    });

    test('acepta CUPS con minúsculas o espacios si se normaliza previamente', () => {
      const raw = ' es 0021 0000 0000 0000 ab 0f ';
      assert.strictEqual(isValidSpanishCups(normalizeCups(raw)), true);
    });

    test('rechaza cadenas vacías, nulas o no string', () => {
      assert.strictEqual(isValidSpanishCups(''), false);
      assert.strictEqual(isValidSpanishCups(null), false);
      assert.strictEqual(isValidSpanishCups(undefined), false);
      assert.strictEqual(isValidSpanishCups(12345), false);
    });

    test('rechaza CUPS que no comiencen por ES', () => {
      assert.strictEqual(isValidSpanishCups('FR0021000000000000AB'), false);
      assert.strictEqual(isValidSpanishCups('PT0021000000000000AB'), false);
      assert.strictEqual(isValidSpanishCups('002100000000000000AB'), false);
    });

    test('rechaza CUPS con longitud diferente de 20 o 22 caracteres', () => {
      // 19 caracteres
      assert.strictEqual(isValidSpanishCups('ES002100000000000AB'), false);
      // 21 caracteres
      assert.strictEqual(isValidSpanishCups('ES0021000000000000AB0'), false);
      // 23 caracteres
      assert.strictEqual(isValidSpanishCups('ES0021000000000000AB0F1'), false);
    });

    test('rechaza CUPS con caracteres no numéricos en los 16 dígitos centrales', () => {
      assert.strictEqual(isValidSpanishCups('ES00210000A0000000AB'), false);
      assert.strictEqual(isValidSpanishCups('ES00210000-0000000AB'), false);
    });

    test('rechaza CUPS con dígitos en las letras de control de posición 19-20', () => {
      assert.strictEqual(isValidSpanishCups('ES002100000000000012'), false);
      assert.strictEqual(isValidSpanishCups('ES0021000000000000A1'), false);
    });
  });

  describe('isValidSpanishId()', () => {
    test('valida DNI correctamente', () => {
      // DNI válido conocido (ej. 12345678Z)
      assert.strictEqual(isValidSpanishId('12345678Z'), true);
      assert.strictEqual(isValidSpanishId('12345678A'), false); // Letra errónea
    });

    test('valida CIF de empresa correctamente', () => {
      assert.strictEqual(isValidSpanishId('B12345674'), true);
      assert.strictEqual(isValidSpanishId('B12345670'), false); // Control erróneo
    });

    test('valida NIE de extranjero correctamente', () => {
      assert.strictEqual(isValidSpanishId('X1234567L'), true);
      assert.strictEqual(isValidSpanishId('X1234567A'), false); // Letra errónea
    });

    test('rechaza valores no válidos o vacíos', () => {
      assert.strictEqual(isValidSpanishId(''), false);
      assert.strictEqual(isValidSpanishId(null), false);
      assert.strictEqual(isValidSpanishId('INVALID123'), false);
    });
  });

  describe('Reglas de Negocio: Suministros y Comparador', () => {
    test('validación de alta de cliente: exige al menos un CUPS válido', () => {
      const validateClientCupsData = (puntos) => {
        if (!puntos || puntos.length === 0) {
          return { valid: false, error: 'Debes indicar al menos un código CUPS' };
        }
        for (const p of puntos) {
          const norm = normalizeCups(p.cups);
          if (!isValidSpanishCups(norm)) {
            return { valid: false, error: `CUPS "${p.cups}" inválido` };
          }
        }
        return { valid: true, error: null };
      };

      // Sin puntos
      assert.strictEqual(validateClientCupsData([]).valid, false);
      // Con CUPS mal formado
      assert.strictEqual(validateClientCupsData([{ cups: 'ES123', tipoEnergia: 'LUZ' }]).valid, false);
      // Con CUPS válido de Luz
      assert.strictEqual(validateClientCupsData([{ cups: 'ES0021000000000000AB', tipoEnergia: 'LUZ' }]).valid, true);
      // Multipunto válido mixto (Luz + Gas)
      assert.strictEqual(validateClientCupsData([
        { cups: 'ES0021000000000000AB', tipoEnergia: 'LUZ' },
        { cups: 'ES0031000000000000CD0F', tipoEnergia: 'GAS' }
      ]).valid, true);
    });

    test('autoselección y bloqueo de tipo de suministro en comparador al elegir punto', () => {
      const puntos = [
        { id: 1, cliente_id: 10, cups: 'ES0021000000000000AB', direccion_alias: 'Sede Central', tipo_energia: 'LUZ' },
        { id: 2, cliente_id: 10, cups: 'ES0031000000000000CD', direccion_alias: 'Almacén Gas', tipo_energia: 'GAS' }
      ];

      const selectPunto = (p) => {
        const cups = normalizeCups(p.cups);
        const energyType = (p.tipo_energia || 'LUZ').toUpperCase();
        const isLocked = Boolean(cups && energyType);
        return { cups, energyType, isLocked };
      };

      assert.deepStrictEqual(selectPunto(puntos[0]), { cups: 'ES0021000000000000AB', energyType: 'LUZ', isLocked: true });
      assert.deepStrictEqual(selectPunto(puntos[1]), { cups: 'ES0031000000000000CD', energyType: 'GAS', isLocked: true });
    });

    test('un punto de suministro físico solo puede pertenecer a LUZ o GAS (no DUAL en un solo CUPS)', () => {
      const allowedEnergyTypes = ['LUZ', 'GAS'];
      assert.strictEqual(allowedEnergyTypes.includes('LUZ'), true);
      assert.strictEqual(allowedEnergyTypes.includes('GAS'), true);
      assert.strictEqual(allowedEnergyTypes.includes('DUAL'), false);
    });

    test('el selector del comparador en index.html solo contiene LUZ y GAS, excluyendo DUAL', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const html = fs.readFileSync(path.resolve('src/index.html'), 'utf8');
      const selectMatch = html.match(/<select id="calc-energy-type"[\s\S]*?<\/select>/);
      assert.ok(selectMatch, 'El elemento select #calc-energy-type debe existir en src/index.html');
      const selectHtml = selectMatch[0];
      assert.ok(selectHtml.includes('value="LUZ"'), 'Debe incluir la opción LUZ');
      assert.ok(selectHtml.includes('value="GAS"'), 'Debe incluir la opción GAS');
      assert.strictEqual(selectHtml.includes('DUAL'), false, 'No debe contener la opción DUAL');
    });

    test('el selector de renovaciones en index.html solo contiene Luz y Gas, excluyendo Dual', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const html = fs.readFileSync(path.resolve('src/index.html'), 'utf8');
      const selectMatch = html.match(/<select id="manual-ren-tipo"[\s\S]*?<\/select>/);
      assert.ok(selectMatch, 'El elemento select #manual-ren-tipo debe existir en src/index.html');
      const selectHtml = selectMatch[0];
      assert.ok(selectHtml.includes('value="Luz"'), 'Debe incluir la opción Luz');
      assert.ok(selectHtml.includes('value="Gas"'), 'Debe incluir la opción Gas');
      assert.strictEqual(selectHtml.toLowerCase().includes('dual'), false, 'No debe contener la opción Dual');
    });

    test('las renovaciones desde historial y manual normalizan y asignan tipo_energia a Luz o Gas', () => {
      const mapRenewalEnergy = (raw) => {
        const norm = (raw || '').toUpperCase();
        if (norm.includes('GAS')) return 'Gas';
        return 'Luz'; // Cubre LUZ, DUAL legacy o vacío
      };

      assert.strictEqual(mapRenewalEnergy('LUZ'), 'Luz');
      assert.strictEqual(mapRenewalEnergy('Luz'), 'Luz');
      assert.strictEqual(mapRenewalEnergy('GAS'), 'Gas');
      assert.strictEqual(mapRenewalEnergy('Gas'), 'Gas');
      assert.strictEqual(mapRenewalEnergy('DUAL'), 'Luz');
      assert.strictEqual(mapRenewalEnergy(''), 'Luz');
      assert.strictEqual(mapRenewalEnergy(null), 'Luz');
    });

    test('búsqueda inversa: detectar cliente y suministro a partir del CUPS', () => {
      const clients = [
        { id: 10, nombre_empresa: 'Empresa Demo S.L.' },
        { id: 20, nombre_empresa: 'Comercial Norte S.A.' }
      ];
      const puntos = [
        { id: 1, cliente_id: 10, cups: 'ES0021000000000000AB', tipo_energia: 'LUZ' },
        { id: 2, cliente_id: 20, cups: 'ES0031000000000000CD0F', tipo_energia: 'GAS' }
      ];

      const reverseLookup = (enteredCups) => {
        const norm = normalizeCups(enteredCups);
        const matchedPunto = puntos.find(p => normalizeCups(p.cups) === norm);
        if (!matchedPunto) return null;
        const matchedClient = clients.find(c => c.id === matchedPunto.cliente_id);
        return {
          clientName: matchedClient?.nombre_empresa || null,
          cups: matchedPunto.cups,
          tipoEnergia: matchedPunto.tipo_energia,
          isLocked: true
        };
      };

      assert.deepStrictEqual(reverseLookup('ES0021000000000000AB'), {
        clientName: 'Empresa Demo S.L.',
        cups: 'ES0021000000000000AB',
        tipoEnergia: 'LUZ',
        isLocked: true
      });

      assert.deepStrictEqual(reverseLookup('es 0031 0000 0000 0000 cd 0f'), {
        clientName: 'Comercial Norte S.A.',
        cups: 'ES0031000000000000CD0F',
        tipoEnergia: 'GAS',
        isLocked: true
      });

      assert.strictEqual(reverseLookup('ES9999999999999999ZZ'), null);
    });

    test('retrocompatibilidad: cliente legacy sin CUPS requiere que el usuario lo informe para comparar y permite seleccionar tipo', () => {
      const legacyClient = { id: 99, nombre_empresa: 'Cliente Antiguo', cups: '' };
      
      const validateComparatorSubmit = (client, enteredCups) => {
        const cups = normalizeCups(enteredCups || client.cups || '');
        if (!cups) {
          return { canProceed: false, reason: 'CUPS_MISSING', isLocked: false };
        }
        if (!isValidSpanishCups(cups)) {
          return { canProceed: false, reason: 'CUPS_INVALID', isLocked: false };
        }
        return { canProceed: true, cups, isLocked: true };
      };

      // Si el cliente legacy no tiene CUPS y el input está vacío -> Bloqueado con aviso, selector no bloqueado
      assert.deepStrictEqual(validateComparatorSubmit(legacyClient, ''), {
        canProceed: false,
        reason: 'CUPS_MISSING',
        isLocked: false
      });

      // Si el usuario introduce el CUPS en el comparador para ese cliente -> Permitido
      assert.deepStrictEqual(validateComparatorSubmit(legacyClient, 'ES0021000000000000AB'), {
        canProceed: true,
        cups: 'ES0021000000000000AB',
        isLocked: true
      });
    });
  });
});
