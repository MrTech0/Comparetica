# Lista de Comprobaciones para Lanzamiento de Releases (Release Checklist)

Esta guía detalla los pasos obligatorios que deben seguirse antes, durante y después de publicar una nueva versión de **Comparetica** para asegurar que no se olvide ningún paso y que las actualizaciones automáticas funcionen correctamente para todos los usuarios.

---

## 📋 Lista de Comprobaciones

### 1. 🛠️ Fase de Pre-Lanzamiento (Preparación)
- [ ] **Incrementar la versión**: Asegurar que la nueva versión (ej. `0.1.8`) esté declarada idénticamente en:
  - `src-tauri/Cargo.toml` (`version = "X.Y.Z"`)
  - `src-tauri/Cargo.lock` (paquete `comparetica`)
  - `src-tauri/tauri.conf.json` (`"version": "X.Y.Z"`)
- [ ] **Escribir Notas de Versión**: Rellenar el archivo `RELEASE_NOTES.md` con un listado limpio de los cambios introducidos en la versión actual.
- [ ] **Commit y Push**: Subir los cambios de la versión y las notas a la rama principal:
  ```powershell
  $env:GITHUB_TOKEN=""; git add .
  $env:GITHUB_TOKEN=""; git commit -m "Bump version to vX.Y.Z for release"
  $env:GITHUB_TOKEN=""; git push origin main
  ```

---

### 2. 🚀 Fase de Lanzamiento (Tagging)
- [ ] **Crear Etiqueta de Versión**: Crear la etiqueta de Git apuntando al último commit de `main`:
  ```powershell
  git tag vX.Y.Z
  ```
- [ ] **Subir Etiqueta**: Subir la etiqueta para disparar la GitHub Action automatizada:
  ```powershell
  $env:GITHUB_TOKEN=""; git push origin vX.Y.Z
  ```

---

### 3. ⏳ Fase de Seguimiento del Pipeline
- [ ] **Verificar Compilación**: Monitorear el progreso en la pestaña **Actions** de GitHub o a través de la CLI:
  ```powershell
  $env:GITHUB_TOKEN=""; gh run list --limit 3
  ```
- [ ] **Comprobar Release Creada**: Confirmar que la compilación en Windows finalice sin errores y cree la Release en GitHub con los dos assets:
  - `Comparetica_X.Y.Z_x64.msi` (Instalador)
  - `Comparetica_X.Y.Z_x64.msi.sig` (Firma digital)

---

### 4. 🔄 Fase Post-Lanzamiento (Actualizador Tauri - CRÍTICO)
> [!IMPORTANT]
> **Si no se realiza esta fase, los usuarios con la versión anterior nunca recibirán la notificación de actualización.**

- [ ] **Descargar Firma Digital**: Descargar el archivo `.sig` generado por la compilación automatizada:
  ```powershell
  $env:GITHUB_TOKEN=""; gh release download vX.Y.Z --pattern "*.sig" --dir .
  ```
- [ ] **Leer Firma**: Abrir el archivo `.sig` descargado para obtener el texto cifrado de la firma.
- [ ] **Actualizar `updates/latest.json`**: Editar el archivo metadata del actualizador en `updates/latest.json` con la información de la nueva versión:
  - `"version"`: `"X.Y.Z"` (la versión exacta recién publicada)
  - `"pub_date"`: `"YYYY-MM-DDTHH:MM:SSZ"` (fecha y hora en que se publicó la Release)
  - `"signature"`: `"TEXTO_DE_LA_FIRMA_DESCARGADA"` (copiar toda la cadena de texto del archivo `.sig`)
  - `"url"`: `"https://github.com/MrTech0/Comparetica/releases/download/vX.Y.Z/Comparetica_X.Y.Z_x64.msi"` (verificar que el tag y el nombre del archivo coincidan)
- [ ] **Subir Cambios a GitHub**: Guardar el archivo `latest.json`, hacer commit y subirlo a la rama `main` para que raw.githubusercontent.com empiece a servir la nueva metadata:
  ```powershell
  $env:GITHUB_TOKEN=""; git add updates/latest.json
  $env:GITHUB_TOKEN=""; git commit -m "Update updates/latest.json metadata for vX.Y.Z release"
  $env:GITHUB_TOKEN=""; git push origin main
  ```
- [ ] **Limpiar Archivo Temporal**: Eliminar el archivo de firma descargado localmente para mantener el directorio limpio:
  ```powershell
  Remove-Item Comparetica_X.Y.Z_x64.msi.sig
  ```

---

### 5. 🔍 Fase de Verificación Final
- [ ] **Prueba de Actualización**: Abrir una instancia instalada de la aplicación con la versión anterior (ej. 0.1.7) en tu ordenador y forzar la búsqueda de actualizaciones. Comprobar que:
  - Se detecta la versión `X.Y.Z`.
  - Se muestra el listado correcto de novedades en la ventana modal.
  - La descarga y reinicio de la aplicación se realizan con éxito sin errores de firma.
