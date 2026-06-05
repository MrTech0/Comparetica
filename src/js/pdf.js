/* src/js/pdf.js */

/**
 * Genera y descarga un reporte ejecutivo estético en PDF con los resultados de la comparación.
 * @param {Object} data - Datos consolidados de la comparación.
 * @param {boolean} previewMode - Si se debe previsualizar en modal en lugar de guardar/descargar.
 */
export function generatePDFReport(data, previewMode = false) {
  const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!jsPDFClass) {
    alert("Error: No se ha cargado la librería jsPDF. No se puede generar el reporte.");
    return;
  }
  const doc = new jsPDFClass({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

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

  // Título e Identidad
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.text('Comparetica', 15, 30);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.text('Estudio de Ahorro y Optimización Energética', 15, 35);

  // Fecha del informe
  const todayStr = new Date().toLocaleDateString('es-ES', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  doc.text(`Fecha: ${todayStr}`, 155, 30);
  doc.text(`Suministro: ${data.energyType}`, 155, 35);

  // Línea divisoria de cabecera
  doc.setDrawColor(220, 225, 230);
  doc.setLineWidth(0.5);
  doc.line(15, 40, 195, 40);

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
    // Asumimos prorratas proporcionales sencillas para la factura actual para comparación estética
    const rows = [
      { name: 'Término de Potencia (Capacidad)', cur: data.currentCost * 0.28, prop: details.potenciaTotal },
      { name: 'Término de Energía (Consumos P1/P2/P3)', cur: data.currentCost * 0.52, prop: details.energiaTotal },
      { name: 'Impuesto de Electricidad (IEE)', cur: data.currentCost * 0.045, prop: details.iee },
      { name: 'Alquiler de Medida y Bono Social', cur: data.currentCost * 0.015, prop: details.alquiler + details.bonoSocial },
      { name: 'IVA / IGIC aplicable', cur: data.currentCost * 0.14, prop: details.impuestos },
    ];

    rows.forEach(r => {
      currentY += 8;
      doc.setFillColor(248, 249, 250);
      doc.rect(15, currentY - 5, 180, 8, 'F');

      const diff = r.cur - r.prop;

      doc.setTextColor(30, 30, 30);
      doc.text(r.name, 18, currentY);
      doc.text(`${r.cur.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`, 80, currentY);
      doc.text(`${r.prop.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`, 120, currentY);
      
      if (diff > 0) {
        doc.setTextColor(successColor[0], successColor[1], successColor[2]);
        doc.text(`${diff.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`, 160, currentY);
      } else {
        doc.setTextColor(100, 100, 100);
        doc.text(`${diff.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`, 160, currentY);
      }
    });

  } else {
    // GAS RL.1
    const details = data.costDetail.annual;
    const rows = [
      { name: 'Término Fijo (Mensualidad)', cur: data.currentCost * 0.22, prop: details.fijo },
      { name: 'Término Variable (Energía Gas)', cur: data.currentCost * 0.61, prop: details.variable },
      { name: 'Impuesto sobre Hidrocarburos', cur: data.currentCost * 0.02, prop: details.hidrocarburos },
      { name: 'Alquiler de Contador Gas', cur: data.currentCost * 0.01, prop: details.alquiler },
      { name: 'IVA / IGIC aplicable', cur: data.currentCost * 0.14, prop: details.impuestos },
    ];

    rows.forEach(r => {
      currentY += 8;
      doc.setFillColor(248, 249, 250);
      doc.rect(15, currentY - 5, 180, 8, 'F');

      const diff = r.cur - r.prop;

      doc.setTextColor(30, 30, 30);
      doc.text(r.name, 18, currentY);
      doc.text(`${r.cur.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`, 80, currentY);
      doc.text(`${r.prop.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`, 120, currentY);
      
      if (diff > 0) {
        doc.setTextColor(successColor[0], successColor[1], successColor[2]);
        doc.text(`${diff.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`, 160, currentY);
      } else {
        doc.setTextColor(100, 100, 100);
        doc.text(`${diff.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €`, 160, currentY);
      }
    });
  }

  // --- NOTAS LEGALES Y PRIVACIDAD ---
  doc.setFontSize(8);
  doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setFont('helvetica', 'normal');
  doc.text('Nota informativa:', 15, 220);
  doc.text('1. El presente documento es una estimación económica y comercial. No constituye un contrato vinculante.', 15, 225);
  doc.text('2. Las tarifas simuladas corresponden a precios vigentes facilitados por las comercializadoras en la fecha del reporte.', 15, 229);
  doc.text('3. Los consumos han sido anualizados de forma lineal, por lo que podrían variar ligeramente según los hábitos reales del cliente.', 15, 233);

  // --- FIRMA Y FOOTER ---
  doc.line(15, 250, 195, 250);
  doc.text('Comparetica App', 15, 256);
  doc.text('Página 1 de 1', 180, 256);

  // Si está activo el modo previsualización, mostramos en modal
  if (previewMode) {
    try {
      const blob = doc.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      const previewDialog = document.getElementById('dialog-pdf-preview');
      const iframe = document.getElementById('pdf-preview-iframe');
      if (previewDialog && iframe) {
        iframe.src = blobUrl;
        previewDialog.classList.add('active');
      } else {
        window.open(blobUrl);
      }
    } catch (e) {
      console.error("Error al previsualizar el PDF:", e);
      alert("Error al previsualizar el reporte.");
    }
    return;
  }

  // Descarga el archivo
  const safeClientName = data.clientName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `comparativa_${safeClientName}.pdf`;

  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    window.__TAURI__.core.invoke('save_pdf', { filename, base64Data: pdfBase64 })
      .then(path => {
        console.log(`Archivo PDF guardado correctamente en: ${path}`);
      })
      .catch(err => {
        if (err !== "Cancelado por el usuario") {
          alert("Error al guardar el PDF: " + err);
        }
      });
  } else {
    doc.save(filename);
  }
}
