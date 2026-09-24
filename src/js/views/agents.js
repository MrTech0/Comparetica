/* src/js/views/agents.js */

import {
  getAgentes,
  addAgente,
  updateAgente,
  toggleAgenteEstado,
  deleteAgente,
  reassignAgenteClientes,
  checkAgenteSetupStatus
} from '../db.js';
import { showToast, showConfirm } from '../ui.js';

let cachedAgents = [];
let agentToDeleteId = null;
let currentSortClients = null; // 'desc' | 'asc' | null

export async function initAgentsView() {
  setupDialogs();
  setupFormSubmit();
  setupReassignForm();
  setupClientsSort();

  const searchInput = document.getElementById('search-agents-input');
  if (searchInput && !searchInput.dataset.listenerAdded) {
    searchInput.addEventListener('input', () => {
      renderAgentsTable();
    });
    searchInput.dataset.listenerAdded = 'true';
  }

  await loadAgentsTable();
}

function setupDialogs() {
  const openBtn = document.getElementById('open-agent-dialog-btn');
  const closeBtn = document.getElementById('dialog-agent-close');
  const dialog = document.getElementById('dialog-agent');
  const form = document.getElementById('dialog-agent-form');

  if (!openBtn || !dialog || !closeBtn) return;

  openBtn.addEventListener('click', () => {
    document.getElementById('dialog-agent-title').innerText = "Registrar Agente Comercial";
    document.getElementById('dialog-agent-id').value = "";
    if (form) form.reset();
    dialog.classList.add('active');
  });

  closeBtn.addEventListener('click', () => {
    dialog.classList.remove('active');
  });
}

function setupFormSubmit() {
  const form = document.getElementById('dialog-agent-form');
  const dialog = document.getElementById('dialog-agent');

  if (!form || !dialog) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('dialog-agent-id').value;
    const nombre = document.getElementById('dialog-agent-name').value.trim();
    const telefono = document.getElementById('dialog-agent-phone').value.trim() || null;
    const email = document.getElementById('dialog-agent-email').value.trim() || null;

    if (!nombre) {
      showToast("El nombre del agente comercial es obligatorio.", "error");
      return;
    }

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Guardando...";
      }

      if (id) {
        await updateAgente(parseInt(id, 10), nombre, telefono, email);
        showToast("Agente comercial actualizado correctamente.", "success");
      } else {
        await addAgente(nombre, telefono, email);
        showToast("Agente comercial registrado correctamente.", "success");
      }

      dialog.classList.remove('active');
      form.reset();
      await loadAgentsTable();
    } catch (err) {
      console.error("Error al guardar agente:", err);
      showToast(`Error al guardar agente: ${err.message || err}`, "error");
    } finally {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = "Guardar Agente";
      }
    }
  });
}

function setupReassignForm() {
  const form = document.getElementById('dialog-reassign-form');
  const dialog = document.getElementById('dialog-reassign-agent');
  const cancelBtn = document.getElementById('dialog-reassign-cancel');

  if (!form || !dialog || !cancelBtn) return;

  cancelBtn.addEventListener('click', () => {
    dialog.classList.remove('active');
    agentToDeleteId = null;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldAgentId = parseInt(document.getElementById('dialog-reassign-old-agent-id').value, 10);
    const targetAgentId = parseInt(document.getElementById('dialog-reassign-target-agent').value, 10);

    if (!targetAgentId || isNaN(targetAgentId)) {
      showToast("Debes seleccionar un agente comercial de destino.", "error");
      return;
    }

    if (oldAgentId === targetAgentId) {
      showToast("El agente de destino no puede ser el mismo agente a eliminar.", "error");
      return;
    }

    try {
      await reassignAgenteClientes(oldAgentId, targetAgentId);
      await deleteAgente(oldAgentId);
      showToast("Clientes transferidos y agente eliminado correctamente.", "success");

      dialog.classList.remove('active');
      agentToDeleteId = null;
      await loadAgentsTable();
    } catch (err) {
      console.error("Error al reasignar y eliminar agente:", err);
      showToast(`Error al reasignar clientes: ${err.message || err}`, "error");
    }
  });
}

export async function loadAgentsTable() {
  try {
    cachedAgents = await getAgentes();
    renderAgentsTable();
  } catch (err) {
    console.error("Error al cargar la tabla de agentes:", err);
  }
}

function renderAgentsTable() {
  const tbody = document.getElementById('table-agents-body');
  if (!tbody) return;

  const searchInput = document.getElementById('search-agents-input');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filtered = cachedAgents.filter(a => {
    const name = (a.nombre || '').toLowerCase();
    const phone = (a.telefono || '').toLowerCase();
    const email = (a.email || '').toLowerCase();
    return name.includes(query) || phone.includes(query) || email.includes(query);
  });

  if (currentSortClients === 'desc') {
    filtered.sort((a, b) => (b.num_clientes || 0) - (a.num_clientes || 0));
  } else if (currentSortClients === 'asc') {
    filtered.sort((a, b) => (a.num_clientes || 0) - (b.num_clientes || 0));
  }

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--color-outline); padding: 32px 16px;">
          ${query ? 'No se encontraron agentes que coincidan con la búsqueda.' : 'No hay agentes registrados. Haga clic en \'Nuevo Agente\' para registrar uno.'}
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(agent => {
    const tr = document.createElement('tr');

    const statusChip = agent.activo === 1
      ? `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; background-color: #bbf7d0; color: #166534; border: 1px solid #4ade80; font-weight: 600;">Activo</span>`
      : `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; background-color: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; font-weight: 600;">Inactivo</span>`;

    const clientCountBadge = `<span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px; background-color: var(--color-primary-container); color: var(--color-on-primary-container); font-weight: 700;">${agent.num_clientes || 0}</span>`;

    tr.innerHTML = `
      <td><strong>${escapeHtml(agent.nombre)}</strong></td>
      <td>${escapeHtml(agent.telefono || '-')}</td>
      <td>${escapeHtml(agent.email || '-')}</td>
      <td>${clientCountBadge}</td>
      <td>${statusChip}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button type="button" class="m3-btn-icon edit-agent-btn" data-id="${agent.id}" title="Editar Agente">
          <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>
        <button type="button" class="m3-btn-icon toggle-agent-btn" data-id="${agent.id}" data-active="${agent.activo}" title="${agent.activo === 1 ? 'Desactivar Agente' : 'Activar Agente'}">
          ${agent.activo === 1 
            ? `<svg viewBox="0 0 24 24" style="color:var(--color-warning);"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`
            : `<svg viewBox="0 0 24 24" style="color:var(--color-success);"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`}
        </button>
        <button type="button" class="m3-btn-icon delete-agent-btn" data-id="${agent.id}" data-name="${escapeHtml(agent.nombre)}" title="Eliminar Agente" style="color: var(--color-error);">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Eventos de Editar
  tbody.querySelectorAll('.edit-agent-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const agent = cachedAgents.find(a => a.id === id);
      if (agent) {
        document.getElementById('dialog-agent-title').innerText = "Editar Agente Comercial";
        document.getElementById('dialog-agent-id').value = agent.id;
        document.getElementById('dialog-agent-name').value = agent.nombre;
        document.getElementById('dialog-agent-phone').value = agent.telefono || '';
        document.getElementById('dialog-agent-email').value = agent.email || '';
        document.getElementById('dialog-agent').classList.add('active');
      }
    });
  });

  // Eventos de Activar/Desactivar
  tbody.querySelectorAll('.toggle-agent-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const active = parseInt(btn.getAttribute('data-active'), 10) === 1;
      const agent = cachedAgents.find(a => a.id === id);
      
      const actionText = active ? "desactivar" : "activar";
      const confirm = await showConfirm(
        `¿Está seguro de ${actionText} al agente comercial "${agent?.nombre || ''}"?`,
        `${active ? 'Desactivar' : 'Activar'} Agente`
      );

      if (confirm) {
        try {
          await toggleAgenteEstado(id, !active);
          showToast(`Agente ${active ? 'desactivado' : 'activado'} correctamente.`, "success");
          await loadAgentsTable();
        } catch (err) {
          showToast(`Error al cambiar estado: ${err.message || err}`, "error");
        }
      }
    });
  });

  // Eventos de Eliminar
  tbody.querySelectorAll('.delete-agent-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.getAttribute('data-id'), 10);
      const name = btn.getAttribute('data-name');

      const confirmDelete = await showConfirm(
        `¿Está seguro de eliminar al agente comercial "${name}"?`,
        "Eliminar Agente"
      );

      if (confirmDelete) {
        try {
          await deleteAgente(id);
          showToast("Agente comercial eliminado correctamente.", "success");
          await loadAgentsTable();
        } catch (err) {
          if (err.message && err.message.startsWith("TIENE_CLIENTES_ASIGNADOS")) {
            const count = err.message.split(":")[1] || "varios";
            openReassignDialog(id, name, count);
          } else {
            showToast(`Error al eliminar agente: ${err.message || err}`, "error");
          }
        }
      }
    });
  });
}

function openReassignDialog(oldAgentId, oldAgentName, count) {
  const dialog = document.getElementById('dialog-reassign-agent');
  const select = document.getElementById('dialog-reassign-target-agent');
  const desc = document.getElementById('dialog-reassign-desc');
  const hiddenId = document.getElementById('dialog-reassign-old-agent-id');

  if (!dialog || !select || !desc || !hiddenId) return;

  hiddenId.value = oldAgentId;
  agentToDeleteId = oldAgentId;

  desc.innerHTML = `El agente <strong>${escapeHtml(oldAgentName)}</strong> tiene <strong>${count} clientes</strong> asignados. Para poder eliminarlo, debes seleccionar a qué otro comercial deseas transferir sus clientes:`;

  select.innerHTML = '<option value="">-- Seleccionar Agente Comercial de Destino --</option>';
  cachedAgents.filter(a => a.id !== oldAgentId && a.activo === 1).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.nombre;
    select.appendChild(opt);
  });

  dialog.classList.add('active');
}

/**
 * Comprueba si la aplicación requiere la configuración inicial del Agente Principal.
 * Muestra una modal emergente si no hay agentes creados o si hay clientes sin asignar.
 */
export async function ensureInitialAgentFlow() {
  // 1. Si el modal de la consultora está activo o el primer inicio no se ha completado, postergar la apertura para evitar solapamientos
  const welcomeWizard = document.getElementById('dialog-welcome-wizard');
  if (welcomeWizard && welcomeWizard.classList.contains('active')) {
    return;
  }

  const isFirstRunCompleted = localStorage.getItem('first_run_completed');
  if (!isFirstRunCompleted) {
    return;
  }

  const status = await checkAgenteSetupStatus();

  // Si ya existen agentes creados en la base de datos:
  if (status.hasAgents) {
    // Si quedan clientes sin agente asignado (por migración), vincularlos automáticamente al primer agente activo
    if (status.unassignedCount > 0 && status.agents.length > 0) {
      await reassignAgenteClientes(null, status.agents[0].id);
    }
    return;
  }

  const dialog = document.getElementById('dialog-initial-agent-setup');
  const form = document.getElementById('form-initial-agent-setup');

  if (!dialog || !form) return;

  dialog.classList.add('active');

  if (!form.dataset.listenerAdded) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('initial-agent-name').value.trim();
      const phone = document.getElementById('initial-agent-phone').value.trim() || null;
      const email = document.getElementById('initial-agent-email').value.trim() || null;

      if (!name) {
        showToast("El nombre del comercial principal es obligatorio.", "error");
        return;
      }

      try {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerText = "Guardando...";
        }

        // 1. Crear el primer agente
        const res = await addAgente(name, phone, email);
        const newAgentId = res && res.lastInsertId ? res.lastInsertId : 1;

        // 2. Asignar todos los clientes sin agente a este nuevo agente
        await reassignAgenteClientes(null, newAgentId);

        showToast("Agente comercial principal configurado correctamente.", "success");
        dialog.classList.remove('active');
        form.reset();
      } catch (err) {
        console.error("Error al configurar agente principal:", err);
        showToast(`Error al configurar agente principal: ${err.message || err}`, "error");
      } finally {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Guardar Comercial Principal y Asignar Clientes";
        }
      }
    });

    form.dataset.listenerAdded = 'true';
  }
}

function setupClientsSort() {
  const th = document.getElementById('th-agent-clients-count');
  if (!th || th.dataset.sortInitialized) return;
  th.dataset.sortInitialized = 'true';

  th.addEventListener('click', () => {
    if (!currentSortClients) {
      currentSortClients = 'desc';
    } else if (currentSortClients === 'desc') {
      currentSortClients = 'asc';
    } else {
      currentSortClients = 'desc';
    }
    updateClientsSortIndicator();
    renderAgentsTable();
  });
}

function updateClientsSortIndicator() {
  const arrow = document.getElementById('th-agent-clients-arrow');
  if (!arrow) return;
  if (currentSortClients === 'desc') {
    arrow.textContent = '↓';
    arrow.title = 'Orden actual: Mayor a menor';
    arrow.style.color = 'var(--color-primary)';
    arrow.style.fontWeight = 'bold';
  } else if (currentSortClients === 'asc') {
    arrow.textContent = '↑';
    arrow.title = 'Orden actual: Menor a mayor';
    arrow.style.color = 'var(--color-primary)';
    arrow.style.fontWeight = 'bold';
  } else {
    arrow.textContent = '↕';
    arrow.title = 'Haga clic para ordenar';
    arrow.style.color = 'var(--color-on-surface-variant)';
    arrow.style.fontWeight = 'normal';
  }
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
