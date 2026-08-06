// src/js/db.js

let dbInstance = null;

/**
 * Comprueba el estado de inicialización y desbloqueo de la base de datos cifrada.
 */
export async function checkDbStatus() {
  if (!window.__TAURI__) {
    return { is_initialized: true, is_unlocked: true, needs_migration: false };
  }
  const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);
  return await invoke('db_check_status');
}

function generateMockRecoveryKey() {
  const chars = '2345679ACDEFGHJKMNPQRSTVWXYZ';
  let raw = '';
  for (let i = 0; i < 16; i++) {
    raw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RC-${raw.substring(0, 4)}-${raw.substring(4, 8)}-${raw.substring(8, 12)}-${raw.substring(12, 16)}`;
}

/**
 * Configura por primera vez la Contraseña Maestra y devuelve la Clave de Recuperación.
 */
export async function setupMasterPassword(password) {
  if (!window.__TAURI__) return generateMockRecoveryKey();
  const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);
  return await invoke('db_setup_master_password', { password });
}

/**
 * Desbloquea la base de datos cifrada mediante la Contraseña Maestra.
 */
export async function loginDb(password) {
  if (!window.__TAURI__) return true;
  const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);
  return await invoke('db_login', { password });
}

/**
 * Recupera el acceso a la base de datos con la Clave de Recuperación y establece una nueva contraseña.
 */
export async function recoverDbAccess(recoveryKey, newPassword) {
  if (!window.__TAURI__) return true;
  const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);
  return await invoke('db_recover_access', { recoveryKey, newPassword });
}

/**
 * Cambia la contraseña maestra de la bóveda.
 */
export async function changeMasterPassword(currentPassword, newPassword) {
  if (!window.__TAURI__) return true;
  const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);
  return await invoke('db_change_password', { currentPassword, newPassword });
}

/**
 * Inicializa y obtiene el cliente de base de datos cifrada nativo en Rust.
 * @returns {Promise<any>} Instancia del conector.
 */
export async function getDb() {
  if (dbInstance) return dbInstance;

  if (!window.__TAURI__) {
    console.warn("Tauri no disponible. Ejecutando en modo mock de desarrollo.");
    dbInstance = createMockDb();
    return dbInstance;
  }

  const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);

  dbInstance = {
    async select(query, params = []) {
      return await invoke('db_select', { query, params });
    },
    async execute(query, params = []) {
      return await invoke('db_execute', { query, params });
    }
  };

  return dbInstance;
}

/**
 * Crea las tablas necesarias si no existen.
 * @param {any} db Instancia del plugin de base de datos.
 */
async function initSchema(db) {
  // Habilitar claves foráneas en SQLite
  await db.execute("PRAGMA foreign_keys = ON;");

  // 0. Tabla de Clientes
  await db.execute(`
    CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre_empresa TEXT NOT NULL,
        cif TEXT NOT NULL UNIQUE,
        representante TEXT,
        cups TEXT,
        email TEXT,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 1. Tabla de Comercializadoras
  await db.execute(`
    CREATE TABLE IF NOT EXISTS comercializadoras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Tabla de Tarifas de Luz (Tarifa 2.0TD y 3.0TD)
  // Precios de potencia: €/kW/año. Precios de energía: €/kWh.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tarifas_luz (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comercializadora_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        tipo_tarifa TEXT NOT NULL DEFAULT '2.0TD',
        potencia_p1 REAL NOT NULL,
        potencia_p2 REAL NOT NULL,
        potencia_p3 REAL DEFAULT 0.0,
        potencia_p4 REAL DEFAULT 0.0,
        potencia_p5 REAL DEFAULT 0.0,
        potencia_p6 REAL DEFAULT 0.0,
        energia_p1 REAL NOT NULL,
        energia_p2 REAL NOT NULL,
        energia_p3 REAL NOT NULL,
        energia_p4 REAL DEFAULT 0.0,
        energia_p5 REAL DEFAULT 0.0,
        energia_p6 REAL DEFAULT 0.0,
        excedente REAL DEFAULT 0.0,
        comision_tramos_consumo TEXT,
        comision_tramos_potencia TEXT,
        notas TEXT,
        activo INTEGER DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (comercializadora_id) REFERENCES comercializadoras(id) ON DELETE CASCADE,
        UNIQUE(comercializadora_id, nombre)
    );
  `);

  // Migración dinámica para bases de datos existentes
  try {
    const clientColumns = await db.select("PRAGMA table_info(clientes);");
    const hasEmail = clientColumns.some(c => c.name === 'email');
    if (!hasEmail) {
      await db.execute("ALTER TABLE clientes ADD COLUMN email TEXT;");
      console.log("Migración completada: Columna 'email' añadida a 'clientes'.");
    }
  } catch (err) {
    console.error("Error al migrar la tabla clientes:", err);
  }

  try {
    const columns = await db.select("PRAGMA table_info(tarifas_luz);");
    const hasTipoTarifa = columns.some(c => c.name === 'tipo_tarifa');
    if (!hasTipoTarifa) {
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN tipo_tarifa TEXT NOT NULL DEFAULT '2.0TD';");
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN potencia_p3 REAL DEFAULT 0.0;");
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN potencia_p4 REAL DEFAULT 0.0;");
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN potencia_p5 REAL DEFAULT 0.0;");
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN potencia_p6 REAL DEFAULT 0.0;");
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN energia_p4 REAL DEFAULT 0.0;");
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN energia_p5 REAL DEFAULT 0.0;");
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN energia_p6 REAL DEFAULT 0.0;");
      console.log("Migración de tabla tarifas_luz completada con éxito.");
    }
    const hasCreadoEnLuz = columns.some(c => c.name === 'creado_en');
    if (!hasCreadoEnLuz) {
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP;");
      console.log("Migración creado_en en tarifas_luz completada.");
    }
    const hasExcedente = columns.some(c => c.name === 'excedente');
    if (!hasExcedente) {
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN excedente REAL DEFAULT 0.0;");
      console.log("Migración excedente en tarifas_luz completada.");
    }

    const hasTramosConsumo = columns.some(c => c.name === 'comision_tramos_consumo');
    if (!hasTramosConsumo) {
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN comision_tramos_consumo TEXT;");
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN comision_tramos_potencia TEXT;");
      console.log("Añadidas columnas comision_tramos_consumo y comision_tramos_potencia a tarifas_luz.");

      // Migrar datos de tarifas_luz
      const rows = await db.select("SELECT id, comision, comision_potencia, comision_tramos FROM tarifas_luz;");
      for (const row of rows) {
        let trConsumo = [];
        let trPotencia = [];

        if (row.comision_tramos) {
          try {
            const parsed = JSON.parse(row.comision_tramos);
            if (Array.isArray(parsed)) {
              parsed.forEach(tr => {
                const u = (tr.unidad || 'kW').toLowerCase();
                const limit = tr.tipo === 'hasta' ? tr.hasta : (tr.tipo === 'desde' ? tr.desde : tr.hasta);
                if (u === 'kw' && limit <= 120) {
                  trPotencia.push(tr);
                } else {
                  trConsumo.push(tr);
                }
              });
            }
          } catch (e) {
            console.error("Error al migrar comision_tramos de luz id", row.id, e);
          }
        }

        if (row.comision > 0 && trConsumo.length === 0) {
          trConsumo.push({ tipo: 'desde', desde: 0, unidad: 'kWh', comision: row.comision });
        }

        await db.execute(
          "UPDATE tarifas_luz SET comision_tramos_consumo = $1, comision_tramos_potencia = $2 WHERE id = $3;",
          [
            trConsumo.length > 0 ? JSON.stringify(trConsumo) : null,
            trPotencia.length > 0 ? JSON.stringify(trPotencia) : null,
            row.id
          ]
        );
      }
      console.log("Migración de datos de comisiones en tarifas_luz completada.");

      // Eliminar columnas antiguas
      const hasOldComision = columns.some(c => c.name === 'comision');
      if (hasOldComision) {
        await db.execute("ALTER TABLE tarifas_luz DROP COLUMN comision;");
        await db.execute("ALTER TABLE tarifas_luz DROP COLUMN comision_potencia;");
        await db.execute("ALTER TABLE tarifas_luz DROP COLUMN comision_tramos;");
        console.log("Columnas antiguas de comisión eliminadas de tarifas_luz.");
      }
    }
  } catch (err) {
    console.error("Error al migrar la tabla tarifas_luz:", err);
  }

  // 3. Tabla de Tarifas de Gas (Tarifas RL.1 a RL.6)
  // Término fijo: €/mes. Término variable: €/kWh.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tarifas_gas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comercializadora_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        tipo_tarifa TEXT NOT NULL DEFAULT 'RL.1',
        termino_fijo REAL NOT NULL,
        termino_variable REAL NOT NULL,
        comision_tramos_consumo TEXT,
        notas TEXT,
        activo INTEGER DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (comercializadora_id) REFERENCES comercializadoras(id) ON DELETE CASCADE,
        UNIQUE(comercializadora_id, nombre)
    );
  `);

  // Migración dinámica para tarifas_gas
  try {
    const columns = await db.select("PRAGMA table_info(tarifas_gas);");
    const hasTipoTarifa = columns.some(c => c.name === 'tipo_tarifa');
    if (!hasTipoTarifa) {
      await db.execute("ALTER TABLE tarifas_gas ADD COLUMN tipo_tarifa TEXT NOT NULL DEFAULT 'RL.1';");
      console.log("Migración de tabla tarifas_gas completada con éxito.");
    }
    const hasCreadoEnGas = columns.some(c => c.name === 'creado_en');
    if (!hasCreadoEnGas) {
      await db.execute("ALTER TABLE tarifas_gas ADD COLUMN creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP;");
      console.log("Migración creado_en en tarifas_gas completada.");
    }

    const hasTramosConsumoGas = columns.some(c => c.name === 'comision_tramos_consumo');
    if (!hasTramosConsumoGas) {
      await db.execute("ALTER TABLE tarifas_gas ADD COLUMN comision_tramos_consumo TEXT;");
      console.log("Añadida columna comision_tramos_consumo a tarifas_gas.");

      // Migrar datos de tarifas_gas
      const rows = await db.select("SELECT id, comision, comision_tramos FROM tarifas_gas;");
      for (const row of rows) {
        let trConsumo = [];

        if (row.comision_tramos) {
          try {
            const parsed = JSON.parse(row.comision_tramos);
            if (Array.isArray(parsed)) {
              parsed.forEach(tr => {
                trConsumo.push(tr);
              });
            }
          } catch (e) {
            console.error("Error al migrar comision_tramos de gas id", row.id, e);
          }
        }

        if (row.comision > 0 && trConsumo.length === 0) {
          trConsumo.push({ tipo: 'desde', desde: 0, unidad: 'kWh', comision: row.comision });
        }

        await db.execute(
          "UPDATE tarifas_gas SET comision_tramos_consumo = $1 WHERE id = $2;",
          [
            trConsumo.length > 0 ? JSON.stringify(trConsumo) : null,
            row.id
          ]
        );
      }
      console.log("Migración de datos de comisiones en tarifas_gas completada.");

      // Eliminar columnas antiguas
      const hasOldComisionGas = columns.some(c => c.name === 'comision');
      if (hasOldComisionGas) {
        await db.execute("ALTER TABLE tarifas_gas DROP COLUMN comision;");
        await db.execute("ALTER TABLE tarifas_gas DROP COLUMN comision_tramos;");
        console.log("Columnas antiguas de comisión eliminadas de tarifas_gas.");
      }
    }
  } catch (err) {
    console.error("Error al migrar la tabla tarifas_gas:", err);
  }

  // 4. Tabla de Comparativas (Historial)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS comparativas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_nombre TEXT NOT NULL,
        cliente_cups TEXT,
        tipo_energia TEXT NOT NULL, -- 'LUZ', 'GAS', 'DUAL'
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        datos_cliente_json TEXT NOT NULL,
        comercializadora_luz_propuesta_id INTEGER,
        tarifa_luz_propuesta_id INTEGER,
        ahorro_luz_anual REAL DEFAULT 0.0,
        comercializadora_gas_propuesta_id INTEGER,
        tarifa_gas_propuesta_id INTEGER,
        ahorro_gas_anual REAL DEFAULT 0.0,
        comision_total REAL DEFAULT 0.0,
        estado TEXT NOT NULL DEFAULT 'Pendiente de aceptación',
        estado_cambiado_en TEXT,
        FOREIGN KEY (tarifa_luz_propuesta_id) REFERENCES tarifas_luz(id) ON DELETE SET NULL,
        FOREIGN KEY (tarifa_gas_propuesta_id) REFERENCES tarifas_gas(id) ON DELETE SET NULL
    );
  `);

  // Migración dinámica para añadir columnas a la tabla 'comparativas' si no existen
  try {
    const columns = await db.select("PRAGMA table_info(comparativas);");
    const hasEstado = columns.some(c => c.name === 'estado');
    if (!hasEstado) {
      await db.execute("ALTER TABLE comparativas ADD COLUMN estado TEXT NOT NULL DEFAULT 'Pendiente de aceptación';");
      console.log("Migración completada: Columna 'estado' añadida a 'comparativas'.");
    }
    const hasEstadoCambiadoEn = columns.some(c => c.name === 'estado_cambiado_en');
    if (!hasEstadoCambiadoEn) {
      await db.execute("ALTER TABLE comparativas ADD COLUMN estado_cambiado_en TEXT;");
      console.log("Migración completada: Columna 'estado_cambiado_en' añadida a 'comparativas'.");
    }
    const hasAhorroGas = columns.some(c => c.name === 'ahorro_gas_anual');
    if (!hasAhorroGas) {
      await db.execute("ALTER TABLE comparativas ADD COLUMN ahorro_gas_anual REAL DEFAULT 0.0;");
      console.log("Migración completada: Columna 'ahorro_gas_anual' añadida a 'comparativas'.");
    }
    const hasComisionTotal = columns.some(c => c.name === 'comision_total');
    if (!hasComisionTotal) {
      await db.execute("ALTER TABLE comparativas ADD COLUMN comision_total REAL DEFAULT 0.0;");
      console.log("Migración completada: Columna 'comision_total' añadida a 'comparativas'.");
    }
    const hasEstadoCobro = columns.some(c => c.name === 'estado_cobro');
    if (!hasEstadoCobro) {
      await db.execute("ALTER TABLE comparativas ADD COLUMN estado_cobro TEXT NOT NULL DEFAULT 'Pendiente';");
      console.log("Migración completada: Columna 'estado_cobro' añadida a 'comparativas'.");
    }
    const hasFechaCobro = columns.some(c => c.name === 'fecha_cobro');
    if (!hasFechaCobro) {
      await db.execute("ALTER TABLE comparativas ADD COLUMN fecha_cobro TEXT;");
      console.log("Migración completada: Columna 'fecha_cobro' añadida a 'comparativas'.");
    }
    const hasEstadoContrato = columns.some(c => c.name === 'estado_contrato');
    if (!hasEstadoContrato) {
      await db.execute("ALTER TABLE comparativas ADD COLUMN estado_contrato TEXT NOT NULL DEFAULT 'Pendiente';");
      console.log("Migración completada: Columna 'estado_contrato' añadida a 'comparativas'.");
    }
    const hasMotivoScoring = columns.some(c => c.name === 'motivo_rechazo_scoring');
    if (!hasMotivoScoring) {
      await db.execute("ALTER TABLE comparativas ADD COLUMN motivo_rechazo_scoring TEXT DEFAULT '';");
      console.log("Migración completada: Columna 'motivo_rechazo_scoring' añadida a 'comparativas'.");
    }

    // Crear tabla 'puntos_suministro' si no existe
    await db.execute(`
      CREATE TABLE IF NOT EXISTS puntos_suministro (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        cups TEXT NOT NULL,
        direccion_alias TEXT,
        tipo_energia TEXT DEFAULT 'LUZ',
        notas TEXT,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
      );
    `);

    // Migración automática: Copiar CUPS de 'clientes' a 'puntos_suministro'
    await db.execute(`
      INSERT INTO puntos_suministro (cliente_id, cups, direccion_alias, tipo_energia)
      SELECT c.id, c.cups, 'Principal', 'LUZ'
      FROM clientes c
      WHERE c.cups IS NOT NULL AND c.cups != ''
        AND NOT EXISTS (
            SELECT 1 FROM puntos_suministro ps WHERE ps.cliente_id = c.id AND ps.cups = c.cups
        );
    `);
  } catch (e) {
    console.error("Error al migrar tablas en initSchema:", e);
  }
}

/**
 * Implementa una base de datos mockizada si el entorno no es Tauri (útil para pruebas básicas en navegador).
 */
function createMockDb() {
  const mockStorage = {
    clientes: JSON.parse(localStorage.getItem('mock_clientes') || '[]'),
    comercializadoras: JSON.parse(localStorage.getItem('mock_comercializadoras') || '[]'),
    tarifas_luz: JSON.parse(localStorage.getItem('mock_tarifas_luz') || '[]'),
    tarifas_gas: JSON.parse(localStorage.getItem('mock_tarifas_gas') || '[]'),
    comparativas: JSON.parse(localStorage.getItem('mock_comparativas') || '[]'),
    clientes: JSON.parse(localStorage.getItem('mock_clientes') || '[]')
  };

  // Migración de mockStorage en localStorage para comisiones
  let mockStorageChanged = false;
  
  mockStorage.tarifas_luz.forEach(t => {
    if (t.comision_tramos_consumo === undefined) {
      let trConsumo = [];
      let trPotencia = [];
      
      if (t.comision_tramos) {
        try {
          const parsed = JSON.parse(t.comision_tramos);
          if (Array.isArray(parsed)) {
            parsed.forEach(tr => {
              const u = (tr.unidad || 'kW').toLowerCase();
              const limit = tr.tipo === 'hasta' ? tr.hasta : (tr.tipo === 'desde' ? tr.desde : tr.hasta);
              if (u === 'kw' && limit <= 120) {
                trPotencia.push(tr);
              } else {
                trConsumo.push(tr);
              }
            });
          }
        } catch (e) {}
      }
      
      if (t.comision > 0 && trConsumo.length === 0) {
        trConsumo.push({ tipo: 'desde', desde: 0, unidad: 'kWh', comision: t.comision });
      }
      
      t.comision_tramos_consumo = trConsumo.length > 0 ? JSON.stringify(trConsumo) : null;
      t.comision_tramos_potencia = trPotencia.length > 0 ? JSON.stringify(trPotencia) : null;
      
      delete t.comision;
      delete t.comision_potencia;
      delete t.comision_tramos;
      mockStorageChanged = true;
    }
  });

  mockStorage.tarifas_gas.forEach(t => {
    if (t.comision_tramos_consumo === undefined) {
      let trConsumo = [];
      
      if (t.comision_tramos) {
        try {
          const parsed = JSON.parse(t.comision_tramos);
          if (Array.isArray(parsed)) {
            parsed.forEach(tr => {
              trConsumo.push(tr);
            });
          }
        } catch (e) {}
      }
      
      if (t.comision > 0 && trConsumo.length === 0) {
        trConsumo.push({ tipo: 'desde', desde: 0, unidad: 'kWh', comision: t.comision });
      }
      
      t.comision_tramos_consumo = trConsumo.length > 0 ? JSON.stringify(trConsumo) : null;
      
      delete t.comision;
      delete t.comision_tramos;
      mockStorageChanged = true;
    }
  });

  if (mockStorageChanged) {
    localStorage.setItem('mock_tarifas_luz', JSON.stringify(mockStorage.tarifas_luz));
    localStorage.setItem('mock_tarifas_gas', JSON.stringify(mockStorage.tarifas_gas));
    console.log("Migración de mockStorage en localStorage completada.");
  }

  const save = () => {
    localStorage.setItem('mock_comercializadoras', JSON.stringify(mockStorage.comercializadoras));
    localStorage.setItem('mock_tarifas_luz', JSON.stringify(mockStorage.tarifas_luz));
    localStorage.setItem('mock_tarifas_gas', JSON.stringify(mockStorage.tarifas_gas));
    localStorage.setItem('mock_comparativas', JSON.stringify(mockStorage.comparativas));
    localStorage.setItem('mock_clientes', JSON.stringify(mockStorage.clientes));
  };

  return {
    async execute(query, params = []) {
      console.log("Mock DB Execute:", query, params);
      if (query.includes("INSERT INTO comercializadoras")) {
        const id = mockStorage.comercializadoras.length + 1;
        mockStorage.comercializadoras.push({ id, nombre: params[0], creado_en: new Date().toISOString() });
        save();
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (query.includes("DELETE FROM comercializadoras")) {
        mockStorage.comercializadoras = mockStorage.comercializadoras.filter(c => c.id !== params[0]);
        mockStorage.tarifas_luz = mockStorage.tarifas_luz.filter(t => t.comercializadora_id !== params[0]);
        mockStorage.tarifas_gas = mockStorage.tarifas_gas.filter(t => t.comercializadora_id !== params[0]);
        save();
        return { rowsAffected: 1 };
      }
      if (query.includes("INSERT INTO tarifas_luz")) {
        const id = mockStorage.tarifas_luz.length + 1;
        mockStorage.tarifas_luz.push({
          id,
          comercializadora_id: params[0],
          nombre: params[1],
          tipo_tarifa: params[2],
          potencia_p1: params[3],
          potencia_p2: params[4],
          potencia_p3: params[5],
          potencia_p4: params[6],
          potencia_p5: params[7],
          potencia_p6: params[8],
          energia_p1: params[9],
          energia_p2: params[10],
          energia_p3: params[11],
          energia_p4: params[12],
          energia_p5: params[13],
          energia_p6: params[14],
          excedente: params[15],
          comision_tramos_consumo: params[16],
          comision_tramos_potencia: params[17],
          notas: params[18],
          activo: 1,
          creado_en: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });
        save();
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (query.includes("UPDATE tarifas_luz")) {
        const id = params[18];
        const index = mockStorage.tarifas_luz.findIndex(item => item.id === id);
        if (index !== -1) {
          mockStorage.tarifas_luz[index] = {
            ...mockStorage.tarifas_luz[index],
            nombre: params[0],
            tipo_tarifa: params[1],
            potencia_p1: params[2],
            potencia_p2: params[3],
            potencia_p3: params[4],
            potencia_p4: params[5],
            potencia_p5: params[6],
            potencia_p6: params[7],
            energia_p1: params[8],
            energia_p2: params[9],
            energia_p3: params[10],
            energia_p4: params[11],
            energia_p5: params[12],
            energia_p6: params[13],
            excedente: params[14],
            comision_tramos_consumo: params[15],
            comision_tramos_potencia: params[16],
            notas: params[17]
          };
          save();
        }
        return { rowsAffected: 1 };
      }
      if (query.includes("DELETE FROM tarifas_luz")) {
        mockStorage.tarifas_luz = mockStorage.tarifas_luz.filter(t => t.id !== params[0]);
        save();
        return { rowsAffected: 1 };
      }
      if (query.includes("INSERT INTO tarifas_gas")) {
        const id = mockStorage.tarifas_gas.length + 1;
        mockStorage.tarifas_gas.push({
          id,
          comercializadora_id: params[0],
          nombre: params[1],
          tipo_tarifa: params[2],
          termino_fijo: params[3],
          termino_variable: params[4],
          comision_tramos_consumo: params[5],
          notas: params[6],
          activo: 1,
          creado_en: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });
        save();
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (query.includes("UPDATE tarifas_gas")) {
        const id = params[6];
        const index = mockStorage.tarifas_gas.findIndex(item => item.id === id);
        if (index !== -1) {
          mockStorage.tarifas_gas[index] = {
            ...mockStorage.tarifas_gas[index],
            nombre: params[0],
            tipo_tarifa: params[1],
            termino_fijo: params[2],
            termino_variable: params[3],
            comision_tramos_consumo: params[4],
            notas: params[5]
          };
          save();
        }
        return { rowsAffected: 1 };
      }
      if (query.includes("DELETE FROM tarifas_gas")) {
        mockStorage.tarifas_gas = mockStorage.tarifas_gas.filter(t => t.id !== params[0]);
        save();
        return { rowsAffected: 1 };
      }
      if (query.includes("INSERT INTO comparativas")) {
        const id = mockStorage.comparativas.length + 1;
        mockStorage.comparativas.push({
          id, cliente_nombre: params[0], cliente_cups: params[1], tipo_energia: params[2],
          fecha: new Date().toISOString(), datos_cliente_json: params[3],
          comercializadora_luz_propuesta_id: params[4], tarifa_luz_propuesta_id: params[5], ahorro_luz_anual: params[6],
          comercializadora_gas_propuesta_id: params[7], tarifa_gas_propuesta_id: params[8], ahorro_gas_anual: params[9],
          comision_total: params[10],
          estado: 'Pendiente de aceptación'
        });
        save();
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (query.includes("UPDATE comparativas SET estado")) {
        const nuevoEstado = params[0];
        const estadoCambiadoEn = params[1];
        const id = params[2];
        const index = mockStorage.comparativas.findIndex(c => c.id === id);
        if (index !== -1) {
          mockStorage.comparativas[index].estado = nuevoEstado;
          mockStorage.comparativas[index].estado_cambiado_en = estadoCambiadoEn;
          save();
        }
        return { rowsAffected: 1 };
      }
      if (query.includes("DELETE FROM comparativas")) {
        mockStorage.comparativas = mockStorage.comparativas.filter(c => c.id !== params[0]);
        save();
        return { rowsAffected: 1 };
      }
      if (query.includes("INSERT INTO clientes")) {
        const id = mockStorage.clientes.length + 1;
        mockStorage.clientes.push({
          id,
          nombre_empresa: params[0],
          cif: params[1],
          representante: params[2],
          cups: params[3],
          email: params[4],
          creado_en: new Date().toISOString()
        });
        save();
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (query.includes("UPDATE clientes")) {
        const id = params[5];
        const index = mockStorage.clientes.findIndex(item => item.id === id);
        if (index !== -1) {
          mockStorage.clientes[index] = {
            ...mockStorage.clientes[index],
            nombre_empresa: params[0],
            cif: params[1],
            representante: params[2],
            cups: params[3],
            email: params[4]
          };
          save();
        }
        return { rowsAffected: 1 };
      }
      if (query.includes("DELETE FROM clientes")) {
        mockStorage.clientes = mockStorage.clientes.filter(c => c.id !== params[0]);
        save();
        return { rowsAffected: 1 };
      }
      if (query.includes("INSERT INTO renovaciones")) {
        if (!mockStorage.renovaciones) mockStorage.renovaciones = [];
        const id = mockStorage.renovaciones.length + 1;
        mockStorage.renovaciones.push({
          id,
          cliente_id: params[0],
          tipo_energia: params[1],
          cups: params[2],
          comercializadora_actual: params[3],
          tarifa_actual: params[4],
          fecha_firma: params[5],
          duracion_meses: params[6],
          fecha_vencimiento: params[7],
          notas: params[8],
          estado_renovacion: 'Pendiente',
          creado_en: new Date().toISOString()
        });
        save();
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (query.includes("UPDATE renovaciones")) {
        if (mockStorage.renovaciones) {
          const id = params[1];
          const ren = mockStorage.renovaciones.find(r => r.id === id);
          if (ren) ren.estado_renovacion = params[0];
          save();
        }
        return { rowsAffected: 1 };
      }
      return { lastInsertId: 0, rowsAffected: 0 };
    },
    async select(query, params = []) {
      console.log("Mock DB Select:", query, params);
      if (query.includes("FROM comercializadoras")) {
        return mockStorage.comercializadoras;
      }
      if (query.includes("FROM tarifas_luz")) {
        const rawList = params.length > 0
          ? mockStorage.tarifas_luz.filter(t => t.comercializadora_id === params[0])
          : mockStorage.tarifas_luz;
        return rawList.map(t => ({
          ...t,
          creado_en: t.creado_en || new Date().toISOString().replace('T', ' ').substring(0, 19)
        }));
      }
      if (query.includes("FROM tarifas_gas")) {
        const rawList = params.length > 0
          ? mockStorage.tarifas_gas.filter(t => t.comercializadora_id === params[0])
          : mockStorage.tarifas_gas;
        return rawList.map(t => ({
          ...t,
          creado_en: t.creado_en || new Date().toISOString().replace('T', ' ').substring(0, 19)
        }));
      }
      if (query.includes("FROM renovaciones")) {
        const list = mockStorage.renovaciones || [];
        return list.map(r => {
          const client = (mockStorage.clientes || []).find(c => c.id === r.cliente_id) || {};
          return {
            ...r,
            cliente_nombre: client.nombre_empresa || 'Cliente Mock',
            cliente_cif: client.cif || ''
          };
        });
      }
      if (query.includes("FROM comparativas")) {
        return mockStorage.comparativas;
      }
      if (query.includes("FROM clientes")) {
        let clientsList = (mockStorage.clientes || []).map(c => {
          const agent = (mockStorage.agentes || []).find(a => a.id === c.agente_id);
          return {
            ...c,
            agente_nombre: agent ? agent.nombre : null
          };
        });

        // Manejo de búsqueda en mock DB
        if (query.includes("LIKE") && params && params.length > 0) {
          const rawSearch = (params[0] || '').toString().replace(/%/g, '').toLowerCase();
          if (rawSearch) {
            clientsList = clientsList.filter(c =>
              (c.nombre_empresa && c.nombre_empresa.toLowerCase().includes(rawSearch)) ||
              (c.cif && c.cif.toLowerCase().includes(rawSearch)) ||
              (c.cups && c.cups.toLowerCase().includes(rawSearch))
            );
          }
        }

        if (query.includes("COUNT(*)")) {
          return [{ total: clientsList.length, "COUNT(*)": clientsList.length }];
        }

        // Ordenar alfabéticamente
        clientsList.sort((a, b) => (a.nombre_empresa || '').localeCompare(b.nombre_empresa || ''));

        // Paginación o límite
        if (query.includes("LIMIT")) {
          const limit = params[params.length - 2];
          const offset = params[params.length - 1];
          if (typeof limit === 'number' && typeof offset === 'number') {
            clientsList = clientsList.slice(offset, offset + limit);
          } else if (typeof offset === 'number') {
            clientsList = clientsList.slice(offset);
          } else if (typeof limit === 'number') {
            clientsList = clientsList.slice(0, limit);
          }
        }

        return clientsList;
      }
      return [];
    }
  };
}

// ==========================================
// MÉTODOS DE ABSTRACCIÓN (PREPARADOS Y SEGUROS)
// ==========================================

// --- Comercializadoras ---

/**
 * Obtiene la lista completa de comercializadoras ordenadas alfabéticamente.
 * @returns {Promise<Array<Object>>} Lista de comercializadoras.
 */
export async function getComercializadoras() {
  const db = await getDb();
  return await db.select("SELECT * FROM comercializadoras ORDER BY nombre ASC;");
}

/**
 * Registra una nueva comercializadora en la base de datos.
 * @param {string} nombre - Nombre de la comercializadora.
 * @returns {Promise<Object>} Resultado de la ejecución de la consulta.
 */
export async function addComercializadora(nombre) {
  const db = await getDb();
  return await db.execute("INSERT INTO comercializadoras (nombre) VALUES ($1);", [nombre]);
}

/**
 * Elimina una comercializadora por su identificador.
 * @param {number} id - Identificador de la comercializadora.
 * @returns {Promise<Object>} Resultado de la ejecución de la consulta.
 */
export async function deleteComercializadora(id) {
  const db = await getDb();
  return await db.execute("DELETE FROM comercializadoras WHERE id = $1;", [id]);
}

// --- Tarifas de Luz ---

/**
 * Obtiene la lista de tarifas de luz de una comercializadora específica o todas.
 * @param {number|null} [comercializadoraId=null] - ID de la comercializadora a filtrar (opcional).
 * @returns {Promise<Array<Object>>} Lista de tarifas de luz.
 */
export async function getTarifasLuz(comercializadoraId = null) {
  const db = await getDb();
  if (comercializadoraId) {
    return await db.select(
      "SELECT t.*, c.nombre as comercializadora_nombre FROM tarifas_luz t JOIN comercializadoras c ON t.comercializadora_id = c.id WHERE t.comercializadora_id = $1 ORDER BY t.nombre ASC;",
      [comercializadoraId]
    );
  }
  return await db.select(
    "SELECT t.*, c.nombre as comercializadora_nombre FROM tarifas_luz t JOIN comercializadoras c ON t.comercializadora_id = c.id ORDER BY c.nombre ASC, t.nombre ASC;"
  );
}

/**
 * Registra una nueva tarifa de luz con sus 6 periodos correspondientes.
 * @param {number} comercializadoraId - ID de la comercializadora asociada.
 * @param {string} nombre - Nombre descriptivo de la tarifa.
 * @param {string} tipoTarifa - Tipo de tarifa ('2.0TD' o '3.0TD').
 * @param {number} potenciaP1 - Precio potencia P1 (€/kW/año).
 * @param {number} potenciaP2 - Precio potencia P2 (€/kW/año).
 * @param {number} potenciaP3 - Precio potencia P3 (€/kW/año).
 * @param {number} potenciaP4 - Precio potencia P4 (€/kW/año).
 * @param {number} potenciaP5 - Precio potencia P5 (€/kW/año).
 * @param {number} potenciaP6 - Precio potencia P6 (€/kW/año).
 * @param {number} energiaP1 - Precio energía P1 (€/kWh).
 * @param {number} energiaP2 - Precio energía P2 (€/kWh).
 * @param {number} energiaP3 - Precio energía P3 (€/kWh).
 * @param {number} energiaP4 - Precio energía P4 (€/kWh).
 * @param {number} energiaP5 - Precio energía P5 (€/kWh).
 * @param {number} energiaP6 - Precio energía P6 (€/kWh).
 * @param {number} excedente - Precio compensación excedente (€/kWh).
 * @param {string} comisionTramosConsumo - Cadena JSON con tramos de comisión según consumo.
 * @param {string} comisionTramosPotencia - Cadena JSON con tramos de comisión según potencia.
 * @param {string} notas - Comentarios o notas aclaratorias.
 * @returns {Promise<Object>} Resultado de la inserción.
 */
export async function addTarifaLuz(
  comercializadoraId, nombre, tipoTarifa,
  potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
  energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
  excedente, comisionTramosConsumo, comisionTramosPotencia, notas
) {
  const db = await getDb();
  return await db.execute(
    `INSERT INTO tarifas_luz (
      comercializadora_id, nombre, tipo_tarifa, 
      potencia_p1, potencia_p2, potencia_p3, potencia_p4, potencia_p5, potencia_p6, 
      energia_p1, energia_p2, energia_p3, energia_p4, energia_p5, energia_p6, 
      excedente, comision_tramos_consumo, comision_tramos_potencia, notas
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19);`,
    [
      comercializadoraId, nombre, tipoTarifa,
      potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
      energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
      excedente, comisionTramosConsumo, comisionTramosPotencia, notas
    ]
  );
}

/**
 * Actualiza una tarifa de luz existente.
 * @param {number} id - ID de la tarifa a modificar.
 * @param {string} nombre - Nombre descriptivo de la tarifa.
 * @param {string} tipoTarifa - Tipo de tarifa ('2.0TD' o '3.0TD').
 * @param {number} potenciaP1 - Precio potencia P1 (€/kW/año).
 * @param {number} potenciaP2 - Precio potencia P2 (€/kW/año).
 * @param {number} potenciaP3 - Precio potencia P3 (€/kW/año).
 * @param {number} potenciaP4 - Precio potencia P4 (€/kW/año).
 * @param {number} potenciaP5 - Precio potencia P5 (€/kW/año).
 * @param {number} potenciaP6 - Precio potencia P6 (€/kW/año).
 * @param {number} energiaP1 - Precio energía P1 (€/kWh).
 * @param {number} energiaP2 - Precio energía P2 (€/kWh).
 * @param {number} energiaP3 - Precio energía P3 (€/kWh).
 * @param {number} energiaP4 - Precio energía P4 (€/kWh).
 * @param {number} energiaP5 - Precio energía P5 (€/kWh).
 * @param {number} energiaP6 - Precio energía P6 (€/kWh).
 * @param {number} excedente - Precio compensación excedente (€/kWh).
 * @param {string} comisionTramosConsumo - Cadena JSON con tramos de comisión según consumo.
 * @param {string} comisionTramosPotencia - Cadena JSON con tramos de comisión según potencia.
 * @param {string} notas - Comentarios o notas.
 * @returns {Promise<Object>} Resultado de la actualización.
 */
export async function updateTarifaLuz(
  id, nombre, tipoTarifa,
  potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
  energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
  excedente, comisionTramosConsumo, comisionTramosPotencia, notas
) {
  const db = await getDb();
  return await db.execute(
    `UPDATE tarifas_luz SET 
      nombre = $1, tipo_tarifa = $2, 
      potencia_p1 = $3, potencia_p2 = $4, potencia_p3 = $5, potencia_p4 = $6, potencia_p5 = $7, potencia_p6 = $8, 
      energia_p1 = $9, energia_p2 = $10, energia_p3 = $11, energia_p4 = $12, energia_p5 = $13, energia_p6 = $14, 
      excedente = $15, comision_tramos_consumo = $16, comision_tramos_potencia = $17, notas = $18 
     WHERE id = $19;`,
    [
      nombre, tipoTarifa,
      potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
      energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
      excedente, comisionTramosConsumo, comisionTramosPotencia, notas, id
    ]
  );
}

/**
 * Elimina una tarifa de luz por su ID.
 * @param {number} id - ID de la tarifa a eliminar.
 * @returns {Promise<Object>} Resultado de la eliminación.
 */
export async function deleteTarifaLuz(id) {
  const db = await getDb();
  return await db.execute("DELETE FROM tarifas_luz WHERE id = $1;", [id]);
}

// --- Tarifas de Gas ---

/**
 * Obtiene la lista de tarifas de gas de una comercializadora o todas.
 * @param {number|null} [comercializadoraId=null] - ID de la comercializadora a filtrar (opcional).
 * @returns {Promise<Array<Object>>} Lista de tarifas de gas.
 */
export async function getTarifasGas(comercializadoraId = null) {
  const db = await getDb();
  if (comercializadoraId) {
    return await db.select(
      "SELECT t.*, c.nombre as comercializadora_nombre FROM tarifas_gas t JOIN comercializadoras c ON t.comercializadora_id = c.id WHERE t.comercializadora_id = $1 ORDER BY t.nombre ASC;",
      [comercializadoraId]
    );
  }
  return await db.select(
    "SELECT t.*, c.nombre as comercializadora_nombre FROM tarifas_gas t JOIN comercializadoras c ON t.comercializadora_id = c.id ORDER BY c.nombre ASC, t.nombre ASC;"
  );
}

/**
 * Registra una nueva tarifa de gas (RL.1 a RL.6).
 * @param {number} comercializadoraId - ID de la comercializadora asociada.
 * @param {string} nombre - Nombre de la tarifa.
 * @param {string} tipoTarifa - Peaje de gas ('RL.1' a 'RL.6').
 * @param {number} terminoFijo - Término fijo mensual (€/mes).
 * @param {number} terminoVariable - Término variable (€/kWh).
 * @param {string} comisionTramosConsumo - Cadena JSON con los tramos de comisión.
 * @param {string} notas - Notas o aclaraciones.
 * @returns {Promise<Object>} Resultado de la inserción.
 */
export async function addTarifaGas(comercializadoraId, nombre, tipoTarifa, terminoFijo, terminoVariable, comisionTramosConsumo, notas) {
  const db = await getDb();
  return await db.execute(
    `INSERT INTO tarifas_gas (comercializadora_id, nombre, tipo_tarifa, termino_fijo, termino_variable, comision_tramos_consumo, notas) 
     VALUES ($1, $2, $3, $4, $5, $6, $7);`,
    [comercializadoraId, nombre, tipoTarifa, terminoFijo, terminoVariable, comisionTramosConsumo, notas]
  );
}

/**
 * Actualiza una tarifa de gas existente.
 * @param {number} id - ID de la tarifa a actualizar.
 * @param {string} nombre - Nombre de la tarifa.
 * @param {string} tipoTarifa - Peaje de gas ('RL.1' a 'RL.6').
 * @param {number} terminoFijo - Término fijo mensual (€/mes).
 * @param {number} terminoVariable - Término variable (€/kWh).
 * @param {number} comision - Comisión base (€).
 * @param {string} comisionTramos - Cadena JSON con los tramos.
 * @param {string} notas - Notas.
 * @returns {Promise<Object>} Resultado de la actualización.
 */
export async function updateTarifaGas(id, nombre, tipoTarifa, terminoFijo, terminoVariable, comisionTramosConsumo, notas) {
  const db = await getDb();
  return await db.execute(
    `UPDATE tarifas_gas SET nombre = $1, tipo_tarifa = $2, termino_fijo = $3, termino_variable = $4, comision_tramos_consumo = $5, notas = $6 
     WHERE id = $7;`,
    [nombre, tipoTarifa, terminoFijo, terminoVariable, comisionTramosConsumo, notas, id]
  );
}

/**
 * Elimina una tarifa de gas por su ID.
 * @param {number} id - ID de la tarifa a eliminar.
 * @returns {Promise<Object>} Resultado de la eliminación.
 */
export async function deleteTarifaGas(id) {
  const db = await getDb();
  return await db.execute("DELETE FROM tarifas_gas WHERE id = $1;", [id]);
}

// --- Historial de Comparativas ---

/**
 * Registra una nueva comparación en el historial de clientes.
 * @param {string} clienteNombre - Nombre completo del cliente.
 * @param {string} clienteCups - Código CUPS de suministro (opcional).
 * @param {string} tipoEnergia - Suministro ('LUZ', 'GAS' o 'DUAL').
 * @param {Object} datosClienteJson - Objeto completo con los inputs introducidos.
 * @param {number|null} tarifaLuzPropuestaId - ID de la tarifa de luz recomendada.
 * @param {number} ahorroLuzAnual - Ahorro estimado anual en luz (€).
 * @param {number|null} tarifaGasPropuestaId - ID de la tarifa de gas recomendada.
 * @param {number} ahorroGasAnual - Ahorro estimado anual en gas (€).
 * @param {number} comisionTotal - Comisión total ganada por el consultor (€).
 * @returns {Promise<Object>} Resultado del registro de la comparativa.
 */
export async function addComparativa(clienteNombre, clienteCups, tipoEnergia, datosClienteJson, tarifaLuzPropuestaId, ahorroLuzAnual, tarifaGasPropuestaId, ahorroGasAnual, comisionTotal) {
  const db = await getDb();
  return await db.execute(
    `INSERT INTO comparativas (
      cliente_nombre, cliente_cups, tipo_energia, datos_cliente_json, 
      tarifa_luz_propuesta_id, ahorro_luz_anual, 
      tarifa_gas_propuesta_id, ahorro_gas_anual, 
      comision_total
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
    [
      clienteNombre, clienteCups, tipoEnergia, JSON.stringify(datosClienteJson), 
      tarifaLuzPropuestaId, ahorroLuzAnual, 
      tarifaGasPropuestaId, ahorroGasAnual, 
      comisionTotal
    ]
  );
}

/**
 * Obtiene el listado del historial de comparativas con nombres de comercializadoras y tarifas.
 * @returns {Promise<Array<Object>>} Listado del historial ordenado por fecha descendente.
 */
export async function getComparativas() {
  const db = await getDb();
  if (window.__TAURI__ && window.__TAURI__.sql) {
    return await db.select(`
      SELECT c.*, 
             tl.nombre as tarifa_luz_nombre, cl.nombre as comercializadora_luz_nombre,
             tg.nombre as tarifa_gas_nombre, cg.nombre as comercializadora_gas_nombre,
             cli.email as cliente_email
      FROM comparativas c
      LEFT JOIN tarifas_luz tl ON c.tarifa_luz_propuesta_id = tl.id
      LEFT JOIN comercializadoras cl ON tl.comercializadora_id = cl.id
      LEFT JOIN tarifas_gas tg ON c.tarifa_gas_propuesta_id = tg.id
      LEFT JOIN comercializadoras cg ON tg.comercializadora_id = cg.id
      LEFT JOIN clientes cli ON c.cliente_nombre = cli.nombre_empresa
      ORDER BY c.fecha DESC;
    `);
  } else {
    // Modo mock
    const comps = await db.select("SELECT * FROM comparativas;");
    const clients = await db.select("SELECT * FROM clientes;");
    return comps.map(c => {
      const client = clients.find(cli => cli.nombre_empresa === c.cliente_nombre);
      return {
        ...c,
        cliente_email: client ? client.email : null
      };
    }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }
}

/**
 * Elimina un registro del historial de comparativas por su ID.
 * @param {number} id - ID del registro del historial.
 * @returns {Promise<Object>} Resultado de la eliminación.
 */
export async function deleteComparativa(id) {
  const db = await getDb();
  return await db.execute("DELETE FROM comparativas WHERE id = $1;", [id]);
}

/**
 * Elimina todos los registros de todas las tablas de la base de datos para el Factory Reset.
 */
export async function clearAllTables() {
  const db = await getDb();
  if (window.__TAURI__ && window.__TAURI__.sql) {
    try {
      await db.execute("DELETE FROM comparativas;");
      await db.execute("DELETE FROM clientes;");
      await db.execute("DELETE FROM tarifas_luz;");
      await db.execute("DELETE FROM tarifas_gas;");
      await db.execute("DELETE FROM comercializadoras;");
      // Restablecer los contadores de incremento automático (AUTOINCREMENT) en SQLite
      try {
        await db.execute("DELETE FROM sqlite_sequence;");
      } catch (seqError) {
        console.log("No se pudo limpiar sqlite_sequence, probablemente no existe aún:", seqError);
      }
    } catch (e) {
      console.error("Error al vaciar tablas SQLite:", e);
      throw e;
    }
  } else {
    // Modo mock
    localStorage.removeItem('mock_comercializadoras');
    localStorage.removeItem('mock_tarifas_luz');
    localStorage.removeItem('mock_tarifas_gas');
    localStorage.removeItem('mock_comparativas');
    localStorage.removeItem('mock_clientes');
  }
}

// --- Gestión de Clientes ---

/**
 * Obtiene la lista completa de clientes ordenados alfabéticamente por nombre de empresa/particular.
 * @returns {Promise<Array<Object>>} Lista de clientes.
 */
export async function getClientes() {
  const db = await getDb();
  try {
    const clients = await db.select(`
      SELECT c.*, 
             EXISTS (
               SELECT 1 FROM comparativas comp 
               WHERE comp.cliente_nombre = c.nombre_empresa AND comp.estado = 'Aceptada'
             ) AS tiene_aceptada
      FROM clientes c
      ORDER BY c.nombre_empresa ASC;
    `);
    return Array.isArray(clients) ? clients : [];
  } catch (err) {
    console.error("Error al obtener lista de clientes:", err);
    return [];
  }
}

/**
 * Obtiene una página de clientes ordenados alfabéticamente con recuento total de registros y soporte de filtro.
 * @param {number} page Número de página (1-based).
 * @param {number} pageSize Tamaño de página (por defecto 25).
 * @param {string} search Término opcional de búsqueda (nombre, CIF o CUPS).
 * @returns {Promise<{clients: Array<Object>, totalCount: number, page: number, pageSize: number, totalPages: number}>}
 */
export async function getClientesPaginated(page = 1, pageSize = 25, search = '', agentId = null) {
  const db = await getDb();
  const validPage = Math.max(1, parseInt(page, 10) || 1);
  const validPageSize = Math.max(1, parseInt(pageSize, 10) || 25);
  const offset = (validPage - 1) * validPageSize;
  const cleanSearch = (search || '').trim();

  try {
    let whereClauses = [];
    let params = [];

    if (cleanSearch.length > 0) {
      whereClauses.push(`(c.nombre_empresa LIKE ? OR c.cif LIKE ? OR c.cups LIKE ?)`);
      const pattern = `%${cleanSearch}%`;
      params.push(pattern, pattern, pattern);
    }

    if (agentId !== null && agentId !== '' && !isNaN(parseInt(agentId, 10))) {
      whereClauses.push(`c.agente_id = ?`);
      params.push(parseInt(agentId, 10));
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 1. Obtener recuento total
    const countSql = `SELECT COUNT(*) AS total FROM clientes c ${whereClause};`;
    const countRes = await db.select(countSql, params);
    let totalCount = 0;
    if (Array.isArray(countRes) && countRes.length > 0) {
      totalCount = parseInt(countRes[0].total || countRes[0]['COUNT(*)'] || 0, 10) || 0;
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / validPageSize));

    // 2. Obtener registros paginados incluyendo el nombre del agente comercial
    const selectSql = `
      SELECT c.*, a.nombre AS agente_nombre,
             EXISTS (
               SELECT 1 FROM comparativas comp 
               WHERE comp.cliente_nombre = c.nombre_empresa AND comp.estado = 'Aceptada'
             ) AS tiene_aceptada
      FROM clientes c
      LEFT JOIN agentes a ON c.agente_id = a.id
      ${whereClause}
      ORDER BY c.nombre_empresa ASC
      LIMIT ? OFFSET ?;
    `;
    const queryParams = [...params, validPageSize, offset];
    const clients = await db.select(selectSql, queryParams);

    return {
      clients: Array.isArray(clients) ? clients : [],
      totalCount,
      page: validPage,
      pageSize: validPageSize,
      totalPages
    };
  } catch (err) {
    console.error("Error al obtener clientes paginados:", err);
    return {
      clients: [],
      totalCount: 0,
      page: validPage,
      pageSize: validPageSize,
      totalPages: 1
    };
  }
}

/**
 * Obtiene los primeros N clientes para selectores desplegables sin sobrecargar la memoria del DOM.
 * @param {number} limit Número máximo de clientes a recuperar.
 */
export async function getClientesForSelect(limit = 100) {
  const db = await getDb();
  try {
    const clients = await db.select(`
      SELECT id, nombre_empresa, cif, cups
      FROM clientes
      ORDER BY nombre_empresa ASC
      LIMIT ?;
    `, [limit]);
    return Array.isArray(clients) ? clients : [];
  } catch (err) {
    console.error("Error al obtener clientes para selector:", err);
    return [];
  }
}

/**
 * Busca clientes por nombre, CIF o CUPS con un límite estricto para evitar bloqueos del DOM.
 * @param {string} term Término de búsqueda.
 * @param {number} limit Límite máximo de resultados.
 */
export async function searchClientes(term, limit = 50) {
  const db = await getDb();
  if (!term || term.trim().length === 0) {
    return await getClientesForSelect(limit);
  }
  try {
    const pattern = `%${term.trim()}%`;
    const clients = await db.select(`
      SELECT id, nombre_empresa, cif, cups
      FROM clientes
      WHERE nombre_empresa LIKE ? OR cif LIKE ? OR cups LIKE ?
      ORDER BY nombre_empresa ASC
      LIMIT ?;
    `, [pattern, pattern, pattern, limit]);
    return Array.isArray(clients) ? clients : [];
  } catch (err) {
    console.error("Error al buscar clientes:", err);
    return [];
  }
}

/**
 * Registra un nuevo cliente en la base de datos.
 * @param {string} nombre - Nombre comercial de la empresa o nombre del particular.
 * @param {string} cif - DNI/CIF fiscal único.
 * @param {string} representante - Nombre del representante o contacto (opcional).
 * @param {string} cups - Código CUPS (opcional).
 * @param {string} email - Correo electrónico de contacto (opcional).
 * @param {number|null} agenteId - ID del agente comercial asignado.
 * @returns {Promise<Object>} Resultado de la inserción.
 */
export async function addCliente(nombre, cif, representante, cups, email = null, agenteId = null) {
  const db = await getDb();
  return await db.execute(
    "INSERT INTO clientes (nombre_empresa, cif, representante, cups, email, agente_id) VALUES ($1, $2, $3, $4, $5, $6);",
    [nombre, cif, representante, cups, email, agenteId]
  );
}

/**
 * Actualiza los datos de un cliente existente.
 * @param {number} id - Identificador único del cliente.
 * @param {string} nombre - Nombre comercial o particular.
 * @param {string} cif - DNI/CIF fiscal.
 * @param {string} representante - Nombre del representante (opcional).
 * @param {string} cups - Código CUPS (opcional).
 * @param {string} email - Correo electrónico de contacto (opcional).
 * @param {number|null} agenteId - ID del agente comercial asignado.
 * @returns {Promise<Object>} Resultado de la actualización.
 */
export async function updateCliente(id, nombre, cif, representante, cups, email = null, agenteId = null) {
  const db = await getDb();
  return await db.execute(
    "UPDATE clientes SET nombre_empresa = $1, cif = $2, representante = $3, cups = $4, email = $5, agente_id = $6 WHERE id = $7;",
    [nombre, cif, representante, cups, email, agenteId, id]
  );
}

// --- Gestión de Agentes / Comerciales ---

/**
 * Obtiene la lista completa de agentes con el recuento de clientes asociados.
 * @param {boolean} onlyActive Si es true, retorna sólo los agentes activos.
 * @returns {Promise<Array<Object>>} Lista de agentes.
 */
export async function getAgentes(onlyActive = false) {
  const db = await getDb();
  try {
    const where = onlyActive ? "WHERE a.activo = 1" : "";
    const agents = await db.select(`
      SELECT a.*, 
             (SELECT COUNT(*) FROM clientes c WHERE c.agente_id = a.id) AS num_clientes
      FROM agentes a
      ${where}
      ORDER BY a.nombre ASC;
    `);
    return Array.isArray(agents) ? agents : [];
  } catch (err) {
    console.error("Error al obtener lista de agentes:", err);
    return [];
  }
}

/**
 * Registra un nuevo agente/comercial.
 * @param {string} nombre Nombre y apellidos del agente.
 * @param {string|null} telefono Teléfono de contacto.
 * @param {string|null} email Email de contacto.
 */
export async function addAgente(nombre, telefono = null, email = null) {
  const db = await getDb();
  return await db.execute(
    "INSERT INTO agentes (nombre, telefono, email, activo) VALUES ($1, $2, $3, 1);",
    [nombre, telefono, email]
  );
}

/**
 * Actualiza la información de un agente existente.
 */
export async function updateAgente(id, nombre, telefono = null, email = null) {
  const db = await getDb();
  return await db.execute(
    "UPDATE agentes SET nombre = $1, telefono = $2, email = $3 WHERE id = $4;",
    [nombre, telefono, email, id]
  );
}

/**
 * Cambia el estado activo/inactivo de un agente.
 */
export async function toggleAgenteEstado(id, activo) {
  const db = await getDb();
  return await db.execute(
    "UPDATE agentes SET activo = $1 WHERE id = $2;",
    [activo ? 1 : 0, id]
  );
}

/**
 * Reasigna en lote todos los clientes de un agente a otro agente de destino.
 */
export async function reassignAgenteClientes(oldAgentId, newAgentId) {
  const db = await getDb();
  if (oldAgentId === null || oldAgentId === undefined || oldAgentId === '') {
    return await db.execute(
      "UPDATE clientes SET agente_id = $1 WHERE agente_id IS NULL;",
      [newAgentId]
    );
  }
  return await db.execute(
    "UPDATE clientes SET agente_id = $1 WHERE agente_id = $2 OR agente_id IS NULL;",
    [newAgentId, oldAgentId]
  );
}

/**
 * Elimina un agente si no tiene clientes asignados.
 */
export async function deleteAgente(id) {
  const db = await getDb();
  const countRes = await db.select("SELECT COUNT(*) AS total FROM clientes WHERE agente_id = $1;", [id]);
  const total = countRes && countRes[0] ? (countRes[0].total || countRes[0]['COUNT(*)'] || 0) : 0;
  if (total > 0) {
    throw new Error(`TIENE_CLIENTES_ASIGNADOS:${total}`);
  }
  return await db.execute("DELETE FROM agentes WHERE id = $1;", [id]);
}

/**
 * Comprueba el estado de configuración de agentes para la migración asistida del Agente Principal.
 */
export async function checkAgenteSetupStatus() {
  const db = await getDb();
  try {
    const agents = await db.select("SELECT id, nombre FROM agentes WHERE activo = 1 ORDER BY id ASC;");
    const countAgents = Array.isArray(agents) ? agents.length : 0;
    
    const unassignedRes = await db.select("SELECT COUNT(*) AS total FROM clientes WHERE agente_id IS NULL;");
    const unassignedCount = unassignedRes && unassignedRes[0] ? (unassignedRes[0].total || unassignedRes[0]['COUNT(*)'] || 0) : 0;

    return {
      hasAgents: countAgents > 0,
      agents: Array.isArray(agents) ? agents : [],
      unassignedCount
    };
  } catch (err) {
    console.error("Error al comprobar estado de agentes:", err);
    return { hasAgents: false, agents: [], unassignedCount: 0 };
  }
}

export async function deleteCliente(id) {
  const db = await getDb();
  if (window.__TAURI__ && window.__TAURI__.sql) {
    // 1. Obtener el nombre del cliente
    const clientRows = await db.select("SELECT nombre_empresa FROM clientes WHERE id = $1;", [id]);
    if (clientRows.length === 0) {
      throw new Error("Cliente no encontrado.");
    }
    const nombre = clientRows[0].nombre_empresa;

    // 2. Comprobar si tiene comparativas aceptadas (menos de 6 años)
    const comps = await db.select(`
      SELECT COUNT(*) as count FROM comparativas 
      WHERE cliente_nombre = $1 AND estado = 'Aceptada' 
        AND fecha >= datetime('now', '-6 years');
    `, [nombre]);
    
    const count = comps.length > 0 ? (comps[0].count || 0) : 0;
    if (count > 0) {
      throw new Error("OBLIGACION_LEGAL_RETENCION");
    }

    // 3. Eliminar comparativas pendientes o rechazadas asociadas
    await db.execute(`
      DELETE FROM comparativas 
      WHERE cliente_nombre = $1 AND (estado != 'Aceptada' OR estado IS NULL);
    `, [nombre]);

    // 4. Eliminar el cliente
    return await db.execute("DELETE FROM clientes WHERE id = $1;", [id]);
  } else {
    // Modo mock
    const mockClients = await db.select("SELECT * FROM clientes;");
    const client = mockClients.find(c => c.id === id);
    if (!client) {
      throw new Error("Cliente no encontrado.");
    }
    const nombre = client.nombre_empresa;

    const mockComps = await db.select("SELECT * FROM comparativas;");
    
    // Comprobar si tiene comparativas aceptadas (menos de 6 años)
    const legalAcceptedCutoff = Date.now() - (6 * 365 * 24 * 60 * 60 * 1000);
    const hasAccepted = mockComps.some(c => 
      c.cliente_nombre === nombre && 
      c.estado === 'Aceptada' && 
      new Date(c.fecha).getTime() >= legalAcceptedCutoff
    );

    if (hasAccepted) {
      throw new Error("OBLIGACION_LEGAL_RETENCION");
    }

    // Limpiar comparativas asociadas pendientes o rechazadas en localStorage
    const filteredComps = mockComps.filter(c => 
      !(c.cliente_nombre === nombre && (c.estado !== 'Aceptada' || c.estado === null))
    );
    localStorage.setItem('mock_comparativas', JSON.stringify(filteredComps));

    // Eliminar el cliente de localStorage usando db.execute de mock
    return await db.execute("DELETE FROM clientes WHERE id = $1;", [id]);
  }
}

/**
 * Actualiza el estado de aceptación de una comparativa.
 * @param {number} id - ID de la comparativa.
 * @param {string} nuevoEstado - 'Pendiente de aceptación', 'Aceptada' o 'Rechazada'.
 * @returns {Promise<Object>} Resultado de la actualización.
 */
export async function updateComparativaEstado(id, nuevoEstado) {
  const db = await getDb();
  const cambiadoEn = (nuevoEstado === 'Pendiente de aceptación') ? null : new Date().toISOString();
  return await db.execute(
    "UPDATE comparativas SET estado = $1, estado_cambiado_en = $2 WHERE id = $3;",
    [nuevoEstado, cambiadoEn, id]
  );
}

/**
 * Actualiza el estado de tramitación del contrato de una comparativa y el motivo de rechazo por scoring si aplica.
 * @param {number} id - ID de la comparativa.
 * @param {string} estadoContrato - 'Pendiente', 'En trámite', 'Firmado y Activado' o 'Rechazado por Scoring'.
 * @param {string} [motivoRechazoScoring=''] - Motivo opcional del rechazo por scoring.
 * @returns {Promise<Object>} Resultado de la actualización.
 */
export async function updateComparativaContrato(id, estadoContrato, motivoRechazoScoring = '') {
  const db = await getDb();
  return await db.execute(
    "UPDATE comparativas SET estado_contrato = $1, motivo_rechazo_scoring = $2 WHERE id = $3;",
    [estadoContrato, motivoRechazoScoring || '', id]
  );
}

/**
 * Obtiene todos los puntos de suministro registrados para un cliente específico.
 * @param {number} clienteId - ID del cliente.
 * @returns {Promise<Array<Object>>} Listado de puntos de suministro.
 */
export async function getPuntosSuministroByCliente(clienteId) {
  const db = await getDb();
  if (window.__TAURI__ && window.__TAURI__.sql) {
    return await db.select(
      "SELECT * FROM puntos_suministro WHERE cliente_id = $1 ORDER BY id ASC;",
      [clienteId]
    );
  } else {
    const mockPuntos = JSON.parse(localStorage.getItem('mock_puntos_suministro') || '[]');
    return mockPuntos.filter(p => p.cliente_id === clienteId);
  }
}

/**
 * Obtiene todos los puntos de suministro registrados en el sistema.
 * @returns {Promise<Array<Object>>} Listado completo de puntos de suministro.
 */
export async function getPuntosSuministroAll() {
  const db = await getDb();
  if (window.__TAURI__ && window.__TAURI__.sql) {
    return await db.select("SELECT ps.*, c.nombre_empresa as cliente_nombre FROM puntos_suministro ps JOIN clientes c ON ps.cliente_id = c.id ORDER BY ps.id ASC;");
  } else {
    return JSON.parse(localStorage.getItem('mock_puntos_suministro') || '[]');
  }
}

/**
 * Registra o sincroniza la lista completa de puntos de suministro para un cliente.
 * @param {number} clienteId - ID del cliente.
 * @param {Array<Object>} puntosArray - Lista de objetos { cups, direccionAlias, tipoEnergia, notas }.
 */
export async function syncPuntosSuministroCliente(clienteId, puntosArray) {
  const db = await getDb();
  if (window.__TAURI__ && window.__TAURI__.sql) {
    // 1. Eliminar puntos actuales del cliente
    await db.execute("DELETE FROM puntos_suministro WHERE cliente_id = $1;", [clienteId]);

    // 2. Insertar los puntos actualizados
    for (const p of puntosArray) {
      if (p.cups && p.cups.trim() !== '') {
        await db.execute(
          `INSERT INTO puntos_suministro (cliente_id, cups, direccion_alias, tipo_energia, notas)
           VALUES ($1, $2, $3, $4, $5);`,
          [clienteId, p.cups.trim().toUpperCase(), p.direccionAlias || 'Principal', p.tipoEnergia || 'LUZ', p.notas || '']
        );
      }
    }
  } else {
    let mockPuntos = JSON.parse(localStorage.getItem('mock_puntos_suministro') || '[]');
    mockPuntos = mockPuntos.filter(p => p.cliente_id !== clienteId);
    
    puntosArray.forEach((p, idx) => {
      if (p.cups && p.cups.trim() !== '') {
        mockPuntos.push({
          id: Date.now() + idx,
          cliente_id: clienteId,
          cups: p.cups.trim().toUpperCase(),
          direccion_alias: p.direccionAlias || 'Principal',
          tipo_energia: p.tipoEnergia || 'LUZ',
          notas: p.notas || ''
        });
      }
    });
    localStorage.setItem('mock_puntos_suministro', JSON.stringify(mockPuntos));
  }
}

/**
 * Actualiza el estado de cobro de una comparativa.
 * @param {number} id - ID de la comparativa.
 * @param {string} estadoCobro - 'Pendiente' o 'Cobrado'.
 * @param {string|null} fechaCobro - Fecha de cobro (YYYY-MM-DD o ISO string).
 * @returns {Promise<Object>} Resultado de la actualización.
 */
export async function updateComparativaCobro(id, estadoCobro, fechaCobro = null) {
  const db = await getDb();
  return await db.execute(
    "UPDATE comparativas SET estado_cobro = $1, fecha_cobro = $2 WHERE id = $3;",
    [estadoCobro, fechaCobro, id]
  );
}

/**
 * Ejecuta una autopurga de comparaciones y clientes antiguos conforme a la ley de retención.
 * @param {number} days - Número máximo de días de conservación de los datos.
 */
export async function purgeOldData(days) {
  const db = await getDb();
  if (window.__TAURI__ && window.__TAURI__.sql) {
    try {
      // 1. Eliminar comparativas pendientes o rechazadas antiguas (más de 365 días)
      await db.execute(`
        DELETE FROM comparativas 
        WHERE (estado = 'Pendiente de aceptación' OR estado = 'Rechazada' OR estado IS NULL) 
          AND fecha < datetime('now', '-365 days');
      `);
      
      // 2. Eliminar comparativas aceptadas antiguas (más de 6 años)
      await db.execute(`
        DELETE FROM comparativas 
        WHERE estado = 'Aceptada' 
          AND fecha < datetime('now', '-6 years');
      `);
      
      // 3. Eliminar clientes antiguos (más de 365 días) que no posean ninguna comparativa en el sistema
      await db.execute(`
        DELETE FROM clientes 
        WHERE creado_en < datetime('now', '-365 days') 
          AND nombre_empresa NOT IN (SELECT DISTINCT cliente_nombre FROM comparativas);
      `);
      
      console.log("Purga automática de datos completada (plazos legales fijos aplicados).");
    } catch (e) {
      console.error("Error al ejecutar purga automática SQLite:", e);
    }
  } else {
    // Purga en modo mock
    try {
      const retentionCutoff = Date.now() - (365 * 24 * 60 * 60 * 1000); // 365 días
      const legalAcceptedCutoff = Date.now() - (6 * 365 * 24 * 60 * 60 * 1000); // 6 años
      
      const mockComps = JSON.parse(localStorage.getItem('mock_comparativas') || '[]');
      
      // Filtrar comparativas por su estado y antigüedad correspondiente
      const filteredComps = mockComps.filter(c => {
        const estado = c.estado || 'Pendiente de aceptación';
        const dateMs = new Date(c.fecha).getTime();
        if (estado === 'Aceptada') {
          return dateMs >= legalAcceptedCutoff;
        } else {
          return dateMs >= retentionCutoff;
        }
      });
      localStorage.setItem('mock_comparativas', JSON.stringify(filteredComps));

      const mockClients = JSON.parse(localStorage.getItem('mock_clientes') || '[]');
      const filteredClients = mockClients.filter(c => {
        const isOld = new Date(c.creado_en).getTime() < retentionCutoff;
        if (isOld) {
          const hasComps = filteredComps.some(comp => comp.cliente_nombre === c.nombre_empresa);
          return hasComps;
        }
        return true;
      });
      localStorage.setItem('mock_clientes', JSON.stringify(filteredClients));
      console.log("Purga automática en modo mock completada (plazos legales fijos aplicados).");
    } catch (e) {
      console.error("Error al ejecutar purga automática en mock:", e);
    }
  }
}

/**
 * Obtiene la versión actual del motor SQLite.
 * @returns {Promise<string>} Versión de SQLite.
 */
export async function getSqliteVersion() {
  const db = await getDb();
  if (window.__TAURI__ && window.__TAURI__.sql) {
    try {
      const res = await db.select("SELECT sqlite_version() as version;");
      return res[0].version;
    } catch (err) {
      console.error(err);
      return "Desconocida";
    }
  } else {
    return "3.45.0 (Simulado)";
  }
}

/**
 * Obtiene las columnas actuales de la tabla clientes directamente desde SQLite.
 * Garantiza compatibilidad dinámica si en el futuro se añaden nuevas columnas.
 */
export async function getClientesSchemaColumns() {
  const baseCols = [
    { name: 'nombre_empresa', type: 'TEXT', notnull: true, label: 'Nombre / Empresa *' },
    { name: 'cif', type: 'TEXT', notnull: true, label: 'CIF / DNI / NIF *' },
    { name: 'agente_nombre', type: 'TEXT', notnull: false, label: 'Agente / Comercial' },
    { name: 'representante', type: 'TEXT', notnull: false, label: 'Representante' },
    { name: 'cups', type: 'TEXT', notnull: false, label: 'CUPS' },
    { name: 'email', type: 'TEXT', notnull: false, label: 'Email de Contacto' },
    { name: 'fecha_firma', type: 'TEXT', notnull: false, label: 'Fecha Firma Contrato (Opcional - Renovación)' },
    { name: 'fecha_vencimiento', type: 'TEXT', notnull: false, label: 'Fecha Vencimiento Contrato (Opcional - Renovación)' }
  ];
  return baseCols;
}

function getHumanLabelForColumn(columnName) {
  const labels = {
    nombre_empresa: 'Nombre / Empresa *',
    cif: 'CIF / DNI / NIF *',
    agente_nombre: 'Agente / Comercial',
    representante: 'Representante',
    cups: 'CUPS',
    email: 'Email de Contacto'
  };
  if (labels[columnName]) return labels[columnName];

  return columnName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Importa o actualiza una lista de clientes en la base de datos.
 * @param {Array<Object>} rows Objetos con propiedades correspondientes a las columnas de SQLite.
 * @param {boolean} updateExisting Si es true, actualiza los campos si el CIF ya existe; si es false, los omite.
 */
export async function importClientesBatch(rows, updateExisting = false) {
  // Pre-procesar mapeo de agente_nombre a agente_id
  const agentsList = await getAgentes(false);
  const agentMap = new Map();
  agentsList.forEach(a => agentMap.set(a.nombre.toLowerCase().trim(), a.id));

  let defaultAgentId = agentsList.find(a => a.activo === 1)?.id || null;

  for (const row of rows) {
    if (row.agente_nombre && typeof row.agente_nombre === 'string' && row.agente_nombre.trim().length > 0) {
      const cleanAgentName = row.agente_nombre.trim();
      const key = cleanAgentName.toLowerCase();
      if (agentMap.has(key)) {
        row.agente_id = agentMap.get(key);
      } else {
        // Crear agente automáticamente si no existe en el catálogo
        try {
          const res = await addAgente(cleanAgentName);
          const newId = res && res.lastInsertId ? res.lastInsertId : null;
          if (newId) {
            agentMap.set(key, newId);
            row.agente_id = newId;
            if (!defaultAgentId) defaultAgentId = newId;
          }
        } catch (e) {
          console.error("Error al crear agente automático durante importación:", e);
        }
      }
    }
    
    if (!row.agente_id && defaultAgentId) {
      row.agente_id = defaultAgentId;
    }
  }

  if (window.__TAURI__) {
    const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);
    const [added, updated, skipped] = await invoke('db_import_clientes_batch', { rows, updateExisting });
    return { added, updated, skipped, errors: [] };
  }

  // Fallback Mock DB (desarrollo sin Tauri)
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const { nombre_empresa, cif, ...otherFields } = row;

    if (!nombre_empresa || !cif) {
      skipped++;
      errors.push(`Fila ${i + 1}: Faltan campos obligatorios (Nombre o CIF).`);
      continue;
    }

    try {
      if (window.__TAURI__) {
        const existing = await db.select("SELECT id FROM clientes WHERE cif = ?;", [cif.trim()]);
        if (existing.length > 0) {
          if (updateExisting) {
            const fieldsToUpdate = [];
            const params = [];
            fieldsToUpdate.push("nombre_empresa = ?");
            params.push(nombre_empresa.trim());

            for (const [key, val] of Object.entries(otherFields)) {
              if (val !== undefined && val !== null && val !== '') {
                fieldsToUpdate.push(`${key} = ?`);
                params.push(typeof val === 'string' ? val.trim() : val);
              }
            }
            params.push(existing[0].id);

            const query = `UPDATE clientes SET ${fieldsToUpdate.join(', ')} WHERE id = ?;`;
            await db.execute(query, params);
            updated++;
          } else {
            skipped++;
          }
        } else {
          const keys = ['nombre_empresa', 'cif'];
          const values = [nombre_empresa.trim(), cif.trim()];
          const placeholders = ['?', '?'];

          for (const [key, val] of Object.entries(otherFields)) {
            if (val !== undefined && val !== null && val !== '') {
              keys.push(key);
              values.push(typeof val === 'string' ? val.trim() : val);
              placeholders.push('?');
            }
          }

          const query = `INSERT INTO clientes (${keys.join(', ')}) VALUES (${placeholders.join(', ')});`;
          await db.execute(query, values);
          added++;
        }
      } else {
        const mockClients = JSON.parse(localStorage.getItem('mock_clientes') || '[]');
        const existingIndex = mockClients.findIndex(c => c.cif === cif.trim());
        if (existingIndex !== -1) {
          if (updateExisting) {
            mockClients[existingIndex] = { ...mockClients[existingIndex], nombre_empresa: nombre_empresa.trim(), ...otherFields };
            updated++;
          } else {
            skipped++;
          }
        } else {
          mockClients.push({ id: mockClients.length + 1, nombre_empresa: nombre_empresa.trim(), cif: cif.trim(), ...otherFields, creado_en: new Date().toISOString() });
          added++;
        }
        localStorage.setItem('mock_clientes', JSON.stringify(mockClients));
      }
    } catch (err) {
      skipped++;
      errors.push(`Fila ${i + 1} (${cif}): ${err.message || err}`);
    }
  }

  return { added, updated, skipped, errors };
}

/**
 * Importa en lote renovaciones asociadas a clientes.
 * @param {Array<Object>} rows Arreglo de objetos con datos de renovación.
 * @returns {Promise<number>} Número de renovaciones insertadas.
 */
export async function importRenovacionesBatch(rows) {
  if (!rows || rows.length === 0) return 0;

  if (window.__TAURI__) {
    const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);
    return await invoke('db_import_renovaciones_batch', { rows });
  }

  let count = 0;
  if (!mockStorage.renovaciones) mockStorage.renovaciones = [];

  for (const r of rows) {
    mockStorage.renovaciones.push({
      id: mockStorage.renovaciones.length + 1,
      ...r,
      creado_en: new Date().toISOString()
    });
    count++;
  }
  return count;
}
