// src/js/auth.js
import { checkDbStatus, setupMasterPassword, loginDb, recoverDbAccess, changeMasterPassword } from './db.js';

let authOverlayEl = null;
let authTitleEl = null;
let authSubtitleEl = null;
let authAlertEl = null;
let setupFormEl = null;
let recoveryDisplayEl = null;
let loginFormEl = null;
let recoverFormEl = null;

let currentRecoveryKey = "";

export async function initAuthGuard(onUnlockedCallback) {
  authOverlayEl = document.getElementById('auth-overlay');
  authTitleEl = document.getElementById('auth-title');
  authSubtitleEl = document.getElementById('auth-subtitle');
  authAlertEl = document.getElementById('auth-alert');
  setupFormEl = document.getElementById('auth-form-setup');
  recoveryDisplayEl = document.getElementById('auth-recovery-display');
  loginFormEl = document.getElementById('auth-form-login');
  recoverFormEl = document.getElementById('auth-form-recover');

  setupAuthEventListeners(onUnlockedCallback);

  try {
    const status = await checkDbStatus();
    
    if (status.is_unlocked) {
      hideAuthOverlay();
      if (typeof onUnlockedCallback === 'function') onUnlockedCallback();
      return;
    }

    showAuthOverlay();

    if (!status.is_initialized) {
      showSetupMode(status.needs_migration);
    } else {
      showLoginMode();
    }
  } catch (err) {
    console.error("Error al comprobar el estado de autenticación:", err);
    showLoginMode();
  }
}

function showAuthOverlay() {
  if (authOverlayEl) authOverlayEl.classList.remove('hidden');
}

function hideAuthOverlay() {
  if (authOverlayEl) authOverlayEl.classList.add('hidden');
}

function hideAlert() {
  if (authAlertEl) {
    authAlertEl.classList.add('hidden');
    authAlertEl.textContent = '';
    authAlertEl.className = 'auth-alert hidden';
  }
}

function showAlert(message, type = 'error') {
  if (!authAlertEl) return;
  authAlertEl.innerHTML = message;
  authAlertEl.className = `auth-alert ${type}`;
  authAlertEl.classList.remove('hidden');
}

function hideAllForms() {
  hideAlert();
  if (setupFormEl) setupFormEl.classList.add('hidden');
  if (recoveryDisplayEl) recoveryDisplayEl.classList.add('hidden');
  if (loginFormEl) loginFormEl.classList.add('hidden');
  if (recoverFormEl) recoverFormEl.classList.add('hidden');
}

function showSetupMode(isMigration = false) {
  hideAllForms();
  authTitleEl.textContent = isMigration ? "Actualizar a Bóveda Cifrada" : "Configurar Contraseña Maestra";
  authSubtitleEl.textContent = isMigration 
    ? "Hemos detectado datos anteriores. Crea una Contraseña Maestra para cifrar tu base de datos y cumplir con el RGPD/LOPDGDD."
    : "Establece la Contraseña Maestra para proteger la aplicación y tus copias de seguridad de forma cifrada.";
  setupFormEl.classList.remove('hidden');
}

function showRecoveryDisplayMode(key) {
  hideAllForms();
  currentRecoveryKey = key;
  authTitleEl.textContent = "¡Bóveda Configurada con Éxito!";
  authSubtitleEl.textContent = "Guarda tu Clave de Recuperación de Emergencia en un lugar seguro.";
  
  const keyInput = document.getElementById('display-recovery-key');
  if (keyInput) keyInput.value = key;
  
  recoveryDisplayEl.classList.remove('hidden');
}

function showLoginMode() {
  hideAllForms();
  authTitleEl.textContent = "Desbloquear Comparetica";
  authSubtitleEl.textContent = "Introduce tu Contraseña Maestra para acceder a tus clientes, tarifas y comparativas cifradas.";
  loginFormEl.classList.remove('hidden');
  
  setTimeout(() => {
    const input = document.getElementById('login-password');
    if (input) input.focus();
  }, 100);
}

function showRecoverMode() {
  hideAllForms();
  authTitleEl.textContent = "Recuperar Acceso de Emergencia";
  authSubtitleEl.textContent = "Introduce tu Clave de Recuperación y la nueva Contraseña Maestra que deseas utilizar.";
  recoverFormEl.classList.remove('hidden');
  
  setTimeout(() => {
    const input = document.getElementById('recover-key');
    if (input) input.focus();
  }, 100);
}

function setupAuthEventListeners(onUnlockedCallback) {
  // Toggle contraseña visible
  const toggleBtn = document.getElementById('toggle-login-password-visibility');
  const loginInput = document.getElementById('login-password');
  if (toggleBtn && loginInput) {
    toggleBtn.addEventListener('click', () => {
      loginInput.type = loginInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Setup Form submit
  if (setupFormEl) {
    setupFormEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();
      const p1 = document.getElementById('setup-password').value;
      const p2 = document.getElementById('setup-password-confirm').value;

      if (p1.length < 6) {
        showAlert("La contraseña debe tener al menos 6 caracteres.");
        return;
      }
      if (p1 !== p2) {
        showAlert("Las contraseñas no coinciden. Por favor, verifícalas.");
        return;
      }

      const btn = document.getElementById('btn-setup-submit');
      const originalHtml = btn ? btn.innerHTML : '';

      try {
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `<span class="spinner-sm"></span> Cifrando información...`;
        }
        
        const recoveryKey = await setupMasterPassword(p1);
        showRecoveryDisplayMode(recoveryKey);
      } catch (err) {
        showAlert(err.toString());
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      }
    });
  }

  // Recovery Display events
  const btnCopy = document.getElementById('btn-copy-recovery-key');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      if (currentRecoveryKey) {
        navigator.clipboard.writeText(currentRecoveryKey);
        showAlert("¡Clave de recuperación copiada al portapapeles!", "success");
      }
    });
  }

  const btnPdf = document.getElementById('btn-download-recovery-pdf');
  if (btnPdf) {
    btnPdf.addEventListener('click', async () => {
      await generateRecoveryPdf(currentRecoveryKey);
    });
  }

  const btnConfirmDone = document.getElementById('btn-confirm-recovery-done');
  if (btnConfirmDone) {
    btnConfirmDone.addEventListener('click', () => {
      hideAuthOverlay();
      if (typeof onUnlockedCallback === 'function') onUnlockedCallback();
    });
  }

  // Login Form submit
  if (loginFormEl) {
    loginFormEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();
      const password = document.getElementById('login-password').value;

      const btn = document.getElementById('btn-login-submit');
      const originalHtml = btn ? btn.innerHTML : '';

      try {
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `<span class="spinner-sm"></span> Verificando contraseña...`;
        }

        await loginDb(password);
        hideAuthOverlay();
        if (typeof onUnlockedCallback === 'function') onUnlockedCallback();
      } catch (err) {
        showAlert("Contraseña incorrecta. Por favor, vuelve a intentarlo.");
        const input = document.getElementById('login-password');
        if (input) {
          input.value = '';
          input.focus();
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      }
    });
  }

  // Navegación entre Login y Recover
  const btnGotoRecover = document.getElementById('btn-goto-recover');
  if (btnGotoRecover) {
    btnGotoRecover.addEventListener('click', showRecoverMode);
  }

  const btnGotoLogin = document.getElementById('btn-goto-login');
  if (btnGotoLogin) {
    btnGotoLogin.addEventListener('click', showLoginMode);
  }

  // Recover Form submit
  if (recoverFormEl) {
    recoverFormEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();
      const key = document.getElementById('recover-key').value;
      const newPassword = document.getElementById('recover-password').value;

      if (newPassword.length < 6) {
        showAlert("La nueva contraseña debe tener al menos 6 caracteres.");
        return;
      }

      const btn = document.getElementById('btn-recover-submit');
      const originalHtml = btn ? btn.innerHTML : '';

      try {
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `<span class="spinner-sm"></span> Desbloqueando...`;
        }

        const newRecoveryKey = await recoverDbAccess(key, newPassword);
        showRecoveryDisplayMode(newRecoveryKey);
      } catch (err) {
        showAlert("Clave de recuperación incorrecta o inválida.");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      }
    });
  }
}

async function generateRecoveryPdf(key) {
  if (!window.jspdf) {
    showAlert("Librería jsPDF no disponible.");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(20);
  doc.setTextColor(26, 115, 232);
  doc.text("Comparetica - Clave de Recuperación de Emergencia", 15, 20);

  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text("Documento Oficial de Respaldo de Seguridad (RGPD / LOPDGDD)", 15, 28);
  doc.setLineWidth(0.5);
  doc.setDrawColor(200, 200, 200);
  doc.line(15, 32, 195, 32);

  doc.setFontSize(12);
  doc.setTextColor(40, 40, 40);
  doc.text("Esta clave de recuperación permite acceder a tus datos cifrados si olvidas tu Contraseña Maestra.", 15, 45);
  doc.text("Guarda esta hoja impresa en un lugar seguro o en una carpeta de seguridad.", 15, 52);

  // Box for Recovery Key
  doc.setFillColor(245, 247, 250);
  doc.setDrawColor(26, 115, 232);
  doc.roundedRect(15, 65, 180, 30, 3, 3, 'FD');

  doc.setFontSize(18);
  doc.setFont("courier", "bold");
  doc.setTextColor(26, 115, 232);
  doc.text(key, 105, 83, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text("Fecha de generación: " + new Date().toLocaleString('es-ES'), 15, 110);
  doc.text("Comparetica - Sistema de Cifrado de Datos B2B", 15, 116);

  if (window.__TAURI__) {
    const pdfDataUri = doc.output('datauristring');
    const base64Data = pdfDataUri.split(',')[1];
    const invoke = window.__TAURI__.core ? window.__TAURI__.core.invoke : (window.__TAURI__.invoke || window.__TAURI__.core?.invoke);

    try {
      const savedPath = await invoke('save_pdf', {
        filename: "Comparetica_Clave_Recuperacion_Emergencia.pdf",
        base64Data: base64Data
      });
      showAlert(`📄 PDF de clave guardado con éxito en:<br><span style="font-family: monospace; font-size: 11px; word-break: break-all; opacity: 0.95; display: block; margin-top: 4px; line-height: 1.3;">${savedPath}</span>`, 'success');
    } catch (err) {
      if (err !== "Cancelado por el usuario") {
        showAlert(`Error al guardar el PDF: ${err}`);
      }
    }
  } else {
    doc.save("Comparetica_Clave_Recuperacion_Emergencia.pdf");
    showAlert("📄 PDF descargado con éxito.", "success");
  }
}
