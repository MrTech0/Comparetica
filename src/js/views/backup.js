/* src/js/views/backup.js */

export function initBackupView() {
  const exportBtn = document.getElementById('export-backup-btn');
  const importBtn = document.getElementById('import-backup-btn');
  const dirInput = document.getElementById('backup-directory-input');
  const changeDirBtn = document.getElementById('change-backup-dir-btn');
  const resetDirBtn = document.getElementById('reset-backup-dir-btn');
  const retentionInput = document.getElementById('backup-retention-input');

  // Cargar la configuración de copias de seguridad actual
  async function loadBackupConfig() {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      try {
        const currentDir = await window.__TAURI__.core.invoke('get_backup_directory');
        if (dirInput) dirInput.value = currentDir;
        
        const currentDays = await window.__TAURI__.core.invoke('get_backup_retention');
        if (retentionInput) retentionInput.value = currentDays;
      } catch (err) {
        console.error("Error al cargar la configuración de copias de seguridad:", err);
      }
    } else {
      if (dirInput) dirInput.value = "Modo Navegador (Sin ruta local)";
      if (retentionInput) retentionInput.value = 7;
    }
  }

  loadBackupConfig();

  // Cambiar directorio de copias de seguridad
  if (changeDirBtn) {
    changeDirBtn.addEventListener('click', async () => {
      if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
        alert("Esta acción solo está disponible en modo de escritorio (Tauri).");
        return;
      }

      try {
        changeDirBtn.disabled = true;
        const selectedPath = await window.__TAURI__.core.invoke('select_backup_directory');
        const savedPath = await window.__TAURI__.core.invoke('set_backup_directory', { path: selectedPath });
        if (dirInput) dirInput.value = savedPath;
      } catch (error) {
        if (error !== "Cancelado por el usuario") {
          alert(`Error al configurar el directorio: ${error}`);
        }
      } finally {
        changeDirBtn.disabled = false;
      }
    });
  }

  // Restablecer directorio de copias de seguridad
  if (resetDirBtn) {
    resetDirBtn.addEventListener('click', async () => {
      if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
        alert("Esta acción solo está disponible en modo de escritorio (Tauri).");
        return;
      }

      try {
        resetDirBtn.disabled = true;
        const savedPath = await window.__TAURI__.core.invoke('set_backup_directory', { path: "" });
        if (dirInput) dirInput.value = savedPath;
        alert("Ubicación de copia automática restablecida al directorio Home del usuario.");
      } catch (error) {
        alert(`Error al restablecer el directorio: ${error}`);
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
      
      if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
        try {
          await window.__TAURI__.core.invoke('set_backup_retention', { days });
        } catch (err) {
          alert(`Error al guardar los días de retención: ${err}`);
        }
      }
    });
  }

  // Exportación manual
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
        alert("Las copias de seguridad nativas solo están disponibles ejecutando la aplicación de escritorio (Tauri).");
        return;
      }

      try {
        exportBtn.disabled = true;
        const originalText = exportBtn.innerHTML;
        exportBtn.innerText = "Exportando...";

        const resultPath = await window.__TAURI__.core.invoke('export_backup');
        alert(`Copia de seguridad guardada con éxito en:\n${resultPath}`);
        
        exportBtn.innerHTML = originalText;
      } catch (error) {
        if (error !== "Cancelado por el usuario") {
          alert(`Error al exportar la copia de seguridad: ${error}`);
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
      if (!window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
        alert("Las copias de seguridad nativas solo están disponibles ejecutando la aplicación de escritorio (Tauri).");
        return;
      }

      const confirmRestore = confirm(
        "¿Estás seguro de que deseas restaurar una copia de seguridad?\n\n" +
        "Esta acción eliminará de forma permanente TODOS tus datos locales actuales (tarifas, comercializadoras e historial) y los reemplazará por los del archivo de copia de seguridad.\n\n" +
        "La aplicación se REINICIARÁ automáticamente tras completarse la importación."
      );

      if (!confirmRestore) return;

      try {
        importBtn.disabled = true;
        const originalText = importBtn.innerHTML;
        importBtn.innerText = "Restaurando...";

        const msg = await window.__TAURI__.core.invoke('import_backup');
        alert(msg);
      } catch (error) {
        if (error !== "Cancelado por el usuario") {
          alert(`Error al importar la copia de seguridad: ${error}`);
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
