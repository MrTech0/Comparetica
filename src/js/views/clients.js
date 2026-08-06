import { getClientesPaginated, addCliente, updateCliente, deleteCliente, getAgentes, getPuntosSuministroByCliente, syncPuntosSuministroCliente } from '../db.js';

let currentClientPage = 1;
const CLIENT_PAGE_SIZE = 25;
let currentClientTotalPages = 1;
let currentClientTotalCount = 0;
let currentLoadedClients = [];

export async function initClientsView() {
  setupCupsManager();
  setupDialogs();
  setupFormSubmit();

  const searchInput = document.getElementById('search-clients-input');
  if (searchInput) {
    searchInput.value = '';
  }

  await populateAgentFilter();
  await loadClientsTable(1);
}

function setupCupsManager() {
  const addBtn = document.getElementById('btn-add-cups-row');
  if (addBtn && !addBtn.dataset.listenerAdded) {
    addBtn.addEventListener('click', () => {
      addCupsRow('', '', 'LUZ');
    });
    addBtn.dataset.listenerAdded = 'true';
  }
}

function clearCupsContainer() {
  const container = document.getElementById('client-cups-container');
  if (container) container.innerHTML = '';
}

function addCupsRow(cups = '', alias = '', energy = 'LUZ') {
  const container = document.getElementById('client-cups-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'cups-item-row';
  row.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-bottom: 6px;';

  row.innerHTML = `
    <input type="text" class="m3-input client-cups-input" placeholder="CUPS (ES0021...)" value="${escapeHtml(cups)}" style="flex: 2.2; text-transform: uppercase; font-family: monospace; font-size: 13px; height: 40px;" />
    <input type="text" class="m3-input client-cups-alias" placeholder="Ubicación / Alias (ej. Tienda Centro)" value="${escapeHtml(alias)}" style="flex: 1.8; font-size: 13px; height: 40px;" />
    <select class="m3-input m3-select m3-select-sm client-cups-type" style="width: 110px;">
      <option value="LUZ" ${energy === 'LUZ' ? 'selected' : ''}>⚡ Luz</option>
      <option value="GAS" ${energy === 'GAS' ? 'selected' : ''}>🔥 Gas</option>
      <option value="DUAL" ${energy === 'DUAL' ? 'selected' : ''}>⚡🔥 Dual</option>
    </select>
    <button type="button" class="m3-btn-icon btn-remove-cups-row" title="Eliminar este CUPS" style="color: var(--color-error); width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); border: 1px solid var(--color-outline-variant); background-color: var(--color-surface); flex-shrink: 0;">
      <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  `;

  row.querySelector('.btn-remove-cups-row').addEventListener('click', () => {
    const totalRows = container.querySelectorAll('.cups-item-row').length;
    if (totalRows > 1) {
      row.remove();
    } else {
      row.querySelector('.client-cups-input').value = '';
      row.querySelector('.client-cups-alias').value = '';
    }
  });

  container.appendChild(row);

  // Inicializar componentes m3-custom-select dinámicos
  if (typeof window.initCustomSelects === 'function') {
    window.initCustomSelects();
  }
}

function getCupsRowsData() {
  const container = document.getElementById('client-cups-container');
  if (!container) return [];

  const rows = container.querySelectorAll('.cups-item-row');
  const result = [];

  rows.forEach(r => {
    const cups = r.querySelector('.client-cups-input')?.value?.trim()?.toUpperCase() || '';
    const alias = r.querySelector('.client-cups-alias')?.value?.trim() || 'Principal';
    const energy = r.querySelector('.client-cups-type')?.value || 'LUZ';

    if (cups !== '') {
      result.push({ cups, direccionAlias: alias, tipoEnergia: energy });
    }
  });

  return result;
}

async function populateAgentFilter() {
  const filterSelect = document.getElementById('filter-client-agent');
  if (!filterSelect) return;

  const currentVal = filterSelect.value;
  const agents = await getAgentes(false);
  filterSelect.innerHTML = '<option value="">Todos los Agentes</option>';

  agents.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.nombre + (a.activo === 0 ? ' (Inactivo)' : '');
    filterSelect.appendChild(opt);
  });

  if (currentVal) filterSelect.value = currentVal;

  if (!filterSelect.dataset.listenerAdded) {
    filterSelect.addEventListener('change', () => {
      loadClientsTable(1);
    });
    filterSelect.dataset.listenerAdded = 'true';
  }
}

async function populateClientDialogAgentSelector(selectedAgentId = null) {
  const select = document.getElementById('dialog-client-agent');
  if (!select) return;

  const agents = await getAgentes(true);
  select.innerHTML = '<option value="">-- Seleccionar Agente Comercial --</option>';

  agents.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.nombre;
    select.appendChild(opt);
  });

  if (selectedAgentId) {
    select.value = selectedAgentId;
  } else if (agents.length === 1) {
    select.value = agents[0].id;
  }
}

function setupDialogs() {
  const openBtn = document.getElementById('open-client-dialog-btn');
  const closeBtn = document.getElementById('dialog-client-close');
  const dialog = document.getElementById('dialog-client');
  const form = document.getElementById('dialog-client-form');

  if (!openBtn || !dialog || !closeBtn) return;

  // Abrir diálogo de creación
  openBtn.addEventListener('click', async () => {
    document.getElementById('dialog-client-title').innerText = "Registrar Cliente";
    document.getElementById('dialog-client-id').value = "";
    if (form) form.reset();
    clearCupsContainer();
    addCupsRow('', 'Principal', 'LUZ');
    await populateClientDialogAgentSelector();
    dialog.classList.add('active');
  });

  // Cerrar diálogo
  closeBtn.addEventListener('click', () => {
    dialog.classList.remove('active');
  });
}

function setupFormSubmit() {
  const form = document.getElementById('dialog-client-form');
  const dialog = document.getElementById('dialog-client');

  if (!form || !dialog) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('dialog-client-id').value;
    const nombre = document.getElementById('dialog-client-name').value.trim();
    const cif = document.getElementById('dialog-client-cif').value.trim().toUpperCase();
    const representante = document.getElementById('dialog-client-rep').value.trim();
    const email = document.getElementById('dialog-client-email').value.trim();
    const agenteIdRaw = document.getElementById('dialog-client-agent').value;
    const agenteId = agenteIdRaw ? parseInt(agenteIdRaw, 10) : null;

    const puntosData = getCupsRowsData();
    const primaryCups = puntosData.length > 0 ? puntosData[0].cups : '';

    if (!agenteId || isNaN(agenteId)) {
      window.showToast("Error: Debes seleccionar un agente comercial para el cliente.", "error");
      return;
    }

    if (!isValidSpanishId(cif)) {
      window.showToast("Error: El DNI / CIF introducido no es un documento válido.", "error");
      return;
    }

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerText = "Guardando...";

      if (id) {
        // Actualizar
        const clientId = parseInt(id, 10);
        await updateCliente(clientId, nombre, cif, representante, primaryCups, email, agenteId);
        await syncPuntosSuministroCliente(clientId, puntosData);
        window.showToast("Cliente y sus puntos de suministro actualizados.", "success");
        await loadClientsTable(currentClientPage);
      } else {
        // Registrar nuevo
        const newRes = await addCliente(nombre, cif, representante, primaryCups, email, agenteId);
        let newClientId = null;
        if (newRes && newRes.lastInsertId) {
          newClientId = newRes.lastInsertId;
        } else if (typeof newRes === 'number') {
          newClientId = newRes;
        }
        
        if (newClientId) {
          await syncPuntosSuministroCliente(newClientId, puntosData);
        }
        window.showToast("Cliente y sus puntos de suministro registrados.", "success");
        await loadClientsTable(1);
      }

      dialog.classList.remove('active');
      form.reset();
    } catch (err) {
      console.error(err);
      if (err.message && err.message.includes("UNIQUE constraint failed")) {
        window.showToast("Error: Ya existe un cliente registrado con ese DNI / CIF.", "error");
      } else {
        window.showToast(`Error al guardar cliente: ${err.message || err}`, "error");
      }
    } finally {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = "Guardar Cliente";
      }
    }
  });
}

export async function loadClientsTable(page = 1) {
  try {
    currentClientPage = Math.max(1, page);
    const searchInput = document.getElementById('search-clients-input');
    const query = searchInput ? searchInput.value.trim() : '';
    const agentFilterSelect = document.getElementById('filter-client-agent');
    const agentIdFilter = agentFilterSelect && agentFilterSelect.value ? parseInt(agentFilterSelect.value, 10) : null;

    const res = await getClientesPaginated(currentClientPage, CLIENT_PAGE_SIZE, query, agentIdFilter);
    currentLoadedClients = res.clients;
    currentClientTotalCount = res.totalCount;
    currentClientTotalPages = res.totalPages;
    currentClientPage = res.page;

    setupPaginationAndSearchListeners();
    renderClientsTableRows(currentLoadedClients, query);
    updatePaginationUI();
  } catch (err) {
    console.error("Error al cargar la tabla de clientes:", err);
  }
}

function setupPaginationAndSearchListeners() {
  const searchInput = document.getElementById('search-clients-input');
  if (searchInput && !searchInput.dataset.listenerAdded) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadClientsTable(1);
      }, 200);
    });
    searchInput.dataset.listenerAdded = 'true';
  }

  const btnPrev = document.getElementById('btn-prev-page-clients');
  if (btnPrev && !btnPrev.dataset.listenerAdded) {
    btnPrev.addEventListener('click', () => {
      if (currentClientPage > 1) {
        loadClientsTable(currentClientPage - 1);
      }
    });
    btnPrev.dataset.listenerAdded = 'true';
  }

  const btnNext = document.getElementById('btn-next-page-clients');
  if (btnNext && !btnNext.dataset.listenerAdded) {
    btnNext.addEventListener('click', () => {
      if (currentClientPage < currentClientTotalPages) {
        loadClientsTable(currentClientPage + 1);
      }
    });
    btnNext.dataset.listenerAdded = 'true';
  }
}

function updatePaginationUI() {
  const infoEl = document.getElementById('clients-pagination-info');
  const indicatorEl = document.getElementById('clients-page-indicator');
  const btnPrev = document.getElementById('btn-prev-page-clients');
  const btnNext = document.getElementById('btn-next-page-clients');

  if (currentClientTotalCount === 0) {
    if (infoEl) infoEl.textContent = 'Mostrando 0 - 0 de 0 clientes';
    if (indicatorEl) indicatorEl.textContent = 'Página 1 de 1';
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  const start = (currentClientPage - 1) * CLIENT_PAGE_SIZE + 1;
  const end = Math.min(currentClientPage * CLIENT_PAGE_SIZE, currentClientTotalCount);

  if (infoEl) {
    infoEl.textContent = `Mostrando ${start} - ${end} de ${currentClientTotalCount.toLocaleString('es-ES')} clientes`;
  }
  if (indicatorEl) {
    indicatorEl.textContent = `Página ${currentClientPage} de ${currentClientTotalPages}`;
  }
  if (btnPrev) {
    btnPrev.disabled = currentClientPage <= 1;
  }
  if (btnNext) {
    btnNext.disabled = currentClientPage >= currentClientTotalPages;
  }
}

function renderClientsTableRows(clients, query) {
  const tbody = document.getElementById('table-clients-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!clients || clients.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--color-outline); padding: 32px 16px;">
          ${query ? 'No se encontraron clientes que coincidan con la búsqueda.' : 'No hay clientes registrados en la base de datos. Haga clic en \'Nuevo Cliente\' para empezar.'}
        </td>
      </tr>
    `;
    return;
  }

  clients.forEach(client => {
    const tr = document.createElement('tr');
    
    const createdDate = new Date(client.creado_en).toLocaleDateString('es-ES', {
      year: 'numeric', month: 'short', day: 'numeric'
    });

    const clientTypeHtml = client.tiene_aceptada
      ? `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; background-color: #bbf7d0 !important; color: #166534 !important; border: 1px solid #4ade80 !important; font-weight: 600;">Real</span>`
      : `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; background-color: #fef08a !important; color: #854d0e !important; border: 1px solid #facc15 !important; font-weight: 600;">Potencial</span>`;

    const agentChip = client.agente_nombre
      ? `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; font-weight: 600;">${escapeHtml(client.agente_nombre)}</span>`
      : `<span class="text-muted" style="font-size:12px;">Sin Asignar</span>`;

    tr.innerHTML = `
      <td><strong>${escapeHtml(client.nombre_empresa)}</strong></td>
      <td><code>${escapeHtml(client.cif)}</code></td>
      <td>${agentChip}</td>
      <td>${escapeHtml(client.representante || '-')}</td>
      <td><small class="text-muted">${escapeHtml(client.cups || '-')}</small></td>
      <td>${escapeHtml(client.email || '-')}</td>
      <td>${clientTypeHtml}</td>
      <td>${createdDate}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button type="button" class="m3-btn-icon edit-client-btn" data-id="${client.id}" title="Editar Cliente">
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button type="button" class="m3-btn-icon delete-client-btn" data-id="${client.id}" data-name="${client.nombre_empresa}" title="Eliminar Cliente" style="color: var(--color-error);">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </td>
    `;
    
    tbody.appendChild(tr);
  });

  // Registrar eventos para botones de editar
  tbody.querySelectorAll('.edit-client-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const client = currentLoadedClients.find(c => c.id === id);
      if (client) {
        openEditDialog(client);
      }
    });
  });

  // Registrar eventos para botones de borrar
  tbody.querySelectorAll('.delete-client-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const name = btn.getAttribute('data-name');
      
      const confirmDelete = await window.showConfirm(
        `¿Está seguro de eliminar al cliente "${name}"?\n\nEsta acción no se puede deshacer y eliminará automáticamente todas sus comparativas pendientes y rechazadas.`,
        "Eliminar Cliente"
      );

      if (confirmDelete) {
        try {
          await deleteCliente(id);
          window.showToast("Cliente y sus datos asociados eliminados correctamente.", "success");
          
          // Si era el único en la página actual y no estamos en página 1, retroceder una página
          if (currentLoadedClients.length === 1 && currentClientPage > 1) {
            currentClientPage--;
          }
          await loadClientsTable(currentClientPage);
        } catch (e) {
          if (e.message === "OBLIGACION_LEGAL_RETENCION") {
            showLegalRetentionWarning();
          } else {
            window.showToast(`Error al eliminar cliente: ${e.message || e}`, "error");
          }
        }
      }
    });
  });
}

function showLegalRetentionWarning() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog-legal-retention-warn');
    const closeBtn = document.getElementById('dialog-legal-retention-close');
    if (!overlay || !closeBtn) {
      resolve();
      return;
    }

    const closeHandler = () => {
      overlay.classList.remove('active');
      closeBtn.removeEventListener('click', closeHandler);
      resolve();
    };

    closeBtn.addEventListener('click', closeHandler);
    overlay.classList.add('active');
  });
}

async function openEditDialog(client) {
  const dialog = document.getElementById('dialog-client');
  if (!dialog) return;

  document.getElementById('dialog-client-title').innerText = "Editar Cliente";
  document.getElementById('dialog-client-id').value = client.id;
  document.getElementById('dialog-client-name').value = client.nombre_empresa;
  document.getElementById('dialog-client-cif').value = client.cif;
  document.getElementById('dialog-client-rep').value = client.representante || "";
  document.getElementById('dialog-client-email').value = client.email || "";

  clearCupsContainer();
  try {
    const puntos = await getPuntosSuministroByCliente(client.id);
    if (puntos && puntos.length > 0) {
      puntos.forEach(p => addCupsRow(p.cups, p.direccion_alias || 'Principal', p.tipo_energia || 'LUZ'));
    } else {
      addCupsRow(client.cups || '', 'Principal', 'LUZ');
    }
  } catch (e) {
    addCupsRow(client.cups || '', 'Principal', 'LUZ');
  }

  await populateClientDialogAgentSelector(client.agente_id);

  dialog.classList.add('active');
}

/**
 * Regenera las opciones del datalist para el autocompletado del comparador de tarifas.
 * @param {Array<Object>} clients - Lista de clientes.
 */
function updateClientsDatalist(clients) {
  const datalist = document.getElementById('clients-datalist');
  if (!datalist) return;

  datalist.innerHTML = '';
  clients.forEach(c => {
    const option = document.createElement('option');
    option.value = c.nombre_empresa;
    // Guardamos metadatos en atributos data para poder recuperarlos después
    option.setAttribute('data-cups', c.cups || '');
    datalist.appendChild(option);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- Spanish DNI/NIE/CIF Validation Helpers ---
function validateDNI(dni) {
  const match = dni.match(/^(\d{8})([A-Z])$/);
  if (!match) return false;
  const num = parseInt(match[1], 10);
  const letter = match[2];
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  return letters[num % 23] === letter;
}

function validateNIE(nie) {
  let cleanNie = nie.replace(/^X/, '0').replace(/^Y/, '1').replace(/^Z/, '2');
  return validateDNI(cleanNie);
}

function validateCIF(cif) {
  const match = cif.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (!match) return false;
  
  const letter = match[1];
  const digits = match[2];
  const control = match[3];
  
  let oddSum = 0;
  let evenSum = 0;
  
  for (let i = 0; i < 7; i++) {
    const d = parseInt(digits.charAt(i), 10);
    if (i % 2 === 0) {
      let temp = d * 2;
      if (temp > 9) temp -= 9;
      oddSum += temp;
    } else {
      evenSum += d;
    }
  }
  
  const totalSum = oddSum + evenSum;
  const controlDigit = (10 - (totalSum % 10)) % 10;
  const letters = 'JABCDEFGHI';
  const controlLetter = letters.charAt(controlDigit);
  
  if ('KPQRSNW'.includes(letter)) {
    return control === controlLetter;
  } else if ('ABEHMX'.includes(letter)) {
    return parseInt(control, 10) === controlDigit;
  } else {
    return parseInt(control, 10) === controlDigit || control === controlLetter;
  }
}

function isValidSpanishId(id) {
  const cleanId = id.toUpperCase().replace(/[\s-]/g, '');
  if (/^[XYZ]/.test(cleanId)) return validateNIE(cleanId);
  if (/^[ABCDEFGHJNPQRSUVW]/.test(cleanId)) return validateCIF(cleanId);
  if (/^\d/.test(cleanId)) return validateDNI(cleanId);
  return false;
}
