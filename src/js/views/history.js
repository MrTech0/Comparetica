import { getComparativas, deleteComparativa, updateComparativaEstado, updateComparativaCobro, updateComparativaContrato } from '../db.js';
import { generatePDFReport } from '../pdf.js';
import { openNewRenewalDialogFromHistory } from './renewals.js';
import { relaunchComparisonForScoring } from './calculator_view.js';
import { invoke } from '../ipc.js';
import { showToast, showConfirm } from '../ui.js';
import { onAppEvent, APP_EVENTS } from '../events.js';
import { getComparisonStatusLock, canManageCommissionCollection } from '../comparison_status.js';
import { getCommissionSplit, formatRetentionPercent, moneyToCents } from '../commission_split.js';

const commissionMoney = cents => `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const commissionEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
function grossCommissionCents(record) {
  try { return moneyToCents(record.comision_total ?? 0); } catch { return 0; }
}
function commissionDetailHtml(split) {
  return `<div class="commission-split-detail">
    <span>Total del contrato: <strong>${commissionMoney(split.total_centimos)}</strong></span>
    <span>Comercial: <strong>${commissionEscape(split.agente_nombre)}</strong></span>
    <span>Retención: ${formatRetentionPercent(split.porcentaje_centesimas)} %</span>
    <span>Consultoría: <strong>${commissionMoney(split.consultoria_centimos)}</strong></span>
    <span>Comercial: <strong>${commissionMoney(split.comercial_centimos)}</strong></span>
  </div>`;
}

let activeLockTimers = [];
let isCobroDialogInitialized = false;
let unsubComparisonSaved = null;
const HISTORY_SEARCH_COLUMNS = ['client', 'cups'];
const pendingHistoryChanges = new Set();
const historyContractControls = new Map();

function getStatusLockTitle(reason) {
  if (reason === 'contract') return 'El estado está bloqueado por el estado del contrato.';
  if (reason === 'pending') return 'Guardando el cambio. Espera un momento.';
  return 'El estado ya no se puede modificar al haber transcurrido los 5 segundos de margen.';
}

function getCommissionControlTitle(c) {
  if (c.estado_cobro === 'Cobrado') {
    const date = c.fecha_cobro ? new Date(c.fecha_cobro).toLocaleDateString('es-ES') : '';
    return `${date ? `Cobrado el ${date}.` : 'Cobrado.'} El cobro es definitivo y no se puede modificar.`;
  }
  if (!canManageCommissionCollection(c)) return 'El cobro solo se puede gestionar cuando el contrato está firmado y activado.';
  if (pendingHistoryChanges.has(c.id)) return getStatusLockTitle('pending');
  return 'Pendiente de cobro. Haz clic para registrar cobro.';
}

function syncCommissionControl(control, c) {
  if (!control) return;
  control.disabled = !canManageCommissionCollection(c) || pendingHistoryChanges.has(c.id);
  control.setAttribute('title', getCommissionControlTitle(c));
  const arrow = control.querySelector('.status-select-arrow');
  if (arrow) arrow.style.display = control.disabled ? 'none' : '';
}

function refreshHistoryContract(c) {
  updateHistoryKpis(cachedHistory);
  // Un filtro de contrato puede hacer que la fila deje de pertenecer a la vista.
  if (currentHistoryContractFilter !== 'ALL') {
    applyHistoryFilter();
    return;
  }
  const refreshControls = historyContractControls.get(c.id);
  if (refreshControls && !refreshControls()) applyHistoryFilter();
}

function clearActiveLockTimers() {
  activeLockTimers.forEach(timer => clearTimeout(timer));
  activeLockTimers = [];
}

function showLegalRetentionCompWarning() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog-legal-retention-comp-warn');
    const closeBtn = document.getElementById('dialog-legal-retention-comp-close');
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

export async function initHistoryView() {
  currentHistoryPage = 1;
  for (const column of HISTORY_SEARCH_COLUMNS) {
    const input = document.getElementById(`search-history-${column}`);
    const details = document.getElementById(`history-${column}-search`);
    if (input) input.value = '';
    if (details) details.open = false;
  }

  setupCobroDialog();
  await loadHistoryTable();

  // Escuchar cuando se guarde una nueva comparativa para refrescar la lista automáticamente
  if (unsubComparisonSaved) {
    unsubComparisonSaved();
  }
  unsubComparisonSaved = onAppEvent(APP_EVENTS.COMPARISON_SAVED, refreshHistory);
}

async function refreshHistory() {
  await loadHistoryTable();
}

let cachedHistory = [];
let currentHistoryDateSort = 'desc'; // 'desc' (más reciente a más antigua) | 'asc' (más antigua a más reciente)
let currentHistorySavingsSort = null; // 'desc' (mayor a menor) | 'asc' (menor a mayor) | null
let currentHistoryCommissionSort = null;
let currentHistoryTypeFilter = 'ALL';
let currentHistoryEstadoFilter = 'ALL';
let currentHistoryContractFilter = 'ALL';
let currentHistoryCobroFilter = 'ALL';
const HISTORY_PAGE_SIZE = 25;
let currentHistoryPage = 1;
let currentHistoryTotalPages = 1;

function setupHistoryPagination() {
  for (const [id, direction] of [['btn-prev-page-history', -1], ['btn-next-page-history', 1]]) {
    const button = document.getElementById(id);
    if (!button || button.dataset.listenerAdded) continue;
    button.dataset.listenerAdded = 'true';
    button.addEventListener('click', () => {
      const page = currentHistoryPage + direction;
      if (page < 1 || page > currentHistoryTotalPages) return;
      currentHistoryPage = page;
      closeAllHistoryHeaderDropdowns();
      applyHistoryFilter();
    });
  }
}

function updateHistoryPagination(totalCount) {
  const start = totalCount === 0 ? 0 : (currentHistoryPage - 1) * HISTORY_PAGE_SIZE + 1;
  const end = Math.min(currentHistoryPage * HISTORY_PAGE_SIZE, totalCount);
  const info = document.getElementById('history-pagination-info');
  const indicator = document.getElementById('history-page-indicator');
  const previous = document.getElementById('btn-prev-page-history');
  const next = document.getElementById('btn-next-page-history');
  if (info) info.textContent = `Mostrando ${start} - ${end} de ${totalCount.toLocaleString('es-ES')} comparativas`;
  if (indicator) indicator.textContent = `Página ${currentHistoryPage} de ${currentHistoryTotalPages}`;
  if (previous) previous.disabled = currentHistoryPage <= 1;
  if (next) next.disabled = currentHistoryPage >= currentHistoryTotalPages;
}

function setupHistoryColumnSearches() {
  for (const column of HISTORY_SEARCH_COLUMNS) {
    const input = document.getElementById(`search-history-${column}`);
    const details = document.getElementById(`history-${column}-search`);
    const clearButton = document.getElementById(`btn-clear-history-${column}`);
    if (!input || !details || input.dataset.listenerAdded) continue;
    input.dataset.listenerAdded = 'true';
    input.addEventListener('input', () => applyHistoryFilter(true));
    details.addEventListener('toggle', () => {
      if (details.open) input.focus();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        details.open = false;
        details.querySelector('summary')?.focus();
      }
    });
    clearButton?.addEventListener('click', () => {
      input.value = '';
      applyHistoryFilter(true);
      input.focus();
    });
  }
}

function setupHistoryTypeFilter() {
  const select = document.getElementById('filter-history-type');
  if (!select) return;
  select.value = currentHistoryTypeFilter;
  if (select.dataset.listenerAdded) return;
  select.dataset.listenerAdded = 'true';
  select.addEventListener('change', () => {
    currentHistoryTypeFilter = select.value;
    applyHistoryFilter(true);
  });
}

function closeAllHistoryHeaderDropdowns() {
  const tableContainer = document.querySelector('#section-history .table-container');
  if (tableContainer) tableContainer.classList.remove('has-open-dropdown');

  const estadoDropdown = document.getElementById('dropdown-history-estado-filter');
  const estadoTh = document.getElementById('th-history-estado');
  const estadoArrow = document.getElementById('th-history-estado-arrow');
  if (estadoDropdown) estadoDropdown.style.display = 'none';
  if (estadoTh) estadoTh.classList.remove('open');
  if (estadoArrow) estadoArrow.style.transform = 'rotate(0deg)';

  const contractDropdown = document.getElementById('dropdown-history-contract-filter');
  const contractTh = document.getElementById('th-history-contract');
  const contractArrow = document.getElementById('th-history-contract-arrow');
  if (contractDropdown) contractDropdown.style.display = 'none';
  if (contractTh) contractTh.classList.remove('open');
  if (contractArrow) contractArrow.style.transform = 'rotate(0deg)';

  const cobroDropdown = document.getElementById('dropdown-history-cobro-filter');
  const cobroTh = document.getElementById('th-history-cobro');
  const cobroArrow = document.getElementById('th-history-cobro-arrow');
  if (cobroDropdown) cobroDropdown.style.display = 'none';
  if (cobroTh) cobroTh.classList.remove('open');
  if (cobroArrow) cobroArrow.style.transform = 'rotate(0deg)';
}

function setupHistoryEstadoFilterDropdown() {
  const th = document.getElementById('th-history-estado');
  const dropdown = document.getElementById('dropdown-history-estado-filter');
  const arrow = document.getElementById('th-history-estado-arrow');
  const label = document.getElementById('th-history-estado-label');
  const tableContainer = document.querySelector('#section-history .table-container');

  if (!th || !dropdown) return;
  if (th.dataset.filterInitialized) return;
  th.dataset.filterInitialized = 'true';

  th.addEventListener('click', (e) => {
    if (e.target.closest('#dropdown-history-estado-filter')) return;
    const isVisible = dropdown.style.display === 'block';
    closeAllHistoryHeaderDropdowns();

    if (!isVisible) {
      dropdown.style.display = 'block';
      th.classList.add('open');
      if (tableContainer) tableContainer.classList.add('has-open-dropdown');
      if (arrow) arrow.style.transform = 'rotate(180deg)';
    }
  });

  dropdown.querySelectorAll('.history-estado-filter-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = 'var(--color-surface-variant)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = 'transparent';
    });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const estado = item.getAttribute('data-estado') || 'ALL';
      currentHistoryEstadoFilter = estado;

      dropdown.querySelectorAll('.history-estado-filter-item').forEach(el => {
        const check = el.querySelector('.history-estado-check');
        if (check) check.style.display = el === item ? 'inline' : 'none';
      });

      if (label) {
        if (estado === 'ALL') label.textContent = 'Estado';
        else if (estado === 'Aceptada') label.textContent = 'Estado: Aceptadas';
        else if (estado === 'Pendiente de aceptación') label.textContent = 'Estado: Pendientes';
        else if (estado === 'Rechazada') label.textContent = 'Estado: Rechazadas';
      }

      closeAllHistoryHeaderDropdowns();
      applyHistoryFilter(true);
    });
  });

  document.addEventListener('click', (e) => {
    if (!th.contains(e.target)) {
      dropdown.style.display = 'none';
      th.classList.remove('open');
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      if (tableContainer && !tableContainer.querySelector('th.open')) {
        tableContainer.classList.remove('has-open-dropdown');
      }
    }
  });
}

function setupHistoryContractFilterDropdown() {
  const th = document.getElementById('th-history-contract');
  const dropdown = document.getElementById('dropdown-history-contract-filter');
  const arrow = document.getElementById('th-history-contract-arrow');
  const label = document.getElementById('th-history-contract-label');
  const tableContainer = document.querySelector('#section-history .table-container');

  if (!th || !dropdown) return;
  if (th.dataset.filterInitialized) return;
  th.dataset.filterInitialized = 'true';

  th.addEventListener('click', (e) => {
    if (e.target.closest('#dropdown-history-contract-filter')) return;
    const isVisible = dropdown.style.display === 'block';
    closeAllHistoryHeaderDropdowns();

    if (!isVisible) {
      dropdown.style.display = 'block';
      th.classList.add('open');
      if (tableContainer) tableContainer.classList.add('has-open-dropdown');
      if (arrow) arrow.style.transform = 'rotate(180deg)';
    }
  });

  dropdown.querySelectorAll('.history-contract-filter-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = 'var(--color-surface-variant)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = 'transparent';
    });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const contract = item.getAttribute('data-contract') || 'ALL';
      currentHistoryContractFilter = contract;

      dropdown.querySelectorAll('.history-contract-filter-item').forEach(el => {
        const check = el.querySelector('.history-contract-check');
        if (check) check.style.display = el === item ? 'inline' : 'none';
      });

      if (label) {
        if (contract === 'ALL') label.textContent = 'Contrato';
        else label.textContent = `Contrato: ${contract}`;
      }

      closeAllHistoryHeaderDropdowns();
      applyHistoryFilter(true);
    });
  });

  document.addEventListener('click', (e) => {
    if (!th.contains(e.target)) {
      dropdown.style.display = 'none';
      th.classList.remove('open');
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      if (tableContainer && !tableContainer.querySelector('th.open')) {
        tableContainer.classList.remove('has-open-dropdown');
      }
    }
  });
}

function setupHistoryCobroFilterDropdown() {
  const th = document.getElementById('th-history-cobro');
  const dropdown = document.getElementById('dropdown-history-cobro-filter');
  const arrow = document.getElementById('th-history-cobro-arrow');
  const label = document.getElementById('th-history-cobro-label');
  const tableContainer = document.querySelector('#section-history .table-container');

  if (!th || !dropdown) return;
  if (th.dataset.filterInitialized) return;
  th.dataset.filterInitialized = 'true';

  th.addEventListener('click', (e) => {
    if (e.target.closest('#dropdown-history-cobro-filter')) return;
    const isVisible = dropdown.style.display === 'block';
    closeAllHistoryHeaderDropdowns();

    if (!isVisible) {
      dropdown.style.display = 'block';
      th.classList.add('open');
      if (tableContainer) tableContainer.classList.add('has-open-dropdown');
      if (arrow) arrow.style.transform = 'rotate(180deg)';
    }
  });

  dropdown.querySelectorAll('.history-cobro-filter-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = 'var(--color-surface-variant)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = 'transparent';
    });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const cobro = item.getAttribute('data-cobro') || 'ALL';
      currentHistoryCobroFilter = cobro;

      dropdown.querySelectorAll('.history-cobro-filter-item').forEach(el => {
        const check = el.querySelector('.history-cobro-check');
        if (check) check.style.display = el === item ? 'inline' : 'none';
      });

      if (label) {
        if (cobro === 'ALL') label.textContent = 'Cobro Comisión';
        else if (cobro === 'PENDIENTE') label.textContent = 'Cobro: 🟡 Pendientes';
        else if (cobro === 'COBRADO') label.textContent = 'Cobro: ✅ Cobrados';
      }

      closeAllHistoryHeaderDropdowns();
      applyHistoryFilter(true);
    });
  });

  document.addEventListener('click', (e) => {
    if (!th.contains(e.target)) {
      dropdown.style.display = 'none';
      th.classList.remove('open');
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      if (tableContainer && !tableContainer.querySelector('th.open')) {
        tableContainer.classList.remove('has-open-dropdown');
      }
    }
  });
}

function setupHistoryDateSort() {
  const th = document.getElementById('th-history-date');
  if (!th || th.dataset.sortInitialized) return;
  th.dataset.sortInitialized = 'true';

  th.addEventListener('click', () => {
    if (currentHistorySavingsSort !== null || currentHistoryCommissionSort !== null) {
      currentHistorySavingsSort = null;
      currentHistoryCommissionSort = null;
      currentHistoryDateSort = 'desc';
    } else {
      currentHistoryDateSort = currentHistoryDateSort === 'desc' ? 'asc' : 'desc';
    }
    updateHistorySortIndicators();
    applyHistoryFilter(true);
  });
}

function setupHistorySavingsSort() {
  const th = document.getElementById('th-history-savings');
  if (!th || th.dataset.sortInitialized) return;
  th.dataset.sortInitialized = 'true';

  th.addEventListener('click', () => {
    currentHistoryCommissionSort = null;
    if (!currentHistorySavingsSort || currentHistorySavingsSort === 'asc') {
      currentHistorySavingsSort = 'desc';
    } else {
      currentHistorySavingsSort = 'asc';
    }
    updateHistorySortIndicators();
    applyHistoryFilter(true);
  });
}

function setupHistoryCommissionSort() {
  const button = document.getElementById('btn-history-commission-sort');
  if (!button || button.dataset.sortInitialized) return;
  button.dataset.sortInitialized = 'true';
  button.addEventListener('click', () => {
    currentHistorySavingsSort = null;
    currentHistoryCommissionSort = currentHistoryCommissionSort === 'desc' ? 'asc' : 'desc';
    updateHistorySortIndicators();
    applyHistoryFilter(true);
  });
}

function updateHistorySortIndicators() {
  const dateSort = currentHistorySavingsSort === null && currentHistoryCommissionSort === null ? currentHistoryDateSort : null;
  for (const [column, direction, label, descending, ascending] of [
    ['date', dateSort, 'fecha', 'Más reciente a más antigua', 'Más antigua a más reciente'],
    ['savings', currentHistorySavingsSort, 'ahorro anual', 'Mayor a menor ahorro', 'Menor a mayor ahorro'],
    ['commission', currentHistoryCommissionSort, 'comisión', 'Mayor a menor comisión', 'Menor a mayor comisión']
  ]) {
    const th = document.getElementById(`th-history-${column}`);
    th?.setAttribute('aria-sort', direction ? (direction === 'desc' ? 'descending' : 'ascending') : 'none');
    const icon = document.getElementById(`th-history-${column}-sort-icon`);
    if (!icon) continue;
    icon.textContent = direction ? (direction === 'desc' ? '↓' : '↑') : '↕';
    icon.style.color = direction ? 'var(--color-primary)' : 'var(--color-on-surface-variant)';
    icon.style.fontWeight = direction ? 'bold' : 'normal';
    icon.title = direction ? `Orden: ${direction === 'desc' ? descending : ascending}` : `Haga clic para ordenar por ${label}`;
  }
}

async function loadHistoryTable() {
  clearActiveLockTimers();
  historyContractControls.clear();
  const tbody = document.querySelector('#table-history tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="11" class="text-muted">Cargando historial...</td></tr>';
  for (const id of ['btn-prev-page-history', 'btn-next-page-history']) {
    const button = document.getElementById(id);
    if (button) button.disabled = true;
  }

  try {
    cachedHistory = await getComparativas();
    
    setupHistoryColumnSearches();
    setupHistoryTypeFilter();
    setupHistoryPagination();

    // Configurar desplegables de filtrado en cabeceras
    setupHistoryEstadoFilterDropdown();
    setupHistoryContractFilterDropdown();
    setupHistoryCobroFilterDropdown();

    // Configurar ordenación en cabeceras
    setupHistoryDateSort();
    setupHistorySavingsSort();
    setupHistoryCommissionSort();
    updateHistorySortIndicators();

    const tableContainer = document.querySelector('#section-history .table-container');
    if (tableContainer && !tableContainer.dataset.scrollListenerAdded) {
      tableContainer.addEventListener('scroll', () => {
        document.querySelectorAll('.m3-custom-status-select, .m3-custom-contract-select').forEach(cs => cs.classList.remove('open'));
        closeAllHistoryHeaderDropdowns();
      });
      tableContainer.dataset.scrollListenerAdded = 'true';
    }

    if (!window._historyScrollListenerAdded) {
      window.addEventListener('scroll', () => {
        document.querySelectorAll('.m3-custom-status-select, .m3-custom-contract-select').forEach(cs => cs.classList.remove('open'));
        closeAllHistoryHeaderDropdowns();
      }, true);
      window._historyScrollListenerAdded = true;
    }

    applyHistoryFilter();
  } catch (error) {
    cachedHistory = [];
    currentHistoryPage = 1;
    currentHistoryTotalPages = 1;
    updateHistoryKpis(cachedHistory);
    updateHistoryPagination(0);
    tbody.innerHTML = '<tr><td colspan="11" class="text-error">Error al cargar el historial.</td></tr>';
    console.error(error);
  }
}

function updateHistoryKpis(list) {
  let pendientesAceptacion = 0;
  let pendientesFirma = 0;
  let totalComisionesPendientes = 0;
  let legacyPendientes = 0;
  let legacyCobradas = 0;
  let legacyCount = 0;

  list.forEach(c => {
    if ((c.estado || 'Pendiente de aceptación') === 'Pendiente de aceptación') pendientesAceptacion++;
    if (c.estado_contrato === 'En trámite') pendientesFirma++;

    const split = getCommissionSplit(c);
    const comision = split?.consultoria_centimos ?? 0;
    if (!split) legacyCount++;
    const isCobrado = c.estado_cobro === 'Cobrado';

    if (isCobrado) {
      if (!split) legacyCobradas += grossCommissionCents(c);
    } else if (canManageCommissionCollection(c)) {
      if (split) totalComisionesPendientes += comision;
      else legacyPendientes += grossCommissionCents(c);
    }
  });

  const elAceptacion = document.getElementById('history-kpi-acceptance-pending');
  const elFirma = document.getElementById('history-kpi-signature-pending');
  const elPendientes = document.getElementById('history-kpi-pendientes');

  if (elAceptacion) elAceptacion.textContent = pendientesAceptacion.toString();
  if (elFirma) elFirma.textContent = pendientesFirma.toString();
  if (elPendientes) elPendientes.textContent = commissionMoney(totalComisionesPendientes);
  const legacy = document.getElementById('history-legacy-commissions');
  if (legacy) legacy.hidden = legacyCount === 0;
  const legacyPending = document.getElementById('history-legacy-pendientes');
  const legacyPaid = document.getElementById('history-legacy-cobradas');
  if (legacyPending) legacyPending.textContent = commissionMoney(legacyPendientes);
  if (legacyPaid) legacyPaid.textContent = commissionMoney(legacyCobradas);
}

function applyHistoryFilter(resetPage = false) {
  if (resetPage) currentHistoryPage = 1;
  clearActiveLockTimers();
  historyContractControls.clear();
  const tbody = document.querySelector('#table-history tbody');
  if (!tbody) return;

  updateHistoryKpis(cachedHistory);

  const clientQuery = document.getElementById('search-history-client')?.value.trim() || '';
  const cupsQuery = document.getElementById('search-history-cups')?.value.trim() || '';
  for (const [column, query] of [['client', clientQuery], ['cups', cupsQuery]]) {
    const details = document.getElementById(`history-${column}-search`);
    const clearButton = document.getElementById(`btn-clear-history-${column}`);
    details?.classList.toggle('is-filtered', Boolean(query));
    const label = column === 'client' ? 'Cliente' : 'CUPS';
    details?.querySelector('summary')?.setAttribute('aria-label', query ? `${label}, búsqueda activa: ${query}` : `${label}, abrir búsqueda`);
    if (clearButton) clearButton.disabled = !query;
  }

  const cleanString = (str) => {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const cleanClientQuery = cleanString(clientQuery);
  const cleanCupsQuery = cleanString(cupsQuery);

  const filtered = cachedHistory.filter(c => {
    if (clientQuery && !cleanString(c.cliente_nombre).includes(cleanClientQuery)) return false;
    if (cupsQuery && !cleanString(c.cliente_cups).includes(cleanCupsQuery)) return false;
    if (currentHistoryTypeFilter !== 'ALL' && String(c.tipo_energia || '').toUpperCase() !== currentHistoryTypeFilter) return false;

    if (currentHistoryEstadoFilter !== 'ALL') {
      if ((c.estado || 'Pendiente de aceptación') !== currentHistoryEstadoFilter) return false;
    }

    if (currentHistoryContractFilter !== 'ALL') {
      if ((c.estado_contrato || 'Pendiente') !== currentHistoryContractFilter) return false;
    }

    if (currentHistoryCobroFilter !== 'ALL') {
      const estadoCobro = c.estado_cobro || 'Pendiente';
      if (currentHistoryCobroFilter === 'COBRADO' && estadoCobro !== 'Cobrado') return false;
      if (currentHistoryCobroFilter === 'PENDIENTE' && estadoCobro === 'Cobrado') return false;
    }

    return true;
  });

  // Aplicar ordenación activa
  if (currentHistoryCommissionSort !== null) {
    const direction = currentHistoryCommissionSort === 'desc' ? -1 : 1;
    filtered.sort((a, b) => {
      const splitA = getCommissionSplit(a), splitB = getCommissionSplit(b);
      if (splitA && splitB) return direction * (splitA.consultoria_centimos - splitB.consultoria_centimos);
      if (splitA) return -1;
      if (splitB) return 1;
      return new Date(b.fecha).getTime() - new Date(a.fecha).getTime();
    });
  } else if (currentHistorySavingsSort === 'desc') {
    filtered.sort((a, b) => ((b.ahorro_luz_anual || 0) + (b.ahorro_gas_anual || 0)) - ((a.ahorro_luz_anual || 0) + (a.ahorro_gas_anual || 0)));
  } else if (currentHistorySavingsSort === 'asc') {
    filtered.sort((a, b) => ((a.ahorro_luz_anual || 0) + (a.ahorro_gas_anual || 0)) - ((b.ahorro_luz_anual || 0) + (b.ahorro_gas_anual || 0)));
  } else {
    if (currentHistoryDateSort === 'asc') {
      filtered.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
    } else {
      filtered.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    }
  }

  currentHistoryTotalPages = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  currentHistoryPage = Math.min(currentHistoryPage, currentHistoryTotalPages);
  updateHistoryPagination(filtered.length);
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    const hasActiveFilters = clientQuery || cupsQuery || currentHistoryTypeFilter !== 'ALL' || currentHistoryEstadoFilter !== 'ALL' || currentHistoryContractFilter !== 'ALL' || currentHistoryCobroFilter !== 'ALL';
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-muted" style="text-align: center; padding: 32px 16px;">
          ${hasActiveFilters ? 'No se encontraron comparativas con los filtros aplicados.' : 'No se han registrado comparativas aún.'}
        </td>
      </tr>
    `;
    return;
  }

  const pageStart = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
  filtered.slice(pageStart, pageStart + HISTORY_PAGE_SIZE).forEach(c => {
    const split = getCommissionSplit(c);
    const commissionCell = split
      ? `<details class="commission-split"><summary aria-label="Comisión de consultoría: ${commissionMoney(split.consultoria_centimos)}. Ver reparto de ${commissionEscape(c.cliente_nombre)}">${commissionMoney(split.consultoria_centimos)}</summary>${commissionDetailHtml(split)}</details>`
      : `${commissionMoney(grossCommissionCents(c))}<small class="commission-legacy-label">${c.reparto_comision_json ? 'Reparto no válido' : 'Sin reparto registrado'}</small>`;
    const dateStr = new Date(c.fecha).toLocaleString('es-ES', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    const totalAhorro = c.ahorro_luz_anual + c.ahorro_gas_anual;
    const currentEstado = c.estado || 'Pendiente de aceptación';
    
    let estadoClass = 'estado-pendiente';
    if (currentEstado === 'Aceptada') estadoClass = 'estado-aceptada';
    else if (currentEstado === 'Rechazada') estadoClass = 'estado-rechazada';

    const statusLock = getComparisonStatusLock(c);
    const isLocked = statusLock.locked || pendingHistoryChanges.has(c.id);
    const lockTitle = getStatusLockTitle(statusLock.reason || 'pending');

    const isAceptada = (currentEstado === 'Aceptada');
    const deleteAttr = isAceptada
      ? 'style="opacity: 0.5;" title="Ver restricción legal de eliminación"'
      : 'title="Eliminar del historial"';

    const isCobrado = (c.estado_cobro === 'Cobrado');
    let cobroCellHtml = '';
    if (isAceptada) {
      const collectionDisabled = !canManageCommissionCollection(c) || pendingHistoryChanges.has(c.id);
      cobroCellHtml = `<td>
        <button type="button" class="status-select-trigger ${isCobrado ? 'estado-aceptada' : 'estado-pendiente'} btn-manage-cobro"
          data-id="${c.id}" title="${getCommissionControlTitle(c)}" ${collectionDisabled ? 'disabled' : ''}>
          <span>${isCobrado ? '✅ Cobrado' : '🟡 Pendiente'}</span>
          <svg class="status-select-arrow" viewBox="0 0 24 24" ${collectionDisabled ? 'style="display: none;"' : ''} aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>
        </button>
      </td>`;
    } else {
      cobroCellHtml = `<td><span class="text-muted" style="font-size: 12px; display: block; text-align: center;">—</span></td>`;
    }

    const currentContract = c.estado_contrato || 'Pendiente';
    const isContractSignedAndActive = (currentContract === 'Firmado y Activado');
    let contractClass = 'contrato-pendiente';
    if (currentContract === 'En trámite') contractClass = 'contrato-tramite';
    else if (currentContract === 'Firmado y Activado') contractClass = 'contrato-firmado';
    else if (currentContract === 'Rechazado por Scoring') contractClass = 'contrato-scoring';

    let contractCellHtml = '';
    if (!isAceptada) {
      // 1. Si la comparativa no está aceptada, el contrato no debe ser clicable
      contractCellHtml = `
        <td>
          <div class="status-select-trigger ${contractClass}" style="cursor: not-allowed; opacity: 0.65;" title="El contrato solo es editable cuando la comparativa está aceptada.">
            <span>${escapeHtml(currentContract)}</span>
          </div>
        </td>
      `;
    } else if (isContractSignedAndActive) {
      // 2. Si el contrato ya está firmado y activado, no se permite cambiar a otro estado
      contractCellHtml = `
        <td>
          <div class="status-select-trigger ${contractClass}" style="cursor: default;" title="Contrato firmado y activado (bloqueado)">
            <span>✅ Firmado y Activado</span>
          </div>
        </td>
      `;
    } else {
      // 3. Comparativa aceptada y contrato pendiente / en trámite / scoring: editable
      contractCellHtml = `
        <td>
          <div class="m3-custom-contract-select" data-id="${c.id}">
            <div class="status-select-trigger ${contractClass}" style="cursor: pointer;">
              <span>${escapeHtml(currentContract)}</span>
              <svg class="status-select-arrow" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
            </div>
            <div class="status-select-options">
              <div class="status-select-option contrato-pendiente" data-value="Pendiente">Pendiente</div>
              <div class="status-select-option contrato-tramite" data-value="En trámite">En trámite</div>
              <div class="status-select-option contrato-firmado" data-value="Firmado y Activado">✅ Firmado y Activado</div>
              <div class="status-select-option contrato-scoring" data-value="Rechazado por Scoring">🚫 Rechazado por Scoring</div>
            </div>
          </div>
        </td>
      `;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${dateStr}</td>
      <td><strong>${escapeHtml(c.cliente_nombre)}</strong></td>
      <td><small class="text-muted">${escapeHtml(c.cliente_cups || '-')}</small></td>
      <td>
        <span class="m3-chip" style="font-size:11px; height:24px; padding:0 8px;">
          ${escapeHtml(c.tipo_energia)}
        </span>
      </td>
      <td class="text-success">${totalAhorro.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/año</td>
      <td>
        <div class="m3-custom-status-select ${isLocked ? 'disabled' : ''}" data-id="${c.id}" aria-disabled="${isLocked}" ${isLocked ? `title="${lockTitle}"` : ''}>
          <div class="status-select-trigger ${estadoClass}" style="${isLocked ? 'cursor: not-allowed; opacity: 0.75;' : ''}">
            <span>${escapeHtml(currentEstado)}</span>
            <svg class="status-select-arrow" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
          </div>
          <div class="status-select-options">
            <div class="status-select-option estado-pendiente" data-value="Pendiente de aceptación">Pendiente de aceptación</div>
            <div class="status-select-option estado-aceptada" data-value="Aceptada">Aceptada</div>
            <div class="status-select-option estado-rechazada" data-value="Rechazada">Rechazada</div>
          </div>
        </div>
      </td>
      ${contractCellHtml}
      <td class="private-value" style="font-weight: 600;">${commissionCell}</td>
      <td class="private-value" style="font-weight: 600;">${split ? commissionMoney(split.comercial_centimos) : '—'}</td>
      ${cobroCellHtml}
      <td style="text-align: right; white-space: nowrap;">
        <button class="m3-btn-icon btn-preview-history" data-id="${c.id}" title="Previsualizar Reporte PDF">
          <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        </button>
        <button class="m3-btn-icon btn-print-history" data-id="${c.id}" title="Guardar Reporte PDF">
          <svg viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
        </button>
        <button class="m3-btn-icon btn-email-history" data-id="${c.id}" title="Enviar por Correo Electrónico" style="${!c.cliente_email ? 'opacity: 0.38; color: var(--color-outline);' : ''}">
          <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
        </button>
        <button class="m3-btn-icon btn-delete-history" data-id="${c.id}" ${deleteAttr}>
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        </button>
      </td>
    `;

    // Evento de gestión de cobro
    const btnCobro = tr.querySelector('.btn-manage-cobro');
    if (btnCobro) {
      btnCobro.addEventListener('click', () => {
        openCobroDialog(c);
      });
    }

    // Evento de previsualización
    tr.querySelector('.btn-preview-history').addEventListener('click', () => {
      reprintPDF(c, true);
    });

    // Evento de impresión
    tr.querySelector('.btn-print-history').addEventListener('click', () => {
      reprintPDF(c, false);
    });

    // Abrir borrador de correo con el reporte adjunto
    tr.querySelector('.btn-email-history').addEventListener('click', async () => {
      if (!c.cliente_email) {
        showToast("El cliente no tiene un correo de contacto configurado en su ficha.", "error");
        return;
      }
      
      try {
        showToast("Generando reporte y preparando correo electrónico...", "info");
        
        const reportData = getReportDataForRecord(c);
        
        // Generar base64 del PDF (preguntando por contraseña si corresponde)
        const pdfBase64 = await generatePDFReport(reportData, false, true);
        if (!pdfBase64) {
          // El usuario canceló la generación
          return;
        }

        const safeClientName = c.cliente_nombre.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const pdfFilename = `comparativa_${safeClientName}.pdf`;

        if (typeof window !== 'undefined' && window.__TAURI__) {
          await invoke('open_email_with_attachment', {
            recipient: c.cliente_email,
            pdfBase64: pdfBase64,
            pdfFilename: pdfFilename
          });
          showToast("✅ Se ha abierto un borrador de correo con el PDF adjunto.", "success");
        } else {
          // Fallback para pruebas en navegador sin Tauri (abre mailto simple sin adjunto)
          const mailtoUrl = `mailto:${encodeURIComponent(c.cliente_email)}?subject=${encodeURIComponent(`Estudio Comparativo - ${c.cliente_nombre}`)}&body=${encodeURIComponent(`Estimado cliente,\n\nAdjuntamos el informe comparativo.`)}`;
          window.open(mailtoUrl, '_blank');
          showToast("Cliente de correo abierto para enviar el estudio.", "info");
        }
      } catch (err) {
        showToast("Error al preparar el envío por correo: " + err, "error");
        console.error(err);
      }
    });

    // Evento de borrado
    tr.querySelector('.btn-delete-history').addEventListener('click', async (e) => {
      const customSelectEl = tr.querySelector('.m3-custom-status-select');
      const estadoActual = customSelectEl ? customSelectEl.querySelector('.status-select-trigger span').textContent.trim() : c.estado;
      if (estadoActual === 'Aceptada') {
        await showLegalRetentionCompWarning();
        return;
      }
      if (await showConfirm(`¿Está seguro de eliminar del historial la comparativa de ${c.cliente_nombre}?`, "Eliminar Comparativa")) {
        await deleteComparativa(c.id);
        await loadHistoryTable();
      }
    });

    // Configurar eventos para el custom select de estado
    const customSelect = tr.querySelector('.m3-custom-status-select');
    const trigger = customSelect.querySelector('.status-select-trigger');
    const options = customSelect.querySelectorAll('.status-select-option');

    const lockStatus = (reason) => {
      clearTimeout(customSelect._lockTimer);
      customSelect.classList.add('disabled');
      customSelect.classList.remove('open');
      customSelect.setAttribute('aria-disabled', 'true');
      customSelect.setAttribute('title', getStatusLockTitle(reason));
      trigger.style.cursor = 'not-allowed';
      trigger.style.opacity = '0.75';
    };
    const isStatusUnavailable = () => {
      const lock = getComparisonStatusLock(c);
      if (lock.locked || pendingHistoryChanges.has(c.id)) {
        lockStatus(lock.reason || 'pending');
        return true;
      }
      return false;
    };

    // Mantener el plazo original incluso si se recarga, filtra o actualiza la fila.
    const syncStatusLock = () => {
      const lock = getComparisonStatusLock(c);
      if (lock.locked || pendingHistoryChanges.has(c.id)) {
        lockStatus(lock.reason || 'pending');
        return;
      }
      clearTimeout(customSelect._lockTimer);
      customSelect.classList.remove('disabled');
      customSelect.setAttribute('aria-disabled', 'false');
      customSelect.setAttribute('title', '');
      trigger.style.cursor = '';
      trigger.style.opacity = '';
      if (lock.remainingMs === null) return;
      const timer = setTimeout(() => {
        lockStatus('elapsed');
        showToast(`El estado de la comparativa de ${c.cliente_nombre} ha quedado fijado de forma definitiva.`, "info");
      }, lock.remainingMs);
      customSelect._lockTimer = timer;
      activeLockTimers.push(timer);
    };
    syncStatusLock();

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isStatusUnavailable()) return;
      
      // Cerrar todos los demás custom status y contract selects abiertos
      document.querySelectorAll('.m3-custom-status-select, .m3-custom-contract-select').forEach(cs => {
        if (cs !== customSelect) {
          cs.classList.remove('open');
        }
      });
      
      customSelect.classList.toggle('open');
    });

    options.forEach(option => {
      option.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isStatusUnavailable()) return;
        const nuevoEstado = option.getAttribute('data-value');
        if (nuevoEstado === c.estado) {
          customSelect.classList.remove('open');
          return;
        }
        
        pendingHistoryChanges.add(c.id);
        lockStatus('pending');
        let statusUpdated = false;
        try {
          await updateComparativaEstado(c.id, nuevoEstado);
          
          const nowIso = new Date().toISOString();
          c.estado = nuevoEstado;
          c.estado_cambiado_en = (nuevoEstado === 'Pendiente de aceptación') ? null : nowIso;

          const found = cachedHistory.find(item => item.id === c.id);
          if (found) {
            found.estado = nuevoEstado;
            found.estado_cambiado_en = c.estado_cambiado_en;
          }
          
          customSelect.classList.remove('open');
          showToast("Estado de la comparativa actualizado correctamente.", "success");
          statusUpdated = true;
        } catch (err) {
          showToast(err.message === 'COMPARISON_STATUS_LOCKED'
            ? 'El estado ya está bloqueado y no se puede modificar.' : 'Error al actualizar el estado.', 'error');
          console.error(err);
        } finally {
          pendingHistoryChanges.delete(c.id);
        }
        await loadHistoryTable();

        // Recargar tabla de clientes si es necesario para refrescar su Tipo Cliente.
        const clientsSection = document.getElementById('section-clients');
        if (statusUpdated && clientsSection && clientsSection.classList.contains('active')) {
          const { loadClientsTable } = await import('./clients.js');
          await loadClientsTable();
        }
      });
    });

    // Configurar eventos para el custom select de Contrato
    const contractSelect = tr.querySelector('.m3-custom-contract-select');
    if (contractSelect) {
      const contractTrigger = contractSelect.querySelector('.status-select-trigger');
      const contractOptions = contractSelect.querySelectorAll('.status-select-option');

      contractTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pendingHistoryChanges.has(c.id) || c.estado_contrato === 'Firmado y Activado') return;
        document.querySelectorAll('.m3-custom-status-select, .m3-custom-contract-select').forEach(cs => {
          if (cs !== contractSelect) cs.classList.remove('open');
        });
        contractSelect.classList.toggle('open');
      });

      contractOptions.forEach(option => {
        option.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (pendingHistoryChanges.has(c.id) || c.estado_contrato === 'Firmado y Activado') return;
          const targetValue = option.getAttribute('data-value');
          contractSelect.classList.remove('open');

          if (targetValue === 'Rechazado por Scoring') {
            openScoringRejectionDialog(c);
            return;
          }
          pendingHistoryChanges.add(c.id);
          lockStatus('pending');
          try {
            await updateComparativaContrato(c.id, targetValue, '');
            c.estado_contrato = targetValue;
            const foundInCache = cachedHistory.find(item => item.id === c.id);
            if (foundInCache) foundInCache.estado_contrato = targetValue;
          } catch (err) {
            pendingHistoryChanges.delete(c.id);
            console.error(err);
            showToast('Error al actualizar el estado del contrato.', 'error');
            refreshHistoryContract(c);
            return;
          } finally {
            pendingHistoryChanges.delete(c.id);
          }
          refreshHistoryContract(c);

          if (targetValue === 'Firmado y Activado') {
            openNewRenewalDialogFromHistory(c, {
              onSaved: async () => {
                c.estado_contrato = 'Firmado y Activado';
                const found = cachedHistory.find(item => item.id === c.id);
                if (found) found.estado_contrato = 'Firmado y Activado';
                showToast("Contrato firmado y activado. Renovación registrada.", "success");
                refreshHistoryContract(c);
              },
              onCancelled: async () => {
                await updateComparativaContrato(c.id, 'En trámite', '');
                c.estado_contrato = 'En trámite';
                const found = cachedHistory.find(item => item.id === c.id);
                if (found) found.estado_contrato = 'En trámite';
                showToast("Renovación no guardada: el contrato ha vuelto a 'En trámite'.", "info");
                refreshHistoryContract(c);
              }
            });
          } else {
            showToast(`Estado de contrato actualizado a: ${targetValue}`, "success");
          }
        });
      });
    }

    historyContractControls.set(c.id, () => {
      syncStatusLock();
      syncCommissionControl(btnCobro, c);
      // Si la vista se ha reconstruido durante el diálogo, restaurar el selector al cancelar.
      if (!contractSelect) return false;
      const value = c.estado_contrato || 'Pendiente';
      const signed = value === 'Firmado y Activado';
      const pending = pendingHistoryChanges.has(c.id);
      const contractTrigger = contractSelect.querySelector('.status-select-trigger');
      contractTrigger.classList.remove('contrato-pendiente', 'contrato-tramite', 'contrato-firmado', 'contrato-scoring');
      let className = 'contrato-pendiente';
      if (value === 'En trámite') className = 'contrato-tramite';
      else if (signed) className = 'contrato-firmado';
      else if (value === 'Rechazado por Scoring') className = 'contrato-scoring';
      contractTrigger.classList.add(className);
      contractTrigger.querySelector('span').textContent = signed ? '✅ Firmado y Activado' : value;
      contractTrigger.style.cursor = signed ? 'default' : pending ? 'wait' : 'pointer';
      contractSelect.classList.remove('open');
      contractSelect.setAttribute('aria-disabled', String(signed || pending));
      contractSelect.setAttribute('title', signed ? 'Contrato firmado y activado (bloqueado)' : pending ? getStatusLockTitle('pending') : '');
      const arrow = contractTrigger.querySelector('.status-select-arrow');
      if (arrow) arrow.style.display = signed ? 'none' : '';
      return true;
    });

    tbody.appendChild(tr);
  });
}

function openScoringRejectionDialog(c) {
  const dialog = document.getElementById('dialog-scoring-rejection');
  if (!dialog) return;

  const clientEl = document.getElementById('dialog-scoring-client');
  const idEl = document.getElementById('dialog-scoring-id');
  const reasonEl = document.getElementById('dialog-scoring-reason');
  const closeX = document.getElementById('btn-close-scoring-dialog-x');
  const btnSaveOnly = document.getElementById('btn-scoring-save-only');
  const btnRecompare = document.getElementById('btn-scoring-recompare');

  if (clientEl) clientEl.textContent = c.cliente_nombre || 'Cliente';
  if (idEl) idEl.value = c.id;
  if (reasonEl) reasonEl.value = c.motivo_rechazo_scoring || '';

  const closeDialog = () => dialog.classList.remove('active');
  if (closeX) closeX.onclick = closeDialog;

  if (dialog) {
    dialog.onclick = (e) => {
      if (e.target === dialog) closeDialog();
    };
  }

  const saveScoringRejection = async () => {
    if (pendingHistoryChanges.has(c.id)) return false;
    pendingHistoryChanges.add(c.id);
    if (btnSaveOnly) btnSaveOnly.disabled = true;
    if (btnRecompare) btnRecompare.disabled = true;
    refreshHistoryContract(c);
    try {
      const reason = reasonEl ? reasonEl.value.trim() : '';
      await updateComparativaContrato(c.id, 'Rechazado por Scoring', reason);
      c.estado_contrato = 'Rechazado por Scoring';
      c.motivo_rechazo_scoring = reason;
      const foundInCache = cachedHistory.find(item => item.id === c.id);
      if (foundInCache) {
        foundInCache.estado_contrato = 'Rechazado por Scoring';
        foundInCache.motivo_rechazo_scoring = reason;
      }
      closeDialog();
      return true;
    } catch (err) {
      console.error(err);
      showToast('Error al actualizar el estado del contrato.', 'error');
      return false;
    } finally {
      pendingHistoryChanges.delete(c.id);
      if (btnSaveOnly) btnSaveOnly.disabled = false;
      if (btnRecompare) btnRecompare.disabled = false;
      refreshHistoryContract(c);
    }
  };

  if (btnSaveOnly) {
    btnSaveOnly.onclick = async (e) => {
      e.preventDefault();
      if (!await saveScoringRejection()) return;
      showToast("Contrato marcado como Rechazado por Scoring.", "info");
    };
  }

  if (btnRecompare) {
    btnRecompare.onclick = async (e) => {
      e.preventDefault();
      if (!await saveScoringRejection()) return;
      await relaunchComparisonForScoring(c);
    };
  }

  dialog.classList.add('active');
}

// --- Obtener datos consolidados del reporte ---
function getReportDataForRecord(record) {
  const datosCliente = JSON.parse(record.datos_cliente_json);
  const isLuzReport = !!(record.tipo_energia === 'LUZ' || (record.tipo_energia === 'DUAL' && record.tarifa_luz_propuesta_id));
  
  // Configurar tarifa para simulación
  let tariffDetails = datosCliente.proposedTariffSnapshot || null;
  let costDetail = datosCliente.proposedCostDetail || null;
  let currentCost = 0;
  let proposedCost = 0;
  let ahorro = 0;

  if (tariffDetails && costDetail) {
    proposedCost = costDetail.annual.total;
    if (isLuzReport) {
      currentCost = record.ahorro_luz_anual + proposedCost;
      ahorro = record.ahorro_luz_anual;
    } else {
      currentCost = record.ahorro_gas_anual + proposedCost;
      ahorro = record.ahorro_gas_anual;
    }
  } else {
    // Fallback para comparativas antiguas que no tienen el snapshot guardado
    if (isLuzReport) {
      tariffDetails = {
        comercializadora_nombre: record.comercializadora_luz_nombre || 'N/A',
        nombre: record.tarifa_luz_nombre || 'Tarifa Luz',
        tipo_tarifa: '2.0TD',
        potencia_p1: 0,
        potencia_p2: 0,
        energia_p1: 0,
        energia_p2: 0,
        energia_p3: 0
      };

      currentCost = record.ahorro_luz_anual + (datosCliente.currentLightCost || 0);
      proposedCost = datosCliente.currentLightCost || 0;
      ahorro = record.ahorro_luz_anual;
      
      costDetail = {
        annual: {
          total: proposedCost,
          potenciaTotal: proposedCost * 0.3,
          energiaTotal: proposedCost * 0.6,
          iee: proposedCost * 0.05,
          alquiler: 0,
          bonoSocial: 0,
          impuestos: proposedCost * 0.15
        }
      };
    } else {
      tariffDetails = {
        comercializadora_nombre: record.comercializadora_gas_nombre || 'N/A',
        nombre: record.tarifa_gas_nombre || 'Tarifa Gas',
        tipo_tarifa: 'RL.1',
        termino_fijo: 0,
        termino_variable: 0
      };

      currentCost = record.ahorro_gas_anual + (datosCliente.currentGasCost || 0);
      proposedCost = datosCliente.currentGasCost || 0;
      ahorro = record.ahorro_gas_anual;

      costDetail = {
        annual: {
          total: proposedCost,
          fijo: proposedCost * 0.2,
          variable: proposedCost * 0.7,
          hidrocarburos: proposedCost * 0.02,
          alquiler: 0,
          impuestos: proposedCost * 0.15
        }
      };
    }
  }

  return {
    companySnapshot: datosCliente.companySnapshot,
    clientName: record.cliente_nombre,
    clientCups: record.cliente_cups,
    energyType: isLuzReport ? 'LUZ' : 'GAS',
    currentCost: currentCost,
    currentCostDetail: isLuzReport ? (datosCliente.currentLightCostDetail || null) : (datosCliente.currentGasCostDetail || null),
    proposedCost: proposedCost,
    ahorro: ahorro,
    inputDetails: isLuzReport ? datosCliente.lightInput : datosCliente.gasInput,
    tariffDetails: tariffDetails,
    costDetail: costDetail
  };
}

// --- Reimprimir reporte a partir de datos guardados ---
async function reprintPDF(record, previewMode = false) {
  try {
    const reportData = getReportDataForRecord(record);
    await generatePDFReport(reportData, previewMode);
  } catch (error) {
    showToast("Error al regenerar el reporte PDF.", "error");
    console.error(error);
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

// Cerrar todos los selectores de estado personalizados si se hace click fuera
document.addEventListener('click', () => {
  document.querySelectorAll('.m3-custom-status-select').forEach(cs => {
    cs.classList.remove('open');
  });
});

export function promptRenewalFromHistory(comparativa) {
  const dialog = document.getElementById('dialog-create-renewal-from-history');
  if (!dialog) return;

  const clientNameEl = document.getElementById('hist-ren-client-name');
  const cupsEl = document.getElementById('hist-ren-cups');
  const offerEl = document.getElementById('hist-ren-offer');

  if (clientNameEl) clientNameEl.textContent = comparativa.cliente_nombre || 'Cliente';
  if (cupsEl) cupsEl.textContent = comparativa.cliente_cups || 'No especificado';
  if (offerEl) offerEl.textContent = `${comparativa.tipo_energia} - Ahorro estimado: ${(comparativa.ahorro_luz_anual + comparativa.ahorro_gas_anual).toFixed(2)} €/año`;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dateStartInput = document.getElementById('hist-ren-date-start');
  const durationSelect = document.getElementById('hist-ren-duration');
  const dateEndInput = document.getElementById('hist-ren-date-end');

  if (dateStartInput) dateStartInput.value = todayStr;
  
  function updateEndDate() {
    if (!dateStartInput || !durationSelect || !dateEndInput) return;
    const val = dateStartInput.value || todayStr;
    const parts = val.split('-');
    if (parts.length !== 3) return;

    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);

    if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1900 || y > 2100) return;

    const months = parseInt(durationSelect.value || '12', 10);
    const targetDate = new Date(y, m + months, d);

    const resY = targetDate.getFullYear();
    const resM = String(targetDate.getMonth() + 1).padStart(2, '0');
    const resD = String(targetDate.getDate()).padStart(2, '0');

    dateEndInput.value = `${resY}-${resM}-${resD}`;
  }

  updateEndDate();

  if (dateStartInput) {
    dateStartInput.oninput = updateEndDate;
    dateStartInput.onchange = updateEndDate;
  }
  if (durationSelect) {
    durationSelect.onchange = updateEndDate;
  }

  dialog.classList.add('active');

  const btnCancel = document.getElementById('btn-cancel-renewal-from-history');
  const form = document.getElementById('form-renewal-from-history');

  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.classList.remove('active');
  };

  if (btnCancel) {
    btnCancel.onclick = () => {
      dialog.classList.remove('active');
    };
  }

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const { getDb, getClientes } = await import('../db.js');
        const db = await getDb();
        const clients = await getClientes();
        
        let client = clients.find(cl => cl.nombre_empresa === comparativa.cliente_nombre || cl.cups === comparativa.cliente_cups);
        let clientId = client ? client.id : null;

        if (!clientId && clients.length > 0) {
          clientId = clients[0].id;
        }

        if (!clientId) {
          showToast("No se encontró la ficha del cliente en la base de datos.", "error");
          dialog.classList.remove('active');
          return;
        }

        const fecha_firma = dateStartInput.value;
        const duracion_meses = parseInt(durationSelect.value, 10);
        const fecha_vencimiento = dateEndInput.value;
        const notas = document.getElementById('hist-ren-notes')?.value?.trim() || '';

        if (window.__TAURI__) {
          await db.execute(`
            INSERT INTO renovaciones (cliente_id, tipo_energia, cups, comercializadora_actual, tarifa_actual, fecha_firma, duracion_meses, fecha_vencimiento, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
          `, [clientId, comparativa.tipo_energia, comparativa.cliente_cups || '', 'Tarifa Contratada', 'Estudio Aceptado', fecha_firma, duracion_meses, fecha_vencimiento, notas]);
        }

        dialog.classList.remove('active');
        showToast("✅ Renovación programada con éxito en el calendario.", "success");

        const { refreshRenewals } = await import('./renewals.js');
        await refreshRenewals();
      } catch (err) {
        console.error("Error al guardar renovación desde el historial:", err);
      }
    };
  }
}

function openCobroDialog(c) {
  if (!canManageCommissionCollection(c) || pendingHistoryChanges.has(c.id)) return;
  const dialog = document.getElementById('dialog-mark-cobro');
  if (!dialog) return;

  const inputId = document.getElementById('dialog-cobro-id');
  const clientEl = document.getElementById('dialog-cobro-client');
  const amountEl = document.getElementById('dialog-cobro-amount');
  const badgeEl = document.getElementById('dialog-cobro-status-badge');
  const dateInput = document.getElementById('dialog-cobro-date');

  if (inputId) inputId.value = c.id;
  if (clientEl) clientEl.textContent = c.cliente_nombre || 'Cliente';
  if (amountEl) amountEl.textContent = `${(c.comision_total || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const breakdown = document.getElementById('dialog-cobro-split');
  const split = getCommissionSplit(c);
  if (breakdown) breakdown.innerHTML = split ? commissionDetailHtml(split) : '<p class="text-muted">Sin reparto registrado. Este importe total se contabiliza aparte de las comisiones de la consultoría.</p>';

  const isCobrado = c.estado_cobro === 'Cobrado';
  if (badgeEl) {
    badgeEl.className = 'status-select-trigger';
    if (isCobrado) {
      badgeEl.classList.add('estado-aceptada');
      badgeEl.innerHTML = `<span>✅ Cobrado</span>`;
    } else {
      badgeEl.classList.add('estado-pendiente');
      badgeEl.innerHTML = `<span>🟡 Pendiente</span>`;
    }
  }

  if (dateInput) {
    if (c.fecha_cobro) {
      dateInput.value = c.fecha_cobro.substring(0, 10);
    } else {
      const now = new Date();
      dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }
  }

  dialog.classList.add('active');
}

function setupCobroDialog() {
  if (isCobroDialogInitialized) return;
  isCobroDialogInitialized = true;
  
  const dialog = document.getElementById('dialog-mark-cobro');
  const closeBtnX = document.getElementById('btn-close-cobro-dialog-x');
  const form = document.getElementById('form-mark-cobro');

  if (dialog) {
    dialog.onclick = (e) => {
      if (e.target === dialog) dialog.classList.remove('active');
    };
  }

  if (closeBtnX && dialog) {
    closeBtnX.onclick = () => dialog.classList.remove('active');
  }

  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const id = parseInt(document.getElementById('dialog-cobro-id').value, 10);
      const fecha = document.getElementById('dialog-cobro-date').value;
      if (!id) return;
      const comparison = cachedHistory.find(c => c.id === id);
      if (!comparison || !canManageCommissionCollection(comparison) || pendingHistoryChanges.has(id)) return;

      pendingHistoryChanges.add(id);
      try {
        await updateComparativaCobro(id, 'Cobrado', fecha);
        comparison.estado_cobro = 'Cobrado';
        comparison.fecha_cobro = fecha;
        dialog.classList.remove('active');
        showToast("✅ Comisión marcada como COBRADA.", "success");
      } catch (err) {
        console.error("Error al actualizar estado de cobro:", err);
        showToast(err.message === 'COMMISSION_COLLECTION_LOCKED'
          ? 'Solo se puede registrar un cobro pendiente con el contrato firmado y activado.' : 'Error al registrar el cobro.', 'error');
        return;
      } finally {
        pendingHistoryChanges.delete(id);
      }
      await refreshHistory();
    };
  }
}
