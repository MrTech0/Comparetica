/* src/js/app.js */

import { getDb } from './db.js';
import { initHomeView } from './views/home.js';
import { initCalculatorView } from './views/calculator_view.js';
import { initTariffsView, updateComercializadorasSelectors } from './views/tariffs.js';
import { initHistoryView } from './views/history.js';
import { initBackupView } from './views/backup.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Inicializar la base de datos y esquema
  try {
    await getDb();
    console.log("Base de datos inicializada correctamente.");
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
  initCalculatorView();
  await initTariffsView();
  await initHistoryView();
  initBackupView();
  initPdfPreviewDialog();

  // Alimentar selectores dinámicos
  await updateComercializadorasSelectors();
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
    { btn: 'nav-calculator', section: 'section-calculator', title: 'Comparador de Tarifas' },
    { btn: 'nav-tariffs', section: 'section-tariffs', title: 'Gestión de Tarifas y Comisiones' },
    { btn: 'nav-history', section: 'section-history', title: 'Historial de Comparativas' },
    { btn: 'nav-backup', section: 'section-backup', title: 'Copia de Seguridad' }
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
      if (item.btn === 'nav-tariffs') {
        // Recargar listas CRUD por si hubo cambios
        await updateComercializadorasSelectors();
      } else if (item.btn === 'nav-history') {
        // Disparar evento para refrescar historial
        window.dispatchEvent(new CustomEvent('comparison-saved'));
      }
    });
  });
}

// --- MODO PRIVADO ---
function initPrivateMode() {
  const checkbox = document.getElementById('private-mode-checkbox');

  // Cargar estado inicial (por defecto inactivo)
  checkbox.checked = false;

  checkbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      document.body.classList.add('private-mode-active');
    } else {
      document.body.classList.remove('private-mode-active');
    }
  });
}
