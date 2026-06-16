/* src/js/views/clients.js */

import { getClientes, addCliente, updateCliente, deleteCliente } from '../db.js';

export async function initClientsView() {
  setupDialogs();
  setupFormSubmit();
  await loadClientsTable();
}

function setupDialogs() {
  const openBtn = document.getElementById('open-client-dialog-btn');
  const closeBtn = document.getElementById('dialog-client-close');
  const dialog = document.getElementById('dialog-client');
  const form = document.getElementById('dialog-client-form');

  if (!openBtn || !dialog || !closeBtn) return;

  // Abrir diálogo de creación
  openBtn.addEventListener('click', () => {
    document.getElementById('dialog-client-title').innerText = "Registrar Cliente";
    document.getElementById('dialog-client-id').value = "";
    if (form) form.reset();
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
    const cups = document.getElementById('dialog-client-cups').value.trim().toUpperCase();

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerText = "Guardando...";

      if (id) {
        // Actualizar
        await updateCliente(parseInt(id), nombre, cif, representante, cups);
        window.showToast("Cliente actualizado correctamente.", "success");
      } else {
        // Registrar nuevo
        await addCliente(nombre, cif, representante, cups);
        window.showToast("Cliente registrado correctamente.", "success");
      }

      dialog.classList.remove('active');
      form.reset();
      
      // Recargar tabla de clientes
      await loadClientsTable();
    } catch (err) {
      console.error(err);
      if (err.message && err.message.includes("UNIQUE constraint failed")) {
        window.showToast("Error: Ya existe un cliente registrado con ese DNI / CIF.", "error");
      } else {
        window.showToast(`Error al guardar cliente: ${err}`, "error");
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

export async function loadClientsTable() {
  const tbody = document.getElementById('table-clients-body');
  if (!tbody) return;

  try {
    const clients = await getClientes();
    tbody.innerHTML = '';

    if (clients.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--color-outline); padding: 32px 16px;">
            No hay clientes registrados en la base de datos. Haga clic en 'Nuevo Cliente' para empezar.
          </td>
        </tr>
      `;
      updateClientsDatalist([]);
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

      tr.innerHTML = `
        <td><strong>${escapeHtml(client.nombre_empresa)}</strong></td>
        <td><code>${escapeHtml(client.cif)}</code></td>
        <td>${escapeHtml(client.representante || '-')}</td>
        <td><small class="text-muted">${escapeHtml(client.cups || '-')}</small></td>
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
        const id = parseInt(btn.getAttribute('data-id'));
        const client = clients.find(c => c.id === id);
        if (client) {
          openEditDialog(client);
        }
      });
    });

    // Registrar eventos para botones de borrar
    tbody.querySelectorAll('.delete-client-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'));
        const name = btn.getAttribute('data-name');
        
        const confirmDelete = await window.showConfirm(
          `¿Está seguro de eliminar al cliente "${name}"?\n\nEsta acción no se puede deshacer y desvinculará sus datos.`,
          "Eliminar Cliente"
        );

        if (confirmDelete) {
          try {
            await deleteCliente(id);
            window.showToast("Cliente eliminado correctamente.", "success");
            await loadClientsTable();
          } catch (e) {
            window.showToast(`Error al eliminar cliente: ${e}`, "error");
          }
        }
      });
    });

    // Actualizar el autocompletado en el comparador
    updateClientsDatalist(clients);
  } catch (err) {
    console.error("Error al cargar la tabla de clientes:", err);
  }
}

function openEditDialog(client) {
  const dialog = document.getElementById('dialog-client');
  if (!dialog) return;

  document.getElementById('dialog-client-title').innerText = "Editar Cliente";
  document.getElementById('dialog-client-id').value = client.id;
  document.getElementById('dialog-client-name').value = client.nombre_empresa;
  document.getElementById('dialog-client-cif').value = client.cif;
  document.getElementById('dialog-client-rep').value = client.representante || "";
  document.getElementById('dialog-client-cups').value = client.cups || "";

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
