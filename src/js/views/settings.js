/* src/js/views/settings.js */

import {
  clearAllTables,
  getSqliteVersion,
  changeMasterPassword,
  getCompanyConfig,
  saveCompanyConfig,
  getCompanyLogo,
  saveCompanyLogo,
  deleteCompanyLogo,
  getRenewalThresholds,
  saveRenewalThresholds,
  getClientInactivityParams,
  saveClientInactivityParams
} from '../db.js';
import { initCsvImporter } from '../csv_importer.js';
import { invoke } from '../ipc.js';
import { showToast, showConfirm } from '../ui.js';

export async function initSettingsView() {
  setupTabs();
  setupAppearance();
  await setupCompanySettings();
  initCsvImporter();
  setupSecuritySettings();
  setupCleanup();
  setupUpdates();
  await setupRenewalParamsSettings();
  await setupClientInactivitySettings();
}

// --- Pestañas de Configuración ---
function setupTabs() {
  const tabs = [
    { btn: 'tab-btn-settings-appearance', panel: 'panel-settings-appearance' },
    { btn: 'tab-btn-settings-company', panel: 'panel-settings-company' },
    { btn: 'tab-btn-settings-import', panel: 'panel-settings-import' },
    { btn: 'tab-btn-settings-security', panel: 'panel-settings-security' },
    { btn: 'tab-btn-settings-updates', panel: 'panel-settings-updates' },
    { btn: 'tab-btn-settings-cleanup', panel: 'panel-settings-cleanup' },
    { btn: 'tab-btn-settings-params', panel: 'panel-settings-params' },
    { btn: 'tab-btn-settings-legal', panel: 'panel-settings-legal' },
    { btn: 'tab-btn-settings-about', panel: 'panel-settings-about' }
  ];

  tabs.forEach(item => {
    const button = document.getElementById(item.btn);
    const panel = document.getElementById(item.panel);

    if (!button || !panel) return;

    button.addEventListener('click', async () => {
      // Desactivar todos
      tabs.forEach(t => {
        const b = document.getElementById(t.btn);
        const p = document.getElementById(t.panel);
        if (b) b.classList.remove('active');
        if (p) {
          p.classList.remove('active');
          p.style.display = 'none';
        }
      });

      // Activar actual
      button.classList.add('active');
      panel.classList.add('active');
      panel.style.display = 'block';

      // Recargar datos si corresponde
      if (item.btn === 'tab-btn-settings-company' || item.btn === 'tab-btn-settings-params') {
        await loadSettings();
      } else if (item.btn === 'tab-btn-settings-about') {
        await loadAboutInfo();
      }
    });
  });
}

// --- Control de Apariencia ---
function setupAppearance() {
  // Cargar color inicial guardado
  const savedColor = localStorage.getItem('color_theme') || 'blue';
  document.documentElement.setAttribute('data-color-theme', savedColor);

  // Escuchar botones de color
  const colorButtons = document.querySelectorAll('.color-theme-btn');
  colorButtons.forEach(btn => {
    // Resaltar el seleccionado
    const colorCode = btn.getAttribute('data-theme-color');
    if (colorCode === savedColor) {
      btn.style.boxShadow = '0 0 0 3px var(--color-outline)';
    }

    btn.addEventListener('click', () => {
      const selectedColor = btn.getAttribute('data-theme-color');
      
      // Aplicar tema de color en HTML
      document.documentElement.setAttribute('data-color-theme', selectedColor);
      localStorage.setItem('color_theme', selectedColor);

      // Actualizar bordes de selección
      colorButtons.forEach(b => {
        if (b.getAttribute('data-theme-color') === selectedColor) {
          b.style.boxShadow = '0 0 0 3px var(--color-outline)';
        } else {
          b.style.boxShadow = 'none';
        }
      });

      showToast(`Paleta de color cambiada a: ${btn.innerText.trim()}`, "success");
    });
  });
}

// --- Control de Seguridad y Cambio de Contraseña ---
function setupSecuritySettings() {
  const form = document.getElementById('settings-security-form');
  const dialog = document.getElementById('dialog-settings-new-key');
  const displayKeyInput = document.getElementById('settings-display-new-key');
  const btnCopy = document.getElementById('btn-settings-copy-new-key');
  const btnPdf = document.getElementById('btn-settings-download-new-pdf');
  const btnClose = document.getElementById('btn-settings-close-new-key');

  if (!form) return;

  let latestNewKey = "";

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPass = document.getElementById('settings-current-password').value;
    const newPass = document.getElementById('settings-new-password').value;
    const confirmPass = document.getElementById('settings-new-password-confirm').value;

    if (newPass.length < 6) {
      showToast("La nueva contraseña debe tener al menos 6 caracteres.", "error");
      return;
    }

    if (newPass !== confirmPass) {
      showToast("La nueva contraseña y la confirmación no coinciden.", "error");
      return;
    }

    const btn = document.getElementById('btn-save-security');
    const originalHtml = btn ? btn.innerHTML : '';

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-sm"></span> Cifrando con nueva clave...`;
      }

      const newRecoveryKey = await changeMasterPassword(currentPass, newPass);
      latestNewKey = newRecoveryKey;
      form.reset();

      if (displayKeyInput) displayKeyInput.value = newRecoveryKey;
      if (dialog) dialog.classList.add('active');

      showToast("¡Contraseña Maestra actualizada y nueva clave generada!", "success");
    } catch (err) {
      showToast("Error al cambiar la contraseña. Verifica tu contraseña actual.", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }
  });

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      if (latestNewKey) {
        navigator.clipboard.writeText(latestNewKey);
        showToast("¡Nueva clave de recuperación copiada al portapapeles!", "success");
      }
    });
  }

  if (btnPdf) {
    btnPdf.addEventListener('click', async () => {
      if (latestNewKey && window.jspdf) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(20);
        doc.setTextColor(26, 115, 232);
        doc.text("Comparetica - NUEVA Clave de Recuperación de Emergencia", 15, 20);

        doc.setFontSize(11);
        doc.setTextColor(80, 80, 80);
        doc.text("Documento Oficial de Respaldo de Seguridad (RGPD / LOPDGDD)", 15, 28);
        doc.setLineWidth(0.5);
        doc.setDrawColor(200, 200, 200);
        doc.line(15, 32, 195, 32);

        doc.setFontSize(12);
        doc.setTextColor(40, 40, 40);
        doc.text("Esta NUEVA clave de recuperación reemplaza e invalida cualquier clave anterior.", 15, 45);
        doc.text("Guarda esta hoja impresa en un lugar seguro.", 15, 52);

        doc.setFillColor(245, 247, 250);
        doc.setDrawColor(26, 115, 232);
        doc.roundedRect(15, 65, 180, 30, 3, 3, 'FD');

        doc.setFontSize(18);
        doc.setFont("courier", "bold");
        doc.setTextColor(26, 115, 232);
        doc.text(latestNewKey, 105, 83, { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text("Fecha de actualización: " + new Date().toLocaleString('es-ES'), 15, 110);
        doc.text("Comparetica - Sistema de Cifrado de Datos B2B", 15, 116);

        if (typeof window !== 'undefined' && window.__TAURI__) {
          const pdfDataUri = doc.output('datauristring');
          const base64Data = pdfDataUri.split(',')[1];

          try {
            const savedPath = await invoke('save_pdf', {
              filename: "Comparetica_NUEVA_Clave_Recuperacion.pdf",
              base64Data: base64Data
            });
            showToast(`📄 PDF de nueva clave guardado en: ${savedPath}`, 'success');
          } catch (err) {
            if (err !== "Cancelado por el usuario") {
              showToast(`Error al guardar PDF: ${err}`, 'error');
            }
          }
        } else {
          doc.save("Comparetica_NUEVA_Clave_Recuperacion.pdf");
          showToast("📄 PDF descargado con éxito.", "success");
        }
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      if (dialog) dialog.classList.remove('active');
    });
  }
}

// --- Control de Limpieza / Factory Reset ---
function setupCleanup() {
  const resetBtn = document.getElementById('factory-reset-btn');
  
  // Modales
  const confirmModal1 = document.getElementById('dialog-reset-confirm');
  const confirmModal2 = document.getElementById('dialog-reset-confirm-2');
  
  // Elementos Modal 1
  const closeBtn1 = document.getElementById('dialog-reset-close');
  const nextBtn1 = document.getElementById('dialog-reset-next');
  const confirmInput = document.getElementById('reset-confirm-input');
  
  // Elementos Modal 2
  const closeBtn2 = document.getElementById('dialog-reset-close-2');
  const submitBtn = document.getElementById('dialog-reset-submit');

  if (!resetBtn || !confirmModal1 || !confirmModal2) return;

  // Abrir Modal 1
  resetBtn.addEventListener('click', () => {
    confirmInput.value = '';
    nextBtn1.disabled = true;
    confirmModal1.classList.add('active');
  });

  // Cancelar Modal 1
  closeBtn1.addEventListener('click', () => {
    confirmModal1.classList.remove('active');
  });

  // Validar texto "BORRAR" en Modal 1
  confirmInput.addEventListener('input', (e) => {
    const text = e.target.value.trim().toUpperCase();
    nextBtn1.disabled = text !== 'BORRAR';
  });

  // Avanzar a Modal 2
  nextBtn1.addEventListener('click', () => {
    confirmModal1.classList.remove('active');
    confirmModal2.classList.add('active');
  });

  // Cancelar Modal 2
  closeBtn2.addEventListener('click', () => {
    confirmModal2.classList.remove('active');
  });

  // Confirmar y Ejecutar Borrado Total
  submitBtn.addEventListener('click', async () => {
    try {
      submitBtn.disabled = true;
      submitBtn.innerText = "Restableciendo...";

      // 1. Borrar base de datos SQLite en frontend (borrar tablas)
      await clearAllTables();

      // 2. Limpiar todo el localStorage
      localStorage.clear();

      // 3. Ejecutar comando Rust (borrar config y logos)
      let msg = "";
      if (typeof window !== 'undefined' && window.__TAURI__) {
        try {
          msg = await invoke('factory_reset');
        } catch (e) {
          console.error(e);
        }
      }

      // 4. Mostrar Toast y Recargar o Reiniciar
      if (msg === "DEV_MODE") {
        showToast("Aplicación restablecida con éxito. Recargando...", "success");
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else if (msg) {
        showToast(msg, "success");
        // El proceso nativo se reiniciará automáticamente, no necesitamos hacer reload()
      } else {
        showToast("Aplicación restablecida con éxito. Recargando...", "success");
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Error al restablecer la aplicación:", error);
      submitBtn.disabled = false;
      submitBtn.innerText = "Sí, borrar todo";
      showToast("Error al inicializar la aplicación.", "error");
      confirmModal2.classList.remove('active');
    }
  });
}

// --- Control de Datos de Consultora ---
async function setupCompanySettings() {
  const form = document.getElementById('settings-company-form');
  const logoInput = document.getElementById('settings-company-logo');
  const logoPreview = document.getElementById('settings-company-logo-preview');
  const clearLogoBtn = document.getElementById('settings-company-logo-clear-btn');

  if (!form) return;

  // Cargar datos actuales
  await loadCurrentCompanyData();

  // Escuchar envío del formulario
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('settings-company-name').value.trim();
    const street = document.getElementById('settings-company-street').value.trim();
    const number = document.getElementById('settings-company-number').value.trim();
    const cp = document.getElementById('settings-company-cp').value.trim();
    const city = document.getElementById('settings-company-city').value.trim();
    const province = document.getElementById('settings-company-province').value.trim();
    const web = document.getElementById('settings-company-web').value.trim();
    const email = document.getElementById('settings-company-email').value.trim();
    const phone = document.getElementById('settings-company-phone').value.trim();

    // Validaciones
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        showToast("El formato del correo electrónico no es válido.", "error");
        return;
      }
    }

    if (phone) {
      const phoneRegex = /^\+?[0-9\s\-]{9,15}$/;
      if (!phoneRegex.test(phone)) {
        showToast("El formato del teléfono no es válido (debe tener entre 9 y 15 dígitos).", "error");
        return;
      }
    }

    const configData = {
      consultora_nombre: name,
      consultora_calle: street,
      consultora_numero: number,
      consultora_cp: cp,
      consultora_ciudad: city,
      consultora_provincia: province,
      consultora_web: web,
      consultora_email: email,
      consultora_telefono: phone
    };

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerText = "Guardando...";

      // 1. Guardar Configuración de Texto
      await saveCompanyConfig(configData);

      // 2. Guardar Logotipo si se ha seleccionado uno nuevo
      if (logoInput && logoInput.files && logoInput.files[0]) {
        const file = logoInput.files[0];
        const extension = file.name.split('.').pop().toLowerCase();
        const base64Data = await fileToBase64(file);
        const dataUri = `data:image/${extension === 'svg' ? 'svg+xml' : extension};base64,${base64Data}`;

        await saveCompanyLogo(dataUri);

        if (typeof window !== 'undefined' && window.__TAURI__) {
          try {
            await invoke('save_company_logo', { base64Data, extension });
          } catch (errLogo) {
            console.warn("No se pudo invocar save_company_logo en backend:", errLogo);
          }
        }
      }

      showToast("Configuración de la consultora guardada correctamente.", "success");
      await loadSettings(); // Refrescar vista previa

    } catch (error) {
      console.error("Error al guardar la configuración de la consultora:", error);
      showToast("Error al guardar los datos de configuración.", "error");
    } finally {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = "Guardar Datos de Consultora";
      }
    }
  });

  // Limpiar logotipo personalizado
  if (clearLogoBtn) {
    clearLogoBtn.addEventListener('click', async () => {
      if (!await showConfirm("¿Estás seguro de que deseas eliminar tu logotipo personalizado y usar la bombilla por defecto?", "Borrar Logotipo Personalizado")) {
        return;
      }

      try {
        await deleteCompanyLogo();
        
        logoInput.value = ''; // Limpiar input file
        showToast("Logotipo eliminado con éxito. Ahora se usará el icono por defecto.", "success");
        await loadSettings(); // Refrescar vista previa
      } catch (error) {
        console.error("Error al eliminar el logotipo:", error);
        showToast("Error al eliminar el logotipo personalizado.", "error");
      }
    });
  }
}

// Exportar función para refrescar la configuración al navegar
export async function refreshCompanySettings() {
  await loadSettings();
}

/**
 * Carga la configuración de empresa, logotipo y umbrales de renovación desde SQLite cifrada.
 */
export async function loadSettings() {
  let config = {};
  let logoDataUri = null;
  let thresholds = { critical: 30, warning: 60, radar: 90 };

  try {
    config = await getCompanyConfig();
  } catch (e) {
    console.error("Error al cargar company_config:", e);
  }

  try {
    logoDataUri = await getCompanyLogo();
  } catch (e) {
    console.error("Error al cargar company_logo:", e);
  }

  try {
    thresholds = await getRenewalThresholds();
  } catch (e) {
    console.error("Error al cargar renewal_thresholds:", e);
  }

  // Llenar inputs de empresa
  const nameInput = document.getElementById('settings-company-name');
  const streetInput = document.getElementById('settings-company-street');
  const numberInput = document.getElementById('settings-company-number');
  const cpInput = document.getElementById('settings-company-cp');
  const cityInput = document.getElementById('settings-company-city');
  const provinceInput = document.getElementById('settings-company-province');
  const webInput = document.getElementById('settings-company-web');
  const emailInput = document.getElementById('settings-company-email');
  const phoneInput = document.getElementById('settings-company-phone');

  if (nameInput) nameInput.value = config.consultora_nombre || '';
  if (streetInput) streetInput.value = config.consultora_calle || '';
  if (numberInput) numberInput.value = config.consultora_numero || '';
  if (cpInput) cpInput.value = config.consultora_cp || '';
  if (cityInput) cityInput.value = config.consultora_ciudad || '';
  if (provinceInput) provinceInput.value = config.consultora_provincia || '';
  if (webInput) webInput.value = config.consultora_web || '';
  if (emailInput) emailInput.value = config.consultora_email || '';
  if (phoneInput) phoneInput.value = config.consultora_telefono || '';

  // Pintar preview de logo
  const logoPreview = document.getElementById('settings-company-logo-preview');
  if (logoPreview) {
    if (logoDataUri) {
      logoPreview.innerHTML = `<img src="${logoDataUri}" style="width: 100%; height: 100%; object-fit: contain;" />`;
    } else {
      logoPreview.innerHTML = `<span class="text-muted" style="font-size: 9px; text-align: center; padding: 4px;">Bombilla (Defecto)</span>`;
    }
  }

  // Llenar inputs de umbrales de renovaciones
  const critInput = document.getElementById('settings-renewal-critical-days');
  const warnInput = document.getElementById('settings-renewal-warning-days');
  const radInput = document.getElementById('settings-renewal-radar-days');

  if (critInput) critInput.value = thresholds.critical;
  if (warnInput) warnInput.value = thresholds.warning;
  if (radInput) radInput.value = thresholds.radar;

  return { config, logo: logoDataUri, thresholds };
}

// Helper para compatibilidad interna
async function loadCurrentCompanyData() {
  await loadSettings();
}

// Convertir archivo a base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result;
      const base64Index = result.indexOf(';base64,') + 8;
      if (base64Index > 7) {
        resolve(result.substring(base64Index));
      } else {
        reject("Error al parsear base64");
      }
    };
    reader.onerror = error => reject(error);
  });
}

// --- Control de Actualizaciones ---
function setupUpdates() {
  const versionSpan = document.getElementById('update-current-version');
  const autoUpdateCheckbox = document.getElementById('settings-auto-update-checkbox');
  const checkBtn = document.getElementById('settings-check-update-btn');

  const statusCard = document.getElementById('settings-update-status-card');
  const statusTitle = document.getElementById('settings-update-status-title');
  const statusDesc = document.getElementById('settings-update-status-desc');
  const progressContainer = document.getElementById('settings-update-progress-container');
  const progressBar = document.getElementById('settings-update-progress-bar');
  const actionsContainer = document.getElementById('settings-update-actions');

  if (versionSpan) {
    if (window.__TAURI__ && window.__TAURI__.app) {
      window.__TAURI__.app.getVersion().then(v => {
        versionSpan.textContent = v;
      }).catch(e => {
        console.error(e);
        versionSpan.textContent = '0.1.5';
      });
    } else {
      versionSpan.textContent = '0.1.5';
    }
  }

  if (autoUpdateCheckbox) {
    const isAuto = localStorage.getItem('auto_update_enabled') !== 'false';
    autoUpdateCheckbox.checked = isAuto;
    autoUpdateCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('auto_update_enabled', e.target.checked.toString());
    });
  }

  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      runCheckUpdate(true);
    });
  }

  async function runCheckUpdate(manual = false) {
    const updater = window.__TAURI__ ? (window.__TAURI__.updater || window.__TAURI__.plugin?.updater || window.__TAURI__.pluginUpdater) : null;
    if (!updater) {
      if (manual) {
        showToast("El servicio de actualizaciones solo está disponible dentro de la aplicación instalada.", "info");
      }
      return;
    }

    if (statusCard) {
      statusCard.style.display = 'block';
      statusTitle.textContent = "Buscando actualizaciones...";
      statusDesc.textContent = "Conectando con el servidor de actualizaciones en GitHub...";
      progressContainer.style.display = 'none';
      actionsContainer.innerHTML = '';
    }

    try {
      const update = await updater.check();

      if (update) {
        // Nueva versión encontrada
        statusTitle.textContent = "¡Actualización Disponible!";
        statusTitle.style.color = "var(--color-primary)";
        statusDesc.textContent = `Versión: v${update.version}\nPublicada el: ${new Date(update.date).toLocaleDateString('es-ES')}\n\nNotas de versión:\n${update.body || 'Sin notas de versión.'}`;
        
        actionsContainer.innerHTML = '';
        const installBtn = document.createElement('button');
        installBtn.className = 'm3-btn';
        installBtn.textContent = 'Descargar e Instalar';
        
        installBtn.addEventListener('click', async () => {
          installBtn.disabled = true;
          installBtn.textContent = 'Descargando...';
          progressContainer.style.display = 'block';
          progressBar.style.width = '0%';

          try {
            let downloaded = 0;
            let contentLength = 0;

            await update.downloadAndInstall((event) => {
              switch (event.event) {
                case 'Started':
                  contentLength = event.data.contentLength || 0;
                  break;
                case 'Progress':
                  downloaded += event.data.chunkLength;
                  if (contentLength > 0) {
                    const percent = Math.round((downloaded / contentLength) * 100);
                    progressBar.style.width = `${percent}%`;
                  }
                  break;
                case 'Finished':
                  progressBar.style.width = '100%';
                  break;
              }
            });

            showToast("Instalación completada. Reiniciando...", "success");
            setTimeout(async () => {
              if (typeof window !== 'undefined' && window.__TAURI__) {
                await invoke('restart_app');
              }
            }, 1500);

          } catch (err) {
            console.error(err);
            showToast("Error al instalar la actualización.", "error");
            statusTitle.textContent = "Error de Instalación";
            statusTitle.style.color = "var(--color-error)";
            statusDesc.textContent = err.toString();
            installBtn.disabled = false;
            installBtn.textContent = 'Reintentar Descarga';
          }
        });

        actionsContainer.appendChild(installBtn);

      } else {
        // Ya está actualizado
        statusTitle.textContent = "Aplicación al Día";
        statusTitle.style.color = "var(--color-tertiary)";
        statusDesc.textContent = "Ya tienes instalada la última versión disponible de Comparetica.";
        actionsContainer.innerHTML = '';
      }
    } catch (error) {
      console.error(error);
      if (typeof window !== 'undefined' && window.__TAURI__) {
        invoke('log_frontend_error', { error: `Manual check error: ${error.message || error.toString()}` }).catch(err => console.error(err));
      }
      statusTitle.textContent = "Error de Conexión";
      statusTitle.style.color = "var(--color-error)";
      statusDesc.textContent = `No se pudo conectar con el servidor de actualizaciones: ${error.message || error.toString() || 'Error desconocido'}\n\nPor favor, compruebe su conexión a internet.`;
      actionsContainer.innerHTML = '';
    }
  }
}

async function loadAboutInfo() {
  const appVersionEl = document.getElementById('about-app-version');
  const nodeVersionEl = document.getElementById('about-node-version');
  const rustVersionEl = document.getElementById('about-rust-version');
  const tauriVersionEl = document.getElementById('about-tauri-version');
  const sqliteVersionEl = document.getElementById('about-sqlite-version');
  const jspdfVersionEl = document.getElementById('about-jspdf-version');

  // Obtener versión de jsPDF de forma dinámica
  const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  const jspdfVersion = jsPDFClass ? (jsPDFClass.version || 'Desconocida') : 'No cargado';
  if (jspdfVersionEl) jspdfVersionEl.textContent = jspdfVersion;

  // Obtener versión de SQLite de forma dinámica
  const sqliteVersion = await getSqliteVersion();
  if (sqliteVersionEl) sqliteVersionEl.textContent = sqliteVersion;

  if (typeof window !== 'undefined' && window.__TAURI__) {
    try {
      const info = await invoke('get_about_info');
      if (appVersionEl) appVersionEl.textContent = info.app_version || 'Desconocida';
      if (nodeVersionEl) nodeVersionEl.textContent = info.node_version || 'No instalado';
      if (rustVersionEl) rustVersionEl.textContent = info.rust_version || 'No instalado';
      if (tauriVersionEl) tauriVersionEl.textContent = info.tauri_version || 'Desconocida';
    } catch (err) {
      console.error("Error al obtener información de Acerca de:", err);
      if (appVersionEl) appVersionEl.textContent = 'Error';
      if (nodeVersionEl) nodeVersionEl.textContent = 'Error';
      if (rustVersionEl) rustVersionEl.textContent = 'Error';
      if (tauriVersionEl) tauriVersionEl.textContent = 'Error';
    }
  } else {
    // Fallback de navegador/desarrollo sin Tauri
    if (appVersionEl) appVersionEl.textContent = '0.2.1 (Navegador)';
    if (nodeVersionEl) nodeVersionEl.textContent = 'v18.16.0 (Simulado)';
    if (rustVersionEl) rustVersionEl.textContent = 'rustc 1.75.0 (Simulado)';
    if (tauriVersionEl) tauriVersionEl.textContent = '2.0.0 (Simulado)';
  }
}

async function setupRenewalParamsSettings() {
  const critInput = document.getElementById('settings-renewal-critical-days');
  const warnInput = document.getElementById('settings-renewal-warning-days');
  const radInput = document.getElementById('settings-renewal-radar-days');
  const btnSave = document.getElementById('btn-save-renewal-params');

  try {
    const thresholds = await getRenewalThresholds();
    if (critInput) critInput.value = thresholds.critical;
    if (warnInput) warnInput.value = thresholds.warning;
    if (radInput) radInput.value = thresholds.radar;
  } catch (e) {
    console.error("Error al cargar umbrales de renovación:", e);
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const critVal = parseInt(critInput?.value || '30', 10);
      const warnVal = parseInt(warnInput?.value || '60', 10);
      const radVal = parseInt(radInput?.value || '90', 10);

      await saveRenewalThresholds({ critical: critVal, warning: warnVal, radar: radVal });

      showToast("Parámetros y umbrales de renovación guardados con éxito.", "success");

      const { refreshRenewals } = await import('./renewals.js');
      await refreshRenewals();
    });
  }
}

async function setupClientInactivitySettings() {
  const newMonthsInput = document.getElementById('settings-client-inactive-new-months');
  const expiryDaysInput = document.getElementById('settings-client-inactive-expiry-days');
  const btnSave = document.getElementById('btn-save-client-inactivity-params');

  try {
    const params = await getClientInactivityParams();
    if (newMonthsInput) newMonthsInput.value = params.cliente_inactivo_meses_nuevo;
    if (expiryDaysInput) expiryDaysInput.value = params.cliente_inactivo_dias_vencimiento;
  } catch (e) {
    console.error("Error al cargar parámetros de inactividad de clientes:", e);
  }

  if (btnSave && !btnSave.dataset.listenerAdded) {
    btnSave.addEventListener('click', async () => {
      const mesesNuevo = parseInt(newMonthsInput?.value || '3', 10);
      const diasVencimiento = parseInt(expiryDaysInput?.value || '30', 10);

      if (isNaN(mesesNuevo) || mesesNuevo < 1) {
        showToast("Error: El plazo de meses para clientes nuevos debe ser mayor o igual a 1.", "error");
        return;
      }
      if (isNaN(diasVencimiento) || diasVencimiento < 1) {
        showToast("Error: El margen de días tras vencimiento debe ser mayor o igual a 1.", "error");
        return;
      }

      await saveClientInactivityParams({
        cliente_inactivo_meses_nuevo: mesesNuevo,
        cliente_inactivo_dias_vencimiento: diasVencimiento
      });

      showToast("Parámetros de inactividad de clientes guardados con éxito.", "success");
    });
    btnSave.dataset.listenerAdded = 'true';
  }
}

