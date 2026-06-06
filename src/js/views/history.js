/* src/js/views/history.js */

import { getComparativas, deleteComparativa } from '../db.js';
import { generatePDFReport } from '../pdf.js';

export async function initHistoryView() {
  await loadHistoryTable();

  // Escuchar cuando se guarde una nueva comparativa para refrescar la lista automáticamente
  window.removeEventListener('comparison-saved', refreshHistory);
  window.addEventListener('comparison-saved', refreshHistory);
}

async function refreshHistory() {
  await loadHistoryTable();
}

async function loadHistoryTable() {
  const tbody = document.querySelector('#table-history tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Cargando historial...</td></tr>';

  try {
    const list = await getComparativas();
    tbody.innerHTML = '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No se han registrado comparativas aún.</td></tr>';
      return;
    }

    list.forEach(c => {
      const dateStr = new Date(c.fecha).toLocaleString('es-ES', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });

      const totalAhorro = c.ahorro_luz_anual + c.ahorro_gas_anual;
      
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
        <td class="private-value" style="font-weight: 600;">${c.comision_total.toFixed(2)} €</td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="m3-btn-icon btn-preview-history" data-id="${c.id}" title="Previsualizar Reporte PDF">
            <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
          <button class="m3-btn-icon btn-print-history" data-id="${c.id}" title="Guardar Reporte PDF">
            <svg viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
          </button>
          <button class="m3-btn-icon btn-delete-history" data-id="${c.id}" title="Eliminar del historial">
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

      // Evento de borrado
      tr.querySelector('.btn-delete-history').addEventListener('click', async () => {
        if (confirm(`¿Está seguro de eliminar del historial la comparativa de ${c.cliente_nombre}?`)) {
          await deleteComparativa(c.id);
          await loadHistoryTable();
        }
      });

      tbody.appendChild(tr);
    });
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-error">Error al cargar el historial.</td></tr>';
    console.error(error);
  }
}

// --- Reimprimir reporte a partir de datos guardados ---
async function reprintPDF(record, previewMode = false) {
  try {
    const datosCliente = JSON.parse(record.datos_cliente_json);
    
    // Configurar tarifa para simulación
    let tariffDetails = null;
    let costDetail = null;
    let currentCost = 0;
    let proposedCost = 0;
    let ahorro = 0;
    
    // Si la comparativa guardada fue de luz
    if (record.tipo_energia === 'LUZ' || (record.tipo_energia === 'DUAL' && record.tarifa_luz_propuesta_id)) {
      tariffDetails = {
        comercializadora_nombre: record.comercializadora_luz_nombre || 'N/A',
        nombre: record.tarifa_luz_nombre || 'Tarifa Luz',
        // Intentar rescatar detalles básicos o dejar por defecto los del cálculo
        potencia_p1: datosCliente.lightInput ? (datosCliente.lightInput.p1PotPrice || 0) : 0,
        potencia_p2: datosCliente.lightInput ? (datosCliente.lightInput.p2PotPrice || 0) : 0,
        energia_p1: datosCliente.lightInput ? (datosCliente.lightInput.p1EnePrice || 0) : 0,
        energia_p2: datosCliente.lightInput ? (datosCliente.lightInput.p2EnePrice || 0) : 0,
        energia_p3: datosCliente.lightInput ? (datosCliente.lightInput.p3EnePrice || 0) : 0,
      };

      currentCost = record.ahorro_luz_anual + (datosCliente.currentLightCost || 0); // Estimado
      proposedCost = datosCliente.currentLightCost || 0;
      ahorro = record.ahorro_luz_anual;
      
      // Estructuramos un mock de costDetail para evitar nulos en reporte
      costDetail = {
        annual: {
          total: proposedCost,
          potenciaTotal: proposedCost * 0.3, // estimado
          energiaTotal: proposedCost * 0.6, // estimado
          iee: proposedCost * 0.05,
          impuestos: proposedCost * 0.15
        }
      };
    } else if (record.tipo_energia === 'GAS' || (record.tipo_energia === 'DUAL' && record.tarifa_gas_propuesta_id)) {
      tariffDetails = {
        comercializadora_nombre: record.comercializadora_gas_nombre || 'N/A',
        nombre: record.tarifa_gas_nombre || 'Tarifa Gas',
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
          impuestos: proposedCost * 0.15
        }
      };
    }

    const reportData = {
      clientName: record.cliente_nombre,
      clientCups: record.cliente_cups,
      energyType: record.tipo_energia,
      currentCost: currentCost,
      proposedCost: proposedCost,
      ahorro: ahorro,
      inputDetails: record.tipo_energia === 'LUZ' ? datosCliente.lightInput : datosCliente.gasInput,
      tariffDetails: tariffDetails,
      costDetail: costDetail
    };

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
