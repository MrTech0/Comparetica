/* src/js/app.js */

import { getDb, purgeOldData } from './db.js';
import { initHomeView } from './views/home.js';
import { initCalculatorView } from './views/calculator_view.js';
import { initClientsView } from './views/clients.js';
import { initTariffsView, updateComercializadorasSelectors } from './views/tariffs.js';
import { initHistoryView } from './views/history.js';
import { initBackupView } from './views/backup.js';
import { initWizard } from './views/wizard.js';
import { initSettingsView, refreshCompanySettings } from './views/settings.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Inicializar la base de datos y esquema
  try {
    await getDb();
    console.log("Base de datos inicializada correctamente.");
    
    // Ejecutar purga de datos antiguos conforme a la política de retención legal
    try {
      await purgeOldData();
    } catch (err) {
      console.error("Error al ejecutar la purga automática:", err);
    }
  } catch (error) {
    console.error("Error crítico al inicializar la base de datos:", error);
  }

  // 2. Inicializar sistema de temas (Claro / Oscuro)
  initThemeSystem();

  // 3. Inicializar navegación entre vistas
  initNavigation();

  // 4. Inicializar control de Modo Privado
  initPrivateMode();

  // 5. Inicializar vistas hijas
  await initHomeView();
  await initClientsView();
  initCalculatorView();
  await initTariffsView();
  await initHistoryView();
  initBackupView();
  initPdfPreviewDialog();
  initWizard();
  initSettingsView();

  // Alimentar selectores dinámicos
  await updateComercializadorasSelectors();

  // Inicializar contraer/expandir barra lateral
  initSidebarCollapse();

  // Inicializar desplegables personalizados
  initCustomSelects();

  // Comprobar actualizaciones en segundo plano al iniciar
  initStartupUpdateCheck();
});

// --- PREVISUALIZACIÓN DE PDF GLOBAL ---
function initPdfPreviewDialog() {
  const closeBtn = document.getElementById('dialog-pdf-preview-close');
  const previewDialog = document.getElementById('dialog-pdf-preview');
  const iframe = document.getElementById('pdf-preview-iframe');
  if (closeBtn && previewDialog && iframe) {
    closeBtn.addEventListener('click', () => {
      if (iframe.src.startsWith('blob:')) {
        URL.revokeObjectURL(iframe.src);
      }
      iframe.src = '';
      previewDialog.classList.remove('active');
    });
  }
}

// --- SISTEMA DE TEMAS (Claro / Oscuro) ---
function initThemeSystem() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');

  // Determinar tema inicial
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  let currentTheme = 'light';
  if (savedTheme) {
    currentTheme = savedTheme;
  } else if (systemPrefersDark) {
    currentTheme = 'dark';
  }

  // Aplicar tema
  applyTheme(currentTheme);

  // Evento click
  themeToggleBtn.addEventListener('click', () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    if (theme === 'dark') {
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    } else {
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    }
  }
}

// --- NAVEGACIÓN ---
function initNavigation() {
  const navItems = [
    { btn: 'nav-home', section: 'section-home', title: 'Precio de la Energía (Hoy)' },
    { btn: 'nav-clients', section: 'section-clients', title: 'Gestión de Clientes' },
    { btn: 'nav-calculator', section: 'section-calculator', title: 'Comparador de Tarifas' },
    { btn: 'nav-tariffs', section: 'section-tariffs', title: 'Gestión de Tarifas y Comisiones' },
    { btn: 'nav-history', section: 'section-history', title: 'Historial de Comparativas' },
    { btn: 'nav-backup', section: 'section-backup', title: 'Copia de Seguridad' },
    { btn: 'nav-settings', section: 'section-settings', title: 'Configuración de la Aplicación' }
  ];

  const viewTitle = document.getElementById('view-title');

  navItems.forEach(item => {
    const button = document.getElementById(item.btn);
    if (!button) return;

    button.addEventListener('click', async () => {
      // Desactivar items anteriores
      navItems.forEach(i => {
        const btnEl = document.getElementById(i.btn);
        const sectEl = document.getElementById(i.section);
        if (btnEl) btnEl.classList.remove('active');
        if (sectEl) {
          sectEl.classList.remove('active');
          sectEl.style.display = 'none';
        }
      });

      // Activar actual
      button.classList.add('active');
      const section = document.getElementById(item.section);
      if (section) {
        section.classList.add('active');
        section.style.display = 'block';
      }
      
      // Actualizar título
      if (viewTitle) viewTitle.innerText = item.title;

      // Acciones especiales al cambiar de pestaña
      if (item.btn === 'nav-clients') {
        const clientsModule = await import('./views/clients.js');
        if (clientsModule && clientsModule.loadClientsTable) {
          await clientsModule.loadClientsTable();
        }
      } else if (item.btn === 'nav-tariffs') {
        // Recargar listas CRUD por si hubo cambios
        await updateComercializadorasSelectors();
      } else if (item.btn === 'nav-history') {
        // Disparar evento para refrescar historial
        window.dispatchEvent(new CustomEvent('comparison-saved'));
      } else if (item.btn === 'nav-settings') {
        // Recargar datos de la consultora por si se han actualizado
        await refreshCompanySettings();
      }
    });
  });
}

// --- MODO PRIVADO ---
function initPrivateMode() {
  const checkbox = document.getElementById('private-mode-checkbox');

  // Cargar estado inicial (por defecto activo)
  checkbox.checked = true;
  document.body.classList.add('private-mode-active');

  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      document.body.classList.add('private-mode-active');
    } else {
      document.body.classList.remove('private-mode-active');
    }
  });
}

// --- NOTIFICACIONES TOAST (Material 3) ---
window.showToast = function(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `m3-toast ${type}`;
  toast.innerText = message;

  container.appendChild(toast);

  // Auto-eliminar después de 4 segundos
  setTimeout(() => {
    toast.classList.add('m3-toast-fadeout');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
};

window.showActionToast = function(message, actions = []) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'm3-toast action-toast';

  const textSpan = document.createElement('span');
  textSpan.className = 'toast-text';
  textSpan.innerText = message;
  toast.appendChild(textSpan);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'toast-actions';

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.className = action.class || '';
    btn.innerText = action.text;
    btn.addEventListener('click', () => {
      if (action.callback) action.callback();
      toast.classList.add('m3-toast-fadeout');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    });
    actionsDiv.appendChild(btn);
  });

  toast.appendChild(actionsDiv);
  container.appendChild(toast);
};


/**
 * Muestra un diálogo de confirmación personalizado de Material Design 3.
 * @param {string} mensaje - Mensaje a mostrar.
 * @param {string} titulo - Título del diálogo.
 * @returns {Promise<boolean>} Devuelve una promesa que se resuelve a true si el usuario acepta, o false si cancela.
 */
window.showConfirm = function(mensaje, titulo = "Confirmación") {
  return new Promise((resolve) => {
    const overlay = document.getElementById('dialog-confirm');
    const titleEl = document.getElementById('dialog-confirm-title');
    const msgEl = document.getElementById('dialog-confirm-message');
    const btnCancel = document.getElementById('dialog-confirm-cancel');
    const btnAccept = document.getElementById('dialog-confirm-accept');

    if (!overlay || !titleEl || !msgEl || !btnCancel || !btnAccept) {
      // Fallback a confirm nativo si por alguna razón no se encuentra el HTML
      resolve(confirm(mensaje));
      return;
    }

    titleEl.innerText = titulo;
    msgEl.innerText = mensaje;

    // Clonar botones para limpiar cualquier event listener previo
    const cancelClone = btnCancel.cloneNode(true);
    const acceptClone = btnAccept.cloneNode(true);
    btnCancel.replaceWith(cancelClone);
    btnAccept.replaceWith(acceptClone);

    cancelClone.addEventListener('click', () => {
      overlay.classList.remove('active');
      resolve(false);
    });

    acceptClone.addEventListener('click', () => {
      overlay.classList.remove('active');
      resolve(true);
    });

    overlay.classList.add('active');
  });
};

// --- MATERIAL 3 CUSTOM STYLED SELECT DROPDOWNS ---
export function initCustomSelects() {
  window.initCustomSelects = initCustomSelects;
  const originalValueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (originalValueProp && !HTMLSelectElement.prototype._customValueHooked) {
    Object.defineProperty(HTMLSelectElement.prototype, 'value', {
      get: function() {
        return originalValueProp.get.call(this);
      },
      set: function(val) {
        originalValueProp.set.call(this, val);
        this.dispatchEvent(new CustomEvent('custom-value-set'));
      }
    });
    HTMLSelectElement.prototype._customValueHooked = true;
  }

  const nativeSelects = document.querySelectorAll('select.m3-select');
  nativeSelects.forEach(select => {
    if (select.dataset.customized) return;
    select.dataset.customized = 'true';
    
    select.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'm3-custom-select';
    if (select.classList.contains('m3-select-sm')) {
      wrapper.classList.add('m3-select-sm');
    }
    if (select.id) {
      wrapper.id = 'custom-select-for-' + select.id;
    }
    
    const trigger = document.createElement('div');
    trigger.className = 'm3-custom-select-trigger';
    
    const triggerText = document.createElement('span');
    const selectedOption = select.options[select.selectedIndex];
    triggerText.textContent = selectedOption ? selectedOption.textContent : '-- Seleccionar --';
    
    const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowSvg.setAttribute('class', 'm3-custom-select-arrow');
    arrowSvg.setAttribute('viewBox', '0 0 24 24');
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M7 10l5 5 5-5z');
    arrowSvg.appendChild(arrowPath);
    
    trigger.appendChild(triggerText);
    trigger.appendChild(arrowSvg);
    wrapper.appendChild(trigger);

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'm3-custom-select-options';
    wrapper.appendChild(optionsContainer);

    const populateOptions = () => {
      optionsContainer.innerHTML = '';
      Array.from(select.options).forEach(opt => {
        const optEl = document.createElement('div');
        optEl.className = 'm3-custom-select-option';
        if (opt.value === select.value) {
          optEl.classList.add('active');
        }
        optEl.textContent = opt.textContent;
        optEl.dataset.value = opt.value;

        optEl.addEventListener('click', (e) => {
          e.stopPropagation();
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.dispatchEvent(new Event('input', { bubbles: true }));
          wrapper.classList.remove('open');
        });

        optionsContainer.appendChild(optEl);
      });
      
      const currentSelected = select.options[select.selectedIndex];
      triggerText.textContent = currentSelected ? currentSelected.textContent : '-- Seleccionar --';
    };

    populateOptions();

    select.parentNode.insertBefore(wrapper, select.nextSibling);

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.m3-custom-select').forEach(cs => {
        if (cs !== wrapper) cs.classList.remove('open');
      });
      wrapper.classList.toggle('open');
    });

    select.addEventListener('custom-value-set', () => {
      populateOptions();
    });

    select.addEventListener('change', () => {
      populateOptions();
    });

    const form = select.form;
    if (form) {
      form.addEventListener('reset', () => {
        setTimeout(() => {
          populateOptions();
        }, 0);
      });
    }

    const observer = new MutationObserver(() => {
      populateOptions();
    });
    observer.observe(select, { childList: true, subtree: true });
  });
}

// Global click handler to close dropdowns when clicking outside
if (!window._customSelectGlobalInitialized) {
  document.addEventListener('click', () => {
    document.querySelectorAll('.m3-custom-select').forEach(cs => {
      cs.classList.remove('open');
    });
  });
  window._customSelectGlobalInitialized = true;
}

// --- COLLAPSIBLE SIDEBAR ---
function initSidebarCollapse() {
  const logoToggle = document.getElementById('sidebar-logo-toggle');
  const appContainer = document.getElementById('app-container');
  if (!logoToggle || !appContainer) return;

  // Load initial collapsed state from localStorage
  const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
  if (isCollapsed) {
    appContainer.classList.add('collapsed-sidebar');
    logoToggle.title = "Expandir Menú";
  } else {
    appContainer.classList.remove('collapsed-sidebar');
    logoToggle.title = "Contraer Menú";
  }

  logoToggle.addEventListener('click', () => {
    // Only toggle if on desktop (width >= 1024px)
    if (window.innerWidth < 1024) return;

    const currentlyCollapsed = appContainer.classList.toggle('collapsed-sidebar');
    localStorage.setItem('sidebar_collapsed', currentlyCollapsed);
  });
}

// --- COMPROBACIÓN DE ACTUALIZACIONES AL INICIAR ---
async function initStartupUpdateCheck() {
  if (!window.__TAURI__ || !window.__TAURI__.updater) {
    return; // Solo funciona dentro de Tauri
  }

  // 1. Verificar si la comprobación automática está activa
  const isAutoEnabled = localStorage.getItem('auto_update_enabled') !== 'false';
  if (!isAutoEnabled) return;

  // 2. Verificar si está pospuesta hoy
  const postponedUntil = localStorage.getItem('update_postponed_until');
  if (postponedUntil) {
    const now = Date.now();
    if (now < parseInt(postponedUntil)) {
      console.log("Comprobación de actualización pospuesta para hoy.");
      return;
    }
  }

  try {
    const updater = window.__TAURI__.updater;
    const update = await updater.check();

    if (update) {
      // Mostrar el diálogo de notificación de actualización
      const overlay = document.getElementById('dialog-update-alert');
      const msgEl = document.getElementById('dialog-update-alert-message');
      const btnClose = document.getElementById('dialog-update-alert-close');
      const btnPostpone = document.getElementById('dialog-update-alert-postpone');
      const btnAccept = document.getElementById('dialog-update-alert-accept');

      if (!overlay || !msgEl || !btnClose || !btnPostpone || !btnAccept) return;

      msgEl.innerText = `Hay una nueva versión disponible de Comparetica: v${update.version}\nPublicada el: ${new Date(update.date).toLocaleDateString('es-ES')}\n\nNotas de versión:\n${update.body || 'Sin detalles.'}\n\n¿Desea descargar e instalar la actualización ahora?\n(La aplicación se actualizará y reiniciará automáticamente).`;

      overlay.classList.add('active');

      // Limpiar listeners viejos clonando los botones
      const closeClone = btnClose.cloneNode(true);
      const postponeClone = btnPostpone.cloneNode(true);
      const acceptClone = btnAccept.cloneNode(true);
      btnClose.replaceWith(closeClone);
      btnPostpone.replaceWith(postponeClone);
      btnAccept.replaceWith(acceptClone);

      closeClone.addEventListener('click', () => {
        overlay.classList.remove('active');
      });

      postponeClone.addEventListener('click', () => {
        // Posponer por 1 día natural (24 horas)
        const oneDayMs = 24 * 60 * 60 * 1000;
        const postponedTime = Date.now() + oneDayMs;
        localStorage.setItem('update_postponed_until', postponedTime.toString());
        window.showToast("Actualización pospuesta durante 24 horas.", "info");
        overlay.classList.remove('active');
      });

      acceptClone.addEventListener('click', async () => {
        acceptClone.disabled = true;
        acceptClone.textContent = 'Descargando...';
        postponeClone.style.display = 'none';
        closeClone.style.display = 'none';

        try {
          await update.downloadAndInstall();
          window.showToast("Actualización instalada con éxito. Reiniciando...", "success");
          setTimeout(async () => {
            if (window.__TAURI__ && window.__TAURI__.core) {
              await window.__TAURI__.core.invoke('restart_app');
            }
          }, 1500);
        } catch (err) {
          console.error(err);
          window.showToast("Error al descargar e instalar la actualización.", "error");
          acceptClone.disabled = false;
          acceptClone.textContent = 'Reintentar';
          postponeClone.style.display = 'block';
          closeClone.style.display = 'block';
        }
      });
    }
  } catch (error) {
    console.error("Error al comprobar actualizaciones al iniciar:", error);
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('log_frontend_error', { error: `Startup check error: ${error.message || error.toString()}` }).catch(err => console.error(err));
    }
  }
}

