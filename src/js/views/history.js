/* src/js/views/history.js */

import { getComparativas, deleteComparativa, updateComparativaEstado } from '../db.js';
import { generatePDFReport } from '../pdf.js';

let activeLockTimers = [];

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

  await loadHistoryTable();

  // Escuchar cuando se guarde una nueva comparativa para refrescar la lista automáticamente
  window.removeEventListener('comparison-saved', refreshHistory);
  window.addEventListener('comparison-saved', refreshHistory);
}

async function refreshHistory() {
  await loadHistoryTable();
}

let cachedHistory = [];

async function loadHistoryTable() {
  clearActiveLockTimers();
  const tbody = document.querySelector('#table-history tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="text-muted">Cargando historial...</td></tr>';

  try {
    cachedHistory = await getComparativas();
    
    // Configurar listener de búsqueda
    const searchInput = document.getElementById('search-history-input');
    if (searchInput && !searchInput.dataset.listenerAdded) {
      searchInput.addEventListener('input', () => {
        applyHistoryFilter();
      });
      searchInput.dataset.listenerAdded = 'true';
    }

    applyHistoryFilter();
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-error">Error al cargar el historial.</td></tr>';
    console.error(error);
  }
}

function applyHistoryFilter() {
  clearActiveLockTimers();
  const tbody = document.querySelector('#table-history tbody');
  if (!tbody) return;

  const searchInput = document.getElementById('search-history-input');
  const query = searchInput ? searchInput.value.trim() : '';

  const cleanString = (str) => {
    if (!str) return '';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const cleanQuery = cleanString(query);

  // Filtrar por nombre de cliente y CUPS
  const filtered = cachedHistory.filter(c => {
    const name = cleanString(c.cliente_nombre);
    const cups = cleanString(c.cliente_cups);
    return name.includes(cleanQuery) || cups.includes(cleanQuery);
  });

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-muted" style="text-align: center; padding: 32px 16px;">
          ${query ? 'No se encontraron comparativas que coincidan con la búsqueda.' : 'No se han registrado comparativas aún.'}
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
      <td class="private-value" style="font-weight: 600;">${c.comision_total.toFixed(2)} €</td>
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
        window.showToast("El cliente no tiene un correo de contacto configurado en su ficha.", "error");
        return;
      }
      
      try {
        window.showToast("Generando reporte y preparando correo electrónico...", "info");
        
        const reportData = getReportDataForRecord(c);
        
        // Generar base64 del PDF (preguntando por contraseña si corresponde)
        const pdfBase64 = await generatePDFReport(reportData, false, true);
        if (!pdfBase64) {
          // El usuario canceló la generación
          return;
        }

        const safeClientName = c.cliente_nombre.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const pdfFilename = `comparativa_${safeClientName}.pdf`;

        if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
          await window.__TAURI__.core.invoke('open_email_with_attachment', {
            recipient: c.cliente_email,
            pdfFilename: pdfFilename,
            pdfBase64: pdfBase64
          });
        } else {
          // Fallback para pruebas en navegador sin Tauri (abre mailto simple sin adjunto)
          window.showToast("Atención: El archivo adjunto solo se soporta ejecutando la aplicación de escritorio. Se abrirá el cliente de correo sin adjunto.", "warning");
          window.location.href = `mailto:${c.cliente_email}`;
        }
      } catch (err) {
        window.showToast("Error al preparar el envío por correo: " + err, "error");
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
      if (await window.showConfirm(`¿Está seguro de eliminar del historial la comparativa de ${c.cliente_nombre}?`, "Eliminar Comparativa")) {
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
      
      // Cerrar todos los demás custom status selects abiertos
      document.querySelectorAll('.m3-custom-status-select').forEach(cs => {
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
              window.showToast(`El estado de la comparativa de ${c.cliente_nombre} ha quedado fijado de forma definitiva.`, "info");
            }, 60000); // 60 segundos
            customSelect._lockTimer = timer;
            activeLockTimers.push(timer);
          } else {
            customSelect._lockTimer = null;
          }
          
          customSelect.classList.remove('open');
          window.showToast("Estado de la comparativa actualizado correctamente.", "success");
          
          // Recargar tabla de clientes si es necesario para refrescar su Tipo Cliente
          const clientsSection = document.getElementById('section-clients');
          if (clientsSection && clientsSection.classList.contains('active')) {
            // Si la sección de clientes está visible/activa, refrescar la tabla de clientes
            const { loadClientsTable } = await import('./clients.js');
            await loadClientsTable();
          }
        } catch (err) {
          window.showToast("Error al actualizar el estado.", "error");
          console.error(err);
        }
      });
    });

    tbody.appendChild(tr);
  });
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
    window.showToast("Error al regenerar el reporte PDF.", "error");
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
