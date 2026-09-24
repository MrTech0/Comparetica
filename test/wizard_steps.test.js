import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Asistente de Configuración Inicial (Wizard de 3 Pasos)', () => {
  const html = fs.readFileSync(path.resolve('src/index.html'), 'utf8');

  test('el diálogo welcome wizard existe y contiene los 3 pasos numerados', () => {
    assert.ok(html.includes('id="dialog-welcome-wizard"'), 'El elemento #dialog-welcome-wizard debe existir');
    assert.ok(html.includes('id="wizard-step-1"'), 'El paso 1 (#wizard-step-1) debe existir');
    assert.ok(html.includes('id="wizard-step-2"'), 'El paso 2 (#wizard-step-2) debe existir');
    assert.ok(html.includes('id="wizard-step-3"'), 'El paso 3 (#wizard-step-3) debe existir');
  });

  test('el chip indicador muestra inicialmente "Paso 1 de 3"', () => {
    const chipMatch = html.match(/id="wizard-step-chip"[^>]*>([^<]+)<\/span>/);
    assert.ok(chipMatch, 'Debe existir el chip #wizard-step-chip');
    assert.strictEqual(chipMatch[1].trim(), 'Paso 1 de 3');
  });

  test('el paso 2 contiene botón "Atrás" y botón de avance hacia Comercial Principal ("Siguiente: Comercial Principal ➔")', () => {
    assert.ok(html.includes('id="wizard-step-2-next-btn"'), 'Debe existir el botón #wizard-step-2-next-btn');
    const nextBtnMatch = html.match(/id="wizard-step-2-next-btn"[^>]*>([^<]+)<\/button>/);
    assert.ok(nextBtnMatch);
    assert.ok(nextBtnMatch[1].includes('Comercial Principal'), 'El botón debe indicar avance a Comercial Principal');
  });

  test('el paso 3 contiene los campos del Comercial Principal y el botón "Finalizar"', () => {
    assert.ok(html.includes('id="wizard-agent-name"'), 'Debe existir el input #wizard-agent-name');
    assert.ok(html.includes('id="wizard-agent-phone"'), 'Debe existir el input #wizard-agent-phone');
    assert.ok(html.includes('id="wizard-agent-email"'), 'Debe existir el input #wizard-agent-email');
    assert.ok(html.includes('id="wizard-step-3-back-btn"'), 'Debe existir el botón de retorno en el paso 3');

    const submitBtnMatch = html.match(/id="wizard-submit-btn"[^>]*>([^<]+)<\/button>/);
    assert.ok(submitBtnMatch, 'Debe existir el botón #wizard-submit-btn');
    assert.strictEqual(submitBtnMatch[1].trim(), 'Finalizar');
  });

  test('los botones respetan las clases del sistema de diseño Material 3', () => {
    assert.ok(html.includes('id="wizard-backup-browse-btn" class="m3-btn m3-btn-outlined"'), 'Examinar debe usar m3-btn m3-btn-outlined');
    assert.ok(html.includes('id="wizard-back-step-btn" class="m3-btn m3-btn-outlined"'), 'Atrás del paso 2 debe usar m3-btn m3-btn-outlined');
    assert.ok(html.includes('id="wizard-step-3-back-btn" class="m3-btn m3-btn-outlined"'), 'Atrás del paso 3 debe usar m3-btn m3-btn-outlined');
  });
});
