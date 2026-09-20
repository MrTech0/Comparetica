/* src/js/pdf.js */
import { getCompanyConfig, getCompanyLogo } from './db.js';
import { formatPriceDecimals } from './calculator.js';
import { invoke } from './ipc.js';
import { showToast } from './ui.js';

/**
 * Solicita una contraseña para proteger el PDF exportado mediante un diálogo modal.
 * @returns {Promise<{cancelled: boolean, password: string|null}>}
 */
function promptPdfPassword() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog-pdf-password');
    const input = document.getElementById('pdf-password-input');
    const btnCancel = document.getElementById('btn-pdf-password-cancel');
    const btnSubmit = document.getElementById('btn-pdf-password-submit');

    if (!overlay || !input || !btnCancel || !btnSubmit) {
      resolve({ password: null });
      return;
    }

    input.value = '';

    const cleanListeners = () => {
      btnCancel.removeEventListener('click', onCancel);
      btnSubmit.removeEventListener('click', onSubmit);
      input.removeEventListener('keydown', onKeyDown);
      overlay.classList.remove('active');
    };

    const onCancel = () => {
      cleanListeners();
      resolve({ cancelled: true });
    };

    const onSubmit = () => {
      const password = input.value;
      cleanListeners();
      resolve({ password: password || null });
    };

    const onKeyDown = (e) => {
      if (e.key === 'Enter') {
        onSubmit();
      }
    };

    btnCancel.addEventListener('click', onCancel);
    btnSubmit.addEventListener('click', onSubmit);
    input.addEventListener('keydown', onKeyDown);

    overlay.classList.add('active');
    
    // Autoenfocar el input para mayor comodidad
    setTimeout(() => input.focus(), 100);
  });
}

/**
 * Genera y descarga un reporte ejecutivo estético en PDF con los resultados de la comparación.
 * @param {Object} data - Datos consolidados de la comparación.
 * @param {boolean} previewMode - Si se debe previsualizar en modal en lugar de guardar/descargar.
 */
export async function generatePDFReport(data, previewMode = false, returnBase64 = false) {
  let password = null;
  if (!previewMode) {
    const result = await promptPdfPassword();
    if (result.cancelled) {
      return null; // Cancelado por el usuario
    }
    password = result.password;
  }

  const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!jsPDFClass) {
    showToast("Error: No se ha cargado la librería jsPDF. No se puede generar el reporte.", "error");
    return;
  }

  // Cargar configuración de consultora y logotipo
  let config = {};
  let logoDataUri = null;

  try {
    config = await getCompanyConfig();
    logoDataUri = await getCompanyLogo();
  } catch (e) {
    console.error("Error al obtener la configuración de la consultora:", e);
  }

  const options = {
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  };

  if (password) {
    options.encryption = {
      userPassword: password,
      ownerPassword: password + '_owner',
      userPermissions: ['print', 'copy']
    };
  }

  const doc = new jsPDFClass(options);

  const primaryColor = [10, 62, 130];     // Azul elegante MD3
  const secondaryColor = [74, 91, 108];   // Gris azulado
  const successColor = [16, 124, 65];     // Verde éxito
  const errorColor = [186, 26, 26];       // Rojo error/actual
  const surfaceVariant = [240, 244, 248]; // Fondo gris suave

  // --- CONFIGURACIÓN DE PÁGINA Y FUENTES ---
  doc.setFont('helvetica');

  // --- CABECERA DE LA PÁGINA ---
  // Franja decorativa superior
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 0, 210, 15, 'F');

  // Cargar logotipo (SVG/AVIF/Bombilla) convertida a PNG
  const logoPng = await loadAndConvertLogo(logoDataUri);

  // Pintar logotipo en la cabecera
  if (logoPng) {
    try {
      doc.addImage(logoPng, 'PNG', 15, 18, 20, 20);
    } catch (e) {
      console.error("Error al insertar logotipo en el PDF:", e);
    }
  }

  // Título e Identidad
  const companyName = config.consultora_nombre || 'Comparetica';
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName, 38, 28);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('Estudio de Ahorro y Optimización Energética', 38, 34);

  // Fecha del informe
  const todayStr = new Date().toLocaleDateString('es-ES', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  doc.text(`Fecha: ${todayStr}`, 155, 28);
  const is30TD = data.energyType === 'LUZ' && data.tariffDetails && data.tariffDetails.tipo_tarifa === '3.0TD';
  let supplyText = data.energyType;
  if (is30TD) {
    supplyText += ' (3.0TD)';
  } else if (data.energyType === 'GAS' && data.tariffDetails && data.tariffDetails.tipo_tarifa) {
    supplyText += ` (${data.tariffDetails.tipo_tarifa})`;
  }
  doc.text(`Suministro: ${supplyText}`, 155, 34);

  // Línea divisoria de cabecera
  doc.setDrawColor(220, 225, 230);
  doc.setLineWidth(0.5);
  doc.line(15, 41, 195, 41);

  // --- DATOS DEL CLIENTE ---
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMACIÓN DEL CLIENTE', 15, 48);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);
  doc.text(`Cliente: ${data.clientName}`, 15, 54);
  doc.text(`CUPS: ${data.clientCups || 'No aportado'}`, 15, 59);
  doc.text(`Tarifa Propuesta: ${data.tariffDetails.comercializadora_nombre} - ${data.tariffDetails.nombre}`, 100, 54);
  doc.text(`Periodo simulado: ${data.inputDetails.dias} días (anualizado)`, 100, 59);

  // --- DASHBOARD DE RESUMEN (TARJETAS) ---
  // 1. Tarjeta Gasto Actual (Izquierda)
  doc.setFillColor(surfaceVariant[0], surfaceVariant[1], surfaceVariant[2]);
  doc.rect(15, 68, 85, 30, 'F');
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(errorColor[0], errorColor[1], errorColor[2]);
  doc.text('COSTO ESTIMADO ACTUAL', 20, 74);
  
  doc.setFontSize(18);
  doc.text(`${data.currentCost.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 20, 83);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('anuales (impuestos incl.)', 20, 89);

  // 2. Tarjeta Gasto Propuesto (Derecha)
  doc.setFillColor(surfaceVariant[0], surfaceVariant[1], surfaceVariant[2]);
  doc.rect(110, 68, 85, 30, 'F');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('COSTO PROPUESTO NUEVO', 115, 74);
  
  doc.setFontSize(18);
  doc.text(`${data.proposedCost.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 115, 83);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('anuales (impuestos incl.)', 115, 89);

  // 3. Tarjeta Ahorro Total / Costo Adicional (Centro)
  const isLoss = data.ahorro < 0;
  const cardBgColor = isLoss ? [254, 240, 240] : [224, 242, 230];
  const cardBorderColor = isLoss ? errorColor : successColor;
  const labelText = isLoss ? 'COSTO ADICIONAL ANUALIZADO:' : 'AHORRO NETO ANUALIZADO:';
  const displayVal = Math.abs(data.ahorro);
  const displayValMensual = displayVal / 12;

  doc.setFillColor(cardBgColor[0], cardBgColor[1], cardBgColor[2]);
  doc.rect(15, 103, 180, 20, 'F');
  doc.setDrawColor(cardBorderColor[0], cardBorderColor[1], cardBorderColor[2]);
  doc.setLineWidth(0.5);
  doc.rect(15, 103, 180, 20, 'S');

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(cardBorderColor[0], cardBorderColor[1], cardBorderColor[2]);
  doc.text(labelText, 22, 115);
  
  doc.setFontSize(18);
  doc.text(`${isLoss ? '+' : ''}${displayVal.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € / año`, 95, 116);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`(~ ${isLoss ? '+' : ''}${displayValMensual.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € al mes)`, 152, 115);

  // --- TABLA DE DESGLOSE TÉRMICO ---
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text('DESGLOSE DE CONCEPTOS ANUALIZADOS', 15, 134);

  // Dibujar cabecera de tabla
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(15, 139, 180, 8, 'F');

  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('Concepto Facturado', 18, 144);
  doc.text('Situación Actual', 80, 144);
  doc.text('Propuesta Sugerida', 120, 144);
  doc.text('Diferencia / Ahorro', 160, 144);

  let currentY = 147;
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'normal');

  // Insertar filas según el tipo de energía
  if (data.energyType === 'LUZ') {
    const details = data.costDetail.annual;
    const currentDetails = (data.currentCostDetail && data.currentCostDetail.annual) ? data.currentCostDetail.annual : null;
    const rows = [];

    // 1. Término de Potencia
    const potCur = currentDetails ? currentDetails.potenciaTotal : data.currentCost * 0.28;
    rows.push({
      name: is30TD ? 'Término de Potencia (P1-P6)' : 'Término de Potencia (Capacidad)',
      cur: potCur,
      prop: details.potenciaTotal
    });

    // 2. Término de Energía
    const eneCur = currentDetails ? currentDetails.energiaTotal : data.currentCost * 0.52;
    rows.push({
      name: is30TD ? 'Término de Energía (P1-P6)' : 'Término de Energía (Consumos P1/P2/P3)',
      cur: eneCur,
      prop: details.energiaTotal
    });

    // 3. Compensación de Excedentes
    if (details.excedenteDiscount && details.excedenteDiscount > 0) {
      const excCur = currentDetails ? (currentDetails.excedenteDiscount || 0) : 0;
      rows.push({
        name: 'Compensación de Excedentes',
        cur: -excCur,
        prop: -details.excedenteDiscount
      });
    }

    // 4. Descuento Bono Social
    if (details.bonoSocialDiscount && details.bonoSocialDiscount > 0) {
      const bsDiscCur = currentDetails ? (currentDetails.bonoSocialDiscount || 0) : 0;
      rows.push({
        name: 'Descuento Bono Social',
        cur: -bsDiscCur,
        prop: -details.bonoSocialDiscount
      });
    }

    // 5. Impuesto de Electricidad (IEE)
    const ieeCur = currentDetails ? currentDetails.iee : data.currentCost * 0.045;
    rows.push({
      name: 'Impuesto de Electricidad (IEE)',
      cur: ieeCur,
      prop: details.iee
    });

    // 6. Alquiler contador y Tasa bono social
    const alquBsCur = currentDetails ? (currentDetails.alquiler + currentDetails.bonoSocial) : data.currentCost * 0.015;
    rows.push({
      name: 'Alquiler contador y Tasa bono social',
      cur: alquBsCur,
      prop: details.alquiler + details.bonoSocial
    });

    // 7. Conceptos Especiales Opcionales (Mantenimiento, Reactiva)
    if (currentDetails) {
      if (currentDetails.otherConcepts && currentDetails.otherConcepts > 0) {
        rows.push({
          name: 'Mantenimientos y Otros Conceptos',
          cur: currentDetails.otherConcepts,
          prop: 0
        });
      }
      if (currentDetails.reactivePenalties && currentDetails.reactivePenalties > 0) {
        rows.push({
          name: 'Recargo Reactiva y Penalizaciones',
          cur: currentDetails.reactivePenalties,
          prop: currentDetails.reactivePenalties
        });
      }
    }

    // 8. IVA / IGIC
    const taxCur = currentDetails ? currentDetails.impuestos : data.currentCost * 0.14;
    rows.push({
      name: 'IVA / IGIC aplicable',
      cur: taxCur,
      prop: details.impuestos
    });

    rows.forEach(r => {
      currentY += 7;
      doc.setFillColor(248, 249, 250);
      doc.rect(15, currentY - 4.5, 180, 7, 'F');

      const diff = r.cur - r.prop;

      doc.setTextColor(30, 30, 30);
      doc.text(r.name, 18, currentY);
      doc.text(`${r.cur.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 80, currentY);
      doc.text(`${r.prop.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 120, currentY);
      
      if (diff > 0) {
        doc.setTextColor(successColor[0], successColor[1], successColor[2]);
        doc.text(`${diff.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 160, currentY);
      } else {
        doc.setTextColor(100, 100, 100);
        doc.text(`${diff.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 160, currentY);
      }
    });

  } else {
    // GAS
    const details = data.costDetail.annual;
    const currentDetails = (data.currentCostDetail && data.currentCostDetail.annual) ? data.currentCostDetail.annual : null;
    const rows = [];

    // 1. Término Fijo
    const fixedCur = currentDetails ? currentDetails.fijo : data.currentCost * 0.22;
    rows.push({
      name: 'Término Fijo (Mensualidad)',
      cur: fixedCur,
      prop: details.fijo
    });

    // 2. Término Variable
    const varCur = currentDetails ? currentDetails.variable : data.currentCost * 0.61;
    rows.push({
      name: 'Término Variable (Energía Gas)',
      cur: varCur,
      prop: details.variable
    });

    // 3. Impuesto sobre Hidrocarburos
    const hidCur = currentDetails ? currentDetails.hidrocarburos : data.currentCost * 0.02;
    rows.push({
      name: 'Impuesto sobre Hidrocarburos',
      cur: hidCur,
      prop: details.hidrocarburos
    });

    // 4. Alquiler Contador Gas
    const alquCur = currentDetails ? currentDetails.alquiler : data.currentCost * 0.01;
    rows.push({
      name: 'Alquiler de Contador Gas',
      cur: alquCur,
      prop: details.alquiler
    });

    // 5. Conceptos Opcionales (Mantenimiento)
    if (currentDetails && currentDetails.otherConcepts && currentDetails.otherConcepts > 0) {
      rows.push({
        name: 'Mantenimientos y Otros Conceptos',
        cur: currentDetails.otherConcepts,
        prop: 0
      });
    }

    // 6. IVA / IGIC
    const taxCur = currentDetails ? currentDetails.impuestos : data.currentCost * 0.14;
    rows.push({
      name: 'IVA / IGIC aplicable',
      cur: taxCur,
      prop: details.impuestos
    });

    rows.forEach(r => {
      currentY += 7;
      doc.setFillColor(248, 249, 250);
      doc.rect(15, currentY - 4.5, 180, 7, 'F');

      const diff = r.cur - r.prop;

      doc.setTextColor(30, 30, 30);
      doc.text(r.name, 18, currentY);
      doc.text(`${r.cur.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 80, currentY);
      doc.text(`${r.prop.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 120, currentY);
      
      if (diff > 0) {
        doc.setTextColor(successColor[0], successColor[1], successColor[2]);
        doc.text(`${diff.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 160, currentY);
      } else {
        doc.setTextColor(100, 100, 100);
        doc.text(`${diff.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 160, currentY);
      }
    });
  }

  // --- PRECIOS DE LA TARIFA PROPUESTA ---
  currentY += 10;
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('PRECIOS UNITARIOS DE LA TARIFA PROPUESTA', 15, currentY);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);
  if (data.energyType === 'LUZ') {
    if (is30TD) {
      const potStr1 = `Potencia P1-P3 (€/kW/día): P1: ${formatPriceDecimals(data.tariffDetails.potencia_p1 / 365)} | P2: ${formatPriceDecimals(data.tariffDetails.potencia_p2 / 365)} | P3: ${formatPriceDecimals((data.tariffDetails.potencia_p3 || 0) / 365)}`;
      const potStr2 = `Potencia P4-P6 (€/kW/día): P4: ${formatPriceDecimals((data.tariffDetails.potencia_p4 || 0) / 365)} | P5: ${formatPriceDecimals((data.tariffDetails.potencia_p5 || 0) / 365)} | P6: ${formatPriceDecimals((data.tariffDetails.potencia_p6 || 0) / 365)}`;
      const eneStr1 = `Energía P1-P3 (€/kWh):     P1: ${formatPriceDecimals(data.tariffDetails.energia_p1)} | P2: ${formatPriceDecimals(data.tariffDetails.energia_p2)} | P3: ${formatPriceDecimals(data.tariffDetails.energia_p3)}`;
      let eneStr2 = `Energía P4-P6 (€/kWh):     P4: ${formatPriceDecimals(data.tariffDetails.energia_p4 || 0)} | P5: ${formatPriceDecimals(data.tariffDetails.energia_p5 || 0)} | P6: ${formatPriceDecimals(data.tariffDetails.energia_p6 || 0)}`;
      if (data.tariffDetails.excedente !== undefined && data.tariffDetails.excedente > 0) {
        eneStr2 += ` | Excedente: ${formatPriceDecimals(data.tariffDetails.excedente)}`;
      }
      currentY += 5;
      doc.text(potStr1, 15, currentY);
      currentY += 4.5;
      doc.text(potStr2, 15, currentY);
      currentY += 4.5;
      doc.text(eneStr1, 15, currentY);
      currentY += 4.5;
      doc.text(eneStr2, 15, currentY);
    } else {
      const potStr = `Potencia (€/kW/día): P1: ${formatPriceDecimals(data.tariffDetails.potencia_p1 / 365)} | P2: ${formatPriceDecimals(data.tariffDetails.potencia_p2 / 365)}`;
      let eneStr = `Energía (€/kWh):     P1: ${formatPriceDecimals(data.tariffDetails.energia_p1)} | P2: ${formatPriceDecimals(data.tariffDetails.energia_p2)} | P3: ${formatPriceDecimals(data.tariffDetails.energia_p3)}`;
      if (data.tariffDetails.excedente !== undefined && data.tariffDetails.excedente > 0) {
        eneStr += ` | Excedente: ${formatPriceDecimals(data.tariffDetails.excedente)}`;
      }
      currentY += 5;
      doc.text(potStr, 15, currentY);
      currentY += 4.5;
      doc.text(eneStr, 15, currentY);
    }
  } else {
    const gasType = data.tariffDetails.tipo_tarifa || 'RL.1';
    const gasStr = `Peaje: ${gasType} | Término Fijo: ${formatPriceDecimals(data.tariffDetails.termino_fijo)} €/mes | Término Variable: ${formatPriceDecimals(data.tariffDetails.termino_variable)} €/kWh`;
    currentY += 5;
    doc.text(gasStr, 15, currentY);
  }

  // --- NOTAS LEGALES Y PRIVACIDAD ---
  currentY += 10;
  doc.setFontSize(8);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setFont('helvetica', 'normal');
  doc.text('Nota informativa:', 15, currentY);
  currentY += 4.5;
  doc.text('1. El presente documento es una estimación económica y comercial. No constituye un contrato vinculante.', 15, currentY);
  currentY += 4;
  doc.text('2. Las tarifas simuladas corresponden a precios vigentes facilitados por las comercializadoras en la fecha del reporte.', 15, currentY);
  currentY += 4;
  doc.text('3. Los consumos han sido anualizados de forma lineal, por lo que podrían variar ligeramente según los hábitos reales del cliente.', 15, currentY);
  currentY += 4;
  doc.text('4. El emisor y el software declinan toda responsabilidad por discrepancias. Valide precios finales con la comercializadora antes de contratar.', 15, currentY);

  // --- FIRMA Y FOOTER ---
  doc.line(15, 250, 195, 250);
  
  doc.setFontSize(7);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  
  const footerLines = [];
  if (config.consultora_nombre) {
    let line1 = `Documento preparado por: ${config.consultora_nombre}`;
    
    // Construir dirección a partir de los campos individuales
    const addressParts = [];
    if (config.consultora_calle) addressParts.push(config.consultora_calle);
    if (config.consultora_numero) addressParts.push(`Nº ${config.consultora_numero}`);
    if (config.consultora_cp) addressParts.push(config.consultora_cp);
    if (config.consultora_ciudad) addressParts.push(config.consultora_ciudad);
    if (config.consultora_provincia) addressParts.push(`(${config.consultora_provincia})`);
    
    const fullAddress = addressParts.join(', ');
    if (fullAddress) {
      line1 += ` | Dirección: ${fullAddress}`;
    }
    footerLines.push(line1);

    let line2 = "";
    if (config.consultora_telefono) line2 += `Tel: ${config.consultora_telefono}  `;
    if (config.consultora_email) line2 += `Email: ${config.consultora_email}  `;
    if (config.consultora_web) line2 += `Web: ${config.consultora_web}  `;
    if (line2.trim()) footerLines.push(line2.trim());
  } else {
    footerLines.push('Generado de forma automatizada por Comparetica App');
  }

  if (footerLines.length === 1) {
    doc.text(footerLines[0], 15, 256);
  } else if (footerLines.length === 2) {
    doc.text(footerLines[0], 15, 255);
    doc.text(footerLines[1], 15, 258);
  }

  doc.setFontSize(8);
  doc.text('Página 1 de 1', 180, 256);

  // Cláusula Informativa de Privacidad (RGPD)
  doc.setFontSize(6);
  doc.setTextColor(110, 120, 130);
  const privacyText = "Tratamiento de Datos (RGPD/LOPDGDD): Los datos personales de este estudio se tratan localmente por la consultora en calidad de Responsable del Tratamiento con la finalidad exclusiva de realizar esta propuesta. Puede ejercer sus derechos de acceso, rectificación, supresión y otros dirigiéndose a los datos de contacto del emisor indicados arriba.";
  const splitPrivacy = doc.splitTextToSize(privacyText, 180);
  doc.text(splitPrivacy, 15, 264);

  // Si está activo el modo previsualización, mostramos en modal
  if (previewMode) {
    try {
      const blob = doc.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      const previewDialog = document.getElementById('dialog-pdf-preview');
      const iframe = document.getElementById('pdf-preview-iframe');
      if (previewDialog && iframe) {
        iframe.src = blobUrl + '#toolbar=0&navpanes=0';
        previewDialog.classList.add('active');
      } else {
        window.open(blobUrl + '#toolbar=0&navpanes=0');
      }
    } catch (e) {
      console.error("Error al previsualizar el PDF:", e);
      showToast("Error al previsualizar el reporte.", "error");
    }
    return;
  }

  if (returnBase64) {
    return doc.output('datauristring').split(',')[1];
  }

  // Descarga el archivo
  const safeClientName = data.clientName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `comparativa_${safeClientName}.pdf`;

  if (typeof window !== 'undefined' && window.__TAURI__) {
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    try {
      const path = await invoke('save_pdf', { filename, base64Data: pdfBase64 });
      console.log(`Archivo PDF guardado correctamente en: ${path}`);
    } catch (err) {
      if (err !== "Cancelado por el usuario") {
        showToast("Error al guardar el PDF: " + err, "error");
      }
    }
  } else {
    doc.save(filename);
  }
}

// Convertir logotipo a canvas/PNG
function loadAndConvertLogo(logoDataUri) {
  return new Promise((resolve) => {
    if (!logoDataUri) {
      resolve(getDefaultLogoAsPng());
      return;
    }
    
    const img = new Image();
    img.src = logoDataUri;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 200;
      canvas.height = img.naturalHeight || 200;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      resolve(getDefaultLogoAsPng());
    };
  });
}

// Dibujar logotipo de bombilla por defecto en canvas 2D
function getDefaultLogoAsPng() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, 128, 128);
  
  // Dibujar círculo bombilla (amarillo suave)
  ctx.beginPath();
  ctx.arc(64, 52, 32, 0, Math.PI * 2);
  ctx.fillStyle = '#FFEB3B';
  ctx.fill();
  
  // Dibujar base (gris)
  ctx.beginPath();
  ctx.rect(52, 78, 24, 16);
  ctx.fillStyle = '#9E9E9E';
  ctx.fill();
  
  // Roscas
  ctx.fillStyle = '#757575';
  ctx.beginPath();
  ctx.rect(52, 83, 24, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.rect(52, 89, 24, 3);
  ctx.fill();
  
  // Filamento (naranja)
  ctx.beginPath();
  ctx.moveTo(56, 73);
  ctx.lineTo(60, 52);
  ctx.lineTo(68, 52);
  ctx.lineTo(72, 73);
  ctx.strokeStyle = '#FF9800';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  return canvas.toDataURL('image/png');
}

/**
 * Genera y descarga el Certificado Oficial de Bloqueo LOPD conforme al Art. 32 LOPDGDD y Art. 17.3 RGPD.
 * Se genera exclusivamente bajo demanda y se guarda mediante save_pdf nativo cifrado.
 * @param {Object} cliente - Objeto cliente con id, nombre_empresa, cif, bloqueado_en, bloqueado_hasta.
 * @param {Object} [companyConfig] - Configuración opcional de la consultora emisora.
 */
export async function generateLopdCertificatePdf(cliente, companyConfig = null) {
  if (!cliente) {
    showToast("Error: No se ha especificado ningún cliente para generar el certificado.", "error");
    return;
  }

  const jsPDFClass = (typeof window !== 'undefined' && ((window.jspdf && window.jspdf.jsPDF) || window.jsPDF)) || null;
  if (!jsPDFClass) {
    showToast("Error: No se ha cargado la librería jsPDF. No se puede generar el certificado.", "error");
    return;
  }

  let config = companyConfig;
  let logoDataUri = null;
  if (!config) {
    try {
      config = await getCompanyConfig();
    } catch (e) {
      config = {};
    }
  }
  try {
    logoDataUri = await getCompanyLogo();
  } catch (e) {}

  const doc = new jsPDFClass({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  doc.setFont('helvetica');

  // Colores institucionales
  const primaryColor = [10, 62, 130];
  const secondaryColor = [70, 80, 95];
  const cardBgColor = [246, 248, 252];
  const cardBorderColor = [205, 215, 228];

  // Franja decorativa superior
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 0, 210, 10, 'F');

  // Cabecera con logo y datos de la consultora emisora
  let startHeaderY = 16;
  if (typeof document !== 'undefined') {
    try {
      const logoPng = await loadAndConvertLogo(logoDataUri);
      if (logoPng) {
        doc.addImage(logoPng, 'PNG', 20, startHeaderY, 24, 20);
      }
    } catch (eLogo) {
      console.warn("No se pudo cargar el logo:", eLogo);
    }
  }

  const consultantName = (config && config.name) ? config.name : 'Comparetica Asesoría Energética';
  const consultantCif = (config && config.cif) ? `NIF/CIF: ${config.cif}` : '';
  const consultantEmail = (config && config.email) ? `Email: ${config.email}` : '';
  const consultantPhone = (config && config.phone) ? `Tel: ${config.phone}` : '';
  const consultantAddress = (config && config.address) ? config.address : '';

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(consultantName, 50, startHeaderY + 5);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 110, 120);
  const infoLine1 = [consultantCif, consultantPhone, consultantEmail].filter(Boolean).join('  |  ');
  if (infoLine1) doc.text(infoLine1, 50, startHeaderY + 11);
  if (consultantAddress) doc.text(consultantAddress, 50, startHeaderY + 16);

  // Línea divisoria cabecera
  doc.setDrawColor(220, 225, 235);
  doc.setLineWidth(0.5);
  doc.line(20, startHeaderY + 23, 190, startHeaderY + 23);

  // Título oficial
  const titleY = startHeaderY + 33;
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("CERTIFICADO OFICIAL DE BLOQUEO DE DATOS", 105, titleY, { align: 'center' });

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text("Garantía de Supresión Comercial y Conservación Restringida", 105, titleY + 5.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text("(Art. 32 Ley Orgánica 3/2018 - LOPDGDD y Art. 17.3 Reglamento General (UE) 2016/679 - RGPD)", 105, titleY + 10, { align: 'center' });

  // Recuadro de datos del cliente afectado
  const cardY = titleY + 14;
  const cardH = 34;
  doc.setFillColor(cardBgColor[0], cardBgColor[1], cardBgColor[2]);
  doc.setDrawColor(cardBorderColor[0], cardBorderColor[1], cardBorderColor[2]);
  doc.roundedRect(20, cardY, 170, cardH, 2.5, 2.5, 'FD');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text("DATOS DEL TITULAR / INTERESADO:", 25, cardY + 7);

  doc.setFontSize(8.5);
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.text("Razón Social / Nombre:", 25, cardY + 14);
  doc.setFont('helvetica', 'normal');
  doc.text(String(cliente.nombre_empresa || '-'), 68, cardY + 14);

  doc.setFont('helvetica', 'bold');
  doc.text("NIF / CIF:", 25, cardY + 20);
  doc.setFont('helvetica', 'normal');
  doc.text(String(cliente.cif || '-'), 68, cardY + 20);

  // Formato fechas
  const formatFecha = (f) => {
    if (!f) return '-';
    const d = new Date(f);
    if (isNaN(d.getTime())) return String(f);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  const fechaBloqueoStr = formatFecha(cliente.bloqueado_en || new Date());
  let fechaHasta = cliente.bloqueado_hasta;
  if (!fechaHasta && cliente.bloqueado_en) {
    const d = new Date(cliente.bloqueado_en);
    d.setFullYear(d.getFullYear() + 6);
    fechaHasta = d.toISOString().split('T')[0];
  }
  const fechaHastaStr = formatFecha(fechaHasta || new Date(Date.now() + 6 * 365.25 * 24 * 3600 * 1000));

  doc.setFont('helvetica', 'bold');
  doc.text("Fecha de Bloqueo Efectivo:", 25, cardY + 26);
  doc.setFont('helvetica', 'normal');
  doc.text(fechaBloqueoStr, 68, cardY + 26);

  doc.setFont('helvetica', 'bold');
  doc.text("Vencimiento Retención Legal:", 115, cardY + 26);
  doc.setFont('helvetica', 'normal');
  doc.text(fechaHastaStr, 163, cardY + 26);

  // Declaración formal / Certificación jurídica
  let textY = cardY + cardH + 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(35, 40, 45);

  const introText = `${consultantName}, en calidad de Responsable del Tratamiento de los datos, mediante la emisión del presente documento oficial, CERTIFICA formalmente:`;
  const splitIntro = doc.splitTextToSize(introText, 170);
  doc.text(splitIntro, 20, textY);
  textY += (splitIntro.length * 4.5) + 3;

  const points = [
    {
      num: "PRIMERO.- CESE Y BLOQUEO EFECTIVO.",
      body: `Con motivo del cese de la colaboración mercantil con la entidad y en fecha ${fechaBloqueoStr}, se ha aplicado la medida de BLOQUEO TÉCNICO de todos los datos identificativos y contractuales correspondientes al interesado en todos los registros activos del sistema informático.`
    },
    {
      num: "SEGUNDO.- EXCLUSIÓN COMERCIAL ABSOLUTA.",
      body: "En cumplimiento estricto del Artículo 32 de la Ley Orgánica 3/2018 (LOPDGDD), el bloqueo impide el tratamiento de los datos para fines operativos, comerciales, publicitarios o de elaboración de ofertas/comparativas tarifarias, asegurando que ningún usuario del sistema puede acceder a ellos para finalidades distintas de la mera custodia jurídica."
    },
    {
      num: "TERCERO.- CONSERVACIÓN POR OBLIGACIÓN LEGAL MERCANTIL Y TRIBUTARIA.",
      body: `De conformidad con el Artículo 17.3 apartados (b) y (e) del RGPD y el Artículo 30 del Código de Comercio, los datos derivados de relaciones contractuales perfeccionadas quedan legalmente retenidos durante el plazo preceptivo de prescripción de responsabilidades (6 años), hasta el ${fechaHastaStr}.`
    },
    {
      num: "CUARTO.- DISPONIBILIDAD EXCLUSIVA ANTE AUTORIDADES Y SUPRESIÓN POSTERIOR.",
      body: "Durante el período de bloqueo indicado, los datos permanecerán únicamente a disposición de Jueces y Tribunales, el Ministerio Fiscal o las Administraciones Públicas competentes (incluida la Agencia Española de Protección de Datos - AEPD). Una vez transcurrido íntegramente el período de retención legal, se ejecutará la destrucción y supresión irreversible definitiva de dichos registros."
    }
  ];

  points.forEach(p => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(p.num, 20, textY);
    textY += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(45, 50, 55);
    const splitBody = doc.splitTextToSize(p.body, 170);
    doc.text(splitBody, 20, textY);
    textY += (splitBody.length * 3.8) + 3.5;
  });

  // Bloque de Firma y Validez
  textY = Math.max(textY + 2, 236);

  const todayStr = formatFecha(new Date());
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 65, 70);
  doc.text(`Expedido y certificado a fecha: ${todayStr}`, 20, textY);

  textY += 7;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(`Por ${consultantName}:`, 20, textY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(110, 115, 125);
  doc.text("Firma y sello del Responsable del Tratamiento", 20, textY + 5);

  doc.setDrawColor(180, 190, 205);
  doc.setLineWidth(0.4);
  doc.line(20, textY + 24, 85, textY + 24);

  doc.setFontSize(7);
  doc.setTextColor(120, 125, 135);
  doc.text("Firma fehaciente / Sello de conformidad LOPDGDD", 20, textY + 28);

  // Pie de página con franja
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 292, 210, 5, 'F');

  // Guardar archivo mediante diálogo nativo o descarga
  const safeClient = (cliente.nombre_empresa || 'cliente').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const safeCif = (cliente.cif || 'nif').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `certificado_bloqueo_lopd_${safeClient}_${safeCif}.pdf`;

  if (typeof window !== 'undefined' && window.__TAURI__) {
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    try {
      const path = await invoke('save_pdf', { filename, base64Data: pdfBase64 });
      showToast("Certificado LOPD descargado con éxito.", "success");
      return path;
    } catch (err) {
      if (err !== "Cancelado por el usuario") {
        showToast("Error al guardar el Certificado LOPD: " + err, "error");
      }
      return null;
    }
  } else {
    doc.save(filename);
    showToast("Certificado LOPD descargado.", "success");
    return true;
  }
}

