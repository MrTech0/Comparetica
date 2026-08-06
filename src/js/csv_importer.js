// src/js/csv_importer.js
import { getClientesSchemaColumns, importClientesBatch } from './db.js';

let parsedCsvData = { headers: [], rows: [] };
let crmColumns = []; // [{ name, label, notnull, type }]
let columnMappings = {}; // { crmColumnName: csvHeaderIndex }

let pendingConversionBuffer = null;
let pendingFileName = "";

export function initCsvImporter() {
  const fileInput = document.getElementById('csv-file-input');
  const dropzone = document.getElementById('csv-dropzone');
  const btnSelectFile = document.getElementById('btn-select-csv-file');

  if (!fileInput || !dropzone) return;

  setupEncodingModals();

  // Eventos de Drag & Drop en HTML5
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    dropzone.classList.remove('drag-over');
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      handleCsvFile(dt.files[0]);
    }
  });

  // Eventos nativos de drag & drop en Tauri 2 (escuchando eventos del sistema)
  if (window.__TAURI__ && window.__TAURI__.event) {
    try {
      window.__TAURI__.event.listen('tauri://drag-enter', () => {
        dropzone.classList.add('drag-over');
      });
      window.__TAURI__.event.listen('tauri://drag-over', () => {
        dropzone.classList.add('drag-over');
      });
      window.__TAURI__.event.listen('tauri://drag-leave', () => {
        dropzone.classList.remove('drag-over');
      });
      window.__TAURI__.event.listen('tauri://drag-drop', async (event) => {
        dropzone.classList.remove('drag-over');
        const step1 = document.getElementById('csv-step-1');
        if (step1 && !step1.classList.contains('hidden')) {
          const paths = event.payload?.paths || (Array.isArray(event.payload) ? event.payload : []);
          if (paths.length > 0) {
            await readAndProcessFilePath(paths[0]);
          }
        }
      });
      window.__TAURI__.event.listen('tauri://file-drop', async (event) => {
        dropzone.classList.remove('drag-over');
        const step1 = document.getElementById('csv-step-1');
        if (step1 && !step1.classList.contains('hidden')) {
          const paths = Array.isArray(event.payload) ? event.payload : (event.payload?.paths || []);
          if (paths.length > 0) {
            await readAndProcessFilePath(paths[0]);
          }
        }
      });
    } catch (e) {
      console.warn("No se pudieron registrar eventos nativos de drag-drop:", e);
    }
  }

  if (btnSelectFile) {
    btnSelectFile.addEventListener('click', () => fileInput.click());
  }

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleCsvFile(e.target.files[0]);
    }
  });

  // Botón X roja (eliminar archivo y resetear)
  const btnReset = document.getElementById('btn-csv-reset');
  if (btnReset) {
    btnReset.addEventListener('click', resetImporter);
  }

  const btnRestart = document.getElementById('btn-csv-restart');
  if (btnRestart) {
    btnRestart.addEventListener('click', resetImporter);
  }

  // Botón ejecutar importación
  const btnProcess = document.getElementById('btn-csv-process-import');
  if (btnProcess) {
    btnProcess.addEventListener('click', executeImport);
  }
}

function setupEncodingModals() {
  const dialogConv = document.getElementById('dialog-csv-encoding');
  const btnConvert = document.getElementById('btn-csv-encoding-convert');
  const btnCancel = document.getElementById('btn-csv-encoding-cancel');

  const dialogInvalid = document.getElementById('dialog-csv-encoding-invalid');
  const btnInvalidClose = document.getElementById('btn-csv-encoding-invalid-close');

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      dialogConv?.classList.remove('active');
      pendingConversionBuffer = null;
      pendingFileName = "";
    });
  }

  if (btnInvalidClose) {
    btnInvalidClose.addEventListener('click', () => {
      dialogInvalid?.classList.remove('active');
    });
  }

  if (btnConvert) {
    btnConvert.addEventListener('click', async () => {
      if (!pendingConversionBuffer) return;
      try {
        dialogConv?.classList.remove('active');
        const decoder = new TextDecoder('windows-1252');
        const text = decoder.decode(pendingConversionBuffer);
        
        window.showToast("✅ Conversión a UTF-8 completada con éxito. Puedes continuar con la importación.", "success");
        await processCsvContent(text, pendingFileName);
      } catch (err) {
        console.error("Error al convertir buffer a UTF-8:", err);
        window.showToast("Error al realizar la conversión de codificación.", "error");
      } finally {
        pendingConversionBuffer = null;
        pendingFileName = "";
      }
    });
  }
}

function resetImporter() {
  parsedCsvData = { headers: [], rows: [] };
  columnMappings = {};
  
  const fileInput = document.getElementById('csv-file-input');
  if (fileInput) fileInput.value = '';

  const progressContainer = document.getElementById('csv-progress-container');
  if (progressContainer) progressContainer.classList.add('hidden');

  document.getElementById('csv-step-1').classList.remove('hidden');
  document.getElementById('csv-step-2').classList.add('hidden');
  document.getElementById('csv-step-3').classList.add('hidden');
}

async function handleCsvFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.txt')) {
    window.showToast("Por favor, selecciona un archivo en formato CSV o TXT.", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const buffer = new Uint8Array(event.target.result);
      await inspectAndProcessArrayBuffer(buffer, file.name);
    } catch (err) {
      console.error("Error al procesar el archivo CSV:", err);
      window.showToast("Error al leer el archivo CSV.", "error");
    }
  };

  reader.readAsArrayBuffer(file);
}

async function readAndProcessFilePath(filePath) {
  if (!filePath.toLowerCase().endsWith('.csv') && !filePath.toLowerCase().endsWith('.txt')) {
    window.showToast("Por favor, selecciona un archivo en formato CSV o TXT.", "error");
    return;
  }

  try {
    const fileName = filePath.split(/[/\\]/).pop() || "archivo.csv";

    if (window.__TAURI__) {
      const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);
      const text = await invoke('read_text_file', { path: filePath });
      // Convert string to bytes for encoding inspection
      const encoder = new TextEncoder();
      const buffer = encoder.encode(text);
      await inspectAndProcessArrayBuffer(buffer, fileName);
    }
  } catch (err) {
    console.error("Error al procesar el archivo arrastrado:", err);
    window.showToast("Error al leer el archivo arrastrado.", "error");
  }
}

async function inspectAndProcessArrayBuffer(buffer, fileName) {
  // 1. Probar si es UTF-8 nativo estricto
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    const text = utf8Decoder.decode(buffer);
    await processCsvContent(text, fileName);
    return;
  } catch (errUtf8) {
    console.log("No es UTF-8 estricto. Probando codificación Windows-1252 / Latin-1...");
  }

  // 2. Probar si es Windows-1252 / Latin-1 válido
  try {
    const latinDecoder = new TextDecoder('windows-1252', { fatal: true });
    latinDecoder.decode(buffer);

    // Si tiene éxito, es Windows-1252/Latin-1. Solicitar confirmación del usuario.
    pendingConversionBuffer = buffer;
    pendingFileName = fileName;

    const fileLabel = document.getElementById('dialog-csv-encoding-file');
    if (fileLabel) fileLabel.textContent = `📄 Archivo: ${fileName} (${(buffer.byteLength / 1024).toFixed(1)} KB)`;

    const dialogConv = document.getElementById('dialog-csv-encoding');
    if (dialogConv) dialogConv.classList.add('active');
    return;
  } catch (errLatin) {
    console.warn("Tampoco es Windows-1252/Latin-1 válido.");
  }

  // 3. Si no coincide con codificaciones conocidas, mostrar advertencia
  const dialogInvalid = document.getElementById('dialog-csv-encoding-invalid');
  if (dialogInvalid) dialogInvalid.classList.add('active');
}

async function processCsvContent(text, fileName) {
  parsedCsvData = parseCSVText(text);

  if (!parsedCsvData.headers || parsedCsvData.headers.length === 0 || parsedCsvData.rows.length === 0) {
    window.showToast("El archivo CSV está vacío o no tiene un formato válido.", "error");
    return;
  }

  // Cargar dinámicamente las columnas actuales del esquema de Clientes (PRAGMA table_info)
  crmColumns = await getClientesSchemaColumns();

  // Realizar auto-mapeo con normalización de caracteres
  autoMatchColumns();

  // Renderizar tabla de mapeo y vista previa
  renderMappingUI();

  // Avanzar al Paso 2
  document.getElementById('csv-step-1').classList.remove('hidden'); // asegurar visibilidad paso 1 hidden reset
  document.getElementById('csv-step-1').classList.add('hidden');
  document.getElementById('csv-step-2').classList.remove('hidden');

  document.getElementById('csv-file-info').textContent = `📄 ${fileName} (${parsedCsvData.rows.length.toLocaleString('es-ES')} filas encontradas)`;
}

/**
 * Normaliza cadenas quitando mayúsculas, acentos, diacríticos y signos.
 */
function normalizeHeader(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Parsea texto CSV detectando automáticamente el delimitador (;, ,, tab).
 */
export function parseCSVText(text) {
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detectar delimitador inspeccionando la primera línea
  const firstLine = lines[0];
  let delimiter = ';';
  if ((firstLine.match(/,/g) || []).length > (firstLine.match(/;/g) || []).length) {
    delimiter = ',';
  } else if ((firstLine.match(/\t/g) || []).length > (firstLine.match(/;/g) || []).length) {
    delimiter = '\t';
  }

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parsedRow = parseLine(lines[i]);
    if (parsedRow.some(val => val.length > 0)) {
      rows.push(parsedRow);
    }
  }

  return { headers, rows };
}

/**
 * Auto-asocia columnas del CSV con columnas de la BD usando sinónimos normalizados.
 */
function autoMatchColumns() {
  columnMappings = {};

  const synonymsMap = {
    nombre_empresa: ['nombre', 'empresa', 'razonsocial', 'cliente', 'name', 'company', 'titular', 'nombreempresa', 'clienteempresa'],
    cif: ['cif', 'dni', 'nif', 'documento', 'taxid', 'identificacion', 'cifdni', 'cifnif', 'nifcif'],
    representante: ['representante', 'contacto', 'personadecontacto', 'contact', 'representantelegal', 'persona'],
    cups: ['cups', 'codigocups', 'suministro', 'cupsluz', 'cupsgas', 'punto'],
    email: ['email', 'correo', 'emaildecontacto', 'mail', 'correoelectronico', 'contactoemail']
  };

  crmColumns.forEach(crmCol => {
    const normCrmName = normalizeHeader(crmCol.name);
    const normCrmLabel = normalizeHeader(crmCol.label);
    const knownSynonyms = synonymsMap[crmCol.name] || [normCrmName, normCrmLabel];

    let bestIndex = -1;

    for (let i = 0; i < parsedCsvData.headers.length; i++) {
      const normCsvHeader = normalizeHeader(parsedCsvData.headers[i]);

      if (knownSynonyms.includes(normCsvHeader) || normCsvHeader.includes(normCrmName) || normCrmName.includes(normCsvHeader)) {
        bestIndex = i;
        break;
      }
    }

    columnMappings[crmCol.name] = bestIndex;
  });
}

function renderMappingUI() {
  const container = document.getElementById('csv-mapping-rows');
  if (!container) return;

  container.innerHTML = '';

  crmColumns.forEach((crmCol, idx) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'm3-field-row';
    const isLast = idx === crmColumns.length - 1;
    rowDiv.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: ${isLast ? 'none' : '1px solid var(--color-outline-variant)'}; gap: 24px; transition: background-color var(--transition-fast);`;

    rowDiv.addEventListener('mouseenter', () => {
      rowDiv.style.backgroundColor = 'var(--color-surface-variant)';
    });
    rowDiv.addEventListener('mouseleave', () => {
      rowDiv.style.backgroundColor = 'transparent';
    });

    const cleanLabelText = crmCol.label.replace(/\*/g, '').trim();
    const isRequired = crmCol.notnull;

    const labelDiv = document.createElement('div');
    labelDiv.style.flex = '1';
    labelDiv.innerHTML = `
      <span style="color: var(--color-on-surface); font-size: 14px; font-weight: 600;">${cleanLabelText}</span>
      ${isRequired ? '<span style="color: var(--color-error); font-weight: bold; margin-left: 4px;" title="Campo obligatorio">*</span>' : ''}
    `;

    const selectDiv = document.createElement('div');
    selectDiv.style.flex = '1.2';

    const select = document.createElement('select');
    select.className = 'm3-input';
    select.style.cssText = 'width: 100%; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--color-outline); background-color: var(--color-surface); color: var(--color-on-surface); font-size: 13px; font-weight: 500; cursor: pointer; outline: none; transition: border-color var(--transition-fast);';
    select.dataset.crmColumn = crmCol.name;

    select.addEventListener('focus', () => {
      select.style.borderColor = 'var(--color-primary)';
    });
    select.addEventListener('blur', () => {
      select.style.borderColor = 'var(--color-outline)';
    });

    // Opción no asignar
    const defaultOption = document.createElement('option');
    defaultOption.value = '-1';
    defaultOption.textContent = '-- No importar esta columna --';
    select.appendChild(defaultOption);

    // Opciones del CSV
    parsedCsvData.headers.forEach((headerName, index) => {
      const option = document.createElement('option');
      option.value = index.toString();
      option.textContent = `Columna ${index + 1}: ${headerName}`;

      if (columnMappings[crmCol.name] === index) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
      columnMappings[crmCol.name] = parseInt(e.target.value, 10);
      renderPreviewTable();
    });

    selectDiv.appendChild(select);
    rowDiv.appendChild(labelDiv);
    rowDiv.appendChild(selectDiv);
    container.appendChild(rowDiv);
  });

  renderPreviewTable();
}

function renderPreviewTable() {
  const thead = document.getElementById('csv-preview-thead');
  const tbody = document.getElementById('csv-preview-tbody');

  if (!thead || !tbody) return;

  thead.innerHTML = '';
  tbody.innerHTML = '';

  const mappedCrmCols = crmColumns.filter(col => columnMappings[col.name] !== undefined && columnMappings[col.name] !== -1);

  if (mappedCrmCols.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--color-on-surface-variant); padding: 16px;">Selecciona al menos una columna para ver la vista previa.</td></tr>`;
    return;
  }

  // Header row
  const trHead = document.createElement('tr');
  mappedCrmCols.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label.replace(' *', '');
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  // Prime 5 preview rows
  const previewRows = parsedCsvData.rows.slice(0, 5);
  previewRows.forEach(rowValues => {
    const trBody = document.createElement('tr');
    mappedCrmCols.forEach(col => {
      const csvIndex = columnMappings[col.name];
      const val = (csvIndex >= 0 && csvIndex < rowValues.length) ? rowValues[csvIndex] : '';
      const td = document.createElement('td');
      td.textContent = val;
      trBody.appendChild(td);
    });
    tbody.appendChild(trBody);
  });
}

async function executeImport() {
  // Validar campos obligatorios mapped
  const missingRequired = crmColumns.filter(col => col.notnull && (columnMappings[col.name] === undefined || columnMappings[col.name] === -1));

  if (missingRequired.length > 0) {
    const missingNames = missingRequired.map(c => c.label).join(', ');
    window.showToast(`Debes asociar los campos obligatorios del CRM: ${missingNames}`, "error");
    return;
  }

  const updateExisting = document.getElementById('csv-duplicate-update')?.checked || false;

  // Preparar lista de objetos
  const mappedRows = parsedCsvData.rows.map(rowValues => {
    const item = {};
    crmColumns.forEach(col => {
      const csvIndex = columnMappings[col.name];
      if (csvIndex >= 0 && csvIndex < rowValues.length) {
        item[col.name] = rowValues[csvIndex];
      }
    });
    return item;
  });

  const btnProcess = document.getElementById('btn-csv-process-import');
  const originalText = btnProcess ? btnProcess.innerHTML : '';

  const progressContainer = document.getElementById('csv-progress-container');
  const statusEl = document.getElementById('csv-progress-status');
  const percentEl = document.getElementById('csv-progress-percent');
  const progressBar = document.getElementById('csv-progress-bar');

  try {
    if (btnProcess) {
      btnProcess.disabled = true;
      btnProcess.innerHTML = `<span class="spinner-sm"></span> Procesando importación...`;
    }

    if (progressContainer) progressContainer.classList.remove('hidden');

    const CHUNK_SIZE = 5000;
    const totalRows = mappedRows.length;
    let totalAdded = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const allErrors = [];

    for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
      const chunk = mappedRows.slice(i, i + CHUNK_SIZE);
      const processedCount = Math.min(i + CHUNK_SIZE, totalRows);
      const percent = Math.round((processedCount / totalRows) * 100);

      if (statusEl) statusEl.textContent = `Procesando clientes: ${processedCount.toLocaleString('es-ES')} de ${totalRows.toLocaleString('es-ES')} (${percent}%)`;
      if (percentEl) percentEl.textContent = `${percent}%`;
      if (progressBar) progressBar.style.width = `${percent}%`;

      const result = await importClientesBatch(chunk, updateExisting);
      totalAdded += result.added;
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
      if (result.errors && result.errors.length > 0) {
        allErrors.push(...result.errors);
      }

      // Pequeña pausa para repintado fluido del navegador
      await new Promise(r => setTimeout(r, 16));
    }

    // Si se mapearon fechas de firma o vencimiento, crear las renovaciones asociadas
    const hasFirma = columnMappings['fecha_firma'] !== undefined && columnMappings['fecha_firma'] >= 0;
    const hasVto = columnMappings['fecha_vencimiento'] !== undefined && columnMappings['fecha_vencimiento'] >= 0;

    if (hasFirma || hasVto) {
      try {
        const { getClientes, importRenovacionesBatch } = await import('./db.js');
        const allClients = await getClientes();
        const clientsByCif = {};
        allClients.forEach(c => clientsByCif[(c.cif || '').trim().toUpperCase()] = c.id);

        const todayStr = new Date().toISOString().substring(0, 10);

        // Mapear filas a objetos de renovación válidos
        const renovationPayload = [];
        for (const item of mappedRows) {
          const cifKey = (item.cif || '').trim().toUpperCase();
          const clientId = clientsByCif[cifKey];
          if (!clientId || (!item.fecha_firma && !item.fecha_vencimiento)) continue;

          let fFirma = item.fecha_firma ? item.fecha_firma.trim() : todayStr;
          let fVto = item.fecha_vencimiento ? item.fecha_vencimiento.trim() : '';

          if (!fVto && fFirma) {
            const d = new Date(fFirma);
            if (!isNaN(d.getTime())) {
              d.setFullYear(d.getFullYear() + 1);
              fVto = d.toISOString().substring(0, 10);
            } else {
              fVto = todayStr;
            }
          }

          if (fFirma && fVto) {
            renovationPayload.push({
              cliente_id: clientId,
              tipo_energia: 'Luz',
              cups: item.cups || '',
              comercializadora_actual: 'Importado CSV',
              tarifa_actual: 'Tarifa CSV',
              fecha_firma: fFirma,
              duracion_meses: 12,
              fecha_vencimiento: fVto,
              notas: 'Importado automáticamente desde CSV'
            });
          }
        }

        const totalRenovations = renovationPayload.length;

        if (totalRenovations > 0) {
          const REN_CHUNK_SIZE = 500;
          let processedRenovations = 0;

          for (let i = 0; i < totalRenovations; i += REN_CHUNK_SIZE) {
            const chunk = renovationPayload.slice(i, i + REN_CHUNK_SIZE);
            processedRenovations = Math.min(i + REN_CHUNK_SIZE, totalRenovations);
            const renPercent = Math.round((processedRenovations / totalRenovations) * 100);

            if (statusEl) statusEl.textContent = `Generando contratos de renovación: ${processedRenovations.toLocaleString('es-ES')} de ${totalRenovations.toLocaleString('es-ES')} (${renPercent}%)`;
            if (percentEl) percentEl.textContent = `${renPercent}%`;
            if (progressBar) progressBar.style.width = `${renPercent}%`;

            await importRenovacionesBatch(chunk);

            // Pausa de 16ms para repintado fluido del navegador
            await new Promise(r => setTimeout(r, 16));
          }

          const { refreshRenewals } = await import('./views/renewals.js');
          await refreshRenewals();
        }
      } catch (errRen) {
        console.error("Error al importar renovaciones desde CSV:", errRen);
      }
    }

    window.showToast(`Importación completada: ${totalAdded.toLocaleString('es-ES')} creados, ${totalUpdated.toLocaleString('es-ES')} actualizados.`, "success");
  } catch (err) {
    console.error("Error durante la importación CSV:", err);
    window.showToast(`Error durante la importación: ${err.message || err}`, "error");
  } finally {
    if (btnProcess) {
      btnProcess.disabled = false;
      btnProcess.innerHTML = originalText;
    }
  }
}
