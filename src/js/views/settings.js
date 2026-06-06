/* src/js/views/settings.js */

import { clearAllTables } from '../db.js';

export function initSettingsView() {
  setupTabs();
  setupAppearance();
  setupCompanySettings();
  setupCleanup();
}

// --- Pestañas de Configuración ---
function setupTabs() {
  const tabs = [
    { btn: 'tab-btn-settings-appearance', panel: 'panel-settings-appearance' },
    { btn: 'tab-btn-settings-company', panel: 'panel-settings-company' },
    { btn: 'tab-btn-settings-cleanup', panel: 'panel-settings-cleanup' }
  ];

  tabs.forEach(item => {
    const button = document.getElementById(item.btn);
    const panel = document.getElementById(item.panel);

    if (!button || !panel) return;

    button.addEventListener('click', () => {
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
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        await window.__TAURI__.core.invoke('factory_reset');
      }

      // 4. Mostrar Toast y Recargar ventana para reiniciar en limpio
      window.showToast("Aplicación restablecida con éxito. Recargando...", "success");
      setTimeout(() => {
        window.location.reload();
      }, 1500);
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
      if (!confirm("¿Estás seguro de que deseas eliminar tu logotipo personalizado y usar la bombilla por defecto?")) {
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

  // Helper para cargar y pintar datos actuales en los inputs
  async function loadCurrentCompanyData() {
    let config = {};
    let logoDataUri = null;

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
    document.getElementById('settings-company-name').value = config.consultora_nombre || '';
    document.getElementById('settings-company-street').value = config.consultora_calle || '';
    document.getElementById('settings-company-number').value = config.consultora_numero || '';
    document.getElementById('settings-company-cp').value = config.consultora_cp || '';
    document.getElementById('settings-company-city').value = config.consultora_ciudad || '';
    document.getElementById('settings-company-province').value = config.consultora_provincia || '';
    document.getElementById('settings-company-web').value = config.consultora_web || '';
    document.getElementById('settings-company-email').value = config.consultora_email || '';
    document.getElementById('settings-company-phone').value = config.consultora_telefono || '';

    // Pintar preview
    if (logoPreview) {
      if (logoDataUri) {
        logoPreview.innerHTML = `<img src="${logoDataUri}" style="width: 100%; height: 100%; object-fit: contain;" />`;
      } else {
        logoPreview.innerHTML = `<span class="text-muted" style="font-size: 9px; text-align: center; padding: 4px;">Bombilla (Defecto)</span>`;
      }
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
