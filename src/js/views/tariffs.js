/* src/js/views/tariffs.js */

import {
  getComercializadoras,
  addComercializadora,
  deleteComercializadora,
  getTarifasLuz,
  addTarifaLuz,
  updateTarifaLuz,
  deleteTarifaLuz,
  getTarifasGas,
  addTarifaGas,
  updateTarifaGas,
  deleteTarifaGas
} from '../db.js';

// ==========================================
// INICIALIZACIÓN DE LA VISTA
// ==========================================
export async function initTariffsView() {
  setupTabs();
  setupComercializadoras();
  setupTarifasLuz();
  setupTarifasGas();

  // Cargar datos iniciales
  await loadComercializadoras();
  await loadTarifasLuz();
  await loadTarifasGas();
}

// --- Tabs Management ---
function setupTabs() {
  const tabs = [
    { btn: 'tab-btn-comercializadoras', panel: 'panel-comercializadoras' },
    { btn: 'tab-btn-luz', panel: 'panel-luz' },
    { btn: 'tab-btn-gas', panel: 'panel-gas' }
  ];

  tabs.forEach(tab => {
    document.getElementById(tab.btn).addEventListener('click', () => {
      // Remover active de todos los botones y ocultar todos los paneles
      tabs.forEach(t => {
        document.getElementById(t.btn).classList.remove('active');
        document.getElementById(t.panel).style.display = 'none';
      });

      // Activar el seleccionado
      document.getElementById(tab.btn).classList.add('active');
      document.getElementById(tab.panel).style.display = 'block';
    });
  });
}

// ==========================================
// COMERCIALIZADORAS
// ==========================================
function setupComercializadoras() {
  const addBtn = document.getElementById('add-comercializadora-btn');
  const input = document.getElementById('new-comercializadora-name');

  addBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;

    try {
      await addComercializadora(name);
      input.value = '';
      await loadComercializadoras();
      // Actualizar selectores en diálogos
      await updateComercializadorasSelectors();
    } catch (error) {
      if (window.showToast) {
        window.showToast("Error al guardar la comercializadora. Asegúrese de que el nombre sea único.", "error");
      } else {
        alert("Error al guardar la comercializadora. Asegúrese de que el nombre sea único.");
      }
      console.error(error);
    }
  });
}

async function loadComercializadoras() {
  const tbody = document.querySelector('#table-comercializadoras tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="text-muted">Cargando...</td></tr>';

  try {
    const list = await getComercializadoras();
    tbody.innerHTML = '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No hay comercializadoras registradas.</td></tr>';
      return;
    }

    list.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${c.id}</td>
        <td><strong>${escapeHtml(c.nombre)}</strong></td>
        <td>${new Date(c.creado_en).toLocaleDateString()}</td>
        <td style="text-align: right;">
          <button class="m3-btn-icon btn-delete" data-id="${c.id}" title="Eliminar comercializadora y sus tarifas">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Eventos de borrado
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (confirm("¿Está seguro de eliminar esta comercializadora? Se borrarán todas sus tarifas asociadas.")) {
          await deleteComercializadora(id);
          await loadComercializadoras();
          await loadTarifasLuz();
          await loadTarifasGas();
          await updateComercializadorasSelectors();
        }
      });
    });
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-error">Error al cargar comercializadoras.</td></tr>';
    console.error(error);
  }
}

// ==========================================
// TARIFAS LUZ (2.0TD)
// ==========================================
function setupTarifasLuz() {
  const dialog = document.getElementById('dialog-light');
  const openBtn = document.getElementById('open-light-dialog-btn');
  const closeBtn = document.getElementById('dialog-light-close');
  const form = document.getElementById('dialog-light-form');

  openBtn.addEventListener('click', () => {
    document.getElementById('dialog-light-title').innerText = "Registrar Tarifa Luz 2.0TD";
    document.getElementById('dialog-light-id').value = "";
    form.reset();
    dialog.classList.add('active');
  });

  closeBtn.addEventListener('click', () => {
    dialog.classList.remove('active');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('dialog-light-id').value;
    const comercializadoraId = parseInt(document.getElementById('dialog-light-com').value);
    const nombre = document.getElementById('dialog-light-name').value.trim();
    const potenciaP1 = parseFloat(document.getElementById('dialog-light-p1-pot').value);
    const potenciaP2 = parseFloat(document.getElementById('dialog-light-p2-pot').value);
    const energiaP1 = parseFloat(document.getElementById('dialog-light-p1-ene').value);
    const energiaP2 = parseFloat(document.getElementById('dialog-light-p2-ene').value);
    const energiaP3 = parseFloat(document.getElementById('dialog-light-p3-ene').value);
    const comision = parseFloat(document.getElementById('dialog-light-commission').value);
    const notas = document.getElementById('dialog-light-notes').value.trim();

    try {
      if (id) {
        await updateTarifaLuz(parseInt(id), nombre, potenciaP1, potenciaP2, energiaP1, energiaP2, energiaP3, comision, notas);
      } else {
        await addTarifaLuz(comercializadoraId, nombre, potenciaP1, potenciaP2, energiaP1, energiaP2, energiaP3, comision, notas);
      }
      dialog.classList.remove('active');
      await loadTarifasLuz();
    } catch (error) {
      if (window.showToast) {
        window.showToast("Error al guardar la tarifa. Verifique que no exista una con el mismo nombre para esa comercializadora.", "error");
      } else {
        alert("Error al guardar la tarifa. Verifique que no exista una con el mismo nombre para esa comercializadora.");
      }
      console.error(error);
    }
  });
}

async function loadTarifasLuz() {
  const tbody = document.querySelector('#table-luz tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Cargando...</td></tr>';

  try {
    const list = await getTarifasLuz();
    tbody.innerHTML = '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No hay tarifas de luz registradas.</td></tr>';
      return;
    }

    list.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(t.comercializadora_nombre)}</strong></td>
        <td>${escapeHtml(t.nombre)}</td>
        <td>P1: ${t.potencia_p1.toFixed(6)}<br>P2: ${t.potencia_p2.toFixed(6)}</td>
        <td>P1: ${t.energia_p1.toFixed(6)}<br>P2: ${t.energia_p2.toFixed(6)}<br>P3: ${t.energia_p3.toFixed(6)}</td>
        <td class="private-value">${t.comision.toFixed(2)} €</td>
        <td><small class="text-muted">${escapeHtml(t.notas || '-')}</small></td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="m3-btn-icon btn-edit" data-id="${t.id}" title="Editar tarifa">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="m3-btn-icon btn-delete" data-id="${t.id}" title="Eliminar tarifa">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Acciones de edición
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = list.find(item => item.id === parseInt(btn.dataset.id));
        if (!t) return;

        document.getElementById('dialog-light-title').innerText = "Editar Tarifa Luz 2.0TD";
        document.getElementById('dialog-light-id').value = t.id;
        document.getElementById('dialog-light-com').value = t.comercializadora_id;
        document.getElementById('dialog-light-name').value = t.nombre;
        document.getElementById('dialog-light-p1-pot').value = t.potencia_p1;
        document.getElementById('dialog-light-p2-pot').value = t.potencia_p2;
        document.getElementById('dialog-light-p1-ene').value = t.energia_p1;
        document.getElementById('dialog-light-p2-ene').value = t.energia_p2;
        document.getElementById('dialog-light-p3-ene').value = t.energia_p3;
        document.getElementById('dialog-light-commission').value = t.comision;
        document.getElementById('dialog-light-notes').value = t.notas || "";

        document.getElementById('dialog-light').classList.add('active');
      });
    });

    // Acciones de borrado
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (confirm("¿Está seguro de eliminar esta tarifa de luz?")) {
          await deleteTarifaLuz(id);
          await loadTarifasLuz();
        }
      });
    });

  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-error">Error al cargar tarifas de luz.</td></tr>';
    console.error(error);
  }
}

// ==========================================
// TARIFAS GAS (RL.1)
// ==========================================
function setupTarifasGas() {
  const dialog = document.getElementById('dialog-gas');
  const openBtn = document.getElementById('open-gas-dialog-btn');
  const closeBtn = document.getElementById('dialog-gas-close');
  const form = document.getElementById('dialog-gas-form');

  openBtn.addEventListener('click', () => {
    document.getElementById('dialog-gas-title').innerText = "Registrar Tarifa Gas RL.1";
    document.getElementById('dialog-gas-id').value = "";
    form.reset();
    dialog.classList.add('active');
  });

  closeBtn.addEventListener('click', () => {
    dialog.classList.remove('active');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('dialog-gas-id').value;
    const comercializadoraId = parseInt(document.getElementById('dialog-gas-com').value);
    const nombre = document.getElementById('dialog-gas-name').value.trim();
    const terminoFijo = parseFloat(document.getElementById('dialog-gas-fixed').value);
    const terminoVariable = parseFloat(document.getElementById('dialog-gas-var').value);
    const comision = parseFloat(document.getElementById('dialog-gas-commission').value);
    const notas = document.getElementById('dialog-gas-notes').value.trim();

    try {
      if (id) {
        await updateTarifaGas(parseInt(id), nombre, terminoFijo, terminoVariable, comision, notas);
      } else {
        await addTarifaGas(comercializadoraId, nombre, terminoFijo, terminoVariable, comision, notas);
      }
      dialog.classList.remove('active');
      await loadTarifasGas();
    } catch (error) {
      if (window.showToast) {
        window.showToast("Error al guardar la tarifa. Verifique que no exista una con el mismo nombre para esa comercializadora.", "error");
      } else {
        alert("Error al guardar la tarifa. Verifique que no exista una con el mismo nombre para esa comercializadora.");
      }
      console.error(error);
    }
  });
}

async function loadTarifasGas() {
  const tbody = document.querySelector('#table-gas tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Cargando...</td></tr>';

  try {
    const list = await getTarifasGas();
    tbody.innerHTML = '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No hay tarifas de gas registradas.</td></tr>';
      return;
    }

    list.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(t.comercializadora_nombre)}</strong></td>
        <td>${escapeHtml(t.nombre)}</td>
        <td>${t.termino_fijo.toFixed(6)} €/mes</td>
        <td>${t.termino_variable.toFixed(6)} €/kWh</td>
        <td class="private-value">${t.comision.toFixed(2)} €</td>
        <td><small class="text-muted">${escapeHtml(t.notes || '-')}</small></td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="m3-btn-icon btn-edit" data-id="${t.id}" title="Editar tarifa">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="m3-btn-icon btn-delete" data-id="${t.id}" title="Eliminar tarifa">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = list.find(item => item.id === parseInt(btn.dataset.id));
        if (!t) return;

        document.getElementById('dialog-gas-title').innerText = "Editar Tarifa Gas RL.1";
        document.getElementById('dialog-gas-id').value = t.id;
        document.getElementById('dialog-gas-com').value = t.comercializadora_id;
        document.getElementById('dialog-gas-name').value = t.nombre;
        document.getElementById('dialog-gas-fixed').value = t.termino_fijo;
        document.getElementById('dialog-gas-var').value = t.termino_variable;
        document.getElementById('dialog-gas-commission').value = t.comision;
        document.getElementById('dialog-gas-notes').value = t.notes || "";

        document.getElementById('dialog-gas').classList.add('active');
      });
    });

    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (confirm("¿Está seguro de eliminar esta tarifa de gas?")) {
          await deleteTarifaGas(id);
          await loadTarifasGas();
        }
      });
    });

  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-error">Error al cargar tarifas de gas.</td></tr>';
    console.error(error);
  }
}

// ==========================================
// SELECTORES DE DIÁLOGOS
// ==========================================
export async function updateComercializadorasSelectors() {
  try {
    const list = await getComercializadoras();
    const selectLuz = document.getElementById('dialog-light-com');
    const selectGas = document.getElementById('dialog-gas-com');

    const optionsHtml = list.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
    
    selectLuz.innerHTML = optionsHtml || '<option value="">-- Sin comercializadoras --</option>';
    selectGas.innerHTML = optionsHtml || '<option value="">-- Sin comercializadoras --</option>';
  } catch (error) {
    console.error("Error al actualizar selectores de comercializadoras:", error);
  }
}

// ==========================================
// AUXILIAR FUNCTIONS
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
