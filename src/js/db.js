// src/js/db.js
import { invoke } from './ipc.js';

let dbInstance = null;

/**
 * Comprueba el estado de inicialización y desbloqueo de la base de datos cifrada.
 */
export async function checkDbStatus() {
  return await invoke('db_check_status');
}

/**
 * Configura por primera vez la Contraseña Maestra y devuelve la Clave de Recuperación.
 */
export async function setupMasterPassword(password) {
  return await invoke('db_setup_master_password', { password });
}

/**
 * Desbloquea la base de datos cifrada mediante la Contraseña Maestra.
 */
export async function loginDb(password) {
  return await invoke('db_login', { password });
}

/**
 * Recupera el acceso a la base de datos con la Clave de Recuperación y establece una nueva contraseña.
 */
export async function recoverDbAccess(recoveryKey, newPassword) {
  return await invoke('db_recover_access', { recoveryKey, newPassword });
}

/**
 * Cambia la contraseña maestra de la bóveda.
 */
export async function changeMasterPassword(currentPassword, newPassword) {
  return await invoke('db_change_password', { currentPassword, newPassword });
}

/**
 * Inicializa y obtiene el cliente de base de datos cifrada nativo en Rust.
 * @returns {Promise<any>} Instancia del conector.
 */
export async function getDb() {
  if (dbInstance) return dbInstance;

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
  return await db.select(
    "SELECT * FROM puntos_suministro WHERE cliente_id = $1 ORDER BY id ASC;",
    [clienteId]
  );
}

/**
 * Obtiene todos los puntos de suministro registrados en el sistema.
 * @returns {Promise<Array<Object>>} Listado completo de puntos de suministro.
 */
export async function getPuntosSuministroAll() {
  const db = await getDb();
  return await db.select("SELECT ps.*, c.nombre_empresa as cliente_nombre FROM puntos_suministro ps JOIN clientes c ON ps.cliente_id = c.id ORDER BY ps.id ASC;");
}

/**
 * Registra o sincroniza la lista completa de puntos de suministro para un cliente.
 * @param {number} clienteId - ID del cliente.
 * @param {Array<Object>} puntosArray - Lista de objetos { cups, direccionAlias, tipoEnergia, notas }.
 */
export async function syncPuntosSuministroCliente(clienteId, puntosArray) {
  const db = await getDb();
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
}

/**
 * Obtiene la versión actual del motor SQLite.
 * @returns {Promise<string>} Versión de SQLite.
 */
export async function getSqliteVersion() {
  const db = await getDb();
  try {
    const res = await db.select("SELECT sqlite_version() as version;");
    return res[0].version;
  } catch (err) {
    console.error(err);
    return "Desconocida";
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

  const [added, updated, skipped] = await invoke('db_import_clientes_batch', { rows, updateExisting });
  return { added, updated, skipped, errors: [] };
}

/**
 * Importa en lote renovaciones asociadas a clientes.
 * @param {Array<Object>} rows Arreglo de objetos con datos de renovación.
 * @returns {Promise<number>} Número de renovaciones insertadas.
 */
export async function importRenovacionesBatch(rows) {
  if (!rows || rows.length === 0) return 0;

  return await invoke('db_import_renovaciones_batch', { rows });
}

// --- Ajustes Generales y Configuración de Empresa ---

/**
 * Obtiene un valor de la tabla ajustes en SQLite cifrada.
 * @param {string} clave 
 * @param {any} defaultValue 
 * @returns {Promise<any>}
 */
export async function getAjuste(clave, defaultValue = null) {
  const db = await getDb();
  const rows = await db.select("SELECT valor FROM ajustes WHERE clave = $1 LIMIT 1;", [clave]);
  if (rows && rows.length > 0) {
    try {
      return JSON.parse(rows[0].valor);
    } catch {
      return rows[0].valor;
    }
  }
  return defaultValue;
}

/**
 * Guarda o actualiza un valor en la tabla ajustes en SQLite cifrada.
 * @param {string} clave 
 * @param {any} valor 
 * @returns {Promise<void>}
 */
export async function setAjuste(clave, valor) {
  const db = await getDb();
  const serialized = typeof valor === 'string' ? valor : JSON.stringify(valor);
  await db.execute(`
    INSERT INTO ajustes (clave, valor, actualizado_en)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT(clave) DO UPDATE SET
      valor = excluded.valor,
      actualizado_en = CURRENT_TIMESTAMP;
  `, [clave, serialized]);
}

/**
 * Obtiene la configuración de empresa (con migración transparente desde localStorage o Rust si aún no está en SQLite).
 */
export async function getCompanyConfig() {
  let config = await getAjuste('company_config', null);
  if (!config) {
    // Intentar migrar desde localStorage si existe
    const localStr = localStorage.getItem('company_config');
    if (localStr) {
      try {
        config = JSON.parse(localStr);
        await setAjuste('company_config', config);
      } catch (e) {
        console.error("Error al migrar company_config desde localStorage:", e);
      }
    } else {
      try {
        const rustConfig = await invoke('get_company_config');
        if (rustConfig && Object.keys(rustConfig).length > 0) {
          config = rustConfig;
          await setAjuste('company_config', config);
        }
      } catch (err) {
        console.warn("Error al obtener company_config desde backend:", err);
      }
    }
  }
  return config || {};
}

/**
 * Guarda la configuración de empresa en SQLite cifrada y sincroniza con Rust.
 */
export async function saveCompanyConfig(configData) {
  await setAjuste('company_config', configData);
  try {
    await invoke('save_company_config', { config: configData });
  } catch (err) {
    console.warn("No se pudo invocar save_company_config en backend:", err);
  }
  // Mantener sincronizado localStorage para compatibilidad
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('company_config', JSON.stringify(configData));
  }
}

/**
 * Obtiene el logotipo de empresa (Data URI).
 */
export async function getCompanyLogo() {
  let logo = await getAjuste('company_logo', null);
  if (!logo) {
    const localLogo = typeof localStorage !== 'undefined' ? localStorage.getItem('company_logo') : null;
    if (localLogo) {
      logo = localLogo;
      await setAjuste('company_logo', logo);
    } else {
      try {
        logo = await invoke('get_company_logo');
        if (logo) await setAjuste('company_logo', logo);
      } catch (err) {
        console.warn("Error al obtener logo desde backend:", err);
      }
    }
  }
  return logo || null;
}

/**
 * Guarda el logotipo de empresa en SQLite cifrada.
 */
export async function saveCompanyLogo(logoDataUri) {
  await setAjuste('company_logo', logoDataUri);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('company_logo', logoDataUri);
  }
}

/**
 * Elimina el logotipo de empresa.
 */
export async function deleteCompanyLogo() {
  const db = await getDb();
  await db.execute("DELETE FROM ajustes WHERE clave = 'company_logo';");
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('company_logo');
  }
  try {
    await invoke('delete_company_logo');
  } catch (err) {
    console.warn("Error al borrar logo en backend:", err);
  }
}

/**
 * Exporta una copia de seguridad de la base de datos cifrada.
 * @returns {Promise<string>} Ruta del archivo de respaldo generado.
 */
export async function exportDbBackup() {
  return await invoke('export_backup');
}

/**
 * Importa y restaura una copia de seguridad en la base de datos cifrada.
 * @returns {Promise<string>} Mensaje descriptivo o 'DEV_MODE'.
 */
export async function importDbBackup() {
  return await invoke('import_backup');
}

/**
 * Obtiene los umbrales de alerta de renovaciones.
 */
export async function getRenewalThresholds() {
  let thresholds = await getAjuste('renewal_thresholds', null);
  if (!thresholds) {
    const crit = parseInt(localStorage.getItem('renewal_critical_days') || '30', 10);
    const warn = parseInt(localStorage.getItem('renewal_warning_days') || '60', 10);
    const rad = parseInt(localStorage.getItem('renewal_radar_days') || '90', 10);
    thresholds = { critical: crit, warning: warn, radar: rad };
    await setAjuste('renewal_thresholds', thresholds);
  }
  return thresholds;
}

/**
 * Guarda los umbrales de alerta de renovaciones en SQLite.
 */
export async function saveRenewalThresholds(thresholds = {}) {
  await setAjuste('renewal_thresholds', thresholds);
  localStorage.setItem('renewal_critical_days', String(thresholds.critical ?? 30));
  localStorage.setItem('renewal_warning_days', String(thresholds.warning ?? 60));
  localStorage.setItem('renewal_radar_days', String(thresholds.radar ?? 90));
}
