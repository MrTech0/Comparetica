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
} from '../db.js';
import { M3DateRangePicker } from '../components/date_range_picker.js';

let lightDatePicker = null;
let gasDatePicker = null;

// ==========================================
// INICIALIZACIÓN DE LA VISTA
// ==========================================
export async function initTariffsView() {
  setupTabs();
  setupComercializadoras();
  setupTarifasLuz();
  setupTarifasGas();

  // Inicializar constructores de tramos
  setupComisionTramosBuilder('light');
  setupComisionTramosBuilder('gas');

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
        if (await window.showConfirm("¿Está seguro de eliminar esta comercializadora? Se borrarán todas sus tarifas asociadas.", "Eliminar Comercializadora")) {
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
// TARIFAS LUZ
// ==========================================
function setupTarifasLuz() {
  const dialog = document.getElementById('dialog-light');
  const openBtn = document.getElementById('open-light-dialog-btn');
  const closeBtn = document.getElementById('dialog-light-close');
  const form = document.getElementById('dialog-light-form');
  const typeSelect = document.getElementById('dialog-light-tariff-type');
  const extraPotRow = document.getElementById('dialog-light-30td-pot-row');
  const extraEneRow = document.getElementById('dialog-light-30td-ene-row');

  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      const is30td = typeSelect.value === '3.0TD';
      if (extraPotRow) extraPotRow.style.display = is30td ? 'flex' : 'none';
      if (extraEneRow) extraEneRow.style.display = is30td ? 'flex' : 'none';

      // Configurar campos requeridos
      const extraInputs = [
        'dialog-light-p3-pot', 'dialog-light-p4-pot', 'dialog-light-p5-pot', 'dialog-light-p6-pot',
        'dialog-light-p4-ene', 'dialog-light-p5-ene', 'dialog-light-p6-ene'
      ];
      extraInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          if (is30td) {
            el.setAttribute('required', 'required');
          } else {
            el.removeAttribute('required');
            el.value = "";
          }
        }
      });
    });
  }

  openBtn.addEventListener('click', () => {
    document.getElementById('dialog-light-title').innerText = "Registrar Tarifa Luz";
    document.getElementById('dialog-light-id').value = "";
    form.reset();
    if (typeSelect) {
      typeSelect.value = '2.0TD';
      typeSelect.dispatchEvent(new Event('change'));
    }
    const comTipo = document.getElementById('dialog-light-comision-tipo');
    if (comTipo) {
      comTipo.value = 'fija';
      comTipo.dispatchEvent(new Event('change'));
    }
    const tramosContainer = document.getElementById('dialog-light-tramos-container');
    if (tramosContainer) tramosContainer.innerHTML = '';
    dialog.classList.add('active');
  });

  closeBtn.addEventListener('click', () => {
    dialog.classList.remove('active');
  });

  const filterType = document.getElementById('filter-light-type');
  if (filterType) {
    filterType.addEventListener('change', () => loadTarifasLuz());
  }

  lightDatePicker = new M3DateRangePicker('filter-light-date-range-container', () => {
    loadTarifasLuz();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('dialog-light-id').value;
    const comercializadoraId = parseInt(document.getElementById('dialog-light-com').value);
    const nombre = document.getElementById('dialog-light-name').value.trim();
    const tipoTarifa = typeSelect ? typeSelect.value : '2.0TD';

    // UI potencies are daily (€/kW/day). Multiply by 365 for annual database storage.
    const potenciaP1 = parseFloat(document.getElementById('dialog-light-p1-pot').value) * 365;
    const potenciaP2 = parseFloat(document.getElementById('dialog-light-p2-pot').value) * 365;
    const potenciaP3 = parseFloat(document.getElementById('dialog-light-p3-pot').value || 0) * 365;
    const potenciaP4 = parseFloat(document.getElementById('dialog-light-p4-pot').value || 0) * 365;
    const potenciaP5 = parseFloat(document.getElementById('dialog-light-p5-pot').value || 0) * 365;
    const potenciaP6 = parseFloat(document.getElementById('dialog-light-p6-pot').value || 0) * 365;

    const energiaP1 = parseFloat(document.getElementById('dialog-light-p1-ene').value);
    const energiaP2 = parseFloat(document.getElementById('dialog-light-p2-ene').value);
    const energiaP3 = parseFloat(document.getElementById('dialog-light-p3-ene').value);
    const energiaP4 = parseFloat(document.getElementById('dialog-light-p4-ene').value || 0);
    const energiaP5 = parseFloat(document.getElementById('dialog-light-p5-ene').value || 0);
    const energiaP6 = parseFloat(document.getElementById('dialog-light-p6-ene').value || 0);

    const excedente = parseFloat(document.getElementById('dialog-light-excedente').value || 0);

    let comision = 0;
    let comisionTramos = null;
    const comisionTipo = document.getElementById('dialog-light-comision-tipo').value;
    if (comisionTipo === 'fija') {
      comision = parseFloat(document.getElementById('dialog-light-commission').value || 0);
    } else {
      const rows = document.querySelectorAll('#dialog-light-tramos-container .comision-tramo-row');
      const tramos = [];
      rows.forEach(row => {
        const hasta = parseFloat(row.querySelector('.tramo-hasta').value);
        const valCom = parseFloat(row.querySelector('.tramo-comision').value);
        if (!isNaN(hasta) && !isNaN(valCom)) {
          tramos.push({ hasta, comision: valCom });
        }
      });
      tramos.sort((a, b) => a.hasta - b.hasta);
      comisionTramos = JSON.stringify(tramos);
    }

    const notas = document.getElementById('dialog-light-notes').value.trim();

    try {
      if (id) {
        await updateTarifaLuz(
          parseInt(id), nombre, tipoTarifa,
          potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
          energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
          excedente, comision, comisionTramos, notas
        );
      } else {
        await addTarifaLuz(
          comercializadoraId, nombre, tipoTarifa,
          potenciaP1, potenciaP2, potenciaP3, potenciaP4, potenciaP5, potenciaP6,
          energiaP1, energiaP2, energiaP3, energiaP4, energiaP5, energiaP6,
          excedente, comision, comisionTramos, notas
        );
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
  tbody.innerHTML = '<tr><td colspan="8" class="text-muted">Cargando...</td></tr>';

  try {
    const list = await getTarifasLuz();
    tbody.innerHTML = '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No hay tarifas de luz registradas.</td></tr>';
      return;
    }

    let filteredList = list;

    // Filtrar por Tipo de Tarifa
    const filterType = document.getElementById('filter-light-type')?.value || 'ALL';
    if (filterType !== 'ALL') {
      filteredList = filteredList.filter(t => t.tipo_tarifa === filterType);
    }

    // Filtrar por Rango de Fechas
    if (lightDatePicker && lightDatePicker.startDate) {
      const startBoundary = new Date(lightDatePicker.startDate);
      startBoundary.setHours(0, 0, 0, 0);

      const endBoundary = lightDatePicker.endDate ? new Date(lightDatePicker.endDate) : new Date(startBoundary);
      endBoundary.setHours(0, 0, 0, 0);

      filteredList = filteredList.filter(t => {
        if (!t.creado_en) return false;
        const itemDate = new Date(t.creado_en.replace(' ', 'T'));
        itemDate.setHours(0, 0, 0, 0);
        return itemDate >= startBoundary && itemDate <= endBoundary;
      });
    }

    if (filteredList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No hay tarifas de luz que coincidan con los filtros.</td></tr>';
      return;
    }

    filteredList.forEach(t => {
      const tr = document.createElement('tr');

      const dailyP1 = t.potencia_p1 / 365;
      const dailyP2 = t.potencia_p2 / 365;
      let potHtml = `P1: ${dailyP1.toFixed(7)} &euro;/d&iacute;a (${t.potencia_p1.toFixed(7)} &euro;/a&ntilde;o)<br>P2: ${dailyP2.toFixed(7)} &euro;/d&iacute;a (${t.potencia_p2.toFixed(7)} &euro;/a&ntilde;o)`;
      if (t.tipo_tarifa === '3.0TD') {
        const dailyP3 = (t.potencia_p3 || 0) / 365;
        const dailyP4 = (t.potencia_p4 || 0) / 365;
        const dailyP5 = (t.potencia_p5 || 0) / 365;
        const dailyP6 = (t.potencia_p6 || 0) / 365;
        potHtml += `<br>P3: ${dailyP3.toFixed(7)} &euro;/d&iacute;a (${(t.potencia_p3 || 0).toFixed(7)} &euro;/a&ntilde;o)<br>P4: ${dailyP4.toFixed(7)} &euro;/d&iacute;a (${(t.potencia_p4 || 0).toFixed(7)} &euro;/a&ntilde;o)<br>P5: ${dailyP5.toFixed(7)} &euro;/d&iacute;a (${(t.potencia_p5 || 0).toFixed(7)} &euro;/a&ntilde;o)<br>P6: ${dailyP6.toFixed(7)} &euro;/d&iacute;a (${(t.potencia_p6 || 0).toFixed(7)} &euro;/a&ntilde;o)`;
      }

      let eneHtml = `P1: ${t.energia_p1.toFixed(7)} &euro;/kWh<br>P2: ${t.energia_p2.toFixed(7)} &euro;/kWh<br>P3: ${t.energia_p3.toFixed(7)} &euro;/kWh`;
      if (t.tipo_tarifa === '3.0TD') {
        eneHtml += `<br>P4: ${(t.energia_p4 || 0).toFixed(7)} &euro;/kWh<br>P5: ${(t.energia_p5 || 0).toFixed(7)} &euro;/kWh<br>P6: ${(t.energia_p6 || 0).toFixed(7)} &euro;/kWh`;
      }
      if (t.excedente) {
        eneHtml += `<br><span class="text-success" style="font-weight: 500;">Exc: ${t.excedente.toFixed(7)} &euro;/kWh</span>`;
      }

      let comisionHtml = '';
      if (t.comision_tramos) {
        try {
          const tramos = JSON.parse(t.comision_tramos);
          if (Array.isArray(tramos) && tramos.length > 0) {
            comisionHtml = tramos.map(tr => `&le; ${tr.hasta} kWh: ${tr.comision.toFixed(2)} &euro;`).join('<br>');
          } else {
            comisionHtml = `${t.comision.toFixed(2)} &euro;`;
          }
        } catch (e) {
          comisionHtml = `${t.comision.toFixed(2)} &euro;`;
        }
      } else {
        comisionHtml = `${t.comision.toFixed(2)} &euro;`;
      }

      tr.innerHTML = `
        <td><strong>${escapeHtml(t.comercializadora_nombre)}</strong></td>
        <td>${escapeHtml(t.nombre)}</td>
        <td><span class="m3-chip" style="font-size: 9px; height: 18px; padding: 0 6px;">${t.tipo_tarifa || '2.0TD'}</span></td>
        <td>${potHtml}</td>
        <td>${eneHtml}</td>
        <td class="private-value">${comisionHtml}</td>
        <td><small class="text-muted">${escapeHtml(t.notas || t.notes || '-')}</small></td>
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

        document.getElementById('dialog-light-title').innerText = "Editar Tarifa Luz";
        document.getElementById('dialog-light-id').value = t.id;
        document.getElementById('dialog-light-com').value = t.comercializadora_id;
        document.getElementById('dialog-light-name').value = t.nombre;

        const typeSelect = document.getElementById('dialog-light-tariff-type');
        if (typeSelect) {
          typeSelect.value = t.tipo_tarifa || '2.0TD';
          typeSelect.dispatchEvent(new Event('change'));
        }

        document.getElementById('dialog-light-p1-pot').value = (t.potencia_p1 / 365).toFixed(7);
        document.getElementById('dialog-light-p2-pot').value = (t.potencia_p2 / 365).toFixed(7);
        document.getElementById('dialog-light-p3-pot').value = t.potencia_p3 ? (t.potencia_p3 / 365).toFixed(7) : '0.0000000';
        document.getElementById('dialog-light-p4-pot').value = t.potencia_p4 ? (t.potencia_p4 / 365).toFixed(7) : '0.0000000';
        document.getElementById('dialog-light-p5-pot').value = t.potencia_p5 ? (t.potencia_p5 / 365).toFixed(7) : '0.0000000';
        document.getElementById('dialog-light-p6-pot').value = t.potencia_p6 ? (t.potencia_p6 / 365).toFixed(7) : '0.0000000';

        document.getElementById('dialog-light-p1-ene').value = t.energia_p1.toFixed(7);
        document.getElementById('dialog-light-p2-ene').value = t.energia_p2.toFixed(7);
        document.getElementById('dialog-light-p3-ene').value = t.energia_p3.toFixed(7);
        document.getElementById('dialog-light-p4-ene').value = t.energia_p4 ? t.energia_p4.toFixed(7) : '0.0000000';
        document.getElementById('dialog-light-p5-ene').value = t.energia_p5 ? t.energia_p5.toFixed(7) : '0.0000000';
        document.getElementById('dialog-light-p6-ene').value = t.energia_p6 ? t.energia_p6.toFixed(7) : '0.0000000';

        document.getElementById('dialog-light-excedente').value = t.excedente ? t.excedente.toFixed(7) : '0.0000000';

        const comTipo = document.getElementById('dialog-light-comision-tipo');
        const tramosContainer = document.getElementById('dialog-light-tramos-container');
        tramosContainer.innerHTML = '';
        if (t.comision_tramos) {
          comTipo.value = 'tramos';
          comTipo.dispatchEvent(new Event('change'));
          try {
            const tramos = JSON.parse(t.comision_tramos);
            if (Array.isArray(tramos)) {
              tramos.forEach(tr => {
                addTramoRow('light', tr.hasta, tr.comision);
              });
            }
          } catch(e) {
            console.error(e);
          }
        } else {
          comTipo.value = 'fija';
          comTipo.dispatchEvent(new Event('change'));
          document.getElementById('dialog-light-commission').value = t.comision;
        }

        document.getElementById('dialog-light-notes').value = t.notas || t.notes || "";
        document.getElementById('dialog-light').classList.add('active');
      });
    });

    // Acciones de borrado
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (await window.showConfirm("¿Está seguro de eliminar esta tarifa de luz?", "Eliminar Tarifa de Luz")) {
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
// TARIFAS GAS
// ==========================================
function setupTarifasGas() {
  const dialog = document.getElementById('dialog-gas');
  const openBtn = document.getElementById('open-gas-dialog-btn');
  const closeBtn = document.getElementById('dialog-gas-close');
  const form = document.getElementById('dialog-gas-form');

  openBtn.addEventListener('click', () => {
    document.getElementById('dialog-gas-title').innerText = "Registrar Tarifa Gas";
    document.getElementById('dialog-gas-id').value = "";
    form.reset();
    const comTipo = document.getElementById('dialog-gas-comision-tipo');
    if (comTipo) {
      comTipo.value = 'fija';
      comTipo.dispatchEvent(new Event('change'));
    }
    const tramosContainer = document.getElementById('dialog-gas-tramos-container');
    if (tramosContainer) tramosContainer.innerHTML = '';
    dialog.classList.add('active');
  });

  closeBtn.addEventListener('click', () => {
    dialog.classList.remove('active');
  });

  const filterType = document.getElementById('filter-gas-type');
  if (filterType) {
    filterType.addEventListener('change', () => loadTarifasGas());
  }

  gasDatePicker = new M3DateRangePicker('filter-gas-date-range-container', () => {
    loadTarifasGas();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('dialog-gas-id').value;
    const comercializadoraId = parseInt(document.getElementById('dialog-gas-com').value);
    const nombre = document.getElementById('dialog-gas-name').value.trim();
    const tipoTarifa = document.getElementById('dialog-gas-tariff-type').value;
    const terminoFijo = parseFloat(document.getElementById('dialog-gas-fixed').value);
    const terminoVariable = parseFloat(document.getElementById('dialog-gas-var').value);

    let comision = 0;
    let comisionTramos = null;
    const comisionTipo = document.getElementById('dialog-gas-comision-tipo').value;
    if (comisionTipo === 'fija') {
      comision = parseFloat(document.getElementById('dialog-gas-commission').value || 0);
    } else {
      const rows = document.querySelectorAll('#dialog-gas-tramos-container .comision-tramo-row');
      const tramos = [];
      rows.forEach(row => {
        const hasta = parseFloat(row.querySelector('.tramo-hasta').value);
        const valCom = parseFloat(row.querySelector('.tramo-comision').value);
        if (!isNaN(hasta) && !isNaN(valCom)) {
          tramos.push({ hasta, comision: valCom });
        }
      });
      tramos.sort((a, b) => a.hasta - b.hasta);
      comisionTramos = JSON.stringify(tramos);
    }

    const notas = document.getElementById('dialog-gas-notes').value.trim();

    try {
      if (id) {
        await updateTarifaGas(parseInt(id), nombre, tipoTarifa, terminoFijo, terminoVariable, comision, comisionTramos, notas);
      } else {
        await addTarifaGas(comercializadoraId, nombre, tipoTarifa, terminoFijo, terminoVariable, comision, comisionTramos, notas);
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
  tbody.innerHTML = '<tr><td colspan="8" class="text-muted">Cargando...</td></tr>';

  try {
    const list = await getTarifasGas();
    tbody.innerHTML = '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No hay tarifas de gas registradas.</td></tr>';
      return;
    }

    let filteredList = list;

    // Filtrar por Tipo de Tarifa
    const filterType = document.getElementById('filter-gas-type')?.value || 'ALL';
    if (filterType !== 'ALL') {
      filteredList = filteredList.filter(t => t.tipo_tarifa === filterType);
    }

    // Filtrar por Rango de Fechas
    if (gasDatePicker && gasDatePicker.startDate) {
      const startBoundary = new Date(gasDatePicker.startDate);
      startBoundary.setHours(0, 0, 0, 0);

      const endBoundary = gasDatePicker.endDate ? new Date(gasDatePicker.endDate) : new Date(startBoundary);
      endBoundary.setHours(0, 0, 0, 0);

      filteredList = filteredList.filter(t => {
        if (!t.creado_en) return false;
        const itemDate = new Date(t.creado_en.replace(' ', 'T'));
        itemDate.setHours(0, 0, 0, 0);
        return itemDate >= startBoundary && itemDate <= endBoundary;
      });
    }

    if (filteredList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No hay tarifas de gas que coincidan con los filtros.</td></tr>';
      return;
    }

    filteredList.forEach(t => {
      const tr = document.createElement('tr');
      
      let comisionHtml = '';
      if (t.comision_tramos) {
        try {
          const tramos = JSON.parse(t.comision_tramos);
          if (Array.isArray(tramos) && tramos.length > 0) {
            comisionHtml = tramos.map(tr => `&le; ${tr.hasta} kWh: ${tr.comision.toFixed(2)} &euro;`).join('<br>');
          } else {
            comisionHtml = `${t.comision.toFixed(2)} &euro;`;
          }
        } catch (e) {
          comisionHtml = `${t.comision.toFixed(2)} &euro;`;
        }
      } else {
        comisionHtml = `${t.comision.toFixed(2)} &euro;`;
      }

      tr.innerHTML = `
        <td><strong>${escapeHtml(t.comercializadora_nombre)}</strong></td>
        <td>${escapeHtml(t.nombre)}</td>
        <td><span class="m3-chip" style="font-size: 9px; height: 18px; padding: 0 6px;">${t.tipo_tarifa || 'RL.1'}</span></td>
        <td>${t.termino_fijo.toFixed(7)} €/mes</td>
        <td>${t.termino_variable.toFixed(7)} €/kWh</td>
        <td class="private-value">${comisionHtml}</td>
        <td><small class="text-muted">${escapeHtml(t.notes || t.notas || '-')}</small></td>
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

        document.getElementById('dialog-gas-title').innerText = "Editar Tarifa Gas";
        document.getElementById('dialog-gas-id').value = t.id;
        document.getElementById('dialog-gas-com').value = t.comercializadora_id;
        document.getElementById('dialog-gas-name').value = t.nombre;
        document.getElementById('dialog-gas-tariff-type').value = t.tipo_tarifa || "RL.1";
        document.getElementById('dialog-gas-fixed').value = t.termino_fijo.toFixed(7);
        document.getElementById('dialog-gas-var').value = t.termino_variable.toFixed(7);

        const comTipo = document.getElementById('dialog-gas-comision-tipo');
        const tramosContainer = document.getElementById('dialog-gas-tramos-container');
        tramosContainer.innerHTML = '';
        if (t.comision_tramos) {
          comTipo.value = 'tramos';
          comTipo.dispatchEvent(new Event('change'));
          try {
            const tramos = JSON.parse(t.comision_tramos);
            if (Array.isArray(tramos)) {
              tramos.forEach(tr => {
                addTramoRow('gas', tr.hasta, tr.comision);
              });
            }
          } catch(e) {
            console.error(e);
          }
        } else {
          comTipo.value = 'fija';
          comTipo.dispatchEvent(new Event('change'));
          document.getElementById('dialog-gas-commission').value = t.comision;
        }

        document.getElementById('dialog-gas-notes').value = t.notes || t.notas || "";
        document.getElementById('dialog-gas').classList.add('active');
      });
    });

    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (await window.showConfirm("¿Está seguro de eliminar esta tarifa de gas?", "Eliminar Tarifa de Gas")) {
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

function setupComisionTramosBuilder(prefix) {
  const selectTipo = document.getElementById(`dialog-${prefix}-comision-tipo`);
  const fijaGroup = document.getElementById(`dialog-${prefix}-comision-fija-group`);
  const tramosGroup = document.getElementById(`dialog-${prefix}-comision-tramos-group`);
  const tramosContainer = document.getElementById(`dialog-${prefix}-tramos-container`);
  const addBtn = document.getElementById(`dialog-${prefix}-add-tramo-btn`);

  if (!selectTipo) return;

  selectTipo.addEventListener('change', () => {
    if (selectTipo.value === 'tramos') {
      fijaGroup.style.display = 'none';
      tramosGroup.style.display = 'block';
      if (tramosContainer.children.length === 0) {
        addTramoRow(prefix, null, null);
      }
    } else {
      fijaGroup.style.display = 'block';
      tramosGroup.style.display = 'none';
    }
  });

  addBtn.addEventListener('click', () => {
    addTramoRow(prefix, null, null);
  });
}

function addTramoRow(prefix, hasta, comision) {
  const container = document.getElementById(`dialog-${prefix}-tramos-container`);
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'comision-tramo-row';
  
  const valHasta = hasta !== null ? hasta : '';
  const valComision = comision !== null ? comision : '';

  row.innerHTML = `
    <input type="number" class="m3-input tramo-hasta" placeholder="Hasta kWh" value="${valHasta}" min="0" step="1" required />
    <input type="number" class="m3-input tramo-comision" placeholder="Comisión €" value="${valComision}" min="0" step="0.01" required />
    <button type="button" class="comision-tramo-remove-btn" title="Eliminar tramo">
      <span class="material-symbols-outlined">delete</span>
    </button>
  `;

  row.querySelector('.comision-tramo-remove-btn').addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}
