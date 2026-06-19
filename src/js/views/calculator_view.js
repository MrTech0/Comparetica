/* src/js/views/calculator_view.js */

import { calculateLightBill, calculateGasBill } from '../calculator.js';
import { getTarifasLuz, getTarifasGas, addComparativa, getClientes } from '../db.js';
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

let bypassTariffCheck = false;

export function initCalculatorView() {
  setupEnergyTypeToggle();
  setupLightTariffTypeToggle();
  setupCalcFormSubmit();
  setupCalcFormReset();

  // Toggles de Autoconsumo
  const hasExcedenteCheckbox = document.getElementById('calc-light-has-excedente');
  const excedenteGroup = document.getElementById('calc-light-excedente-group');
  if (hasExcedenteCheckbox && excedenteGroup) {
    hasExcedenteCheckbox.addEventListener('change', () => {
      excedenteGroup.style.display = hasExcedenteCheckbox.checked ? 'flex' : 'none';
      const excConsInput = document.getElementById('calc-light-excedente-cons');
      const excPriceInput = document.getElementById('calc-light-excedente-price');
      if (hasExcedenteCheckbox.checked) {
        excConsInput.setAttribute('required', 'required');
        excPriceInput.setAttribute('required', 'required');
      } else {
        excConsInput.removeAttribute('required');
        excPriceInput.removeAttribute('required');
        excConsInput.value = '';
        excPriceInput.value = '';
      }
    });
  }

  // Toggle de modificar datos del formulario
  const modifyBtn = document.getElementById('calc-modify-btn');
  const formContainer = document.getElementById('calc-form-container');
  if (modifyBtn && formContainer) {
    modifyBtn.addEventListener('click', () => {
      formContainer.style.display = 'block';
      modifyBtn.style.display = 'none';
      formContainer.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Autocompletado y auto-inyección de CUPS personalizado (Material 3)
  const calcClientNameInput = document.getElementById('calc-client-name');
  const calcClientCupsInput = document.getElementById('calc-client-cups');
  const autocompleteList = document.getElementById('clients-autocomplete-list');

  if (calcClientNameInput && autocompleteList) {
    let activeIndex = -1;
    let currentFilteredClients = [];

    const closeAutocomplete = () => {
      autocompleteList.classList.remove('open');
      autocompleteList.innerHTML = '';
      activeIndex = -1;
    };

    const renderSuggestions = async () => {
      const val = calcClientNameInput.value.trim();
      if (val.length === 0) {
        closeAutocomplete();
        return;
      }

      try {
        const allClients = await getClientes();
        currentFilteredClients = allClients.filter(c => 
          c.nombre_empresa.toLowerCase().includes(val.toLowerCase()) ||
          c.cif.toLowerCase().includes(val.toLowerCase()) ||
          (c.cups && c.cups.toLowerCase().includes(val.toLowerCase()))
        );

        if (currentFilteredClients.length === 0) {
          closeAutocomplete();
          return;
        }

        autocompleteList.innerHTML = '';
        activeIndex = -1;

        currentFilteredClients.forEach((client, idx) => {
          const item = document.createElement('div');
          item.className = 'm3-autocomplete-item';
          item.setAttribute('data-index', idx);

          const nameStrong = document.createElement('strong');
          nameStrong.innerText = client.nombre_empresa;
          item.appendChild(nameStrong);

          item.addEventListener('click', () => {
            selectClient(client);
          });

          autocompleteList.appendChild(item);
        });

        autocompleteList.classList.add('open');
      } catch (err) {
        console.error("Error al obtener sugerencias de clientes:", err);
      }
    };

    const selectClient = (client) => {
      calcClientNameInput.value = client.nombre_empresa;
      if (client.cups && calcClientCupsInput) {
        calcClientCupsInput.value = client.cups;
      }
      closeAutocomplete();
    };

    calcClientNameInput.addEventListener('input', () => {
      renderSuggestions();
    });

    calcClientNameInput.addEventListener('focus', () => {
      if (calcClientNameInput.value.trim().length > 0) {
        renderSuggestions();
      }
    });

    // Cerrar al hacer click fuera
    document.addEventListener('click', (e) => {
      if (!calcClientNameInput.contains(e.target) && !autocompleteList.contains(e.target)) {
        closeAutocomplete();
      }
    });

    // Teclado: Navegación por flechas y Enter
    calcClientNameInput.addEventListener('keydown', (e) => {
      const items = autocompleteList.querySelectorAll('.m3-autocomplete-item');
      if (items.length === 0 || !autocompleteList.classList.contains('open')) {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex++;
        if (activeIndex >= items.length) {
          activeIndex = 0;
        }
        updateSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex--;
        if (activeIndex < 0) {
          activeIndex = items.length - 1;
        }
        updateSelection(items);
      } else if (e.key === 'Enter') {
        if (activeIndex !== -1 && items[activeIndex]) {
          e.preventDefault();
          selectClient(currentFilteredClients[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeAutocomplete();
      }
    });

    const updateSelection = (items) => {
      items.forEach((item, idx) => {
        if (idx === activeIndex) {
          item.classList.add('selected');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('selected');
        }
      });
    };
  }
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
      // Disparar cambio en el tipo de tarifa luz para ajustar subcampos de periodos
      const lightTariffTypeSelect = document.getElementById('calc-light-tariff-type');
      if (lightTariffTypeSelect) {
        lightTariffTypeSelect.dispatchEvent(new Event('change'));
      }
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
      const lightTariffTypeSelect = document.getElementById('calc-light-tariff-type');
      if (lightTariffTypeSelect) {
        lightTariffTypeSelect.dispatchEvent(new Event('change'));
      }
    }
  });
}

function setupLightTariffTypeToggle() {
  const lightTariffTypeSelect = document.getElementById('calc-light-tariff-type');
  const extraPotRow = document.getElementById('calc-light-30td-pot-row');
  const extraConsRow = document.getElementById('calc-light-30td-cons-row');
  const extraPotPriceRow = document.getElementById('calc-light-30td-pot-price-row');
  const extraEnePriceRow = document.getElementById('calc-light-30td-ene-price-row');
  const bonoSocialGroup = document.getElementById('calc-light-bono-social-group');

  if (lightTariffTypeSelect) {
    lightTariffTypeSelect.addEventListener('change', () => {
      const is30td = lightTariffTypeSelect.value === '3.0TD';
      if (extraPotRow) extraPotRow.style.display = is30td ? 'flex' : 'none';
      if (extraConsRow) extraConsRow.style.display = is30td ? 'flex' : 'none';
      if (extraPotPriceRow) extraPotPriceRow.style.display = is30td ? 'flex' : 'none';
      if (extraEnePriceRow) extraEnePriceRow.style.display = is30td ? 'flex' : 'none';
      
      if (bonoSocialGroup) {
        bonoSocialGroup.style.display = is30td ? 'none' : 'flex';
      }
      if (is30td) {
        const bonoSocialEl = document.getElementById('calc-light-bono-social');
        if (bonoSocialEl) bonoSocialEl.value = "";
      }

      // Set required attribute on extra inputs if 3.0TD
      const extraInputs = [
        'calc-light-p3-pot', 'calc-light-p4-pot', 'calc-light-p5-pot', 'calc-light-p6-pot',
        'calc-light-p4-cons', 'calc-light-p5-cons', 'calc-light-p6-cons'
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
}

function setInputsRequired(container, isRequired) {
  const inputs = container.querySelectorAll('input[required], select[required], input[data-req]');
  inputs.forEach(input => {
    if (isRequired) {
      // Si el elemento es un campo condicional de 3.0TD, solo hacerlo requerido si el tipo es 3.0TD
      if (input.id.includes('30td') || ['calc-light-p3-pot', 'calc-light-p4-pot', 'calc-light-p5-pot', 'calc-light-p6-pot', 'calc-light-p4-cons', 'calc-light-p5-cons', 'calc-light-p6-cons'].includes(input.id)) {
        const is30td = document.getElementById('calc-light-tariff-type').value === '3.0TD';
        if (is30td) {
          input.setAttribute('required', 'required');
        } else {
          input.removeAttribute('required');
        }
      } else {
        input.setAttribute('required', 'required');
      }
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

    const consentCheckbox = document.getElementById('calc-client-consent');
    if (consentCheckbox && !consentCheckbox.checked) {
      window.showToast("Debe confirmar que dispone del consentimiento explícito del cliente para poder continuar.", "warning");
      return;
    }

    const clientNameInput = document.getElementById('calc-client-name');
    const clientName = clientNameInput ? clientNameInput.value.trim() : "";
    
    // Verificar si el cliente existe en base de datos
    const clients = await getClientes();
    const clientExists = clients.some(c => c.nombre_empresa.toLowerCase() === clientName.toLowerCase());

    if (!clientExists) {
      const choice = await showNoClientAlert();
      if (choice === 'redirect') {
        const navClients = document.getElementById('nav-clients');
        if (navClients) navClients.click();
      }
      return;
    }

    const energyType = document.getElementById('calc-energy-type').value;

    if (!bypassTariffCheck) {
      const lightTariffs = (energyType === 'LUZ' || energyType === 'DUAL') ? await getTarifasLuz() : [];
      const gasTariffs = (energyType === 'GAS' || energyType === 'DUAL') ? await getTarifasGas() : [];

      const missingLuz = (energyType === 'LUZ' || energyType === 'DUAL') && lightTariffs.length === 0;
      const missingGas = (energyType === 'GAS' || energyType === 'DUAL') && gasTariffs.length === 0;

      if (missingLuz || missingGas) {
        let msg = "";
        if (missingLuz && missingGas) {
          msg = "No tiene dada de alta ninguna tarifa de Luz ni de Gas en la base de datos para poder realizar la comparativa.";
        } else if (missingLuz) {
          msg = "No tiene dada de alta ninguna tarifa de Luz en la base de datos para poder realizar la comparativa.";
        } else if (missingGas) {
          msg = "No tiene dada de alta ninguna tarifa de Gas en la base de datos para poder realizar la comparativa.";
        }
        msg += "\n\n¿Desea omitir esta alerta y continuar para calcular únicamente el gasto actual del cliente, o ir a registrarlas en la pestaña de 'Tarifas Luz'?";

        const choice = await showNoTariffsAlert(msg);
        if (choice === 'redirect') {
          const navTariffs = document.getElementById('nav-tariffs');
          const tabBtnLuz = document.getElementById('tab-btn-luz');
          if (navTariffs) navTariffs.click();
          if (tabBtnLuz) tabBtnLuz.click();
          return;
        } else if (choice === 'omit') {
          bypassTariffCheck = true;
          form.requestSubmit();
          return;
        } else {
          return;
        }
      }
    }

    bypassTariffCheck = false;

    const clientCups = document.getElementById('calc-client-cups').value.trim();

    // Resetear contenedores de resultados
    document.getElementById('results-light-list').innerHTML = '';
    document.getElementById('results-gas-list').innerHTML = '';
    document.getElementById('results-light-container').style.display = 'none';
    document.getElementById('results-gas-container').style.display = 'none';

    // Obtener campos comunes de luz
    const hasExcedente = document.getElementById('calc-light-has-excedente').checked;
    const excedenteCons = hasExcedente ? parseFloat(document.getElementById('calc-light-excedente-cons').value || 0) : 0;
    const excedentePrice = hasExcedente ? parseFloat(document.getElementById('calc-light-excedente-price').value || 0) : 0;
    const bonoSocialPct = parseFloat(document.getElementById('calc-light-bono-social').value || 0);
    const bonoSocialFinanciacion = parseFloat(document.getElementById('calc-light-bono-social-financiacion').value || 0);

    // 1. Obtener y parsear inputs de Luz
    let lightInput = null;
    let currentLightAnnual = 0;
    let clientLightConsumoAnual = 0;

    if (energyType === 'LUZ' || energyType === 'DUAL') {
      const is30td = document.getElementById('calc-light-tariff-type').value === '3.0TD';
      if (is30td) {
        lightInput = {
          dias: parseInt(document.getElementById('calc-light-days').value),
          p1Pot: parseFloat(document.getElementById('calc-light-p1-pot').value),
          p2Pot: parseFloat(document.getElementById('calc-light-p2-pot').value),
          p3Pot: parseFloat(document.getElementById('calc-light-p3-pot').value || 0),
          p4Pot: parseFloat(document.getElementById('calc-light-p4-pot').value || 0),
          p5Pot: parseFloat(document.getElementById('calc-light-p5-pot').value || 0),
          p6Pot: parseFloat(document.getElementById('calc-light-p6-pot').value || 0),
          p1Cons: parseFloat(document.getElementById('calc-light-p1-cons').value),
          p2Cons: parseFloat(document.getElementById('calc-light-p2-cons').value),
          p3Cons: parseFloat(document.getElementById('calc-light-p3-cons').value),
          p4Cons: parseFloat(document.getElementById('calc-light-p4-cons').value || 0),
          p5Cons: parseFloat(document.getElementById('calc-light-p5-cons').value || 0),
          p6Cons: parseFloat(document.getElementById('calc-light-p6-cons').value || 0),
          alquiler: parseFloat(document.getElementById('calc-light-meter').value || 0),
          impuestoElectrico: parseFloat(document.getElementById('calc-light-tax').value),
          iva: parseFloat(document.getElementById('calc-light-vat').value),
          excedenteCons,
          excedentePrice,
          bonoSocialPct: 0,
          bonoSocialFinanciacion
        };

        const currentTariffMock = {
          tipo_tarifa: '3.0TD',
          potencia_p1: parseFloat(document.getElementById('calc-light-p1-pot-price').value || 0) * 365,
          potencia_p2: parseFloat(document.getElementById('calc-light-p2-pot-price').value || 0) * 365,
          potencia_p3: parseFloat(document.getElementById('calc-light-p3-pot-price').value || 0) * 365,
          potencia_p4: parseFloat(document.getElementById('calc-light-p4-pot-price').value || 0) * 365,
          potencia_p5: parseFloat(document.getElementById('calc-light-p5-pot-price').value || 0) * 365,
          potencia_p6: parseFloat(document.getElementById('calc-light-p6-pot-price').value || 0) * 365,
          energia_p1: parseFloat(document.getElementById('calc-light-p1-ene-price').value || 0),
          energia_p2: parseFloat(document.getElementById('calc-light-p2-ene-price').value || 0),
          energia_p3: parseFloat(document.getElementById('calc-light-p3-ene-price').value || 0),
          energia_p4: parseFloat(document.getElementById('calc-light-p4-ene-price').value || 0),
          energia_p5: parseFloat(document.getElementById('calc-light-p5-ene-price').value || 0),
          energia_p6: parseFloat(document.getElementById('calc-light-p6-ene-price').value || 0),
          excedente: excedentePrice
        };

        const billDetail = calculateLightBill(lightInput, currentTariffMock);
        currentLightAnnual = billDetail.annual.total;

        const totalCons = lightInput.p1Cons + lightInput.p2Cons + lightInput.p3Cons + lightInput.p4Cons + lightInput.p5Cons + lightInput.p6Cons;
        clientLightConsumoAnual = totalCons * (365 / lightInput.dias);
      } else {
        lightInput = {
          dias: parseInt(document.getElementById('calc-light-days').value),
          p1Pot: parseFloat(document.getElementById('calc-light-p1-pot').value),
          p2Pot: parseFloat(document.getElementById('calc-light-p2-pot').value),
          p1Cons: parseFloat(document.getElementById('calc-light-p1-cons').value),
          p2Cons: parseFloat(document.getElementById('calc-light-p2-cons').value),
          p3Cons: parseFloat(document.getElementById('calc-light-p3-cons').value),
          alquiler: parseFloat(document.getElementById('calc-light-meter').value || 0),
          impuestoElectrico: parseFloat(document.getElementById('calc-light-tax').value),
          iva: parseFloat(document.getElementById('calc-light-vat').value),
          excedenteCons,
          excedentePrice,
          bonoSocialPct,
          bonoSocialFinanciacion
        };

        const currentTariffMock = {
          tipo_tarifa: '2.0TD',
          potencia_p1: parseFloat(document.getElementById('calc-light-p1-pot-price').value || 0) * 365,
          potencia_p2: parseFloat(document.getElementById('calc-light-p2-pot-price').value || 0) * 365,
          energia_p1: parseFloat(document.getElementById('calc-light-p1-ene-price').value || 0),
          energia_p2: parseFloat(document.getElementById('calc-light-p2-ene-price').value || 0),
          energia_p3: parseFloat(document.getElementById('calc-light-p3-ene-price').value || 0),
          excedente: excedentePrice
        };

        const billDetail = calculateLightBill(lightInput, currentTariffMock);
        currentLightAnnual = billDetail.annual.total;

        const totalCons = lightInput.p1Cons + lightInput.p2Cons + lightInput.p3Cons;
        clientLightConsumoAnual = totalCons * (365 / lightInput.dias);
      }
    }

    // 2. Obtener y parsear inputs de Gas
    let gasInput = null;
    let currentGasAnnual = 0;
    let clientGasConsumoAnual = 0;

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
        tipo_tarifa: document.getElementById('calc-gas-tariff-type').value,
        termino_fijo: parseFloat(document.getElementById('calc-gas-fixed-price').value || 0),
        termino_variable: parseFloat(document.getElementById('calc-gas-var-price').value || 0)
      };

      const billDetail = calculateGasBill(gasInput, currentTariffMock);
      currentGasAnnual = billDetail.annual.total;

      clientGasConsumoAnual = gasInput.consumo * (365 / gasInput.dias);
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
      const is30td = document.getElementById('calc-light-tariff-type').value === '3.0TD';
      const allLightTariffs = await getTarifasLuz();
      
      // Filtrar propuestas
      const lightTariffs = allLightTariffs.filter(t => (t.tipo_tarifa || '2.0TD') === (is30td ? '3.0TD' : '2.0TD'));
      const lightResults = [];

      lightTariffs.forEach(tariff => {
        const costDetail = calculateLightBill(lightInput, tariff);
        const resolvedCom = resolveCommission(tariff, clientLightConsumoAnual, lightInput);
        tariff.resolvedComision = resolvedCom;

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
        document.getElementById('results-light-list').innerHTML = '<p class="text-muted">No hay tarifas de luz de este tipo registradas en la base de datos.</p>';
      }
    }

    // 4. Procesar propuestas de Gas
    let bestGasOption = null;
    if (energyType === 'GAS' || energyType === 'DUAL') {
      document.getElementById('results-gas-container').style.display = 'block';
      const gasTariffType = document.getElementById('calc-gas-tariff-type').value;
      const allGasTariffs = await getTarifasGas();
      const gasTariffs = allGasTariffs.filter(t => (t.tipo_tarifa || 'RL.1') === gasTariffType);
      const gasResults = [];

      gasTariffs.forEach(tariff => {
        const costDetail = calculateGasBill(gasInput, tariff);
        const resolvedCom = resolveCommission(tariff, clientGasConsumoAnual);
        tariff.resolvedComision = resolvedCom;

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
    
    // Contraer formulario de entrada de datos
    const modifyBtn = document.getElementById('calc-modify-btn');
    const formContainer = document.getElementById('calc-form-container');
    if (modifyBtn && formContainer) {
      formContainer.style.display = 'none';
      modifyBtn.style.display = 'flex';
    }

    // Scroll suave a los resultados
    document.getElementById('calc-results-wrapper').scrollIntoView({ behavior: 'smooth' });
  });
}

function setupCalcFormReset() {
  const form = document.getElementById('calc-form');
  if (!form) return;

  form.addEventListener('reset', () => {
    const consentCheckbox = document.getElementById('calc-client-consent');
    if (consentCheckbox) consentCheckbox.checked = false;

    // 1. Ocultar el contenedor de resultados
    const resultsWrapper = document.getElementById('calc-results-wrapper');
    if (resultsWrapper) {
      resultsWrapper.style.display = 'none';
    }

    // 2. Limpiar y ocultar las listas de propuestas
    const resultsLightList = document.getElementById('results-light-list');
    if (resultsLightList) resultsLightList.innerHTML = '';

    const resultsGasList = document.getElementById('results-gas-list');
    if (resultsGasList) resultsGasList.innerHTML = '';

    const resultsLightContainer = document.getElementById('results-light-container');
    if (resultsLightContainer) resultsLightContainer.style.display = 'none';

    const resultsGasContainer = document.getElementById('results-gas-container');
    if (resultsGasContainer) resultsGasContainer.style.display = 'none';

    // 3. Resetear el Gasto Anualizado Actual Estimado en pantalla
    const currentAnnualCost = document.getElementById('calc-current-annual-cost');
    if (currentAnnualCost) {
      currentAnnualCost.innerText = '0,00 €';
    }

    // 4. Limpiar los datos temporales del último cálculo
    lastComparisonData = {
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

    bypassTariffCheck = false;

    // 5. Mostrar el formulario y ocultar el botón de modificar
    const formContainer = document.getElementById('calc-form-container');
    if (formContainer) {
      formContainer.style.display = 'block';
    }
    const modifyBtn = document.getElementById('calc-modify-btn');
    if (modifyBtn) {
      modifyBtn.style.display = 'none';
    }

    // 6. Disparar eventos de cambio para sincronizar la visibilidad de bloques y selectores customizados
    setTimeout(() => {
      const energyTypeSelect = document.getElementById('calc-energy-type');
      if (energyTypeSelect) {
        energyTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const lightTariffTypeSelect = document.getElementById('calc-light-tariff-type');
      if (lightTariffTypeSelect) {
        lightTariffTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const hasExcedenteCheckbox = document.getElementById('calc-light-has-excedente');
      if (hasExcedenteCheckbox) {
        hasExcedenteCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 0);
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
          <h4 style="font-size: 15px; margin-top: 6px; font-weight: 500;">
            Tarifa: ${escapeHtml(item.tariff.nombre)}
            <span class="m3-chip" style="font-size: 9px; height: 18px; padding: 0 6px; vertical-align: middle; margin-left: 6px;">
              ${type === 'LUZ' ? (item.tariff.tipo_tarifa || '2.0TD') : (item.tariff.tipo_tarifa || 'RL.1')}
            </span>
          </h4>
          <p class="text-muted" style="font-size: 12px; margin-top: 4px;">
            ${type === 'LUZ' 
              ? (item.tariff.tipo_tarifa === '3.0TD'
                ? `Precios Pot: P1 ${(item.tariff.potencia_p1/365).toFixed(7)}, P2 ${(item.tariff.potencia_p2/365).toFixed(7)}, P3 ${(item.tariff.potencia_p3/365).toFixed(7)}, P4 ${(item.tariff.potencia_p4/365).toFixed(7)}, P5 ${(item.tariff.potencia_p5/365).toFixed(7)}, P6 ${(item.tariff.potencia_p6/365).toFixed(7)} €/kW/día<br>
                   Precios Ene: P1 ${item.tariff.energia_p1.toFixed(7)}, P2 ${item.tariff.energia_p2.toFixed(7)}, P3 ${item.tariff.energia_p3.toFixed(7)}, P4 ${item.tariff.energia_p4.toFixed(7)}, P5 ${item.tariff.energia_p5.toFixed(7)}, P6 ${item.tariff.energia_p6.toFixed(7)} €/kWh${item.tariff.excedente ? `<br><span class="text-success" style="font-weight: 500;">Excedente: ${item.tariff.excedente.toFixed(7)} €/kWh</span>` : ''}`
                : `Precios Pot: P1 ${(item.tariff.potencia_p1/365).toFixed(7)} €/kW/día, P2 ${(item.tariff.potencia_p2/365).toFixed(7)} €/kW/día<br>
                   Precios Ene: P1 ${item.tariff.energia_p1.toFixed(7)}, P2 ${item.tariff.energia_p2.toFixed(7)}, P3 ${item.tariff.energia_p3.toFixed(7)} €/kWh${item.tariff.excedente ? `<br><span class="text-success" style="font-weight: 500;">Excedente: ${item.tariff.excedente.toFixed(7)} €/kWh</span>` : ''}`
                )
              : `Término Fijo: ${item.tariff.termino_fijo.toFixed(7)} €/mes, Término Variable: ${item.tariff.termino_variable.toFixed(7)} €/kWh`
            }
          </p>
        </div>

        <div style="text-align: right; min-width: 180px;">
          <div style="font-size: 13px; font-weight: 600; color: ${labelColor};">${labelText}</div>
          <div style="font-size: 22px; font-weight: 700; color: ${labelColor};">${isLoss ? '+' : ''}${displayValue.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</div>
          <div class="text-muted" style="font-size: 12px; margin-top: 2px;">~ ${isLoss ? '+' : ''}${displayValueMensual.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € / mes</div>
          
          <div class="margin-top-md" style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
            <div style="font-size: 12px;" class="private-value">Comisión: <strong>${(item.tariff.resolvedComision !== undefined ? item.tariff.resolvedComision : item.tariff.comision).toFixed(2)} €</strong></div>
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
      currentGasCost: lastComparisonData.currentGasCost,
      proposedTariffSnapshot: item.tariff,
      proposedCostDetail: item.costDetail
    };

    let tarifaLuzId = null;
    let ahorroLuz = 0;
    let tarifaGasId = null;
    let ahorroGas = 0;
    let comisionTotal = 0;

    if (type === 'LUZ') {
      tarifaLuzId = item.tariff.id;
      ahorroLuz = item.ahorro;
      comisionTotal = item.tariff.resolvedComision !== undefined ? item.tariff.resolvedComision : item.tariff.comision;
    } else if (type === 'GAS') {
      tarifaGasId = item.tariff.id;
      ahorroGas = item.ahorro;
      comisionTotal = item.tariff.resolvedComision !== undefined ? item.tariff.resolvedComision : item.tariff.comision;
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

function resolveCommission(tariff, consumoAnual, potencias = {}) {
  let comisionTramosConsumo = 0;
  let comisionTramosPotencia = 0;

  const maxPot = Math.max(
    potencias.p1Pot || 0,
    potencias.p2Pot || 0,
    potencias.p3Pot || 0,
    potencias.p4Pot || 0,
    potencias.p5Pot || 0,
    potencias.p6Pot || 0
  );

  const evaluateTramosList = (tList, value) => {
    if (tList.length > 0) {
      const firstTramo = tList[0];
      const limitMin = firstTramo.tipo === 'hasta' ? 0 : (firstTramo.desde || 0);
      if (value < limitMin) {
        return 0;
      }
    }

    let resolvedVal = null;
    // Evaluar de derecha a izquierda (de mayor a menor rango/desde) para que
    // los tramos de categorías superiores tengan prioridad si hay solapamiento.
    for (let i = tList.length - 1; i >= 0; i--) {
      const tr = tList[i];
      if (tr.tipo === 'hasta' || !tr.tipo) {
        if (value <= tr.hasta) {
          resolvedVal = tr.comision;
          break;
        }
      } else if (tr.tipo === 'rango') {
        if (value >= tr.desde && value <= tr.hasta) {
          resolvedVal = tr.comision;
          break;
        }
      } else if (tr.tipo === 'desde') {
        if (value >= tr.desde) {
          resolvedVal = tr.comision;
          break;
        }
      }
    }
    if (resolvedVal === null && tList.length > 0) {
      resolvedVal = tList[tList.length - 1].comision;
    }
    return resolvedVal || 0;
  };

  if (tariff.comision_tramos_consumo) {
    try {
      const tramos = JSON.parse(tariff.comision_tramos_consumo);
      if (Array.isArray(tramos) && tramos.length > 0) {
        comisionTramosConsumo = evaluateTramosList(tramos, consumoAnual);
      }
    } catch (e) {
      console.error("Error parsing comision_tramos_consumo:", e);
    }
  }

  if (tariff.comision_tramos_potencia) {
    try {
      const tramos = JSON.parse(tariff.comision_tramos_potencia);
      if (Array.isArray(tramos) && tramos.length > 0) {
        comisionTramosPotencia = evaluateTramosList(tramos, maxPot);
      }
    } catch (e) {
      console.error("Error parsing comision_tramos_potencia:", e);
    }
  }

  return Math.max(comisionTramosConsumo, comisionTramosPotencia);
}

function showNoTariffsAlert(mensaje) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog-no-tariffs');
    const msgEl = document.getElementById('dialog-no-tariffs-message');
    const btnOmit = document.getElementById('dialog-no-tariffs-omit');
    const btnRedirect = document.getElementById('dialog-no-tariffs-redirect');

    if (!overlay || !msgEl || !btnOmit || !btnRedirect) {
      resolve('omit');
      return;
    }

    msgEl.innerText = mensaje;

    // Clonar botones para limpiar event listeners previos
    const omitClone = btnOmit.cloneNode(true);
    const redirectClone = btnRedirect.cloneNode(true);
    btnOmit.replaceWith(omitClone);
    btnRedirect.replaceWith(redirectClone);

    omitClone.addEventListener('click', () => {
      overlay.classList.remove('active');
      resolve('omit');
    });

    redirectClone.addEventListener('click', () => {
      overlay.classList.remove('active');
      resolve('redirect');
    });

    overlay.classList.add('active');
  });
}

function showNoClientAlert() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog-no-client');
    const btnOmit = document.getElementById('dialog-no-client-omit');
    const btnRedirect = document.getElementById('dialog-no-client-redirect');

    if (!overlay || !btnOmit || !btnRedirect) {
      resolve('omit');
      return;
    }

    // Clonar botones para limpiar event listeners previos
    const omitClone = btnOmit.cloneNode(true);
    const redirectClone = btnRedirect.cloneNode(true);
    btnOmit.replaceWith(omitClone);
    btnRedirect.replaceWith(redirectClone);

    omitClone.addEventListener('click', () => {
      overlay.classList.remove('active');
      resolve('omit');
    });

    redirectClone.addEventListener('click', () => {
      overlay.classList.remove('active');
      resolve('redirect');
    });

    overlay.classList.add('active');
  });
}

