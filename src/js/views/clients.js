import {
  getClientesPaginated,
  addCliente,
  updateCliente,
  deleteCliente,
  getAgentes,
  getPuntosSuministroByCliente,
  syncPuntosSuministroCliente,
  updateClienteEstado,
  syncClientesEstadoAutomatico
} from '../db.js';
import { generateLopdCertificatePdf } from '../pdf.js';
import { showToast, showConfirm } from '../ui.js';
import { isValidSpanishCups, normalizeCups, isValidSpanishId } from '../utils/validators.js';

let currentClientPage = 1;
const CLIENT_PAGE_SIZE = 25;
let currentClientTotalPages = 1;
let currentClientTotalCount = 0;
let currentLoadedClients = [];
let currentStatusFilter = ''; // '' | 'activo' | 'inactivo' | 'bloqueado'
let pendingLopdClient = null;

export async function initClientsView() {
  setupCupsManager();
  setupDialogs();
  setupFormSubmit();
  setupStatusFilterDropdown();
  setupLopdBlockDialog();

  const searchInput = document.getElementById('search-clients-input');
  if (searchInput) {
    searchInput.value = '';
  }

  // Sincronización automática de inactividad según reglas de negocio
  try {
    const syncRes = await syncClientesEstadoAutomatico();
    if (syncRes && syncRes.transitionedCount > 0) {
      console.log(`[Lifecycle] Transicionados automáticamente ${syncRes.transitionedCount} clientes a inactivo.`);
    }
  } catch (eSync) {
    console.warn("No se pudo ejecutar la sincronización automática de inactividad:", eSync);
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

  const normalizedVal = normalizeCups(cups);

  const row = document.createElement('div');
  row.className = 'cups-item-row';
  row.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-bottom: 6px;';

  row.innerHTML = `
    <input type="text" class="m3-input client-cups-input" placeholder="CUPS (ES0021...) *" value="${escapeHtml(normalizedVal)}" maxlength="22" required style="flex: 2.2; text-transform: uppercase; font-family: monospace; font-size: 13px; height: 40px;" />
    <input type="text" class="m3-input client-cups-alias" placeholder="Ubicación / Alias (ej. Tienda Centro)" value="${escapeHtml(alias)}" style="flex: 1.8; font-size: 13px; height: 40px;" />
    <select class="m3-input m3-select m3-select-sm client-cups-type" style="width: 110px;">
      <option value="LUZ" ${energy === 'GAS' ? '' : 'selected'}>⚡ Luz</option>
      <option value="GAS" ${energy === 'GAS' ? 'selected' : ''}>🔥 Gas</option>
    </select>
    <button type="button" class="m3-btn-icon btn-remove-cups-row" title="Eliminar este CUPS" style="color: var(--color-error); width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); border: 1px solid var(--color-outline-variant); background-color: var(--color-surface); flex-shrink: 0;">
      <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: currentColor;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  `;

  const cupsInput = row.querySelector('.client-cups-input');
  cupsInput.addEventListener('input', () => {
    cupsInput.value = normalizeCups(cupsInput.value);
  });

  row.querySelector('.btn-remove-cups-row').addEventListener('click', () => {
    const totalRows = container.querySelectorAll('.cups-item-row').length;
    if (totalRows > 1) {
      row.remove();
    } else {
      showToast("Un cliente debe tener al menos un punto de suministro (CUPS).", "warning");
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
    const rawCups = r.querySelector('.client-cups-input')?.value || '';
    const cups = normalizeCups(rawCups);
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
    const estadoGroup = document.getElementById('dialog-client-estado-group');
    if (estadoGroup) estadoGroup.style.display = 'none';
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
      showToast("Error: Debes seleccionar un agente comercial para el cliente.", "error");
      return;
    }

    if (!isValidSpanishId(cif)) {
      showToast("Error: El DNI / CIF introducido no es un documento válido.", "error");
      return;
    }

    if (puntosData.length === 0) {
      showToast("Error: Debes indicar al menos un código CUPS obligatorio para el cliente.", "error");
      return;
    }

    for (const punto of puntosData) {
      if (!isValidSpanishCups(punto.cups)) {
        showToast(`Error: El código CUPS "${punto.cups}" no es válido. Debe comenzar por ES y contener 20 o 22 caracteres.`, "error");
        return;
      }
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

        const estadoSelect = document.getElementById('dialog-client-estado');
        const selectedEstado = estadoSelect ? estadoSelect.value : null;
        const currentClient = currentLoadedClients.find(c => c.id === clientId);
        if (selectedEstado && currentClient && selectedEstado !== (currentClient.estado || 'activo') && selectedEstado !== 'bloqueado') {
          await updateClienteEstado(clientId, selectedEstado);
        }

        showToast("Cliente y sus puntos de suministro actualizados.", "success");
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
        showToast("Cliente y sus puntos de suministro registrados.", "success");
        await loadClientsTable(1);
      }

      dialog.classList.remove('active');
      form.reset();
    } catch (err) {
      console.error(err);
      if (err.message && err.message.includes("UNIQUE constraint failed")) {
        showToast("Error: Ya existe un cliente registrado con ese DNI / CIF.", "error");
      } else {
        showToast(`Error al guardar cliente: ${err.message || err}`, "error");
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

    const res = await getClientesPaginated(currentClientPage, CLIENT_PAGE_SIZE, query, agentIdFilter, currentStatusFilter || null);
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
        <td colspan="10" style="text-align: center; color: var(--color-outline); padding: 32px 16px;">
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

    const clientEstado = client.estado || 'activo';
    let statusBadgeHtml = '';
    if (clientEstado === 'bloqueado') {
      const bloqTitle = client.bloqueado_hasta ? `Bloqueado LOPD hasta ${client.bloqueado_hasta}` : 'Bloqueado conforme a Art. 32 LOPDGDD';
      statusBadgeHtml = `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; background-color: #fee2e2 !important; color: #991b1b !important; border: 1px solid #fca5a5 !important; font-weight: 600;" title="${bloqTitle}">Bloqueado LOPD</span>`;
    } else if (clientEstado === 'inactivo') {
      statusBadgeHtml = `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; background-color: #fef9c3 !important; color: #854d0e !important; border: 1px solid #fde047 !important; font-weight: 600;" title="Cliente inactivo por cese o vencimiento de suministros">Inactivo</span>`;
    } else {
      statusBadgeHtml = `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; background-color: #dcfce7 !important; color: #166534 !important; border: 1px solid #86efac !important; font-weight: 600;" title="Cliente activo">Activo</span>`;
    }

    const agentChip = client.agente_nombre
      ? `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; font-weight: 600;">${escapeHtml(client.agente_nombre)}</span>`
      : `<span class="text-muted" style="font-size:12px;">Sin Asignar</span>`;

    let actionsHtml = `
      <button type="button" class="m3-btn-icon edit-client-btn" data-id="${client.id}" title="Editar Cliente">
        <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      </button>
    `;

    if (clientEstado === 'bloqueado') {
      actionsHtml += `
        <button type="button" class="m3-btn-icon download-lopd-btn" data-id="${client.id}" title="Descargar Certificado Oficial LOPD de Bloqueo" style="color: var(--color-primary);">
          <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </button>
        <button type="button" class="m3-btn-icon set-status-btn" data-id="${client.id}" data-target="activo" data-name="${escapeHtml(client.nombre_empresa)}" title="Reactivar Cliente (Levantar Bloqueo LOPD)" style="color: #166534;">
          <svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
        </button>
      `;
    } else if (clientEstado === 'inactivo') {
      actionsHtml += `
        <button type="button" class="m3-btn-icon set-status-btn" data-id="${client.id}" data-target="activo" data-name="${escapeHtml(client.nombre_empresa)}" title="Reactivar Cliente como Activo" style="color: #166534;">
          <svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
        </button>
        <button type="button" class="m3-btn-icon trigger-lopd-block-btn" data-id="${client.id}" data-name="${escapeHtml(client.nombre_empresa)}" title="Bloquear Cliente (LOPD/RGPD)" style="color: #b91c1c;">
          <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
        </button>
      `;
    } else {
      actionsHtml += `
        <button type="button" class="m3-btn-icon set-status-btn" data-id="${client.id}" data-target="inactivo" data-name="${escapeHtml(client.nombre_empresa)}" title="Marcar como Inactivo (Cese de colaboración)" style="color: #854d0e;">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        </button>
        <button type="button" class="m3-btn-icon trigger-lopd-block-btn" data-id="${client.id}" data-name="${escapeHtml(client.nombre_empresa)}" title="Bloquear Cliente (LOPD/RGPD)" style="color: #b91c1c;">
          <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
        </button>
      `;
    }

    actionsHtml += `
      <button type="button" class="m3-btn-icon delete-client-btn" data-id="${client.id}" data-name="${escapeHtml(client.nombre_empresa)}" title="Eliminar Cliente" style="color: var(--color-error);">
        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      </button>
    `;

    const cupsBadgeHtml = (client.cups && client.cups.trim())
      ? `<small class="text-muted" style="font-family: monospace;">${escapeHtml(client.cups)}</small>`
      : `<span class="m3-chip" style="font-size:11px; height:22px; padding:0 6px; background-color: #fef08a !important; color: #854d0e !important; border: 1px solid #facc15 !important; font-weight: 600;" title="Cliente histórico sin código CUPS asignado">⚠️ Sin CUPS</span>`;

    tr.innerHTML = `
      <td><strong>${escapeHtml(client.nombre_empresa)}</strong></td>
      <td><code>${escapeHtml(client.cif)}</code></td>
      <td>${agentChip}</td>
      <td>${escapeHtml(client.representante || '-')}</td>
      <td>${cupsBadgeHtml}</td>
      <td>${escapeHtml(client.email || '-')}</td>
      <td>${clientTypeHtml}</td>
      <td>${statusBadgeHtml}</td>
      <td>${createdDate}</td>
      <td style="text-align: right; white-space: nowrap;">
        ${actionsHtml}
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

  // Registrar eventos para cambio de estado activo / inactivo
  tbody.querySelectorAll('.set-status-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const targetStatus = btn.getAttribute('data-target');
      const name = btn.getAttribute('data-name');

      let confirmMsg = "";
      if (targetStatus === 'inactivo') {
        confirmMsg = `¿Desea marcar al cliente "${name}" como Inactivo por cese de colaboración?\n\nEl cliente no aparecerá en el comparador ni generará alertas de renovación mientras permanezca inactivo.`;
      } else if (targetStatus === 'activo') {
        confirmMsg = `¿Desea reactivar al cliente "${name}" como Activo?`;
      }

      const confirmed = await showConfirm(confirmMsg, targetStatus === 'inactivo' ? 'Marcar como Inactivo' : 'Reactivar Cliente');
      if (confirmed) {
        try {
          await updateClienteEstado(id, targetStatus);
          showToast(`Estado del cliente actualizado a "${targetStatus}".`, "success");
          await loadClientsTable(currentClientPage);
        } catch (err) {
          showToast(`Error al actualizar estado: ${err.message || err}`, "error");
        }
      }
    });
  });

  // Registrar eventos para abrir modal de bloqueo LOPD
  tbody.querySelectorAll('.trigger-lopd-block-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const client = currentLoadedClients.find(c => c.id === id);
      if (client) {
        openLopdBlockModal(client);
      }
    });
  });

  // Registrar eventos para descargar certificado LOPD
  tbody.querySelectorAll('.download-lopd-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const client = currentLoadedClients.find(c => c.id === id);
      if (client) {
        try {
          await generateLopdCertificatePdf(client);
        } catch (err) {
          showToast(`Error al generar certificado LOPD: ${err.message || err}`, "error");
        }
      }
    });
  });

  // Registrar eventos para botones de borrar
  tbody.querySelectorAll('.delete-client-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const name = btn.getAttribute('data-name');
      
      const confirmDelete = await showConfirm(
        `¿Está seguro de eliminar al cliente "${name}"?\n\nEsta acción no se puede deshacer y eliminará automáticamente todas sus comparativas pendientes y rechazadas.`,
        "Eliminar Cliente"
      );

      if (confirmDelete) {
        try {
          await deleteCliente(id);
          showToast("Cliente y sus datos asociados eliminados correctamente.", "success");
          
          if (currentLoadedClients.length === 1 && currentClientPage > 1) {
            currentClientPage--;
          }
          await loadClientsTable(currentClientPage);
        } catch (e) {
          if (e.message === "OBLIGACION_LEGAL_RETENCION") {
            const client = currentLoadedClients.find(c => c.id === id);
            showLegalRetentionWarning(client);
          } else {
            showToast(`Error al eliminar cliente: ${e.message || e}`, "error");
          }
        }
      }
    });
  });
}

function showLegalRetentionWarning(client = null) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog-legal-retention-warn');
    const closeBtn = document.getElementById('dialog-legal-retention-close');
    const blockBtn = document.getElementById('dialog-legal-retention-block-btn');
    if (!overlay || !closeBtn) {
      resolve();
      return;
    }

    const cleanUp = () => {
      overlay.classList.remove('active');
      closeBtn.removeEventListener('click', onClose);
      if (blockBtn) blockBtn.removeEventListener('click', onBlock);
      resolve();
    };

    const onClose = () => {
      cleanUp();
    };

    const onBlock = () => {
      cleanUp();
      if (client) {
        openLopdBlockModal(client);
      }
    };

    closeBtn.addEventListener('click', onClose);
    if (blockBtn) {
      blockBtn.style.display = client ? 'inline-flex' : 'none';
      blockBtn.addEventListener('click', onBlock);
    }
    overlay.classList.add('active');
  });
}

function openLopdBlockModal(client) {
  if (!client) return;
  pendingLopdClient = client;

  const dialog = document.getElementById('dialog-client-lopd-block');
  const nameEl = document.getElementById('dialog-lopd-client-name');
  const checkbox = document.getElementById('check-confirm-lopd-block');
  const confirmBtn = document.getElementById('btn-confirm-lopd-block');

  if (!dialog || !nameEl || !checkbox || !confirmBtn) return;

  nameEl.textContent = `"${client.nombre_empresa}" (CIF: ${client.cif})`;
  checkbox.checked = false;
  confirmBtn.disabled = true;

  dialog.classList.add('active');
}

function setupLopdBlockDialog() {
  const dialog = document.getElementById('dialog-client-lopd-block');
  const checkbox = document.getElementById('check-confirm-lopd-block');
  const confirmBtn = document.getElementById('btn-confirm-lopd-block');
  const cancelBtn = document.getElementById('btn-cancel-lopd-block');

  if (!dialog || !checkbox || !confirmBtn || !cancelBtn) return;
  if (dialog.dataset.listenerAdded) return;
  dialog.dataset.listenerAdded = 'true';

  checkbox.addEventListener('change', () => {
    confirmBtn.disabled = !checkbox.checked;
  });

  cancelBtn.addEventListener('click', () => {
    dialog.classList.remove('active');
    pendingLopdClient = null;
  });

  confirmBtn.addEventListener('click', async () => {
    if (!pendingLopdClient) return;
    const client = pendingLopdClient;
    try {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Bloqueando...';
      await updateClienteEstado(client.id, 'bloqueado');
      dialog.classList.remove('active');
      showToast(`Cliente "${client.nombre_empresa}" bloqueado correctamente por LOPD/RGPD.`, 'success');
      await loadClientsTable(currentClientPage);
    } catch (err) {
      showToast(`Error al bloquear cliente: ${err.message || err}`, 'error');
    } finally {
      confirmBtn.textContent = 'Confirmar Bloqueo LOPD';
      confirmBtn.disabled = true;
      checkbox.checked = false;
      pendingLopdClient = null;
    }
  });
}

function setupStatusFilterDropdown() {
  const th = document.getElementById('th-client-status');
  const dropdown = document.getElementById('dropdown-client-status-filter');
  const arrow = document.getElementById('th-client-status-arrow');
  const label = document.getElementById('th-client-status-label');

  if (!th || !dropdown) return;
  if (th.dataset.filterInitialized) return;
  th.dataset.filterInitialized = 'true';

  th.addEventListener('click', (e) => {
    if (e.target.closest('#dropdown-client-status-filter')) return;
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
    if (arrow) {
      arrow.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  });

  dropdown.querySelectorAll('.status-filter-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = 'var(--color-surface-variant)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = 'transparent';
    });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const status = item.getAttribute('data-status') || '';
      currentStatusFilter = status;

      dropdown.querySelectorAll('.status-filter-item').forEach(el => {
        const check = el.querySelector('.status-filter-check');
        if (check) {
          check.style.display = el === item ? 'inline' : 'none';
        }
      });

      if (label) {
        if (!status) label.textContent = 'Estado';
        else if (status === 'activo') label.textContent = 'Estado: Activos';
        else if (status === 'inactivo') label.textContent = 'Estado: Inactivos';
        else if (status === 'bloqueado') label.textContent = 'Estado: Bloqueados';
      }

      dropdown.style.display = 'none';
      if (arrow) arrow.style.transform = 'rotate(0deg)';

      loadClientsTable(1);
    });
  });

  document.addEventListener('click', (e) => {
    if (!th.contains(e.target)) {
      dropdown.style.display = 'none';
      if (arrow) arrow.style.transform = 'rotate(0deg)';
    }
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

  const estadoGroup = document.getElementById('dialog-client-estado-group');
  const estadoSelect = document.getElementById('dialog-client-estado');
  if (estadoGroup) estadoGroup.style.display = 'block';
  if (estadoSelect) {
    estadoSelect.value = client.estado || 'activo';
  }

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


