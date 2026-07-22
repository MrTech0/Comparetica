/* src/js/views/settings.js */

import { clearAllTables, getSqliteVersion, changeMasterPassword } from '../db.js';
import { initCsvImporter } from '../csv_importer.js';

export function initSettingsView() {
  setupTabs();
  setupAppearance();
  setupCompanySettings();
  initCsvImporter();
  setupSecuritySettings();
  setupCleanup();
  setupUpdates();
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
      if (item.btn === 'tab-btn-settings-company') {
        await loadCurrentCompanyData();
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

      window.showToast(`Paleta de color cambiada a: ${btn.innerText.trim()}`, "success");
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
      window.showToast("La nueva contraseña debe tener al menos 6 caracteres.", "error");
      return;
    }

    if (newPass !== confirmPass) {
      window.showToast("La nueva contraseña y la confirmación no coinciden.", "error");
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

      window.showToast("¡Contraseña Maestra actualizada y nueva clave generada!", "success");
    } catch (err) {
      window.showToast("Error al cambiar la contraseña. Verifica tu contraseña actual.", "error");
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
        window.showToast("¡Nueva clave de recuperación copiada al portapapeles!", "success");
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

        if (window.__TAURI__) {
          const pdfDataUri = doc.output('datauristring');
          const base64Data = pdfDataUri.split(',')[1];
          const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);

          try {
            const savedPath = await invoke('save_pdf', {
              filename: "Comparetica_NUEVA_Clave_Recuperacion.pdf",
              base64Data: base64Data
            });
            window.showToast(`📄 PDF de nueva clave guardado en: ${savedPath}`, 'success');
          } catch (err) {
            if (err !== "Cancelado por el usuario") {
              window.showToast(`Error al guardar PDF: ${err}`, 'error');
            }
          }
        } else {
          doc.save("Comparetica_NUEVA_Clave_Recuperacion.pdf");
          window.showToast("📄 PDF descargado con éxito.", "success");
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
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        msg = await window.__TAURI__.core.invoke('factory_reset');
      }

      // 4. Mostrar Toast y Recargar o Reiniciar
      if (msg === "DEV_MODE") {
        window.showToast("Aplicación restablecida con éxito. Recargando...", "success");
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else if (msg) {
        window.showToast(msg, "success");
        // El proceso nativo se reiniciará automáticamente, no necesitamos hacer reload()
      } else {
        window.showToast("Aplicación restablecida con éxito. Recargando...", "success");
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Error al restablecer la aplicación:", error);
      submitBtn.disabled = false;
      submitBtn.innerText = "Sí, borrar todo";
      window.showToast("Error al inicializar la aplicación.", "error");
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
        window.showToast("El formato del correo electrónico no es válido.", "error");
        return;
      }
    }

    if (phone) {
      const phoneRegex = /^\+?[0-9\s\-]{9,15}$/;
      if (!phoneRegex.test(phone)) {
        window.showToast("El formato del teléfono no es válido (debe tener entre 9 y 15 dígitos).", "error");
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
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        await window.__TAURI__.core.invoke('save_company_config', { config: configData });
      } else {
        localStorage.setItem('company_config', JSON.stringify(configData));
      }

      // 2. Guardar Logotipo si se ha seleccionado uno nuevo
      if (logoInput && logoInput.files && logoInput.files[0]) {
        const file = logoInput.files[0];
        const extension = file.name.split('.').pop().toLowerCase();
        const base64Data = await fileToBase64(file);

        if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
          await window.__TAURI__.core.invoke('save_company_logo', { base64Data, extension });
        } else {
          localStorage.setItem('company_logo', `data:image/${extension === 'svg' ? 'svg+xml' : extension};base64,${base64Data}`);
        }
      }

      window.showToast("Configuración de la consultora guardada correctamente.", "success");
      await loadCurrentCompanyData(); // Refrescar vista previa

    } catch (error) {
      console.error("Error al guardar la configuración de la consultora:", error);
      window.showToast("Error al guardar los datos de configuración.", "error");
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
      if (!await window.showConfirm("¿Estás seguro de que deseas eliminar tu logotipo personalizado y usar la bombilla por defecto?", "Borrar Logotipo Personalizado")) {
        return;
      }

      try {
        if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
          await window.__TAURI__.core.invoke('delete_company_logo');
        } else {
          localStorage.removeItem('company_logo');
        }
        
        logoInput.value = ''; // Limpiar input file
        window.showToast("Logotipo eliminado con éxito. Ahora se usará el icono por defecto.", "success");
        await loadCurrentCompanyData(); // Refrescar vista previa
      } catch (error) {
        console.error("Error al eliminar el logotipo:", error);
        window.showToast("Error al eliminar el logotipo personalizado.", "error");
      }
    });
  }
}

// Exportar función para refrescar la configuración al navegar
export async function refreshCompanySettings() {
  await loadCurrentCompanyData();
}

// Helper para cargar y pintar datos actuales en los inputs
async function loadCurrentCompanyData() {
  let config = {};
  let logoDataUri = null;
  const logoPreview = document.getElementById('settings-company-logo-preview');

  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    try {
      config = await window.__TAURI__.core.invoke('get_company_config');
      logoDataUri = await window.__TAURI__.core.invoke('get_company_logo');
    } catch (e) {
      console.error(e);
    }
  } else {
    try {
      config = JSON.parse(localStorage.getItem('company_config') || '{}');
      logoDataUri = localStorage.getItem('company_logo');
    } catch (e) {
      console.error(e);
    }
  }

  // Llenar inputs
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

  // Pintar preview
  if (logoPreview) {
    if (logoDataUri) {
      logoPreview.innerHTML = `<img src="${logoDataUri}" style="width: 100%; height: 100%; object-fit: contain;" />`;
    } else {
      logoPreview.innerHTML = `<span class="text-muted" style="font-size: 9px; text-align: center; padding: 4px;">Bombilla (Defecto)</span>`;
    }
  }
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
        window.showToast("El servicio de actualizaciones solo está disponible dentro de la aplicación instalada.", "info");
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

            window.showToast("Instalación completada. Reiniciando...", "success");
            setTimeout(async () => {
              if (window.__TAURI__ && window.__TAURI__.core) {
                await window.__TAURI__.core.invoke('restart_app');
              }
            }, 1500);

          } catch (err) {
            console.error(err);
            window.showToast("Error al instalar la actualización.", "error");
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
      if (window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke('log_frontend_error', { error: `Manual check error: ${error.message || error.toString()}` }).catch(err => console.error(err));
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

  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    try {
      const info = await window.__TAURI__.core.invoke('get_about_info');
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

