/* src/js/views/wizard.js */

export function initWizard() {
  const wizardOverlay = document.getElementById('dialog-welcome-wizard');
  const step1 = document.getElementById('wizard-step-1');
  const step2 = document.getElementById('wizard-step-2');
  const nextBtn = document.getElementById('wizard-next-btn');
  const backBtn = document.getElementById('wizard-back-btn');
  const restoreBtn = document.getElementById('wizard-restore-btn');
  const form = document.getElementById('wizard-form');

  if (!wizardOverlay) return;

  // Comprobar si es el primer arranque
  const isFirstRunCompleted = localStorage.getItem('first_run_completed');
  if (!isFirstRunCompleted) {
    wizardOverlay.classList.add('active');
  }

  // Evento de restauración de copia de seguridad en el arranque
  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
        window.showToast("Las copias de seguridad nativas solo están disponibles ejecutando la aplicación de escritorio (Tauri).", "info");
        return;
      }

      const confirmRestore = await window.showConfirm(
        "¿Estás seguro de que deseas restaurar una copia de seguridad?\n\n" +
        "Esta acción eliminará de forma permanente TODOS tus datos locales actuales y los reemplazará por los del archivo de copia de seguridad.\n\n" +
        "La aplicación se REINICIARÁ automáticamente tras completarse la importación.",
        "Restaurar Copia de Seguridad"
      );

      if (!confirmRestore) return;

      try {
        restoreBtn.disabled = true;
        restoreBtn.innerText = "Restaurando...";

        const msg = await window.__TAURI__.core.invoke('import_backup');
        // Marcamos el primer arranque como completado para evitar que el wizard vuelva a salir tras reiniciar
        localStorage.setItem('first_run_completed', 'true');
        
        if (msg === "DEV_MODE") {
          window.showToast("Copia de seguridad restaurada. Recargando aplicación...", "success");
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          window.showToast(msg, "success");
        }
      } catch (error) {
        if (error !== "Cancelado por el usuario") {
          window.showToast(`Error al importar la copia de seguridad: ${error}`, "error");
        }
      } finally {
        restoreBtn.disabled = false;
        restoreBtn.innerText = "Restaurar Copia de Seguridad";
      }
    });
  }

  // Habilitar/deshabilitar botón Siguiente según aceptación de EULA
  const acceptEulaCheckbox = document.getElementById('wizard-accept-eula');
  if (acceptEulaCheckbox && nextBtn) {
    nextBtn.disabled = !acceptEulaCheckbox.checked;
    acceptEulaCheckbox.addEventListener('change', () => {
      nextBtn.disabled = !acceptEulaCheckbox.checked;
    });
  }

  // Eventos de navegación entre pasos
  if (nextBtn && step1 && step2) {
    nextBtn.addEventListener('click', () => {
      if (acceptEulaCheckbox && !acceptEulaCheckbox.checked) {
        window.showToast("Debe aceptar los términos de uso y descargo de responsabilidad para continuar.", "warning");
        return;
      }
      step1.style.display = 'none';
      step2.style.display = 'block';
    });
  }

  if (backBtn && step1 && step2) {
    backBtn.addEventListener('click', () => {
      step2.style.display = 'none';
      step1.style.display = 'block';
    });
  }

  // Envío del formulario
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

      // Validaciones de email y teléfono si se han rellenado
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          window.showToast("El formato del correo electrónico no es válido.", "error");
          return;
        }
      }

      if (phone) {
        // Permitir dígitos, espacios, guiones y un prefijo '+' inicial
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
          // Modo mock
          localStorage.setItem('company_config', JSON.stringify(configData));
        }

        // 2. Guardar Logotipo si se ha subido
        if (logoInput && logoInput.files && logoInput.files[0]) {
          const file = logoInput.files[0];
          const extension = file.name.split('.').pop().toLowerCase();
          
          const base64Data = await fileToBase64(file);

          if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
            await window.__TAURI__.core.invoke('save_company_logo', { base64Data, extension });
          } else {
            // Modo mock: guardar data URI en localStorage
            localStorage.setItem('company_logo', `data:image/${extension === 'svg' ? 'svg+xml' : extension};base64,${base64Data}`);
          }
        } else {
          // Si no se subió nada y estamos en modo de edición/re-guardado, podemos limpiar el logo si es necesario,
          // pero como es opcional y es la primera instalación, simplemente no guardamos logotipo y se usará el por defecto.
        }

        // Finalizar primer inicio
        localStorage.setItem('first_run_completed', 'true');
        wizardOverlay.classList.remove('active');
        window.showToast("Configuración guardada correctamente. ¡Bienvenido!", "success");

      } catch (error) {
        console.error("Error al guardar la configuración inicial:", error);
        window.showToast("Error al guardar los datos de configuración.", "error");
      } finally {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Finalizar y Guardar";
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
