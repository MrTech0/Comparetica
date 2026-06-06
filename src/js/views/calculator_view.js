/* src/js/views/calculator_view.js */

import { calculateLightBill, calculateGasBill } from '../calculator.js';
import { getTarifasLuz, getTarifasGas, addComparativa } from '../db.js';
import { generatePDFReport } from '../pdf.js';

// Datos temporales de la última comparación realizada
let lastComparisonData = {
  clientName: '',
  clientCups: '',
  energyType: '',
  lightInput: null,
  gasInput: null,
  bestLightTariff: null,
  bestGasTariff: null,
  currentLightCost: 0,
  currentGasCost: 0
};

export function initCalculatorView() {
  setupEnergyTypeToggle();
  setupCalcFormSubmit();
}

// --- Control del Tipo de Suministro ---
function setupEnergyTypeToggle() {
  const energyTypeSelect = document.getElementById('calc-energy-type');
  const lightBlock = document.getElementById('calc-light-block');
  const gasBlock = document.getElementById('calc-gas-block');

  energyTypeSelect.addEventListener('change', (e) => {
    const value = e.target.value;
    
    // Configurar Inputs obligatorios/visibilidad
    if (value === 'LUZ') {
      lightBlock.style.display = 'block';
      gasBlock.style.display = 'none';
      setInputsRequired(lightBlock, true);
      setInputsRequired(gasBlock, false);
    } else if (value === 'GAS') {
      lightBlock.style.display = 'none';
      gasBlock.style.display = 'block';
      setInputsRequired(lightBlock, false);
      setInputsRequired(gasBlock, true);
    } else if (value === 'DUAL') {
      lightBlock.style.display = 'block';
      gasBlock.style.display = 'block';
      setInputsRequired(lightBlock, true);
      setInputsRequired(gasBlock, true);
    }
  });
}

function setInputsRequired(container, isRequired) {
  const inputs = container.querySelectorAll('input[required], select[required], input[data-req]');
  inputs.forEach(input => {
    if (isRequired) {
      input.setAttribute('required', 'required');
    } else {
      input.removeAttribute('required');
    }
  });
}

// --- Submit del Formulario y Procesamiento de Resultados ---
function setupCalcFormSubmit() {
  const form = document.getElementById('calc-form');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const clientName = document.getElementById('calc-client-name').value.trim();
    const clientCups = document.getElementById('calc-client-cups').value.trim();
    const energyType = document.getElementById('calc-energy-type').value;

    // Resetear contenedores de resultados
    document.getElementById('results-light-list').innerHTML = '';
    document.getElementById('results-gas-list').innerHTML = '';
    document.getElementById('results-light-container').style.display = 'none';
    document.getElementById('results-gas-container').style.display = 'none';

    // 1. Obtener y parsear inputs de Luz
    let lightInput = null;
    let currentLightAnnual = 0;
    if (energyType === 'LUZ' || energyType === 'DUAL') {
      lightInput = {
        dias: parseInt(document.getElementById('calc-light-days').value),
        p1Pot: parseFloat(document.getElementById('calc-light-p1-pot').value),
        p2Pot: parseFloat(document.getElementById('calc-light-p2-pot').value),
        p1Cons: parseFloat(document.getElementById('calc-light-p1-cons').value),
        p2Cons: parseFloat(document.getElementById('calc-light-p2-cons').value),
        p3Cons: parseFloat(document.getElementById('calc-light-p3-cons').value),
        alquiler: parseFloat(document.getElementById('calc-light-meter').value || 0),
        impuestoElectrico: parseFloat(document.getElementById('calc-light-tax').value),
        iva: parseFloat(document.getElementById('calc-light-vat').value)
      };

      // Construir mock de tarifa actual del cliente para cálculo homogéneo
      const currentTariffMock = {
        potencia_p1: parseFloat(document.getElementById('calc-light-p1-pot-price').value || 0),
        potencia_p2: parseFloat(document.getElementById('calc-light-p2-pot-price').value || 0),
        energia_p1: parseFloat(document.getElementById('calc-light-p1-ene-price').value || 0),
        energia_p2: parseFloat(document.getElementById('calc-light-p2-ene-price').value || 0),
        energia_p3: parseFloat(document.getElementById('calc-light-p3-ene-price').value || 0)
      };

      const billDetail = calculateLightBill(lightInput, currentTariffMock);
      currentLightAnnual = billDetail.annual.total;
    }

    // 2. Obtener y parsear inputs de Gas
    let gasInput = null;
    let currentGasAnnual = 0;
    if (energyType === 'GAS' || energyType === 'DUAL') {
      gasInput = {
        dias: parseInt(document.getElementById('calc-gas-days').value),
        consumo: parseFloat(document.getElementById('calc-gas-consumption').value),
        alquiler: parseFloat(document.getElementById('calc-gas-meter').value || 0),
        impuestoHidrocarburos: parseFloat(document.getElementById('calc-gas-tax').value),
        iva: parseFloat(document.getElementById('calc-gas-vat').value)
      };

      // Tarifa actual de Gas mock
      const currentTariffMock = {
        termino_fijo: parseFloat(document.getElementById('calc-gas-fixed-price').value || 0),
        termino_variable: parseFloat(document.getElementById('calc-gas-var-price').value || 0)
      };

      const billDetail = calculateGasBill(gasInput, currentTariffMock);
      currentGasAnnual = billDetail.annual.total;
    }

    // Actualizar resumen de gasto actual en pantalla
    const totalCurrentAnnual = currentLightAnnual + currentGasAnnual;
    document.getElementById('calc-current-annual-cost').innerText = `${totalCurrentAnnual.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

    // Inicializar temporales globales
    lastComparisonData = {
      clientName,
      clientCups,
      energyType,
      lightInput,
      gasInput,
      bestLightTariff: null,
      bestGasTariff: null,
      currentLightCost: currentLightAnnual,
      currentGasCost: currentGasAnnual
    };

    // 3. Procesar propuestas de Luz
    let bestLightOption = null;
    if (energyType === 'LUZ' || energyType === 'DUAL') {
      document.getElementById('results-light-container').style.display = 'block';
      const lightTariffs = await getTarifasLuz();
      const lightResults = [];

      lightTariffs.forEach(tariff => {
        const costDetail = calculateLightBill(lightInput, tariff);
        const ahorro = currentLightAnnual - costDetail.annual.total;
        lightResults.push({
          tariff,
          costDetail,
          ahorro
        });
      });

      // Ordenar por ahorro descendente
      lightResults.sort((a, b) => {
        const ahorroA = isNaN(a.ahorro) || a.ahorro === null ? -Infinity : a.ahorro;
        const ahorroB = isNaN(b.ahorro) || b.ahorro === null ? -Infinity : b.ahorro;
        return ahorroB - ahorroA;
      });

      if (lightResults.length > 0) {
        bestLightOption = lightResults[0];
        lastComparisonData.bestLightTariff = bestLightOption;
        renderResultsList('results-light-list', lightResults, 'LUZ');
      } else {
        document.getElementById('results-light-list').innerHTML = '<p class="text-muted">No hay tarifas de luz registradas en la base de datos.</p>';
      }
    }

    // 4. Procesar propuestas de Gas
    let bestGasOption = null;
    if (energyType === 'GAS' || energyType === 'DUAL') {
      document.getElementById('results-gas-container').style.display = 'block';
      const gasTariffs = await getTarifasGas();
      const gasResults = [];

      gasTariffs.forEach(tariff => {
        const costDetail = calculateGasBill(gasInput, tariff);
        const ahorro = currentGasAnnual - costDetail.annual.total;
        gasResults.push({
          tariff,
          costDetail,
          ahorro
        });
      });

      // Ordenar por ahorro descendente
      gasResults.sort((a, b) => {
        const ahorroA = isNaN(a.ahorro) || a.ahorro === null ? -Infinity : a.ahorro;
        const ahorroB = isNaN(b.ahorro) || b.ahorro === null ? -Infinity : b.ahorro;
        return ahorroB - ahorroA;
      });

      if (gasResults.length > 0) {
        bestGasOption = gasResults[0];
        lastComparisonData.bestGasTariff = bestGasOption;
        renderResultsList('results-gas-list', gasResults, 'GAS');
      } else {
        document.getElementById('results-gas-list').innerHTML = '<p class="text-muted">No hay tarifas de gas registradas en la base de datos.</p>';
      }
    }

    // Mostrar sección de resultados
    document.getElementById('calc-results-wrapper').style.display = 'block';
    // Scroll suave a los resultados
    document.getElementById('calc-results-wrapper').scrollIntoView({ behavior: 'smooth' });
  });
}

// --- Renderizar Tarjetas de Resultados ---
function renderResultsList(containerId, results, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  results.forEach((item, index) => {
    const isBest = index === 0 && item.ahorro > 0;
    const isLoss = item.ahorro < 0;
    
    const card = document.createElement('div');
    card.className = `m3-card margin-top-md ${isBest ? 'm3-card-elevated' : 'm3-card-outlined'}`;
    
    if (isBest) {
      card.style.borderLeft = '6px solid var(--color-tertiary)';
    } else if (isLoss) {
      card.style.borderLeft = '6px solid var(--color-error)';
    } else {
      card.style.borderLeft = '6px solid var(--color-outline)';
    }

    const ahorroAnual = item.ahorro;
    const costAnual = item.costDetail.annual.total;
    const costMensual = costAnual / 12;

    const labelText = isLoss ? 'Costo Adicional Anual:' : 'Ahorro Anual Estimado:';
    const labelColor = isLoss ? 'var(--color-error)' : 'var(--color-tertiary)';
    const displayValue = Math.abs(ahorroAnual);
    const displayValueMensual = displayValue / 12;

    let chipHtml = '';
    if (isBest) {
      chipHtml = '<span class="m3-chip m3-chip-success">Opción Más Económica</span>';
    } else if (isLoss) {
      chipHtml = '<span class="m3-chip" style="background-color: var(--color-error-container); color: var(--color-on-error-container); border-color: transparent;">Más Cara</span>';
    }

    card.innerHTML = `
      <div class="flex-row-center-between" style="align-items: flex-start; flex-wrap: wrap; gap: 16px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="logo-icon" style="width:28px;height:28px;font-size:12px;border-radius:var(--radius-xs);">${item.tariff.comercializadora_nombre[0]}</span>
            <strong style="font-size: 16px; color: var(--color-on-surface);">${escapeHtml(item.tariff.comercializadora_nombre)}</strong>
            ${chipHtml}
          </div>
          <h4 style="font-size: 15px; margin-top: 6px; font-weight: 500;">Tarifa: ${escapeHtml(item.tariff.nombre)}</h4>
          <p class="text-muted" style="font-size: 12px; margin-top: 4px;">
            ${type === 'LUZ' 
              ? `Precios Pot: P1 ${item.tariff.potencia_p1.toFixed(6)} €/kW/año, P2 ${item.tariff.potencia_p2.toFixed(6)} €/kW/año<br>
                 Precios Ene: P1 ${item.tariff.energia_p1.toFixed(6)}, P2 ${item.tariff.energia_p2.toFixed(6)}, P3 ${item.tariff.energia_p3.toFixed(6)} €/kWh`
              : `Término Fijo: ${item.tariff.termino_fijo.toFixed(6)} €/mes, Término Variable: ${item.tariff.termino_variable.toFixed(6)} €/kWh`
            }
          </p>
        </div>

        <div style="text-align: right; min-width: 180px;">
          <div style="font-size: 13px; font-weight: 600; color: ${labelColor};">${labelText}</div>
          <div style="font-size: 22px; font-weight: 700; color: ${labelColor};">${isLoss ? '+' : ''}${displayValue.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
          <div class="text-muted" style="font-size: 12px; margin-top: 2px;">~ ${isLoss ? '+' : ''}${displayValueMensual.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € / mes</div>
          
          <div class="margin-top-md" style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
            <div style="font-size: 12px;" class="private-value">Comisión: <strong>${item.tariff.comision.toFixed(2)} €</strong></div>
          </div>
        </div>
      </div>

      <div class="margin-top-lg" style="border-top: 1px solid var(--color-outline-variant); padding-top: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="font-size: 13px;" class="text-muted">
          Factura propuesta: <strong>${costAnual.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/año</strong> 
          (${costMensual.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mes)
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="m3-btn m3-btn-outlined btn-preview-report" data-type="${type}" data-idx="${index}">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
            Previsualizar
          </button>
          <button class="m3-btn m3-btn-outlined btn-pdf-report" data-type="${type}" data-idx="${index}">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>
            Imprimir Reporte
          </button>
          <button class="m3-btn btn-save-comparison" data-type="${type}" data-idx="${index}">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
            Guardar Comparativa
          </button>
        </div>
      </div>
    `;

    // Enlazar eventos de cada tarjeta
    card.querySelector('.btn-preview-report').addEventListener('click', () => {
      exportPDF(item, type, true);
    });

    card.querySelector('.btn-pdf-report').addEventListener('click', () => {
      exportPDF(item, type, false);
    });

    card.querySelector('.btn-save-comparison').addEventListener('click', async () => {
      await saveComparisonToDb(item, type, card.querySelector('.btn-save-comparison'));
    });

    container.appendChild(card);
  });
}

// --- Guardado de Historial en la Base de Datos ---
async function saveComparisonToDb(item, type, buttonEl) {
  try {
    buttonEl.disabled = true;
    buttonEl.innerHTML = 'Guardando...';

    const clienteNombre = lastComparisonData.clientName;
    const clienteCups = lastComparisonData.clientCups;
    const tipoEnergia = lastComparisonData.energyType;

    // Datos del formulario estructurados
    const datosClienteJson = {
      lightInput: lastComparisonData.lightInput,
      gasInput: lastComparisonData.gasInput,
      currentLightCost: lastComparisonData.currentLightCost,
      currentGasCost: lastComparisonData.currentGasCost
    };

    let tarifaLuzId = null;
    let ahorroLuz = 0;
    let tarifaGasId = null;
    let ahorroGas = 0;
    let comisionTotal = 0;

    if (type === 'LUZ') {
      tarifaLuzId = item.tariff.id;
      ahorroLuz = item.ahorro;
      comisionTotal = item.tariff.comision;
    } else if (type === 'GAS') {
      tarifaGasId = item.tariff.id;
      ahorroGas = item.ahorro;
      comisionTotal = item.tariff.comision;
    }

    await addComparativa(
      clienteNombre,
      clienteCups,
      tipoEnergia,
      datosClienteJson,
      tarifaLuzId,
      ahorroLuz,
      tarifaGasId,
      ahorroGas,
      comisionTotal
    );

    buttonEl.innerHTML = `
      <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      Comparativa Guardada
    `;
    buttonEl.classList.add('m3-btn-tertiary');
    
    // Disparar evento para que la vista del historial se actualice
    const event = new CustomEvent('comparison-saved');
    window.dispatchEvent(event);
  } catch (error) {
    buttonEl.disabled = false;
    buttonEl.innerHTML = 'Guardar Comparativa';
    window.showToast("Error al guardar la comparativa en el historial.", "error");
    console.error(error);
  }
}

// --- Exportación a PDF ---
async function exportPDF(item, type, previewMode = false) {
  const reportData = {
    clientName: lastComparisonData.clientName,
    clientCups: lastComparisonData.clientCups,
    energyType: type,
    currentCost: type === 'LUZ' ? lastComparisonData.currentLightCost : lastComparisonData.currentGasCost,
    proposedCost: item.costDetail.annual.total,
    ahorro: item.ahorro,
    inputDetails: type === 'LUZ' ? lastComparisonData.lightInput : lastComparisonData.gasInput,
    tariffDetails: item.tariff,
    costDetail: item.costDetail
  };

  try {
    await generatePDFReport(reportData, previewMode);
  } catch (e) {
    console.error(e);
    window.showToast("Error al generar el PDF.", "error");
  }
}

// Auxiliares
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
