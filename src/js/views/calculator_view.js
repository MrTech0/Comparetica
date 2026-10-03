/* src/js/views/calculator_view.js */

import { calculateLightBill, calculateGasBill, formatPriceDecimals } from '../calculator.js';
import { getTarifasLuz, getTarifasGas, addComparativa, getClientes, getComparativas, getPuntosSuministroByCliente, getCompanySnapshot } from '../db.js';
import { generatePDFReport } from '../pdf.js';
import { showToast } from '../ui.js';
import { emitAppEvent, APP_EVENTS } from '../events.js';
import { isValidSpanishCups, normalizeCups } from '../utils/validators.js';

// Datos temporales de la última comparación realizada
let lastComparisonData = {
  clientId: null,
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
      excedenteGroup.style.display = hasExcedenteCheckbox.checked ? 'grid' : 'none';
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

  setupCalculatorClientSelection();
}

// El cliente se elige primero; sus puntos registrados determinan los selectores.
let calculatorSupplyContext = null;
let calculatorSelectionVersion = 0;
let calculatorSuggestionRequest = 0;

function closeCalculatorSuggestions() {
  calculatorSuggestionRequest++;
  const list = document.getElementById('clients-autocomplete-list');
  if (list) {
    list.classList.remove('open');
    list.innerHTML = '';
  }
  document.getElementById('calc-client-name')?.setAttribute('aria-expanded', 'false');
  document.getElementById('calc-client-name')?.removeAttribute('aria-activedescendant');
}

function setCalculatorOptions(select, entries, placeholder, selected = '') {
  select.innerHTML = '';
  if (placeholder) entries = [{ value: '', label: placeholder }, ...entries];
  entries.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = selected;
}

function setCalculatorSupplyHelp(message) {
  const help = document.getElementById('calc-supply-help');
  if (help) help.textContent = message;
}

function resetCalculatorSupplySelection(message = 'Selecciona un cliente para cargar sus suministros registrados.') {
  calculatorSupplyContext = null;
  calculatorSelectionVersion++;
  bypassTariffCheck = false;
  closeCalculatorSuggestions();
  const energy = document.getElementById('calc-energy-type');
  const cups = document.getElementById('calc-client-cups');
  setCalculatorOptions(energy, [], 'Selecciona primero un cliente');
  setEnergySelectLocked(true, message);
  setCalculatorOptions(cups, [], 'Selecciona primero un cliente');
  cups.disabled = true;
  cups.title = '';
  energy.dispatchEvent(new Event('change'));
  setCalculatorSupplyHelp(message);
}

function renderCalculatorSupplyOptions(preferredCups = '', allowAutomaticSelection = true) {
  const context = calculatorSupplyContext;
  if (!context?.ready) return;
  const energy = document.getElementById('calc-energy-type').value;
  const cups = document.getElementById('calc-client-cups');
  const points = context.points.filter(point => point.tipo_energia === energy);
  const selected = points.find(point => point.cups === preferredCups)?.cups
    || (allowAutomaticSelection && points.length === 1 ? points[0].cups : '');
  setCalculatorOptions(cups, points.map(point => ({
    value: point.cups,
    label: point.direccion_alias ? `${point.cups} — ${point.direccion_alias}` : point.cups
  })), points.length === 1 && selected ? '' : 'Selecciona un CUPS', selected);
  cups.disabled = points.length === 0 || (points.length === 1 && Boolean(selected));
  cups.title = selected;
  setCalculatorSupplyHelp(points.length === 1
    ? 'CUPS del único punto de suministro registrado de este tipo.'
    : 'Selecciona el punto de suministro que quieres comparar.');
}

async function selectCalculatorClient(client, preferredSupply = null) {
  resetCalculatorSupplySelection('Cargando los suministros del cliente…');
  const name = document.getElementById('calc-client-name');
  name.value = client.nombre_empresa;
  const context = { client, points: [], ready: false };
  calculatorSupplyContext = context;
  try {
    const points = await getPuntosSuministroByCliente(client.id);
    if (calculatorSupplyContext !== context) return false;
    context.points = points.map(point => ({
      ...point, cups: normalizeCups(point.cups), tipo_energia: String(point.tipo_energia || '').trim().toUpperCase()
    })).filter(point => point.cups && ['LUZ', 'GAS'].includes(point.tipo_energia));
    context.ready = true;
    const types = ['LUZ', 'GAS'].filter(type => context.points.some(point => point.tipo_energia === type));
    if (types.length === 0) {
      setCalculatorSupplyHelp('Este cliente no tiene puntos de suministro registrados. Añádelos en su ficha de Clientes.');
      showToast('Añade los puntos de suministro en la ficha del cliente antes de comparar.', 'warning');
      return false;
    }
    const preferredCups = normalizeCups(preferredSupply?.cups);
    const preferredPoint = preferredCups ? context.points.find(point => point.cups === preferredCups
      && point.tipo_energia === String(preferredSupply.tipo_energia || '').toUpperCase()) : null;
    const energy = document.getElementById('calc-energy-type');
    setCalculatorOptions(energy, types.map(type => ({ value: type, label: type === 'LUZ' ? 'Luz' : 'Gas' })), '',
      preferredPoint?.tipo_energia || types[0]);
    setEnergySelectLocked(types.length === 1, types.length === 1 ? 'El cliente solo tiene suministros de este tipo.' : '');
    energy.dispatchEvent(new Event('change'));
    renderCalculatorSupplyOptions(preferredPoint?.cups || '', !preferredCups || Boolean(preferredPoint));
    if (preferredCups && !preferredPoint) {
      setCalculatorSupplyHelp('El CUPS de origen ya no está registrado para este cliente y tipo. Revisa su ficha o elige otro punto.');
      showToast('El CUPS de origen no está registrado para este cliente y tipo de suministro. Revisa su ficha.', 'warning');
      return false;
    }
    return true;
  } catch (error) {
    if (calculatorSupplyContext !== context) return false;
    console.error('Error al cargar los suministros del cliente:', error);
    setCalculatorSupplyHelp('No se pudieron cargar los suministros. Vuelve a seleccionar el cliente.');
    showToast('No se pudieron cargar los suministros del cliente.', 'error');
    return false;
  }
}

function setupCalculatorClientSelection() {
  const name = document.getElementById('calc-client-name');
  const list = document.getElementById('clients-autocomplete-list');
  if (!name || !list || name.dataset.supplySelectionInitialized) return;
  name.dataset.supplySelectionInitialized = 'true';
  let activeIndex = -1;
  const renderSuggestions = async () => {
    const query = name.value.trim().toLocaleLowerCase('es');
    const request = ++calculatorSuggestionRequest;
    if (!query) { closeCalculatorSuggestions(); return; }
    try {
      const clients = await getClientes({ soloActivos: true });
      if (request !== calculatorSuggestionRequest) return;
      const matches = clients.filter(client => [client.nombre_empresa, client.cif]
        .some(value => String(value || '').toLocaleLowerCase('es').includes(query)));
      list.innerHTML = '';
      activeIndex = -1;
      name.removeAttribute('aria-activedescendant');
      matches.forEach((client, index) => {
        const item = document.createElement('div');
        item.id = `calc-client-option-${index}`;
        item.className = 'm3-autocomplete-item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.setAttribute('data-index', index);
        const content = document.createElement('div');
        content.className = 'm3-autocomplete-item-content';
        const title = document.createElement('strong');
        title.textContent = client.nombre_empresa;
        const detail = document.createElement('small');
        detail.className = 'text-muted';
        detail.textContent = client.cif || 'Sin CIF/DNI';
        content.appendChild(title);
        content.appendChild(detail);
        item.appendChild(content);
        item.addEventListener('click', () => selectCalculatorClient(client));
        list.appendChild(item);
      });
      list.classList.toggle('open', matches.length > 0);
      name.setAttribute('aria-expanded', String(matches.length > 0));
    } catch (error) {
      if (request !== calculatorSuggestionRequest) return;
      closeCalculatorSuggestions();
      console.error('Error al obtener sugerencias de clientes:', error);
    }
  };
  name.addEventListener('input', () => {
    resetCalculatorSupplySelection();
    return renderSuggestions();
  });
  name.addEventListener('focus', renderSuggestions);
  document.addEventListener('click', event => {
    if (!name.contains(event.target) && !list.contains(event.target)) closeCalculatorSuggestions();
  });
  name.addEventListener('keydown', event => {
    const items = list.querySelectorAll('.m3-autocomplete-item');
    if (!items.length || !list.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCalculatorSuggestions();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = event.key === 'ArrowDown' ? (activeIndex + 1) % items.length
        : (activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
      items.forEach((item, index) => {
        item.classList.toggle('selected', index === activeIndex);
        item.setAttribute('aria-selected', String(index === activeIndex));
      });
      name.setAttribute('aria-activedescendant', items[activeIndex].id);
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      items[activeIndex].click();
    }
  });
  document.getElementById('calc-energy-type').addEventListener('change', () => {
    calculatorSelectionVersion++;
    bypassTariffCheck = false;
    renderCalculatorSupplyOptions();
  });
  document.getElementById('calc-client-cups').addEventListener('change', event => {
    calculatorSelectionVersion++;
    event.target.title = event.target.value;
  });
  resetCalculatorSupplySelection();
}

/**
 * Bloquea o desbloquea el selector de Tipo de Suministro en el Comparador.
 * @param {boolean} locked - True para bloquear en modo solo lectura, false para habilitar.
 * @param {string} [reason] - Mensaje explicativo para el tooltip.
 */
export function setEnergySelectLocked(locked, reason = '') {
  const energySelect = document.getElementById('calc-energy-type');
  if (!energySelect) return;
  energySelect.disabled = locked;
  energySelect.title = locked ? reason : '';

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
    } else {
      lightBlock.style.display = 'none';
      gasBlock.style.display = 'none';
      setInputsRequired(lightBlock, false);
      setInputsRequired(gasBlock, false);
    }
  });
}

function setupLightTariffTypeToggle() {
  const lightTariffTypeSelect = document.getElementById('calc-light-tariff-type');
  const extraPotRow = document.getElementById('calc-light-30td-pot-row');
  const extraConsRow = document.getElementById('calc-light-30td-cons-row');
  const extraPotPriceRow = document.getElementById('calc-light-30td-pot-price-row');
  const extraEnePriceRow = document.getElementById('calc-light-30td-ene-price-row');

  if (lightTariffTypeSelect) {
    lightTariffTypeSelect.addEventListener('change', () => {
      const is30td = lightTariffTypeSelect.value === '3.0TD';
      if (extraPotRow) extraPotRow.style.display = is30td ? 'grid' : 'none';
      if (extraConsRow) extraConsRow.style.display = is30td ? 'grid' : 'none';
      if (extraPotPriceRow) extraPotPriceRow.style.display = is30td ? 'grid' : 'none';
      if (extraEnePriceRow) extraEnePriceRow.style.display = is30td ? 'grid' : 'none';

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
  const inputs = container.querySelectorAll('input[required], select[required], input[data-req], select[data-req]');
  inputs.forEach(input => {
    // Conservar la obligatoriedad aunque el bloque se oculte temporalmente.
    input.setAttribute('data-req', '');
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
      showToast("Debe confirmar que dispone del consentimiento explícito del cliente para poder continuar.", "warning");
      return;
    }

    const clientNameInput = document.getElementById('calc-client-name');
    const clientName = clientNameInput ? clientNameInput.value.trim() : "";
    const context = calculatorSupplyContext;
    const selectionVersion = calculatorSelectionVersion;
    const energyType = document.getElementById('calc-energy-type').value;
    const clientCups = normalizeCups(document.getElementById('calc-client-cups')?.value);
    const selectionIsCurrent = () => context === calculatorSupplyContext && selectionVersion === calculatorSelectionVersion
      && clientName === clientNameInput.value.trim()
      && energyType === document.getElementById('calc-energy-type').value
      && clientCups === normalizeCups(document.getElementById('calc-client-cups').value);
    
    // Verificar si el cliente existe en base de datos y su estado
    const clients = await getClientes();
    if (!selectionIsCurrent()) return;
    const matchedClient = context ? clients.find(c => c.id === context.client.id)
      : clients.find(c => c.nombre_empresa.toLowerCase() === clientName.toLowerCase());

    if (!matchedClient) {
      const choice = await showNoClientAlert();
      if (choice === 'redirect') {
        const navClients = document.getElementById('nav-clients');
        if (navClients) navClients.click();
      }
      return;
    }

    if (matchedClient.estado === 'bloqueado') {
      showToast("El cliente seleccionado se encuentra bloqueado conforme a la LOPD/RGPD y no puede recibir ofertas ni comparativas.", "error");
      return;
    }

    if (matchedClient.estado === 'inactivo') {
      showToast("El cliente seleccionado está inactivo. Debe reactivarlo en la sección de Clientes antes de generar una nueva comparativa.", "warning");
      return;
    }

    if (!context?.ready || context.client.nombre_empresa !== clientName || !['LUZ', 'GAS'].includes(energyType)) {
      showToast('Selecciona un cliente de la lista y uno de sus suministros registrados.', 'warning');
      clientNameInput.focus();
      return;
    }
    let registeredPoints;
    try {
      registeredPoints = await getPuntosSuministroByCliente(matchedClient.id);
    } catch (error) {
      if (!selectionIsCurrent()) return;
      showToast('No se pudieron verificar los suministros del cliente. Vuelve a intentarlo.', 'error');
      return;
    }
    if (!selectionIsCurrent()) return;
    if (!registeredPoints.some(point => normalizeCups(point.cups) === clientCups
      && String(point.tipo_energia || '').trim().toUpperCase() === energyType)) {
      showToast('Selecciona un CUPS registrado para este cliente y tipo de suministro. Si su ficha ha cambiado, vuelve a seleccionar el cliente.', 'warning');
      document.getElementById('calc-client-cups').focus();
      return;
    }

    if (!bypassTariffCheck) {
      const lightTariffs = (energyType === 'LUZ' || energyType === 'DUAL') ? await getTarifasLuz() : [];
      const gasTariffs = (energyType === 'GAS' || energyType === 'DUAL') ? await getTarifasGas() : [];
      if (!selectionIsCurrent()) return;

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
        if (!selectionIsCurrent()) return;
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

    if (!clientCups) {
      showToast("Debes indicar el código CUPS del suministro para poder realizar la comparativa.", "error");
      const cupsInput = document.getElementById('calc-client-cups');
      if (cupsInput) cupsInput.focus();
      return;
    }

    if (!isValidSpanishCups(clientCups)) {
      showToast(`El código CUPS "${clientCups}" no es válido. Debe comenzar por ES y contener 20 o 22 caracteres.`, "error");
      const cupsInput = document.getElementById('calc-client-cups');
      if (cupsInput) cupsInput.focus();
      return;
    }

    let companySnapshot;
    try {
      companySnapshot = await getCompanySnapshot();
    } catch (error) {
      if (selectionIsCurrent()) showToast('No se pudieron guardar los datos de la consultora para esta comparativa. Vuelve a intentarlo.', 'error');
      return;
    }
    if (!selectionIsCurrent()) return;

    // Resetear contenedores de resultados
    document.getElementById('results-light-list').innerHTML = '';
    document.getElementById('results-gas-list').innerHTML = '';
    document.getElementById('results-light-container').style.display = 'none';
    document.getElementById('results-gas-container').style.display = 'none';

    // Obtener campos comunes de luz
    const hasExcedente = document.getElementById('calc-light-has-excedente').checked;
    const excedenteCons = hasExcedente ? parseFloat(document.getElementById('calc-light-excedente-cons').value || 0) : 0;
    const excedentePrice = hasExcedente ? parseFloat(document.getElementById('calc-light-excedente-price').value || 0) : 0;
    const bonoSocialPct = 0;
    const bonoSocialFinanciacion = parseFloat(document.getElementById('calc-light-bono-social-financiacion').value || 0);

    // 1. Obtener y parsear inputs de Luz
    let lightInput = null;
    let currentLightAnnual = 0;
    let clientLightConsumoAnual = 0;

    let currentLightBillDetail = null;
    let currentGasBillDetail = null;

    if (energyType === 'LUZ' || energyType === 'DUAL') {
      const lightOther = parseFloat(document.getElementById('calc-light-other-concepts').value || 0);
      const lightReactive = parseFloat(document.getElementById('calc-light-reactive-penalties').value || 0);
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
          bonoSocialFinanciacion,
          otherConcepts: lightOther,
          reactivePenalties: lightReactive
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

        currentLightBillDetail = calculateLightBill(lightInput, currentTariffMock);
        currentLightAnnual = currentLightBillDetail.annual.total;

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
          bonoSocialFinanciacion,
          otherConcepts: lightOther,
          reactivePenalties: lightReactive
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

        currentLightBillDetail = calculateLightBill(lightInput, currentTariffMock);
        currentLightAnnual = currentLightBillDetail.annual.total;

        const totalCons = lightInput.p1Cons + lightInput.p2Cons + lightInput.p3Cons;
        clientLightConsumoAnual = totalCons * (365 / lightInput.dias);
      }
    }

    // 2. Obtener y parsear inputs de Gas
    let gasInput = null;
    let currentGasAnnual = 0;
    let clientGasConsumoAnual = 0;

    if (energyType === 'GAS' || energyType === 'DUAL') {
      const gasOther = parseFloat(document.getElementById('calc-gas-other-concepts').value || 0);
      gasInput = {
        dias: parseInt(document.getElementById('calc-gas-days').value),
        consumo: parseFloat(document.getElementById('calc-gas-consumption').value),
        alquiler: parseFloat(document.getElementById('calc-gas-meter').value || 0),
        impuestoHidrocarburos: parseFloat(document.getElementById('calc-gas-tax').value),
        iva: parseFloat(document.getElementById('calc-gas-vat').value),
        otherConcepts: gasOther
      };

      // Tarifa actual de Gas mock
      const currentTariffMock = {
        tipo_tarifa: document.getElementById('calc-gas-tariff-type').value,
        termino_fijo: parseFloat(document.getElementById('calc-gas-fixed-price').value || 0),
        termino_variable: parseFloat(document.getElementById('calc-gas-var-price').value || 0)
      };

      currentGasBillDetail = calculateGasBill(gasInput, currentTariffMock);
      currentGasAnnual = currentGasBillDetail.annual.total;

      clientGasConsumoAnual = gasInput.consumo * (365 / gasInput.dias);
    }

    // Actualizar resumen de gasto actual en pantalla
    const totalCurrentAnnual = currentLightAnnual + currentGasAnnual;
    document.getElementById('calc-current-annual-cost').innerText = `${totalCurrentAnnual.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

    // Inicializar temporales globales
    lastComparisonData = {
      companySnapshot,
      clientId: matchedClient.id,
      clientName,
      clientCups,
      energyType,
      lightInput,
      gasInput,
      bestLightTariff: null,
      bestGasTariff: null,
      currentLightCost: currentLightAnnual,
      currentLightCostDetail: currentLightBillDetail,
      currentGasCost: currentGasAnnual,
      currentGasCostDetail: currentGasBillDetail
    };

    // 3. Procesar propuestas de Luz
    let bestLightOption = null;
    if (energyType === 'LUZ' || energyType === 'DUAL') {
      document.getElementById('results-light-container').style.display = 'block';
      const is30td = document.getElementById('calc-light-tariff-type').value === '3.0TD';
      const allLightTariffs = await getTarifasLuz();
      if (!selectionIsCurrent()) return;
      
      // Filtrar propuestas
      const lightTariffs = allLightTariffs.filter(t => (t.tipo_tarifa || '2.0TD') === (is30td ? '3.0TD' : '2.0TD'));
      const lightResults = [];

      lightTariffs.forEach(tariff => {
        const proposedInput = { ...lightInput, otherConcepts: 0 };
        const costDetail = calculateLightBill(proposedInput, tariff);
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
      if (!selectionIsCurrent()) return;
      const gasTariffs = allGasTariffs.filter(t => (t.tipo_tarifa || 'RL.1') === gasTariffType);
      const gasResults = [];

      gasTariffs.forEach(tariff => {
        const proposedInput = { ...gasInput, otherConcepts: 0 };
        const costDetail = calculateGasBill(proposedInput, tariff);
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
      clientId: null,
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
    resetCalculatorSupplySelection();

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
                ? `Precios Pot: P1 ${formatPriceDecimals(item.tariff.potencia_p1/365)}, P2 ${formatPriceDecimals(item.tariff.potencia_p2/365)}, P3 ${formatPriceDecimals((item.tariff.potencia_p3 || 0)/365)}, P4 ${formatPriceDecimals((item.tariff.potencia_p4 || 0)/365)}, P5 ${formatPriceDecimals((item.tariff.potencia_p5 || 0)/365)}, P6 ${formatPriceDecimals((item.tariff.potencia_p6 || 0)/365)} €/kW/día<br>
                   Precios Ene: P1 ${formatPriceDecimals(item.tariff.energia_p1)}, P2 ${formatPriceDecimals(item.tariff.energia_p2)}, P3 ${formatPriceDecimals(item.tariff.energia_p3)}, P4 ${formatPriceDecimals(item.tariff.energia_p4 || 0)}, P5 ${formatPriceDecimals(item.tariff.energia_p5 || 0)}, P6 ${formatPriceDecimals(item.tariff.energia_p6 || 0)} €/kWh${item.tariff.excedente ? `<br><span class="text-success" style="font-weight: 500;">Excedente: ${formatPriceDecimals(item.tariff.excedente)} €/kWh</span>` : ''}`
                : `Precios Pot: P1 ${formatPriceDecimals(item.tariff.potencia_p1/365)} €/kW/día, P2 ${formatPriceDecimals(item.tariff.potencia_p2/365)} €/kW/día<br>
                   Precios Ene: P1 ${formatPriceDecimals(item.tariff.energia_p1)}, P2 ${formatPriceDecimals(item.tariff.energia_p2)}, P3 ${formatPriceDecimals(item.tariff.energia_p3)} €/kWh${item.tariff.excedente ? `<br><span class="text-success" style="font-weight: 500;">Excedente: ${formatPriceDecimals(item.tariff.excedente)} €/kWh</span>` : ''}`
                )
              : `Término Fijo: ${formatPriceDecimals(item.tariff.termino_fijo)} €/mes, Término Variable: ${formatPriceDecimals(item.tariff.termino_variable)} €/kWh`
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
      companySnapshot: lastComparisonData.companySnapshot,
      lightInput: lastComparisonData.lightInput,
      gasInput: lastComparisonData.gasInput,
      currentLightCost: lastComparisonData.currentLightCost,
      currentLightCostDetail: lastComparisonData.currentLightCostDetail,
      currentGasCost: lastComparisonData.currentGasCost,
      currentGasCostDetail: lastComparisonData.currentGasCostDetail,
      proposedTariffSnapshot: item.tariff,
      proposedCostDetail: item.costDetail
    };

    let tarifaLuzId = null;
    let ahorroLuz = 0;
    let tarifaGasId = null;
    let ahorroGas = 0;
    let comisionTotal = 0;

    if (type === 'LUZ') {
      tarifaLuzId = item.tariff?.id || null;
      ahorroLuz = item.ahorro || 0;
      comisionTotal = item.tariff?.resolvedComision !== undefined ? item.tariff.resolvedComision : (item.tariff?.comision || 0);
    } else if (type === 'GAS') {
      tarifaGasId = item.tariff?.id || null;
      ahorroGas = item.ahorro || 0;
      comisionTotal = item.tariff?.resolvedComision !== undefined ? item.tariff.resolvedComision : (item.tariff?.comision || 0);
    } else if (type === 'DUAL') {
      tarifaLuzId = item.tariffLuz?.id || item.lightTariff?.id || item.tariff?.id || null;
      ahorroLuz = item.ahorroLuz || 0;
      tarifaGasId = item.tariffGas?.id || item.gasTariff?.id || null;
      ahorroGas = item.ahorroGas || 0;
      comisionTotal = (item.comisionLuz || 0) + (item.comisionGas || 0);
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
      comisionTotal,
      lastComparisonData.clientId
    );

    buttonEl.innerHTML = `
      <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      Comparativa Guardada
    `;
    buttonEl.classList.add('m3-btn-tertiary');
    
    showToast("Comparativa guardada correctamente en el historial.", "success");

    // Disparar evento para que la vista del historial se actualice
    emitAppEvent(APP_EVENTS.COMPARISON_SAVED);
  } catch (error) {
    buttonEl.disabled = false;
    buttonEl.innerHTML = 'Guardar Comparativa';
    const errMsg = error?.message || (typeof error === 'string' ? error : 'Error al guardar la comparativa');
    showToast(`Error al guardar la comparativa en el historial: ${errMsg}`, "error");
    console.error("Error al guardar comparativa:", error);
  }
}

// --- Exportación a PDF ---
async function exportPDF(item, type, previewMode = false) {
  const reportData = {
    companySnapshot: lastComparisonData.companySnapshot,
    clientName: lastComparisonData.clientName,
    clientCups: lastComparisonData.clientCups,
    energyType: type,
    currentCost: type === 'LUZ' ? lastComparisonData.currentLightCost : lastComparisonData.currentGasCost,
    currentCostDetail: type === 'LUZ' ? lastComparisonData.currentLightCostDetail : lastComparisonData.currentGasCostDetail,
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
    showToast("Error al generar el PDF.", "error");
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

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null && val !== '') {
    el.value = val;
  }
}

/**
 * Precarga automáticamente los datos del cliente, CUPS, suministro y consumos anteriores de una renovación.
 * @param {Object} ren Objeto de la renovación.
 */
export async function prefillCalculatorForRenewal(ren) {
  if (!ren) return false;

  const nameInput = document.getElementById('calc-client-name');
  const formContainer = document.getElementById('calc-form-container');
  const modifyBtn = document.getElementById('calc-modify-btn');

  if (formContainer) formContainer.style.display = 'block';
  if (modifyBtn) modifyBtn.style.display = 'none';
  resetCalculatorSupplySelection();
  nameInput.value = ren.cliente_nombre || '';
  const loadingVersion = calculatorSelectionVersion;
  try {
    const clients = await getClientes();
    if (loadingVersion !== calculatorSelectionVersion) return false;
    const client = ren.cliente_id != null ? clients.find(client => client.id === ren.cliente_id)
      : clients.find(client => client.nombre_empresa.toLowerCase() === nameInput.value.toLowerCase());
    if (!client) {
      showToast('El cliente de origen ya no está registrado. Selecciona un cliente de la lista.', 'warning');
      return false;
    }
    const selected = await selectCalculatorClient(client, {
      cups: ren.cups, tipo_energia: String(ren.tipo_energia || '').toUpperCase().includes('GAS') ? 'GAS' : 'LUZ'
    });
    if (!selected) return false;
  } catch (error) {
    showToast('No se pudieron cargar los datos del cliente en el comparador.', 'error');
    return false;
  }
  const prefillVersion = calculatorSelectionVersion;

  // Intentar recuperar los consumos anteriores de este cliente desde el historial
  try {
    const history = await getComparativas();
    if (prefillVersion !== calculatorSelectionVersion) return false;
    const match = history.find(c => ren.cups
      ? normalizeCups(c.cliente_cups) === normalizeCups(ren.cups)
      : c.cliente_nombre?.toLowerCase() === ren.cliente_nombre?.toLowerCase());

    if (match && match.datos_cliente_json) {
      const parsed = typeof match.datos_cliente_json === 'string' ? JSON.parse(match.datos_cliente_json) : match.datos_cliente_json;
      
      // Precargar datos de luz
      if (parsed.lightInput) {
        const li = parsed.lightInput;
        if (li.tariffType) {
          const ltSelect = document.getElementById('calc-light-tariff-type');
          if (ltSelect) {
            ltSelect.value = li.tariffType;
            ltSelect.dispatchEvent(new Event('change'));
          }
        }
        setInputValue('calc-light-days', li.days);
        setInputValue('calc-light-p1-pot', li.p1Pot);
        setInputValue('calc-light-p2-pot', li.p2Pot);
        setInputValue('calc-light-p3-pot', li.p3Pot);
        setInputValue('calc-light-p4-pot', li.p4Pot);
        setInputValue('calc-light-p5-pot', li.p5Pot);
        setInputValue('calc-light-p6-pot', li.p6Pot);

        setInputValue('calc-light-p1-cons', li.p1Cons);
        setInputValue('calc-light-p2-cons', li.p2Cons);
        setInputValue('calc-light-p3-cons', li.p3Cons);
        setInputValue('calc-light-p4-cons', li.p4Cons);
        setInputValue('calc-light-p5-cons', li.p5Cons);
        setInputValue('calc-light-p6-cons', li.p6Cons);

        setInputValue('calc-light-p1-pot-price', li.p1PotPrice);
        setInputValue('calc-light-p2-pot-price', li.p2PotPrice);
        setInputValue('calc-light-p1-ene-price', li.p1EnePrice);
        setInputValue('calc-light-p2-ene-price', li.p2EnePrice);
        setInputValue('calc-light-p3-ene-price', li.p3EnePrice);
      }

      // Precargar datos de gas
      if (parsed.gasInput) {
        const gi = parsed.gasInput;
        if (gi.tariffType) {
          const gtSelect = document.getElementById('calc-gas-tariff-type');
          if (gtSelect) {
            gtSelect.value = gi.tariffType;
            gtSelect.dispatchEvent(new Event('change'));
          }
        }
        setInputValue('calc-gas-days', gi.days);
        setInputValue('calc-gas-annual-cons', gi.annualConsumption);
        setInputValue('calc-gas-monthly-cons', gi.monthlyCons);
        setInputValue('calc-gas-fixed-price', gi.fixedPrice);
        setInputValue('calc-gas-variable-price', gi.variablePrice);
      }
    }
  } catch (eHistory) {
    console.warn("No se pudieron restaurar consumos anteriores del historial:", eHistory);
  }
  if (prefillVersion !== calculatorSelectionVersion) return false;

  setTimeout(() => {
    if (prefillVersion !== calculatorSelectionVersion) return;
    nameInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nameInput?.focus();
  }, 100);

  showToast(`⚡ Datos de ${ren.cliente_nombre} autocompletados en el comparador.`, "success");
  return true;
}

/**
 * Precarga los datos de una comparativa rechazada por scoring en la calculadora y ejecuta la comparativa
 * para mostrar el listado completo de ofertas alternativas.
 * @param {Object} comp Objeto de la comparativa.
 */
export async function relaunchComparisonForScoring(comp) {
  if (!comp) return;

  // 1. Navegar a la sección del comparador
  const navCalc = document.querySelector('[data-section="calculator"]');
  if (navCalc) navCalc.click();

  // 2. Usar prefillCalculatorForRenewal con el formato adecuado
  const mockRen = {
    cliente_nombre: comp.cliente_nombre,
    cups: comp.cliente_cups,
    tipo_energia: comp.tipo_energia
  };

  if (!await prefillCalculatorForRenewal(mockRen)) return;
  const relaunchVersion = calculatorSelectionVersion;

  // 3. Ejecutar cálculo para mostrar el listado completo de tarifas alternativas
  setTimeout(() => {
    if (relaunchVersion !== calculatorSelectionVersion) return;
    const calcBtn = document.getElementById('calc-submit-btn');
    if (calcBtn) {
      calcBtn.click();
    }
  }, 200);

  showToast(`Datos de ${comp.cliente_nombre || 'cliente'} cargados. Elige una tarifa alternativa del listado completo.`, "info");
}

