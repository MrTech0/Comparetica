import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCSVText } from '../src/js/csv_importer.js';

test('quoted CSV fields preserve line breaks, escaped quotes and separators within a single record', () => {
  const csv = fs.readFileSync(new URL('fixtures/clientes-multilinea.csv', import.meta.url), 'utf8');
  const newline = csv.includes('\r\n') ? '\r\n' : '\n';
  assert.deepEqual(parseCSVText(csv), {
    headers: ['Nombre', 'CIF', 'Representante', 'Email'],
    rows: [
      ['Consultoría "Muñoz"', 'B12345674', `José${newline}Núñez`, 'prueba@example.com'],
      ['Luz, Gas y Servicios; S.L.', '12345678Z', 'Ana López', 'otro@example.com']
    ]
  });
});

test('semicolon detection ignores commas inside quoted headers', () => {
  assert.deepEqual(parseCSVText('"Nombre, empresa, cliente, titular";CIF\nEmpresa;B12345674'), {
    headers: ['Nombre, empresa, cliente, titular', 'CIF'],
    rows: [['Empresa', 'B12345674']]
  });
});

test('comma detection ignores semicolons inside quoted headers', () => {
  assert.deepEqual(parseCSVText('"Nombre; empresa; cliente",CIF,Representante\nEmpresa,B12345674,José'), {
    headers: ['Nombre; empresa; cliente', 'CIF', 'Representante'],
    rows: [['Empresa', 'B12345674', 'José']]
  });
});

test('tab detection ignores separators inside quoted headers', () => {
  assert.deepEqual(parseCSVText('"Nombre, empresa, cliente, titular"\tCIF\tRepresentante\nEmpresa\tB12345674\tJosé'), {
    headers: ['Nombre, empresa, cliente, titular', 'CIF', 'Representante'],
    rows: [['Empresa', 'B12345674', 'José']]
  });
});

test('delimiter detection reads a whole quoted header after blank CRLF records', () => {
  assert.deepEqual(parseCSVText('\r\n\t\r\n"Nombre\r\nEmpresa",CIF,Representante\r\nEmpresa,B12345674,José'), {
    headers: ['Nombre\r\nEmpresa', 'CIF', 'Representante'],
    rows: [['Empresa', 'B12345674', 'José']]
  });
});

test('comma-separated data preserves doubled quotes and quoted commas', () => {
  assert.deepEqual(parseCSVText('Nombre,CIF\n"Empresa, ""Luz"" y Gas",B12345674'), {
    headers: ['Nombre', 'CIF'],
    rows: [['Empresa, "Luz" y Gas', 'B12345674']]
  });
});

test('CRLF and CR inside a quoted value remain part of that value', () => {
  for (const newline of ['\r\n', '\r']) {
    assert.deepEqual(parseCSVText(`Nombre;CIF${newline}"Empresa${newline}SL";B12345674${newline}`), {
      headers: ['Nombre', 'CIF'],
      rows: [[`Empresa${newline}SL`, 'B12345674']]
    });
  }
});

test('blank lines are skipped between records and preserved inside quoted fields', () => {
  assert.deepEqual(parseCSVText('\uFEFF\n\nNombre;CIF\n\n"Empresa\n\nSL";B12345674\n \n'), {
    headers: ['Nombre', 'CIF'],
    rows: [['Empresa\n\nSL', 'B12345674']]
  });
});

test('an unclosed quoted field is rejected as an invalid CSV', () => {
  const csv = fs.readFileSync(new URL('fixtures/clientes-comillas-sin-cerrar.csv', import.meta.url), 'utf8');
  assert.throws(() => parseCSVText(csv), /comillas sin cerrar/);
});

test('empty input and a header without rows remain valid empty results', () => {
  assert.deepEqual(parseCSVText(''), { headers: [], rows: [] });
  assert.deepEqual(parseCSVText(' \n\t\n'), { headers: [], rows: [] });
  assert.deepEqual(parseCSVText('Nombre;CIF\n'), { headers: ['Nombre', 'CIF'], rows: [] });
});

test('empty header columns remain available for manual mapping', () => {
  assert.deepEqual(parseCSVText(';;\nEmpresa;B12345674;José\n;;\n'), {
    headers: ['', '', ''],
    rows: [['Empresa', 'B12345674', 'José']]
  });
});
