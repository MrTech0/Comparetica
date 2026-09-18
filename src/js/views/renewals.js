/* src/js/views/renewals.js */
import {
  getDb,
  getClientes,
  getClientesForSelect,
  searchClientes,
  getComercializadoras,
  getTarifasLuz,
  getTarifasGas,
  getRenewalThresholds
} from '../db.js';
import { showToast, showConfirm } from '../ui.js';

let currentViewMode = 'list'; // 'list' | 'calendar'
let currentCalendarDate = new Date();
let renewalsData = [];
let clientsMap = {};
let currentThresholds = { critical: 30, warning: 60, radar: 90 };

let currentRenewalPage = 1;
const RENEWALS_PER_PAGE = 25;

let isListenersInitialized = false;

export async function initRenewalsView() {
  if (!isListenersInitialized) {
    setupRenewalEventListeners();
    isListenersInitialized = true;
  }
  await loadRenewals();
}

export async function loadRenewals() {
  try {
    const db = await getDb();
    const thresholds = await getRenewalThresholds();
    currentThresholds = thresholds;

    const clients = await getClientes();
    clientsMap = {};
    if (Array.isArray(clients)) {
      clients.forEach(c => clientsMap[c.id] = c);
    }

    try {
      const res = await db.select(`
        SELECT r.*, c.nombre_empresa as cliente_nombre, c.cif as cliente_cif
        FROM renovaciones r
        JOIN clientes c ON r.cliente_id = c.id
        ORDER BY r.fecha_vencimiento ASC;
      `);
      renewalsData = Array.isArray(res) ? res : [];
    } catch (eSelect) {
      console.warn("No se pudieron consultar las renovaciones:", eSelect);
      renewalsData = [];
    }

    updateRenewalsBadge(thresholds);
    updateKpis(thresholds);
    if (currentViewMode === 'list') {
      renderRenewalsTable(thresholds);
    } else {
      renderRenewalsCalendar(thresholds);
    }
  } catch (err) {
    console.error("Error al cargar renovaciones:", err);
    renewalsData = [];
  }
}

export const refreshRenewals = loadRenewals;
export { getRenewalThresholds };

export function updateRenewalsBadge(thresholds = currentThresholds) {
  const badgeEl = document.getElementById('renewals-badge');
  if (!badgeEl) return;

  const now = new Date();
  let criticalCount = 0;

  renewalsData.forEach(ren => {
    if (ren.estado_renovacion === 'Renovado' || ren.estado_renovacion === 'Cancelado') return;
    const vto = new Date(ren.fecha_vencimiento);
    const diffDays = Math.ceil((vto - now) / (1000 * 60 * 60 * 24));
    if (diffDays <= thresholds.critical) {
      criticalCount++;
    }
  });

  if (criticalCount > 0) {
    badgeEl.textContent = criticalCount.toString();
    badgeEl.classList.remove('hidden');
  } else {
    badgeEl.classList.add('hidden');
  }
}

function updateKpis(thresholds = currentThresholds) {
  const now = new Date();

  let total = renewalsData.length;
  let critical = 0;
  let warning = 0;
  let radar = 0;
  let done = 0;

  renewalsData.forEach(ren => {
    const vto = new Date(ren.fecha_vencimiento);
    const diffDays = Math.ceil((vto - now) / (1000 * 60 * 60 * 24));

    if (ren.estado_renovacion === 'Renovado' || diffDays > thresholds.radar) {
      done++;
      return;
    }

    if (diffDays <= thresholds.critical) {
      critical++;
    } else if (diffDays <= thresholds.warning) {
      warning++;
    } else if (diffDays <= thresholds.radar) {
      radar++;
    }
  });

  const kpiTotal = document.getElementById('renewals-kpi-total');
  const kpiCritical = document.getElementById('renewals-kpi-critical');
  const kpiWarning = document.getElementById('renewals-kpi-warning');
  const kpiRadar = document.getElementById('renewals-kpi-radar');
  const kpiDone = document.getElementById('renewals-kpi-done');

  if (kpiTotal) kpiTotal.textContent = total.toString();
  if (kpiCritical) kpiCritical.textContent = critical.toString();
  if (kpiWarning) kpiWarning.textContent = warning.toString();
  if (kpiRadar) kpiRadar.textContent = radar.toString();
  if (kpiDone) kpiDone.textContent = done.toString();
}

function updateRenewalsPaginationUI(totalCount, totalPages, startIdx, endIdx) {
  const infoEl = document.getElementById('renewals-pagination-info');
  const indicatorEl = document.getElementById('renewals-page-indicator');
  const btnPrev = document.getElementById('btn-prev-page-renewals');
  const btnNext = document.getElementById('btn-next-page-renewals');

  if (infoEl) {
    if (totalCount === 0) {
      infoEl.textContent = 'Mostrando 0 - 0 de 0 renovaciones';
    } else {
      const displayStart = startIdx + 1;
      const displayEnd = Math.min(endIdx, totalCount);
      infoEl.textContent = `Mostrando ${displayStart.toLocaleString('es-ES')} - ${displayEnd.toLocaleString('es-ES')} de ${totalCount.toLocaleString('es-ES')} renovaciones`;
    }
  }

  if (indicatorEl) {
    indicatorEl.textContent = `Página ${currentRenewalPage} de ${totalPages}`;
  }

  if (btnPrev) {
    btnPrev.disabled = currentRenewalPage <= 1;
  }

  if (btnNext) {
    btnNext.disabled = currentRenewalPage >= totalPages;
  }
}

function renderRenewalsTable(thresholds = currentThresholds) {
  const tbody = document.getElementById('renewals-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const searchVal = (document.getElementById('search-renewals-input')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('filter-renewals-status')?.value || 'ALL';

  const now = new Date();

  const filtered = renewalsData.filter(ren => {
    if (searchVal) {
      const matchName = (ren.cliente_nombre || '').toLowerCase().includes(searchVal);
      const matchCif = (ren.cliente_cif || '').toLowerCase().includes(searchVal);
      const matchCups = (ren.cups || '').toLowerCase().includes(searchVal);
      if (!matchName && !matchCif && !matchCups) return false;
    }

    if (statusFilter !== 'ALL') {
      const vto = new Date(ren.fecha_vencimiento);
      const diffDays = Math.ceil((vto - now) / (1000 * 60 * 60 * 24));
      const isDone = ren.estado_renovacion === 'Renovado' || diffDays > thresholds.radar;

      if (statusFilter === 'DONE') return isDone;
      if (isDone) return false;
      if (statusFilter === 'CRITICAL' && diffDays > thresholds.critical) return false;
      if (statusFilter === 'WARNING' && (diffDays <= thresholds.critical || diffDays > thresholds.warning)) return false;
      if (statusFilter === 'RADAR' && (diffDays <= thresholds.warning || diffDays > thresholds.radar)) return false;
    }

    return true;
  });

  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / RENEWALS_PER_PAGE) || 1;

  if (currentRenewalPage > totalPages) {
    currentRenewalPage = totalPages;
  }
  if (currentRenewalPage < 1) {
    currentRenewalPage = 1;
  }

  const startIdx = (currentRenewalPage - 1) * RENEWALS_PER_PAGE;
  const endIdx = startIdx + RENEWALS_PER_PAGE;
  const pageItems = filtered.slice(startIdx, endIdx);

  updateRenewalsPaginationUI(totalCount, totalPages, startIdx, endIdx);

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--color-on-surface-variant); padding: 24px;">No se encontraron renovaciones de contratos.</td></tr>`;
    return;
  }

  pageItems.forEach(ren => {
    const tr = document.createElement('tr');
    const vto = new Date(ren.fecha_vencimiento);
    const diffDays = Math.ceil((vto - now) / (1000 * 60 * 60 * 24));
    const isDone = ren.estado_renovacion === 'Renovado' || diffDays > thresholds.radar;

    let statusBadge = '';
    if (isDone) {
      statusBadge = `<span class="m3-badge" style="background-color: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">✅ Renovado</span>`;
    } else if (diffDays <= thresholds.critical) {
      statusBadge = `<span class="m3-badge" style="background-color: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">🔴 Crítico (${diffDays}d)</span>`;
    } else if (diffDays <= thresholds.warning) {
      statusBadge = `<span class="m3-badge" style="background-color: #fef3c7; color: #92400e; border: 1px solid #fcd34d; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">🟡 Próximo (${diffDays}d)</span>`;
    } else if (diffDays <= thresholds.radar) {
      statusBadge = `<span class="m3-badge" style="background-color: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">🔵 En Radar (${diffDays}d)</span>`;
    } else {
      statusBadge = `<span class="m3-badge" style="background-color: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">✅ Renovado</span>`;
    }

    tr.innerHTML = `
      <td>
        <strong style="color: var(--color-on-surface); display: block;">${ren.cliente_nombre || 'Cliente sin nombre'}</strong>
        <span style="font-size: 11px; color: var(--color-on-surface-variant);">${ren.cliente_cif || ''}</span>
      </td>
      <td>
        <span style="font-weight: 600; font-size: 12px; display: block;">${ren.tipo_energia || 'Luz'}</span>
        <span style="font-size: 11px; color: var(--color-on-surface-variant); font-family: monospace;">${ren.cups || '-'}</span>
      </td>
      <td>
        <span style="display: block; font-size: 13px;">${ren.comercializadora_actual || 'No especificada'}</span>
        <span style="font-size: 11px; color: var(--color-on-surface-variant);">${ren.tarifa_actual || ''}</span>
      </td>
      <td style="font-size: 12.5px;">${new Date(ren.fecha_firma).toLocaleDateString('es-ES')}</td>
      <td style="font-size: 12.5px; font-weight: 600;">${new Date(ren.fecha_vencimiento).toLocaleDateString('es-ES')}</td>
      <td style="font-size: 13px; font-weight: 700;">${diffDays} días</td>
      <td>${statusBadge}</td>
      <td style="text-align: right;">
        <div style="display: inline-flex; gap: 4px; align-items: center;">
          <button type="button" class="m3-btn m3-btn-sm btn-action-compare" data-ren-id="${ren.id}" title="Lanzar Comparativa de Renovación">
            <span>⚡ Comparar</span>
          </button>
          <button type="button" class="m3-btn m3-btn-tonal m3-btn-sm btn-action-mark-done" data-ren-id="${ren.id}" title="Marcar como Renovado">
            <span>✅</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach table actions
  tbody.querySelectorAll('.btn-action-compare').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const renId = parseInt(e.currentTarget.getAttribute('data-ren-id'), 10);
      launchRenewalComparison(renId);
    });
  });

  tbody.querySelectorAll('.btn-action-mark-done').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const renId = parseInt(e.currentTarget.getAttribute('data-ren-id'), 10);
      await markRenewalDone(renId);
    });
  });
}

function renderRenewalsCalendar(thresholds = currentThresholds) {
  const grid = document.getElementById('renewals-calendar-grid');
  const titleEl = document.getElementById('calendar-month-year-title');
  if (!grid || !titleEl) return;

  grid.innerHTML = '';

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  titleEl.textContent = `${monthNames[month]} ${year}`;

  const dayHeaders = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  dayHeaders.forEach(dh => {
    const div = document.createElement('div');
    div.className = 'calendar-day-header';
    div.textContent = dh;
    grid.appendChild(div);
  });

  const firstDayIndex = new Date(year, month, 1).getDay();
  // Adjust Monday = 0, Sunday = 6
  const startOffset = (firstDayIndex + 6) % 7;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  // Previous month padding
  for (let i = startOffset - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell other-month';
    cell.innerHTML = `<span class="calendar-day-num">${prevMonthDays - i}</span>`;
    grid.appendChild(cell);
  }

  const today = new Date();

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Find events for this day
    const dayEvents = renewalsData.filter(ren => {
      const vtoStr = (ren.fecha_vencimiento || '').substring(0, 10);
      return vtoStr === cellDateStr;
    });

    const hasEvents = dayEvents.length > 0;
    cell.className = `calendar-day-cell${isToday ? ' today' : ''}${hasEvents ? ' has-events' : ''}`;

    let countHtml = '';
    if (hasEvents) {
      // Determine highest urgency badge style
      let badgeClass = 'done';
      let hasCritical = false;
      let hasWarning = false;
      let hasRadar = false;

      dayEvents.forEach(ev => {
        if (ev.estado_renovacion === 'Renovado') return;
        const vto = new Date(ev.fecha_vencimiento);
        const diffDays = Math.ceil((vto - today) / (1000 * 60 * 60 * 24));
        if (diffDays <= thresholds.critical) hasCritical = true;
        else if (diffDays <= thresholds.warning) hasWarning = true;
        else if (diffDays <= thresholds.radar) hasRadar = true;
      });

      if (hasCritical) {
        badgeClass = 'critical';
      } else if (hasWarning) {
        badgeClass = 'warning';
      } else if (hasRadar) {
        badgeClass = 'radar';
      }

      const labelText = dayEvents.length === 1 ? '1 renovación' : `${dayEvents.length} renovaciones`;
      countHtml = `<div class="calendar-count-badge ${badgeClass}" title="${dayEvents.length} vencimientos el ${day}/${month + 1}/${year}">
        <span>${labelText}</span>
      </div>`;

      // Click listener on cell to open modal listing clients
      cell.addEventListener('click', () => {
        openCalendarDayModal(cellDateStr, day, monthNames[month], year, dayEvents, thresholds);
      });
    }

    cell.innerHTML = `
      <span class="calendar-day-num">${day}</span>
      ${countHtml}
    `;
    grid.appendChild(cell);
  }

  // Next month padding
  const totalCells = startOffset + daysInMonth;
  const remainingCells = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell other-month';
    cell.innerHTML = `<span class="calendar-day-num">${i}</span>`;
    grid.appendChild(cell);
  }
}

function openCalendarDayModal(dateStr, day, monthName, year, dayEvents, thresholds = currentThresholds) {
  const dialog = document.getElementById('dialog-calendar-day-renewals');
  const titleEl = document.getElementById('dialog-calendar-day-title');
  const subtitleEl = document.getElementById('dialog-calendar-day-subtitle');
  const tbody = document.getElementById('calendar-day-renewals-tbody');

  if (!dialog || !tbody) return;

  if (titleEl) {
    titleEl.textContent = `Renovaciones del ${day} de ${monthName} de ${year}`;
  }
  if (subtitleEl) {
    subtitleEl.textContent = `${dayEvents.length} ${dayEvents.length === 1 ? 'contrato con vencimiento' : 'contratos con vencimiento'} en esta fecha`;
  }

  tbody.innerHTML = '';

  const now = new Date();

  dayEvents.forEach(ren => {
    const tr = document.createElement('tr');
    const vto = new Date(ren.fecha_vencimiento);
    const diffDays = Math.ceil((vto - now) / (1000 * 60 * 60 * 24));

    const isDone = ren.estado_renovacion === 'Renovado' || diffDays > thresholds.radar;

    let statusBadge = '';
    if (isDone) {
      statusBadge = `<span class="m3-badge" style="background-color: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">✅ Renovado</span>`;
    } else if (diffDays <= thresholds.critical) {
      statusBadge = `<span class="m3-badge" style="background-color: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">🔴 Crítico (${diffDays}d)</span>`;
    } else if (diffDays <= thresholds.warning) {
      statusBadge = `<span class="m3-badge" style="background-color: #fef3c7; color: #92400e; border: 1px solid #fcd34d; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">🟡 Próximo (${diffDays}d)</span>`;
    } else if (diffDays <= thresholds.radar) {
      statusBadge = `<span class="m3-badge" style="background-color: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">🔵 En Radar (${diffDays}d)</span>`;
    } else {
      statusBadge = `<span class="m3-badge" style="background-color: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; border-radius: 12px; padding: 4px 10px; font-weight: 600; font-size: 12px;">✅ Renovado</span>`;
    }

    tr.innerHTML = `
      <td>
        <strong style="color: var(--color-on-surface); display: block;">${ren.cliente_nombre || 'Cliente sin nombre'}</strong>
        <span style="font-size: 11px; color: var(--color-on-surface-variant);">${ren.cliente_cif || ''}</span>
      </td>
      <td>
        <span style="font-weight: 600; font-size: 12px; display: block;">${ren.tipo_energia || 'Luz'} - ${ren.comercializadora_actual || 'No esp.'}</span>
        <span style="font-size: 11px; color: var(--color-on-surface-variant); font-family: monospace;">${ren.cups || '-'}</span>
      </td>
      <td>${statusBadge}</td>
      <td style="text-align: right;">
        <div style="display: inline-flex; gap: 4px; align-items: center;">
          <button type="button" class="m3-btn m3-btn-sm btn-day-compare" data-ren-id="${ren.id}" title="Lanzar Comparativa de Renovación">
            <span>⚡ Comparar</span>
          </button>
          <button type="button" class="m3-btn m3-btn-tonal m3-btn-sm btn-day-mark-done" data-ren-id="${ren.id}" title="Marcar como Renovado">
            <span>✅</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach event handlers inside modal
  tbody.querySelectorAll('.btn-day-compare').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const renId = parseInt(e.currentTarget.getAttribute('data-ren-id'), 10);
      dialog.classList.remove('active');
      launchRenewalComparison(renId);
    });
  });

  tbody.querySelectorAll('.btn-day-mark-done').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const renId = parseInt(e.currentTarget.getAttribute('data-ren-id'), 10);
      dialog.classList.remove('active');
      await markRenewalDone(renId);
    });
  });

  dialog.classList.add('active');
}

function setupRenewalEventListeners() {
  const btnList = document.getElementById('btn-renewals-view-list');
  const btnCalendar = document.getElementById('btn-renewals-view-calendar');

  const containerList = document.getElementById('renewals-container-list');
  const containerCalendar = document.getElementById('renewals-container-calendar');

  if (btnList && btnCalendar && containerList && containerCalendar) {
    btnList.addEventListener('click', () => {
      currentViewMode = 'list';
      btnList.className = 'm3-btn m3-btn-sm';
      btnCalendar.className = 'm3-btn m3-btn-text m3-btn-sm';
      containerList.classList.remove('hidden');
      containerCalendar.classList.add('hidden');
      renderRenewalsTable();
    });

    btnCalendar.addEventListener('click', () => {
      currentViewMode = 'calendar';
      btnCalendar.className = 'm3-btn m3-btn-sm';
      btnList.className = 'm3-btn m3-btn-text m3-btn-sm';
      containerCalendar.classList.remove('hidden');
      containerList.classList.add('hidden');
      renderRenewalsCalendar();
    });
  }

  const btnPrev = document.getElementById('btn-calendar-prev-month');
  const btnNext = document.getElementById('btn-calendar-next-month');
  const btnToday = document.getElementById('btn-calendar-today');

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
      renderRenewalsCalendar();
    });
  }

  // Escuchadores de paginación para la vista de lista/CRM
  const btnPrevRen = document.getElementById('btn-prev-page-renewals');
  const btnNextRen = document.getElementById('btn-next-page-renewals');

  if (btnPrevRen) {
    btnPrevRen.addEventListener('click', () => {
      if (currentRenewalPage > 1) {
        currentRenewalPage--;
        renderRenewalsTable();
      }
    });
  }

  if (btnNextRen) {
    btnNextRen.addEventListener('click', () => {
      currentRenewalPage++;
      renderRenewalsTable();
    });
  }

  const searchRenInput = document.getElementById('search-renewals-input');
  const filterRenStatus = document.getElementById('filter-renewals-status');

  if (searchRenInput) {
    searchRenInput.addEventListener('input', () => {
      currentRenewalPage = 1;
      renderRenewalsTable();
    });
  }

  if (filterRenStatus) {
    filterRenStatus.addEventListener('change', () => {
      currentRenewalPage = 1;
      renderRenewalsTable();
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
      renderRenewalsCalendar();
    });
  }

  if (btnToday) {
    btnToday.addEventListener('click', () => {
      currentCalendarDate = new Date();
      renderRenewalsCalendar();
    });
  }

  // Escuchadores del modal de renovaciones por día en calendario
  const btnCloseDayDialog = document.getElementById('btn-close-calendar-day-dialog');
  const btnCloseDayDialogX = document.getElementById('btn-close-calendar-day-dialog-x');
  const dayDialog = document.getElementById('dialog-calendar-day-renewals');

  if (dayDialog) {
    if (btnCloseDayDialog) {
      btnCloseDayDialog.onclick = () => dayDialog.classList.remove('active');
    }
    if (btnCloseDayDialogX) {
      btnCloseDayDialogX.onclick = () => dayDialog.classList.remove('active');
    }
    dayDialog.onclick = (e) => {
      if (e.target === dayDialog) dayDialog.classList.remove('active');
    };
  }

  // Enlace de eventos del formulario modal de renovación manual
  const btnAddManual = document.getElementById('btn-open-add-renewal');
  const btnCancelManual = document.getElementById('btn-cancel-renewal-manual');
  const dialogManual = document.getElementById('dialog-renewal-form');
  const formManual = document.getElementById('form-renewal-manual');

  if (btnAddManual && dialogManual) {
    btnAddManual.onclick = (e) => {
      e.preventDefault();
      openManualAddModal();
    };
  }

  if (btnCancelManual && dialogManual) {
    btnCancelManual.onclick = (e) => {
      e.preventDefault();
      dialogManual.classList.remove('active');
    };
  }

  if (formManual) {
    formManual.onsubmit = async (e) => {
      e.preventDefault();
      await saveManualRenewal();
    };
  }

  // Soporte para botón rápido de + Nuevo Cliente dentro del modal de renovaciones
  const btnQuickClient = document.getElementById('btn-quick-add-client');
  if (btnQuickClient) {
    btnQuickClient.onclick = (e) => {
      e.preventDefault();
      const dialogClient = document.getElementById('dialog-client');
      if (dialogClient) {
        document.getElementById('dialog-client-title').textContent = 'Registrar Cliente para Renovación';
        document.getElementById('dialog-client-form')?.reset();
        document.getElementById('dialog-client-id').value = '';
        dialogClient.classList.add('active');
      }
    };
  }
}

// Inicialización directa al cargar el módulo
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setupRenewalEventListeners());
  } else {
    setupRenewalEventListeners();
  }
}

export async function openNewRenewalDialogFromHistory(comp) {
  // 1. Navegar a la sección de renovaciones
  const navRenewals = document.querySelector('[data-section="renewals"]');
  if (navRenewals) navRenewals.click();

  // 2. Abrir modal manual
  await openManualAddModal();

  if (!comp) return;

  // 3. Buscar ID de cliente por nombre o NIF
  try {
    const clients = await getClientes();
    const matchedClient = Array.isArray(clients) ? clients.find(c => (c.nombre_empresa || '').trim().toLowerCase() === (comp.cliente_nombre || '').trim().toLowerCase()) : null;

    const searchInput = document.getElementById('manual-ren-client-search');
    const idInput = document.getElementById('manual-ren-client-id');
    const cupsInput = document.getElementById('manual-ren-cups');
    const energySelect = document.getElementById('manual-ren-energy');
    const retailerInput = document.getElementById('manual-ren-retailer');
    const tariffInput = document.getElementById('manual-ren-tariff');
    const durationInput = document.getElementById('manual-ren-duration');

    if (matchedClient && idInput) idInput.value = matchedClient.id;
    if (searchInput) searchInput.value = comp.cliente_nombre || '';
    if (cupsInput) cupsInput.value = comp.cliente_cups || '';
    if (energySelect) energySelect.value = comp.tipo_energia || 'Luz';

    const retailerName = comp.comercializadora_luz_nombre || comp.comercializadora_gas_nombre || '';
    const tariffName = comp.tarifa_luz_nombre || comp.tarifa_gas_nombre || '';

    if (retailerInput) retailerInput.value = retailerName;
    if (tariffInput) tariffInput.value = tariffName;

    if (durationInput) {
      durationInput.focus();
      durationInput.select();
    }
  } catch (err) {
    console.error("Error al precargar datos de la comparativa en la nueva renovación:", err);
  }
}

export async function openManualAddModal() {
  const dialog = document.getElementById('dialog-renewal-form');
  const searchInput = document.getElementById('manual-ren-client-search');
  const idInput = document.getElementById('manual-ren-client-id');
  const suggestionsBox = document.getElementById('manual-ren-client-suggestions');

  if (!dialog) return;

  // 1. Abrir diálogo de forma instantánea (0ms)
  dialog.classList.add('active');

  const dateStartInput = document.getElementById('manual-ren-date-start');
  const durationInput = document.getElementById('manual-ren-duration');
  const dateEndInput = document.getElementById('manual-ren-date-end');
  const form = document.getElementById('form-renewal-manual');

  if (form) form.reset();
  if (idInput) idInput.value = '';
  if (durationInput) durationInput.value = '12';
  if (suggestionsBox) {
    suggestionsBox.style.display = 'none';
    suggestionsBox.innerHTML = '';
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (dateStartInput) dateStartInput.value = todayStr;

  function updateManualEndDate() {
    if (!dateStartInput || !durationInput || !dateEndInput) return;
    const val = dateStartInput.value || todayStr;
    const parts = val.split('-');
    if (parts.length !== 3) return;

    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);

    if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1900 || y > 2100) return;

    let months = parseInt(durationInput.value || '12', 10);
    if (isNaN(months) || months < 1) months = 12;

    const targetDate = new Date(y, m + months, d);

    const resY = targetDate.getFullYear();
    const resM = String(targetDate.getMonth() + 1).padStart(2, '0');
    const resD = String(targetDate.getDate()).padStart(2, '0');

    dateEndInput.value = `${resY}-${resM}-${resD}`;
  }

  updateManualEndDate();

  if (dateStartInput) {
    dateStartInput.oninput = updateManualEndDate;
    dateStartInput.onchange = updateManualEndDate;
  }
  if (durationInput) {
    durationInput.oninput = () => {
      // Limitar a máximo 2 dígitos enteros
      let cleaned = durationInput.value.replace(/\D/g, '').slice(0, 2);
      if (cleaned !== durationInput.value) {
        durationInput.value = cleaned;
      }
      updateManualEndDate();
    };
    durationInput.onchange = updateManualEndDate;
  }

  // Configurar autocompletado en tiempo real para buscar clientes existentes
  if (searchInput && suggestionsBox) {
    let debounceTimer = null;
    searchInput.oninput = () => {
      idInput.value = ''; // Resetear ID si el usuario escribe libremente
      const term = searchInput.value.trim();
      clearTimeout(debounceTimer);

      if (term.length === 0) {
        suggestionsBox.style.display = 'none';
        suggestionsBox.innerHTML = '';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const results = await searchClientes(term, 10);
          suggestionsBox.innerHTML = '';

          if (!Array.isArray(results) || results.length === 0) {
            const noRes = document.createElement('div');
            noRes.style.padding = '10px 14px';
            noRes.style.fontSize = '13px';
            noRes.style.color = 'var(--color-outline)';
            noRes.textContent = 'Sin clientes coincidentes. Registra el cliente previamente en el apartado Clientes.';
            suggestionsBox.appendChild(noRes);
          } else {
            results.forEach(c => {
              const item = document.createElement('div');
              item.style.padding = '10px 14px';
              item.style.cursor = 'pointer';
              item.style.fontSize = '13px';
              item.style.borderBottom = '1px solid var(--color-outline-variant)';
              item.innerHTML = `<strong>${c.nombre_empresa}</strong>`;

              item.onmouseenter = () => { item.style.backgroundColor = 'var(--color-surface-variant)'; };
              item.onmouseleave = () => { item.style.backgroundColor = 'transparent'; };

              item.onclick = () => {
                searchInput.value = c.nombre_empresa;
                idInput.value = c.id.toString();

                const cupsInput = document.getElementById('manual-ren-cups');
                if (cupsInput && c.cups) {
                  cupsInput.value = c.cups;
                }

                suggestionsBox.style.display = 'none';
              };

              suggestionsBox.appendChild(item);
            });
          }
          suggestionsBox.style.display = 'block';
        } catch (err) {
          console.error("Error al buscar sugerencias de clientes:", err);
        }
      }, 150);
    };

    // Ocultar sugerencias al hacer clic fuera
    document.addEventListener('click', (evt) => {
      if (!searchInput.contains(evt.target) && !suggestionsBox.contains(evt.target)) {
        suggestionsBox.style.display = 'none';
      }
    });
  }

  // 3. Autocompletado de Comercializadora Actual
  const comInput = document.getElementById('manual-ren-comercializadora');
  const comSuggestionsBox = document.getElementById('manual-ren-comercializadora-suggestions');

  if (comInput && comSuggestionsBox) {
    const showComSuggestions = async () => {
      try {
        const term = comInput.value.trim().toLowerCase();
        if (term.length === 0) {
          comSuggestionsBox.style.display = 'none';
          comSuggestionsBox.innerHTML = '';
          return;
        }

        const coms = await getComercializadoras();
        const filtered = coms.filter(c => c.nombre.toLowerCase().includes(term));
        comSuggestionsBox.innerHTML = '';

        if (!filtered || filtered.length === 0) {
          comSuggestionsBox.style.display = 'none';
          return;
        }

        filtered.forEach(c => {
          const item = document.createElement('div');
          item.style.padding = '10px 14px';
          item.style.cursor = 'pointer';
          item.style.fontSize = '13px';
          item.style.borderBottom = '1px solid var(--color-outline-variant)';
          item.innerHTML = `<strong>${c.nombre}</strong>`;

          item.onmouseenter = () => { item.style.backgroundColor = 'var(--color-surface-variant)'; };
          item.onmouseleave = () => { item.style.backgroundColor = 'transparent'; };

          item.onclick = () => {
            comInput.value = c.nombre;
            comSuggestionsBox.style.display = 'none';
          };

          comSuggestionsBox.appendChild(item);
        });

        comSuggestionsBox.style.display = 'block';
      } catch (err) {
        console.error("Error al buscar comercializadoras:", err);
      }
    };

    comInput.oninput = showComSuggestions;

    document.addEventListener('click', (evt) => {
      if (!comInput.contains(evt.target) && !comSuggestionsBox.contains(evt.target)) {
        comSuggestionsBox.style.display = 'none';
      }
    });
  }

  // 4. Autocompletado de Tarifa Actual
  const tarifaInput = document.getElementById('manual-ren-tarifa');
  const tarifaSuggestionsBox = document.getElementById('manual-ren-tarifa-suggestions');

  if (tarifaInput && tarifaSuggestionsBox) {
    const showTarifaSuggestions = async () => {
      try {
        const term = tarifaInput.value.trim().toLowerCase();
        if (term.length === 0) {
          tarifaSuggestionsBox.style.display = 'none';
          tarifaSuggestionsBox.innerHTML = '';
          return;
        }

        const tipoSuministro = document.getElementById('manual-ren-tipo')?.value || 'Luz';
        const selectedComName = comInput?.value.trim().toLowerCase() || '';

        let allTariffs = [];
        if (tipoSuministro === 'Luz' || tipoSuministro === 'Dual') {
          const luz = await getTarifasLuz();
          allTariffs.push(...luz.map(t => ({ ...t, tipo_enum: 'Luz' })));
        }
        if (tipoSuministro === 'Gas' || tipoSuministro === 'Dual') {
          const gas = await getTarifasGas();
          allTariffs.push(...gas.map(t => ({ ...t, tipo_enum: 'Gas' })));
        }

        let filtered = allTariffs;
        if (selectedComName) {
          filtered = filtered.filter(t => (t.comercializadora_nombre || '').toLowerCase() === selectedComName);
        }
        if (term) {
          filtered = filtered.filter(t => t.nombre.toLowerCase().includes(term) || (t.comercializadora_nombre || '').toLowerCase().includes(term));
        }

        tarifaSuggestionsBox.innerHTML = '';
        if (!filtered || filtered.length === 0) {
          tarifaSuggestionsBox.style.display = 'none';
          return;
        }

        // Evitar duplicados por nombre
        const seen = new Set();
        const uniqueFiltered = [];
        filtered.forEach(t => {
          const key = `${t.nombre}_${t.comercializadora_nombre}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueFiltered.push(t);
          }
        });

        uniqueFiltered.slice(0, 15).forEach(t => {
          const item = document.createElement('div');
          item.style.padding = '10px 14px';
          item.style.cursor = 'pointer';
          item.style.fontSize = '13px';
          item.style.borderBottom = '1px solid var(--color-outline-variant)';
          item.innerHTML = `<strong>${t.nombre}</strong>`;

          item.onmouseenter = () => { item.style.backgroundColor = 'var(--color-surface-variant)'; };
          item.onmouseleave = () => { item.style.backgroundColor = 'transparent'; };

          item.onclick = () => {
            tarifaInput.value = t.nombre;
            if (comInput && t.comercializadora_nombre) {
              comInput.value = t.comercializadora_nombre;
            }
            tarifaSuggestionsBox.style.display = 'none';
          };

          tarifaSuggestionsBox.appendChild(item);
        });

        tarifaSuggestionsBox.style.display = 'block';
      } catch (err) {
        console.error("Error al buscar tarifas:", err);
      }
    };

    tarifaInput.oninput = showTarifaSuggestions;

    document.addEventListener('click', (evt) => {
      if (!tarifaInput.contains(evt.target) && !tarifaSuggestionsBox.contains(evt.target)) {
        tarifaSuggestionsBox.style.display = 'none';
      }
    });
  }
}

async function saveManualRenewal() {
  try {
    const db = await getDb();
    const clientIdVal = document.getElementById('manual-ren-client-id')?.value;
    const clientSearchVal = document.getElementById('manual-ren-client-search')?.value.trim();

    if (!clientIdVal) {
      showToast("Por favor, selecciona un cliente existente haciendo clic en las sugerencias desplegadas.", "error");
      return;
    }

    const cliente_id = parseInt(clientIdVal, 10);
    const tipo_energia = document.getElementById('manual-ren-tipo').value;
    const cups = document.getElementById('manual-ren-cups').value.trim();
    const comercializadora_actual = document.getElementById('manual-ren-comercializadora').value.trim();
    const tarifa_actual = document.getElementById('manual-ren-tarifa').value.trim();
    const fecha_firma = document.getElementById('manual-ren-date-start').value;
    const duracionRaw = document.getElementById('manual-ren-duration')?.value.trim();
    const duracion_meses = parseInt(duracionRaw || '12', 10);

    if (isNaN(duracion_meses) || duracion_meses < 1 || duracion_meses > 99) {
      showToast("La duración del contrato debe ser un número entero de 1 a 99 meses (máximo 2 dígitos).", "error");
      return;
    }

    const fecha_vencimiento = document.getElementById('manual-ren-date-end').value;
    const notas = document.getElementById('manual-ren-notes').value.trim();

    // Obtener parámetros globales de días de aviso desde Configuración -> Parámetros
    const thresholds = await getRenewalThresholds();
    const warningDays = thresholds.warning;

    let fecha_aviso_personalizada = null;
    if (fecha_vencimiento) {
      const parts = fecha_vencimiento.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        const dt = new Date(y, m, d);
        dt.setDate(dt.getDate() - warningDays);
        fecha_aviso_personalizada = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      }
    }

    await db.execute(`
      INSERT INTO renovaciones (cliente_id, tipo_energia, cups, comercializadora_actual, tarifa_actual, fecha_firma, duracion_meses, fecha_vencimiento, fecha_aviso_personalizada, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, [cliente_id, tipo_energia, cups, comercializadora_actual, tarifa_actual, fecha_firma, duracion_meses, fecha_vencimiento, fecha_aviso_personalizada, notas]);

    document.getElementById('dialog-renewal-form')?.classList.remove('active');
    showToast("Renovación de contrato registrada con éxito.", "success");
    await refreshRenewals();
  } catch (err) {
    console.error("Error al guardar renovación manual:", err);
    showToast("Error al guardar la renovación de contrato.", "error");
  }
}

async function markRenewalDone(renId) {
  const confirmDone = await showConfirm(
    "¿Deseas marcar esta renovación como COMPLETADA?\n\nEl contrato pasará a estado 'Renovado' y quedará archivado.",
    "Marcar Renovado"
  );
  if (!confirmDone) return;

  const db = await getDb();
  await db.execute(`UPDATE renovaciones SET estado_renovacion = 'Renovado' WHERE id = ?;`, [renId]);

  showToast("Contrato marcado como Renovado con éxito.", "success");
  await refreshRenewals();
}

async function launchRenewalComparison(renId) {
  const ren = renewalsData.find(r => r.id === renId);
  if (!ren) return;

  // 1. Navegar a la pestaña del comparador de tarifas
  const calcNavBtn = document.getElementById('nav-calculator');
  if (calcNavBtn) calcNavBtn.click();

  // 2. Precargar datos del cliente, CUPS, tipo de energía y consumos anteriores en la calculadora
  try {
    const { prefillCalculatorForRenewal } = await import('./calculator_view.js');
    await prefillCalculatorForRenewal(ren);
  } catch (err) {
    console.error("Error al precargar la comparativa de renovación:", err);
  }
}
