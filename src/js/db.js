// src/js/db.js

let dbInstance = null;

/**
 * Inicializa la base de datos y crea el esquema si no existe.
 * @returns {Promise<any>} Instancia de la base de datos.
 */
export async function getDb() {
  if (dbInstance) return dbInstance;

  if (!window.__TAURI__ || !window.__TAURI__.sql) {
    console.error("Tauri SQL plugin no disponible. Ejecutando en modo mock de desarrollo.");
    // Mock para desarrollo/pruebas fuera de Tauri si es necesario
    return createMockDb();
  }

  try {
    const Database = window.__TAURI__.sql;
    // Carga de la base de datos SQLite local
    dbInstance = await Database.load('sqlite:comparetica.db');
    await initSchema(dbInstance);
    return dbInstance;
  } catch (error) {
    console.error("Error al cargar la base de datos:", error);
    throw error;
  }
}

/**
 * Crea las tablas necesarias si no existen.
 * @param {any} db Instancia del plugin de base de datos.
 */
async function initSchema(db) {
  // Habilitar claves foráneas en SQLite
  await db.execute("PRAGMA foreign_keys = ON;");

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
        comision REAL NOT NULL DEFAULT 0.0,
        comision_tramos TEXT,
        notas TEXT,
        activo INTEGER DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (comercializadora_id) REFERENCES comercializadoras(id) ON DELETE CASCADE,
        UNIQUE(comercializadora_id, nombre)
    );
  `);

  // Migración dinámica para bases de datos existentes
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
    const hasComisionTramos = columns.some(c => c.name === 'comision_tramos');
    if (!hasComisionTramos) {
      await db.execute("ALTER TABLE tarifas_luz ADD COLUMN comision_tramos TEXT;");
      console.log("Migración comision_tramos en tarifas_luz completada.");
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
        comision REAL NOT NULL DEFAULT 0.0,
        comision_tramos TEXT,
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
    const hasComisionTramosGas = columns.some(c => c.name === 'comision_tramos');
    if (!hasComisionTramosGas) {
      await db.execute("ALTER TABLE tarifas_gas ADD COLUMN comision_tramos TEXT;");
      console.log("Migración comision_tramos en tarifas_gas completada.");
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
        FOREIGN KEY (tarifa_luz_propuesta_id) REFERENCES tarifas_luz(id) ON DELETE SET NULL,
        FOREIGN KEY (tarifa_gas_propuesta_id) REFERENCES tarifas_gas(id) ON DELETE SET NULL
    );
  `);
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
    comparativas: JSON.parse(localStorage.getItem('mock_comparativas') || '[]')
  };

  const save = () => {
    localStorage.setItem('mock_comercializadoras', JSON.stringify(mockStorage.comercializadoras));
    localStorage.setItem('mock_tarifas_luz', JSON.stringify(mockStorage.tarifas_luz));
    localStorage.setItem('mock_tarifas_gas', JSON.stringify(mockStorage.tarifas_gas));
    localStorage.setItem('mock_comparativas', JSON.stringify(mockStorage.comparativas));
  };

  return {
    async execute(query, params = []) {
      console.log("Mock DB Execute:", query, params);
      // Analizar queries comunes de inserción/borrado muy simplificadas
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
          comision: params[16],
          comision_tramos: params[17],
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
            comision: params[15],
            comision_tramos: params[16],
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
          comision: params[5],
          comision_tramos: params[6],
          notas: params[7],
          activo: 1,
          creado_en: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });
        save();
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (query.includes("UPDATE tarifas_gas")) {
        const id = params[7];
        const index = mockStorage.tarifas_gas.findIndex(item => item.id === id);
        if (index !== -1) {
          mockStorage.tarifas_gas[index] = {
            ...mockStorage.tarifas_gas[index],
            nombre: params[0],
            tipo_tarifa: params[1],
            termino_fijo: params[2],
            termino_variable: params[3],
            comision: params[4],
            comision_tramos: params[5],
            notas: params[6]
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
          comision_total: params[10]
        });
        save();
        return { lastInsertId: id, rowsAffected: 1 };
      }
      if (query.includes("DELETE FROM comparativas")) {
        mockStorage.comparativas = mockStorage.comparativas.filter(c => c.id !== params[0]);
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
 * @param {number} comision - Comisión base (€).
 * @param {string} comisionTramos - Cadena JSON con tramos de comisión según consumo.
 * @param {string} notas - Comentarios o notas aclaratorias.
 * @returns {Promise<Object>} Resultado de la inserción.
 */
export async function addTarifaLuz(
  comercializadoraId, nombre, tipoTarifa,
  potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
  energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
  excedente, comision, comisionTramos, notas
) {
  const db = await getDb();
  return await db.execute(
    `INSERT INTO tarifas_luz (
      comercializadora_id, nombre, tipo_tarifa, 
      potencia_p1, potencia_p2, potencia_p3, potencia_p4, potencia_p5, potencia_p6, 
      energia_p1, energia_p2, energia_p3, energia_p4, energia_p5, energia_p6, 
      excedente, comision, comision_tramos, notas
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19);`,
    [
      comercializadoraId, nombre, tipoTarifa,
      potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
      energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
      excedente, comision, comisionTramos, notas
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
 * @param {number} comision - Comisión base (€).
 * @param {string} comisionTramos - Cadena JSON con tramos de comisión.
 * @param {string} notas - Comentarios o notas.
 * @returns {Promise<Object>} Resultado de la actualización.
 */
export async function updateTarifaLuz(
  id, nombre, tipoTarifa,
  potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
  energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
  excedente, comision, comisionTramos, notas
) {
  const db = await getDb();
  return await db.execute(
    `UPDATE tarifas_luz SET 
      nombre = $1, tipo_tarifa = $2, 
      potencia_p1 = $3, potencia_p2 = $4, potencia_p3 = $5, potencia_p4 = $6, potencia_p5 = $7, potencia_p6 = $8, 
      energia_p1 = $9, energia_p2 = $10, energia_p3 = $11, energia_p4 = $12, energia_p5 = $13, energia_p6 = $14, 
      excedente = $15, comision = $16, comision_tramos = $17, notas = $18 
     WHERE id = $19;`,
    [
      nombre, tipoTarifa,
      potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
      energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
      excedente, comision, comisionTramos, notas, id
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
 * @param {number} comision - Comisión base (€).
 * @param {string} comisionTramos - Cadena JSON con los tramos de comisión.
 * @param {string} notas - Notas o aclaraciones.
 * @returns {Promise<Object>} Resultado de la inserción.
 */
export async function addTarifaGas(comercializadoraId, nombre, tipoTarifa, terminoFijo, terminoVariable, comision, comisionTramos, notas) {
  const db = await getDb();
  return await db.execute(
    `INSERT INTO tarifas_gas (comercializadora_id, nombre, tipo_tarifa, termino_fijo, termino_variable, comision, comision_tramos, notas) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
    [comercializadoraId, nombre, tipoTarifa, terminoFijo, terminoVariable, comision, comisionTramos, notas]
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
export async function updateTarifaGas(id, nombre, tipoTarifa, terminoFijo, terminoVariable, comision, comisionTramos, notas) {
  const db = await getDb();
  return await db.execute(
    `UPDATE tarifas_gas SET nombre = $1, tipo_tarifa = $2, termino_fijo = $3, termino_variable = $4, comision = $5, comision_tramos = $6, notas = $7 
     WHERE id = $8;`,
    [nombre, tipoTarifa, terminoFijo, terminoVariable, comision, comisionTramos, notas, id]
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
  return await db.select(`
    SELECT c.*, 
           tl.nombre as tarifa_luz_nombre, cl.nombre as comercializadora_luz_nombre,
           tg.nombre as tarifa_gas_nombre, cg.nombre as comercializadora_gas_nombre
    FROM comparativas c
    LEFT JOIN tarifas_luz tl ON c.tarifa_luz_propuesta_id = tl.id
    LEFT JOIN comercializadoras cl ON tl.comercializadora_id = cl.id
    LEFT JOIN tarifas_gas tg ON c.tarifa_gas_propuesta_id = tg.id
    LEFT JOIN comercializadoras cg ON tg.comercializadora_id = cg.id
    ORDER BY c.fecha DESC;
  `);
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
      await db.execute("DELETE FROM tarifas_luz;");
      await db.execute("DELETE FROM tarifas_gas;");
      await db.execute("DELETE FROM comercializadoras;");
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
  }
}
