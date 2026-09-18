import { getComparativas, deleteComparativa, updateComparativaEstado, updateComparativaCobro, updateComparativaContrato } from '../db.js';
import { generatePDFReport } from '../pdf.js';
import { openNewRenewalDialogFromHistory } from './renewals.js';
import { relaunchComparisonForScoring } from './calculator_view.js';
import { invoke } from '../ipc.js';
import { showToast, showConfirm } from '../ui.js';
import { onAppEvent, APP_EVENTS } from '../events.js';

let activeLockTimers = [];
let isCobroDialogInitialized = false;
let unsubComparisonSaved = null;

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
  const searchInput = document.getElementById('search-history-input');
  if (searchInput) {
    searchInput.value = '';
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

async function loadHistoryTable() {
  clearActiveLockTimers();
  const tbody = document.querySelector('#table-history tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="10" class="text-muted">Cargando historial...</td></tr>';

  try {
    cachedHistory = await getComparativas();
    
    // Configurar listeners de búsqueda y filtros
    const searchInput = document.getElementById('search-history-input');
    if (searchInput && !searchInput.dataset.listenerAdded) {
      searchInput.addEventListener('input', () => {
        applyHistoryFilter();
      });
      searchInput.dataset.listenerAdded = 'true';
    }

    const filterEstado = document.getElementById('filter-history-estado');
    if (filterEstado && !filterEstado.dataset.listenerAdded) {
      filterEstado.addEventListener('change', () => applyHistoryFilter());
      filterEstado.dataset.listenerAdded = 'true';
    }

    const filterCobro = document.getElementById('filter-history-cobro');
    if (filterCobro && !filterCobro.dataset.listenerAdded) {
      filterCobro.addEventListener('change', () => applyHistoryFilter());
      filterCobro.dataset.listenerAdded = 'true';
    }

    const tableContainer = document.querySelector('#section-history .table-container');
    if (tableContainer && !tableContainer.dataset.scrollListenerAdded) {
      tableContainer.addEventListener('scroll', () => {
        document.querySelectorAll('.m3-custom-status-select, .m3-custom-contract-select').forEach(cs => cs.classList.remove('open'));
      });
      tableContainer.dataset.scrollListenerAdded = 'true';
    }

    if (!window._historyScrollListenerAdded) {
      window.addEventListener('scroll', () => {
        document.querySelectorAll('.m3-custom-status-select, .m3-custom-contract-select').forEach(cs => cs.classList.remove('open'));
      }, true);
      window._historyScrollListenerAdded = true;
    }

    applyHistoryFilter();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-error">Error al cargar el historial.</td></tr>';
    console.error(error);
  }
}

function updateHistoryKpis(list) {
  let totalEstudios = list.length;
  let totalAceptadas = 0;
  let totalComisionesCobradas = 0;
  let totalComisionesPendientes = 0;

  list.forEach(c => {
    const isAceptada = c.estado === 'Aceptada';
    if (isAceptada) totalAceptadas++;

    const comision = c.comision_total || 0;
    const isCobrado = c.estado_cobro === 'Cobrado';
    const isScoringRejected = c.estado_contrato === 'Rechazado por Scoring';

    if (isCobrado) {
      totalComisionesCobradas += comision;
    } else if (isAceptada && !isScoringRejected) {
      totalComisionesPendientes += comision;
    }
  });

  const elTotal = document.getElementById('history-kpi-total');
  const elAceptadas = document.getElementById('history-kpi-aceptadas');
  const elPendientes = document.getElementById('history-kpi-pendientes');
  const elCobradas = document.getElementById('history-kpi-cobradas');

  if (elTotal) elTotal.textContent = totalEstudios.toString();
  if (elAceptadas) elAceptadas.textContent = totalAceptadas.toString();
  if (elPendientes) elPendientes.textContent = `${totalComisionesPendientes.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  if (elCobradas) elCobradas.textContent = `${totalComisionesCobradas.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function applyHistoryFilter() {
  clearActiveLockTimers();
  const tbody = document.querySelector('#table-history tbody');
  if (!tbody) return;

  updateHistoryKpis(cachedHistory);

  const searchInput = document.getElementById('search-history-input');
  const query = searchInput ? searchInput.value.trim() : '';

  const estadoFilter = document.getElementById('filter-history-estado')?.value || 'ALL';
  const cobroFilter = document.getElementById('filter-history-cobro')?.value || 'ALL';

  const cleanString = (str) => {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const cleanQuery = cleanString(query);

  const filtered = cachedHistory.filter(c => {
    if (query) {
      const name = cleanString(c.cliente_nombre);
      const cups = cleanString(c.cliente_cups);
      if (!name.includes(cleanQuery) && !cups.includes(cleanQuery)) return false;
    }

    if (estadoFilter !== 'ALL') {
      if ((c.estado || 'Pendiente de aceptación') !== estadoFilter) return false;
    }

    if (cobroFilter !== 'ALL') {
      const estadoCobro = c.estado_cobro || 'Pendiente';
      if (cobroFilter === 'COBRADO' && estadoCobro !== 'Cobrado') return false;
      if (cobroFilter === 'PENDIENTE' && estadoCobro === 'Cobrado') return false;
    }

    return true;
  });

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-muted" style="text-align: center; padding: 32px 16px;">
          ${(query || estadoFilter !== 'ALL' || cobroFilter !== 'ALL') ? 'No se encontraron comparativas con los filtros aplicados.' : 'No se han registrado comparativas aún.'}
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(c => {
    const dateStr = new Date(c.fecha).toLocaleString('es-ES', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    const totalAhorro = c.ahorro_luz_anual + c.ahorro_gas_anual;
    const currentEstado = c.estado || 'Pendiente de aceptación';
    
    let estadoClass = 'estado-pendiente';
    if (currentEstado === 'Aceptada') estadoClass = 'estado-aceptada';
    else if (currentEstado === 'Rechazada') estadoClass = 'estado-rechazada';

    // Calcular si el selector de estado está bloqueado (transcurrido más de 1 minuto en Aceptada/Rechazada)
    let isLocked = false;
    if (currentEstado === 'Aceptada' || currentEstado === 'Rechazada') {
      if (!c.estado_cambiado_en) {
        isLocked = true; // Sin registro de tiempo (registro antiguo) -> bloqueado
      } else {
        const cambiadoEnMs = new Date(c.estado_cambiado_en).getTime();
        const diffMs = Date.now() - cambiadoEnMs;
        isLocked = diffMs >= 60 * 1000; // Bloquear después de 60 segundos
      }
    }

    const isAceptada = (currentEstado === 'Aceptada');
    const deleteAttr = isAceptada
      ? 'style="opacity: 0.5;" title="Ver restricción legal de eliminación"'
      : 'title="Eliminar del historial"';

    const isCobrado = (c.estado_cobro === 'Cobrado');
    let cobroCellHtml = '';
    if (isAceptada) {
      if (isCobrado) {
        const fechaFmt = c.fecha_cobro ? new Date(c.fecha_cobro).toLocaleDateString('es-ES') : '';
        const titleStr = fechaFmt ? `Cobrado el ${fechaFmt}. Haz clic para gestionar.` : 'Cobrado. Haz clic para gestionar.';
        cobroCellHtml = `<td>
          <div class="status-select-trigger estado-aceptada btn-manage-cobro" data-id="${c.id}" title="${titleStr}" style="cursor: pointer;">
            <span>✅ Cobrado</span>
            <svg class="status-select-arrow" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
          </div>
        </td>`;
      } else {
        cobroCellHtml = `<td>
          <div class="status-select-trigger estado-pendiente btn-manage-cobro" data-id="${c.id}" title="Pendiente de cobro. Haz clic para registrar cobro." style="cursor: pointer;">
            <span>🟡 Pendiente</span>
            <svg class="status-select-arrow" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
          </div>
        </td>`;
      }
    } else {
      cobroCellHtml = `<td><span class="text-muted" style="font-size: 12px; display: block; text-align: center;">—</span></td>`;
    }

    const currentContract = c.estado_contrato || 'Pendiente';
    let contractClass = 'contrato-pendiente';
    if (currentContract === 'En trámite') contractClass = 'contrato-tramite';
    else if (currentContract === 'Firmado y Activado') contractClass = 'contrato-firmado';
    else if (currentContract === 'Rechazado por Scoring') contractClass = 'contrato-scoring';

    const contractCellHtml = `
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
        <div class="m3-custom-status-select ${isLocked ? 'disabled' : ''}" data-id="${c.id}" ${isLocked ? 'title="El estado ya no se puede modificar al haber transcurrido el tiempo límite de cambio."' : ''}>
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
      <td class="private-value" style="font-weight: 600;">${c.comision_total.toFixed(2)} €</td>
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

    // Evento de envío de email
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
          await invoke('send_email', {
            to: c.cliente_email,
            subject: `Estudio Comparativo de Energía - ${c.cliente_nombre}`,
            body: `Estimado/a cliente de ${c.cliente_nombre},\n\nAdjunto a este correo electrónico encontrará el informe detallado de su estudio comparativo de energía realizado con Comparetica.\n\nAtentamente,\nEquipo de Asesoría Energética`,
            pdfBase64: pdfBase64,
            filename: pdfFilename
          });
          showToast("✅ Correo electrónico enviado correctamente con el PDF adjunto.", "success");
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
    const triggerText = trigger.querySelector('span');
    const options = customSelect.querySelectorAll('.status-select-option');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (customSelect.classList.contains('disabled')) return;
      
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
        const nuevoEstado = option.getAttribute('data-value');
        
        try {
          await updateComparativaEstado(c.id, nuevoEstado);
          
          // Actualizar el texto del trigger
          triggerText.textContent = nuevoEstado;
          
          // Actualizar la clase de color del trigger y habilitar/deshabilitar el borrado
          trigger.className = 'status-select-trigger';
          const deleteBtn = tr.querySelector('.btn-delete-history');
          
          if (nuevoEstado === 'Aceptada') {
            trigger.classList.add('estado-aceptada');
            deleteBtn.removeAttribute('disabled');
            deleteBtn.style.opacity = '0.5';
            deleteBtn.style.cursor = '';
            deleteBtn.setAttribute('title', 'Ver restricción legal de eliminación');

            // Abrir pop-up para programar renovación en el calendario
            promptRenewalFromHistory(c);
          } else {
            deleteBtn.removeAttribute('disabled');
            deleteBtn.style.opacity = '';
            deleteBtn.style.cursor = '';
            deleteBtn.setAttribute('title', 'Eliminar del historial');
            
            if (nuevoEstado === 'Rechazada') {
              trigger.classList.add('estado-rechazada');
            } else {
              trigger.classList.add('estado-pendiente');
            }
          }
          
          // Iniciar un temporizador de 1 minuto para bloquear el selector en la UI
          if (customSelect._lockTimer) clearTimeout(customSelect._lockTimer);
          
          if (nuevoEstado === 'Aceptada' || nuevoEstado === 'Rechazada') {
            const timer = setTimeout(() => {
              customSelect.classList.add('disabled');
              customSelect.setAttribute('title', 'El estado ya no se puede modificar al haber transcurrido el tiempo límite de cambio.');
              trigger.style.cursor = 'not-allowed';
              trigger.style.opacity = '0.75';
              showToast(`El estado de la comparativa de ${c.cliente_nombre} ha quedado fijado de forma definitiva.`, "info");
            }, 60000); // 60 segundos
            customSelect._lockTimer = timer;
            activeLockTimers.push(timer);
          } else {
            customSelect._lockTimer = null;
          }
          
          customSelect.classList.remove('open');
          showToast("Estado de la comparativa actualizado correctamente.", "success");
          
          // Recargar tabla de clientes si es necesario para refrescar su Tipo Cliente
          const clientsSection = document.getElementById('section-clients');
          if (clientsSection && clientsSection.classList.contains('active')) {
            // Si la sección de clientes está visible/activa, refrescar la tabla de clientes
            const { loadClientsTable } = await import('./clients.js');
            await loadClientsTable();
          }
        } catch (err) {
          showToast("Error al actualizar el estado.", "error");
          console.error(err);
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
        document.querySelectorAll('.m3-custom-status-select, .m3-custom-contract-select').forEach(cs => {
          if (cs !== contractSelect) cs.classList.remove('open');
        });
        contractSelect.classList.toggle('open');
      });

      contractOptions.forEach(option => {
        option.addEventListener('click', async (e) => {
          e.stopPropagation();
          const targetValue = option.getAttribute('data-value');
          contractSelect.classList.remove('open');

          if (targetValue === 'Rechazado por Scoring') {
            openScoringRejectionDialog(c);
          } else {
            await updateComparativaContrato(c.id, targetValue, '');
            showToast(`Estado de contrato actualizado a: ${targetValue}`, "success");
            
            if (targetValue === 'Firmado y Activado') {
              openNewRenewalDialogFromHistory(c);
            } else {
              await loadHistoryTable();
            }
          }
        });
      });
    }

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

  if (btnSaveOnly) {
    btnSaveOnly.onclick = async (e) => {
      e.preventDefault();
      const reason = reasonEl ? reasonEl.value.trim() : '';
      await updateComparativaContrato(c.id, 'Rechazado por Scoring', reason);
      closeDialog();
      showToast("Contrato marcado como Rechazado por Scoring.", "info");
      await loadHistoryTable();
    };
  }

  if (btnRecompare) {
    btnRecompare.onclick = async (e) => {
      e.preventDefault();
      const reason = reasonEl ? reasonEl.value.trim() : '';
      await updateComparativaContrato(c.id, 'Rechazado por Scoring', reason);
      closeDialog();
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
  const btnPending = document.getElementById('btn-cobro-mark-pending');

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

      try {
        await updateComparativaCobro(id, 'Cobrado', fecha);
        dialog.classList.remove('active');
        showToast("✅ Comisión marcada como COBRADA.", "success");
        await refreshHistory();
      } catch (err) {
        console.error("Error al actualizar estado de cobro:", err);
        showToast("Error al registrar el cobro.", "error");
      }
    };
  }

  if (btnPending) {
    btnPending.onclick = async () => {
      const id = parseInt(document.getElementById('dialog-cobro-id').value, 10);
      if (!id) return;

      try {
        await updateComparativaCobro(id, 'Pendiente', null);
        dialog.classList.remove('active');
        showToast("🟡 Estado de cobro cambiado a PENDIENTE.", "info");
        await refreshHistory();
      } catch (err) {
        console.error("Error al actualizar estado de cobro:", err);
        showToast("Error al actualizar estado de cobro.", "error");
      }
    };
  }
}
