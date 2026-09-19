import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getClientInactivityParams,
  saveClientInactivityParams,
  updateClienteEstado,
  syncClientesEstadoAutomatico,
  getClientesForSelect,
  searchClientes,
  getClientes
} from '../src/js/db.js';
import { generateLopdCertificatePdf } from '../src/js/pdf.js';

describe('Ciclo de Vida de Clientes y Bloqueo LOPD (src/js/db.js)', () => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;

  let memoryDb = {
    ajustes: {},
    clientes: [],
    renovaciones: [],
    comparativas: []
  };

  beforeEach(() => {
    memoryDb = {
      ajustes: {},
      clientes: [],
      renovaciones: [],
      comparativas: []
    };

    // Mock localStorage
    const localStore = {};
    globalThis.localStorage = {
      getItem: (k) => localStore[k] ?? null,
      setItem: (k, v) => { localStore[k] = String(v); },
      removeItem: (k) => { delete localStore[k]; },
      clear: () => { Object.keys(localStore).forEach(k => delete localStore[k]); }
    };

    // Mock window.__TAURI__ and db_select / db_execute
    globalThis.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd, args) => {
            if (cmd === 'db_select') {
              const { query, params = [] } = args;
              if (query.includes('FROM ajustes')) {
                const key = params[0];
                if (memoryDb.ajustes[key]) {
                  return [{ clave: key, valor: memoryDb.ajustes[key] }];
                }
                return [];
              }
              if (query.includes('FROM clientes c') && query.includes('tiene_aceptada')) {
                // Return clients with tiene_aceptada flag
                return memoryDb.clientes.map(c => {
                  const tiene_aceptada = memoryDb.comparativas.some(
                    comp => comp.cliente_nombre === c.nombre_empresa && comp.estado === 'Aceptada'
                  ) ? 1 : 0;
                  return { ...c, tiene_aceptada };
                }).filter(c => {
                  if (query.includes("c.estado = 'activo'")) {
                    return c.estado === 'activo' || !c.estado;
                  }
                  return true;
                });
              }
              if (query.includes('FROM clientes')) {
                let list = [...memoryDb.clientes];
                if (query.includes("estado = 'activo'")) {
                  list = list.filter(c => c.estado === 'activo' || !c.estado);
                }
                if (params && params.length > 0 && typeof params[0] === 'string' && params[0].startsWith('%')) {
                  const term = params[0].replaceAll('%', '').toLowerCase();
                  list = list.filter(c => 
                    c.nombre_empresa.toLowerCase().includes(term) ||
                    (c.cif && c.cif.toLowerCase().includes(term)) ||
                    (c.cups && c.cups.toLowerCase().includes(term))
                  );
                }
                return list;
              }
              if (query.includes('FROM renovaciones')) {
                const clienteId = params[0];
                return memoryDb.renovaciones.filter(r => r.cliente_id === clienteId);
              }
              if (query.includes('FROM comparativas') && query.includes('datetime')) {
                const clienteNombre = params[0];
                return [{ count: memoryDb.comparativas.filter(comp => comp.cliente_nombre === clienteNombre).length }];
              }
              if (query.includes('MAX(fecha)') && query.includes('FROM comparativas')) {
                const clienteNombre = params[0];
                const matched = memoryDb.comparativas.filter(comp => comp.cliente_nombre === clienteNombre && comp.estado === 'Aceptada');
                return [{ ultima_fecha: matched.length > 0 ? matched[0].fecha : null }];
              }
              return [];
            }
            if (cmd === 'db_execute') {
              const { query, params = [] } = args;
              if (query.includes('INSERT INTO ajustes') || query.includes('INSERT OR REPLACE INTO ajustes')) {
                const key = params[0];
                const val = params[1];
                memoryDb.ajustes[key] = val;
                return { rowsAffected: 1 };
              }
              if (query.includes('UPDATE clientes SET estado = ?')) {
                const nuevoEstado = params[0];
                if (nuevoEstado === 'bloqueado') {
                  const bEn = params[1];
                  const bHasta = params[2];
                  const id = params[3];
                  const client = memoryDb.clientes.find(c => c.id === id);
                  if (client) {
                    client.estado = nuevoEstado;
                    client.bloqueado_en = bEn;
                    client.bloqueado_hasta = bHasta;
                  }
                } else {
                  const id = params[1];
                  const client = memoryDb.clientes.find(c => c.id === id);
                  if (client) {
                    client.estado = nuevoEstado;
                    client.bloqueado_en = null;
                    client.bloqueado_hasta = null;
                  }
                }
                return { rowsAffected: 1 };
              }
              if (query.includes("UPDATE clientes SET estado = 'inactivo' WHERE id = ?")) {
                const id = params[0];
                const client = memoryDb.clientes.find(c => c.id === id);
                if (client) {
                  client.estado = 'inactivo';
                }
                return { rowsAffected: 1 };
              }
              return { rowsAffected: 1 };
            }
            throw new Error(`Unmocked command: ${cmd}`);
          }
        }
      }
    };
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  });

  describe('Parámetros de Inactividad (Ajustes)', () => {
    test('obtiene parámetros por defecto si no existen en BD', async () => {
      const params = await getClientInactivityParams();
      assert.strictEqual(params.mesesNuevo, 3, 'Meses de cortesía por defecto debe ser 3');
      assert.strictEqual(params.diasVencimiento, 30, 'Días de vencimiento por defecto debe ser 30');
    });

    test('guarda y recupera parámetros actualizados', async () => {
      await saveClientInactivityParams({ mesesNuevo: 6, diasVencimiento: 45 });
      const params = await getClientInactivityParams();
      assert.strictEqual(params.mesesNuevo, 6);
      assert.strictEqual(params.diasVencimiento, 45);
    });
  });

  describe('Actualización de Estado de Cliente', () => {
    test('rechaza estados no válidos', async () => {
      await assert.rejects(
        async () => {
          await updateClienteEstado(1, 'estado_invalido');
        },
        /Estado inválido/
      );
    });

    test('bloquea un cliente estableciendo fechas de bloqueo a 6 años', async () => {
      memoryDb.clientes.push({ id: 1, nombre_empresa: 'Empresa Test', estado: 'activo' });
      const now = new Date('2026-09-20T10:00:00Z');
      const bEn = now.toISOString();
      const bHasta = '2032-09-20';

      await updateClienteEstado(1, 'bloqueado', { bloqueado_en: bEn, bloqueado_hasta: bHasta });
      const client = memoryDb.clientes.find(c => c.id === 1);
      assert.strictEqual(client.estado, 'bloqueado');
      assert.strictEqual(client.bloqueado_en, bEn);
      assert.strictEqual(client.bloqueado_hasta, bHasta);
    });

    test('reactiva un cliente limpiando fechas de bloqueo', async () => {
      memoryDb.clientes.push({
        id: 2,
        nombre_empresa: 'Cliente Bloqueado',
        estado: 'bloqueado',
        bloqueado_en: '2026-09-20T10:00:00Z',
        bloqueado_hasta: '2032-09-20'
      });

      await updateClienteEstado(2, 'activo');
      const client = memoryDb.clientes.find(c => c.id === 2);
      assert.strictEqual(client.estado, 'activo');
      assert.strictEqual(client.bloqueado_en, null);
      assert.strictEqual(client.bloqueado_hasta, null);
    });
  });

  describe('Detección y Transición Automática a Inactivo', () => {
    test('cliente nuevo creado hace menos de 3 meses permanece activo', async () => {
      const now = new Date();
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      memoryDb.clientes.push({
        id: 10,
        nombre_empresa: 'Nuevo Cliente Reciente',
        creado_en: oneMonthAgo,
        estado: 'activo'
      });

      const res = await syncClientesEstadoAutomatico();
      assert.strictEqual(res.transitionedCount, 0, 'No debe pasar a inactivo un cliente nuevo reciente');
      assert.strictEqual(memoryDb.clientes[0].estado, 'activo');
    });

    test('cliente nuevo sin contratos creado hace más de 3 meses pasa a inactivo', async () => {
      const now = new Date();
      const fourMonthsAgo = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();

      memoryDb.clientes.push({
        id: 11,
        nombre_empresa: 'Prospecto Desatendido',
        creado_en: fourMonthsAgo,
        estado: 'activo'
      });

      const res = await syncClientesEstadoAutomatico();
      assert.strictEqual(res.transitionedCount, 1, 'Debe transicionar a inactivo');
      assert.strictEqual(memoryDb.clientes[0].estado, 'inactivo');
    });

    test('cliente multi-CUPS con un contrato vigente y otro vencido permanece activo', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const expiredDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      memoryDb.clientes.push({
        id: 12,
        nombre_empresa: 'Empresa Multi CUPS',
        creado_en: '2025-01-01T00:00:00Z',
        estado: 'activo'
      });

      memoryDb.renovaciones.push(
        { id: 101, cliente_id: 12, cups: 'ES0001', fecha_vencimiento: futureDate },
        { id: 102, cliente_id: 12, cups: 'ES0002', fecha_vencimiento: expiredDate }
      );

      const res = await syncClientesEstadoAutomatico();
      assert.strictEqual(res.transitionedCount, 0, 'Cliente multi-CUPS con 1 activo debe seguir activo');
      assert.strictEqual(memoryDb.clientes[0].estado, 'activo');
    });

    test('cliente con todos los CUPS vencidos hace más de 30 días pasa a inactivo', async () => {
      const now = new Date();
      const expiredDate1 = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const expiredDate2 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      memoryDb.clientes.push({
        id: 13,
        nombre_empresa: 'Empresa Vencida',
        creado_en: '2025-01-01T00:00:00Z',
        estado: 'activo'
      });

      memoryDb.renovaciones.push(
        { id: 103, cliente_id: 13, cups: 'ES0003', fecha_vencimiento: expiredDate1 },
        { id: 104, cliente_id: 13, cups: 'ES0004', fecha_vencimiento: expiredDate2 }
      );

      const res = await syncClientesEstadoAutomatico();
      assert.strictEqual(res.transitionedCount, 1, 'Cliente con todos los CUPS vencidos debe pasar a inactivo');
      assert.strictEqual(memoryDb.clientes[0].estado, 'inactivo');
    });

    test('cliente bloqueado por LOPD nunca es modificado por la sincronización automática', async () => {
      memoryDb.clientes.push({
        id: 14,
        nombre_empresa: 'Cliente Bloqueado LOPD',
        creado_en: '2024-01-01T00:00:00Z',
        estado: 'bloqueado',
        bloqueado_en: '2026-01-01T00:00:00Z',
        bloqueado_hasta: '2032-01-01'
      });

      const res = await syncClientesEstadoAutomatico();
      assert.strictEqual(res.transitionedCount, 0);
      assert.strictEqual(memoryDb.clientes[0].estado, 'bloqueado');
    });
  });

  describe('Filtros para Selección y Búsqueda (Comparador)', () => {
    test('getClientesForSelect y searchClientes excluyen inactivos y bloqueados por defecto', async () => {
      memoryDb.clientes = [
        { id: 1, nombre_empresa: 'Empresa Activa', estado: 'activo' },
        { id: 2, nombre_empresa: 'Empresa Inactiva', estado: 'inactivo' },
        { id: 3, nombre_empresa: 'Empresa Bloqueada', estado: 'bloqueado' }
      ];

      const selectList = await getClientesForSelect();
      assert.strictEqual(selectList.length, 1);
      assert.strictEqual(selectList[0].nombre_empresa, 'Empresa Activa');

      const searchList = await searchClientes('Empresa');
      assert.strictEqual(searchList.length, 1);
      assert.strictEqual(searchList[0].nombre_empresa, 'Empresa Activa');
    });
  });

  describe('Certificado Oficial LOPD (src/js/pdf.js)', () => {
    test('generateLopdCertificatePdf genera el documento en memoria e invoca save_pdf', async () => {
      let savedFilename = null;
      let savedBase64 = null;

      // Mock jsPDF
      const mockDoc = {
        setFont: () => {},
        setFontSize: () => {},
        setTextColor: () => {},
        setFillColor: () => {},
        setDrawColor: () => {},
        setLineWidth: () => {},
        rect: () => {},
        roundedRect: () => {},
        line: () => {},
        text: () => {},
        splitTextToSize: (txt) => [txt],
        addImage: () => {},
        output: () => 'data:application/pdf;base64,JVBERi0xLjQK...',
        save: (fn) => { savedFilename = fn; }
      };

      globalThis.window = {
        ...(globalThis.window || {}),
        __TAURI__: {
          core: {
            invoke: async (cmd, args) => {
              if (cmd === 'save_pdf') {
                savedFilename = args.filename;
                savedBase64 = args.base64Data;
                return '/fake/path/' + args.filename;
              }
              return null;
            }
          }
        },
        jspdf: {
          jsPDF: function() { return mockDoc; }
        }
      };

      const cliente = {
        id: 99,
        nombre_empresa: 'Cliente Bloqueado S.L.',
        cif: 'B99887766',
        bloqueado_en: '2026-09-20T00:00:00Z',
        bloqueado_hasta: '2032-09-20'
      };

      const companyConfig = {
        name: 'Asesoría Energética Test',
        cif: 'B12345678',
        email: 'info@test.es',
        phone: '900000000'
      };

      const path = await generateLopdCertificatePdf(cliente, companyConfig);
      assert.ok(path.includes('certificado_bloqueo_lopd_cliente_bloqueado_s_l__b99887766.pdf'));
      assert.strictEqual(savedBase64, 'JVBERi0xLjQK...');
    });
  });
});

