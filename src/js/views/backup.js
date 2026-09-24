/* src/js/views/backup.js */

import { invoke } from '../ipc.js';
import { showToast, showConfirm } from '../ui.js';

// Cargar la configuración de copias de seguridad actual
export async function loadBackupConfig() {
  const dirInput = document.getElementById('backup-directory-input');
  const retentionInput = document.getElementById('backup-retention-input');

  if (typeof window !== 'undefined' && window.__TAURI__) {
    try {
      const currentDir = await invoke('get_backup_directory');
      if (dirInput) dirInput.value = currentDir;
      
      const currentDays = await invoke('get_backup_retention');
      if (retentionInput) retentionInput.value = currentDays;
    } catch (err) {
      console.error("Error al cargar la configuración de copias de seguridad:", err);
    }
  } else {
    if (dirInput) dirInput.value = "Modo Navegador (Sin ruta local)";
    if (retentionInput) retentionInput.value = 7;
  }
}

export function initBackupView() {
  const exportBtn = document.getElementById('export-backup-btn');
  const importBtn = document.getElementById('import-backup-btn');
  const dirInput = document.getElementById('backup-directory-input');
  const changeDirBtn = document.getElementById('change-backup-dir-btn');
  const resetDirBtn = document.getElementById('reset-backup-dir-btn');
  const retentionInput = document.getElementById('backup-retention-input');

  loadBackupConfig();

  // Cambiar directorio de copias de seguridad
  if (changeDirBtn) {
    changeDirBtn.addEventListener('click', async () => {
      if (typeof window === 'undefined' || !window.__TAURI__) {
        showToast("Esta acción solo está disponible en modo de escritorio (Tauri).", "info");
        return;
      }

      try {
        changeDirBtn.disabled = true;
        const selectedParent = await invoke('select_backup_directory');
        const savedPath = await invoke('setup_backup_directory', { parentPath: selectedParent });
        if (dirInput) dirInput.value = savedPath;
        showToast("⚡ Ubicación de copias de seguridad actualizada a Comparetica_backups.", "success");
      } catch (error) {
        if (error !== "Cancelado por el usuario") {
          showToast(`Error al configurar el directorio: ${error}`, "error");
        }
      } finally {
        changeDirBtn.disabled = false;
      }
    });
  }

  // Restablecer directorio de copias de seguridad
  if (resetDirBtn) {
    resetDirBtn.addEventListener('click', async () => {
      if (typeof window === 'undefined' || !window.__TAURI__) {
        showToast("Esta acción solo está disponible en modo de escritorio (Tauri).", "info");
        return;
      }

      try {
        resetDirBtn.disabled = true;
        const savedPath = await invoke('setup_backup_directory', { parentPath: null });
        if (dirInput) dirInput.value = savedPath;
        showToast("Ubicación de copia automática restablecida a la carpeta Comparetica_backups en la Home del usuario.", "success");
      } catch (error) {
        showToast(`Error al restablecer el directorio: ${error}`, "error");
      } finally {
        resetDirBtn.disabled = false;
      }
    });
  }

  // Escuchar cambios en los días de retención
  if (retentionInput) {
    retentionInput.addEventListener('change', async (e) => {
      let days = parseInt(e.target.value, 10);
      if (isNaN(days) || days < 1) {
        days = 7;
        e.target.value = 7;
      }
      
      if (typeof window !== 'undefined' && window.__TAURI__) {
        try {
          await invoke('set_backup_retention', { days });
        } catch (err) {
          showToast(`Error al guardar los días de retención: ${err}`, "error");
        }
      }
    });
  }

  // Exportación manual
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      if (typeof window === 'undefined' || !window.__TAURI__) {
        showToast("Las copias de seguridad nativas solo están disponibles ejecutando la aplicación de escritorio (Tauri).", "info");
        return;
      }

      try {
        exportBtn.disabled = true;
        const originalText = exportBtn.innerHTML;
        exportBtn.innerText = "Exportando...";

        const resultPath = await invoke('export_backup');
        showToast(`Copia de seguridad guardada con éxito en: ${resultPath}`, "success");
        
        exportBtn.innerHTML = originalText;
      } catch (error) {
        if (error !== "Cancelado por el usuario") {
          showToast(`Error al exportar la copia de seguridad: ${error}`, "error");
        }
      } finally {
        exportBtn.disabled = false;
        const currentText = exportBtn.innerText;
        if (currentText === "Exportando...") {
          exportBtn.innerHTML = `
            <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
            Crear Copia...
          `;
        }
      }
    });
  }

  // Importación manual
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      if (typeof window === 'undefined' || !window.__TAURI__) {
        showToast("Las copias de seguridad nativas solo están disponibles ejecutando la aplicación de escritorio (Tauri).", "info");
        return;
      }

      const confirmRestore = await showConfirm(
        "¿Estás seguro de que deseas restaurar una copia de seguridad?\n\n" +
        "Esta acción eliminará de forma permanente TODOS tus datos locales actuales (tarifas, comercializadoras e historial) y los reemplazará por los del archivo de copia de seguridad.\n\n" +
        "La aplicación se REINICIARÁ automáticamente tras completarse la importación.",
        "Restaurar Copia de Seguridad"
      );

      if (!confirmRestore) return;

      try {
        importBtn.disabled = true;
        const originalText = importBtn.innerHTML;
        importBtn.innerText = "Restaurando...";

        const msg = await invoke('import_backup');
        localStorage.setItem('first_run_completed', 'true');
        
        if (msg === "DEV_MODE") {
          showToast("Copia de seguridad restaurada. Recargando aplicación...", "success");
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          showToast(msg, "success");
          setTimeout(async () => {
            if (typeof window !== 'undefined' && window.__TAURI__) {
              await invoke('restart_app');
            }
          }, 1500);
        }
      } catch (error) {
        if (error !== "Cancelado por el usuario") {
          showToast(`Error al importar la copia de seguridad: ${error}`, "error");
        }
      } finally {
        importBtn.disabled = false;
        const currentText = importBtn.innerText;
        if (currentText === "Restaurando...") {
          importBtn.innerHTML = `
            <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13h-4v3H8l4 4 4-4h-2z"/></svg>
            Restaurar Copia...
          `;
        }
      }
    });
  }
}
