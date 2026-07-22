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
        FOREIGN KEY (tarifa_luz_propuesta_id) REFERENCES tarifas_luz(id) ON DELETE SET NULL,
        FOREIGN KEY (tarifa_gas_propuesta_id) REFERENCES tarifas_gas(id) ON DELETE SET NULL
    );
  `);

  // Migración dinámica para añadir columna 'estado' a la tabla 'comparativas' si no existe
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
  } catch (e) {
    console.error("Error al migrar la tabla comparativas:", e);
  }
}

/**
 * Implementa una base de datos mockizada si el entorno no es Tauri (útil para pruebas básicas en navegador).
 */
function createMockDb() {
  console.warn("Usando base de datos mock local (en memoria/localStorage)");
  const mockStorage = {
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
      if (query.includes("FROM comparativas")) {
        return mockStorage.comparativas;
      }
      if (query.includes("FROM clientes")) {
        return mockStorage.clientes;
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
  if (window.__TAURI__ && window.__TAURI__.sql) {
    return await db.select(`
      SELECT c.*, 
             EXISTS (
               SELECT 1 FROM comparativas comp 
               WHERE comp.cliente_nombre = c.nombre_empresa AND comp.estado = 'Aceptada'
             ) AS tiene_aceptada
      FROM clientes c
      ORDER BY c.nombre_empresa ASC;
    `);
  } else {
    // Modo mock
    const mockClients = await db.select("SELECT * FROM clientes;");
    const mockComps = await db.select("SELECT * FROM comparativas;");
    return mockClients.map(c => {
      const tieneAceptada = mockComps.some(comp => comp.cliente_nombre === c.nombre_empresa && comp.estado === 'Aceptada');
      return {
        ...c,
        tiene_aceptada: tieneAceptada ? 1 : 0
      };
    }).sort((a, b) => a.nombre_empresa.localeCompare(b.nombre_empresa));
  }
}

/**
 * Registra un nuevo cliente en la base de datos.
 * @param {string} nombre - Nombre comercial de la empresa o nombre del particular.
 * @param {string} cif - DNI/CIF fiscal único.
 * @param {string} representante - Nombre del representante o contacto (opcional).
 * @param {string} cups - Código CUPS (opcional).
 * @returns {Promise<Object>} Resultado de la inserción.
 */
export async function addCliente(nombre, cif, representante, cups, email = null) {
  const db = await getDb();
  return await db.execute(
    "INSERT INTO clientes (nombre_empresa, cif, representante, cups, email) VALUES ($1, $2, $3, $4, $5);",
    [nombre, cif, representante, cups, email]
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
 * @returns {Promise<Object>} Resultado de la actualización.
 */
export async function updateCliente(id, nombre, cif, representante, cups, email = null) {
  const db = await getDb();
  return await db.execute(
    "UPDATE clientes SET nombre_empresa = $1, cif = $2, representante = $3, cups = $4, email = $5 WHERE id = $6;",
    [nombre, cif, representante, cups, email, id]
  );
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
  const db = await getDb();
  if (window.__TAURI__) {
    try {
      const columnsInfo = await db.select("PRAGMA table_info(clientes);");
      return columnsInfo
        .filter(col => col.name !== 'id' && col.name !== 'creado_en')
        .map(col => ({
          name: col.name,
          type: col.type,
          notnull: col.notnull === 1,
          label: getHumanLabelForColumn(col.name)
        }));
    } catch (e) {
      console.error("Error al obtener columnas de clientes via PRAGMA:", e);
    }
  }

  // Fallback por defecto si no es Tauri o falla PRAGMA
  return [
    { name: 'nombre_empresa', type: 'TEXT', notnull: true, label: 'Nombre / Empresa *' },
    { name: 'cif', type: 'TEXT', notnull: true, label: 'CIF / DNI / NIF *' },
    { name: 'representante', type: 'TEXT', notnull: false, label: 'Representante' },
    { name: 'cups', type: 'TEXT', notnull: false, label: 'CUPS' },
    { name: 'email', type: 'TEXT', notnull: false, label: 'Email de Contacto' }
  ];
}

function getHumanLabelForColumn(columnName) {
  const labels = {
    nombre_empresa: 'Nombre / Empresa *',
    cif: 'CIF / DNI / NIF *',
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
  const db = await getDb();
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
