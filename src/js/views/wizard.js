/* src/js/views/wizard.js */
import { loadBackupConfig } from './backup.js';
import { saveCompanyConfig, saveCompanyLogo } from '../db.js';

export async function initWizard() {
  const wizardOverlay = document.getElementById('dialog-welcome-wizard');
  const form = document.getElementById('wizard-form');

  const step1 = document.getElementById('wizard-step-1');
  const step2 = document.getElementById('wizard-step-2');
  const stepChip = document.getElementById('wizard-step-chip');
  const stepTitle = document.getElementById('wizard-step-title');

  const nextBtn = document.getElementById('wizard-next-step-btn');
  const backBtn = document.getElementById('wizard-back-step-btn');
  const browseBtn = document.getElementById('wizard-backup-browse-btn');
  const pathInput = document.getElementById('wizard-backup-path-input');

  if (!wizardOverlay) return;

  // Cargar ruta por defecto al iniciar
  let defaultBackupPath = '';
  let customSelectedParent = '';

  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    try {
      defaultBackupPath = await window.__TAURI__.core.invoke('get_default_backup_path');
    } catch (err) {
      console.error("Error al obtener ruta por defecto:", err);
    }
  } else {
    defaultBackupPath = "C:\\Users\\Usuario\\Comparetica_backups";
  }

  if (pathInput) pathInput.value = defaultBackupPath;

  // Evento "Examinar..." para opción personalizada
  if (browseBtn) {
    browseBtn.addEventListener('click', async () => {
      if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
        window.showToast("La selección de carpetas solo está disponible en la versión de escritorio.", "info");
        return;
      }

      try {
        const selectedParent = await window.__TAURI__.core.invoke('select_backup_directory');
        if (selectedParent) {
          customSelectedParent = selectedParent;
          if (pathInput) pathInput.value = `${selectedParent}\\Comparetica_backups`;
        }
      } catch (err) {
        if (err !== "Cancelado por el usuario") {
          window.showToast(`Error al seleccionar carpeta: ${err}`, "error");
        }
      }
    });
  }

  // Transición Paso 1 -> Paso 2
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const name = document.getElementById('wizard-company-name').value.trim();
      const email = document.getElementById('wizard-company-email').value.trim();
      const phone = document.getElementById('wizard-company-phone').value.trim();

      if (!name) {
        window.showToast("El Nombre de la Consultora es obligatorio.", "error");
        document.getElementById('wizard-company-name').focus();
        return;
      }

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

      if (step1 && step2) {
        step1.style.display = 'none';
        step2.style.display = 'block';
        if (stepChip) stepChip.textContent = 'Paso 2 de 2';
        if (stepTitle) stepTitle.textContent = 'Ubicación de Copias de Seguridad';
      }
    });
  }

  // Transición Paso 2 -> Paso 1
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (step1 && step2) {
        step2.style.display = 'none';
        step1.style.display = 'block';
        if (stepChip) stepChip.textContent = 'Paso 1 de 2';
        if (stepTitle) stepTitle.textContent = 'Datos de tu Consultora Energética';
      }
    });
  }

  // Comprobar si es el primer arranque
  const isFirstRunCompleted = localStorage.getItem('first_run_completed');
  if (!isFirstRunCompleted) {
    wizardOverlay.classList.add('active');
  }

  // Envío final del formulario (Paso 2 Submit)
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('wizard-company-name').value.trim();
      const street = document.getElementById('wizard-company-street').value.trim();
      const number = document.getElementById('wizard-company-number').value.trim();
      const cp = document.getElementById('wizard-company-cp').value.trim();
      const city = document.getElementById('wizard-company-city').value.trim();
      const province = document.getElementById('wizard-company-province').value.trim();
      const web = document.getElementById('wizard-company-web').value.trim();
      const email = document.getElementById('wizard-company-email').value.trim();
      const phone = document.getElementById('wizard-company-phone').value.trim();
      const logoInput = document.getElementById('wizard-company-logo');

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
        const submitBtn = document.getElementById('wizard-submit-btn');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerText = "Configurando...";
        }

        // 1. Guardar Configuración de Texto
        await saveCompanyConfig(configData);

        if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
          // Configurar directorio de copias de seguridad (renombrando existente si corresponde)
          const parentArg = customSelectedParent ? customSelectedParent : null;
          await window.__TAURI__.core.invoke('setup_backup_directory', { parentPath: parentArg });

          // Refrescar inmediatamente la vista de backup
          await loadBackupConfig();
        }

        // 2. Guardar Logotipo si se ha subido
        if (logoInput && logoInput.files && logoInput.files[0]) {
          const file = logoInput.files[0];
          const extension = file.name.split('.').pop().toLowerCase();
          
          const base64Data = await fileToBase64(file);
          const logoDataUri = `data:image/${extension === 'svg' ? 'svg+xml' : extension};base64,${base64Data}`;

          await saveCompanyLogo(logoDataUri);

          if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
            try {
              await window.__TAURI__.core.invoke('save_company_logo', { base64Data, extension });
            } catch (errLogo) {
              console.warn("No se pudo guardar logotipo en backend:", errLogo);
            }
          }
        }

        // Finalizar primer inicio
        localStorage.setItem('first_run_completed', 'true');
        wizardOverlay.classList.remove('active');
        window.showToast("Configuración inicial completada correctamente.", "success");

        // Disparar la comprobación del Comercial Principal
        try {
          const { ensureInitialAgentFlow } = await import('./agents.js');
          await ensureInitialAgentFlow();
        } catch (errAgent) {
          console.error("Error al iniciar flujo de agente principal:", errAgent);
        }

      } catch (error) {
        console.error("Error al guardar la configuración inicial:", error);
        window.showToast(`Error al guardar la configuración: ${error}`, "error");
      } finally {
        const submitBtn = document.getElementById('wizard-submit-btn');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Finalizar Configuración 🚀";
        }
      }
    });
  }
}

// Convertir archivo a base64 (removiendo el header data:image/...)
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
