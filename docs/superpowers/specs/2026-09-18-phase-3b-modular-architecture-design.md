# Especificación de Diseño - Fase 3B: Arquitectura Modular Nativa (UI, IPC y Eventos)

## 1. Resumen y Objetivos

Esta especificación detalla el diseño técnico de la **Fase 3B** de Comparetica, orientada a:
1. **Módulo Central de UI ([`src/js/ui.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/ui.js))**: Extraer de `app.js` las funciones de interacción visual (`showToast`, `showActionToast`, `showConfirm`) a un módulo ES6 dedicado, manteniendo los alias en `window` para preservar la retrocompatibilidad y permitiendo a las vistas importar sus dependencias visuales de forma explícita.
2. **Capa de Abstracción Tauri IPC ([`src/js/ipc.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/ipc.js))**: Unificar las llamadas hacia el backend Rust (`invoke` y `listen`), eliminando la repetición de más de 12 bloques defensivos idénticos (`const invoke = window.__TAURI__.core ? ... : ...`) dispersos en `db.js`, `auth.js`, `pdf.js`, `csv_importer.js` y `views/backup.js`.
3. **Bus y Catálogo de Eventos ([`src/js/events.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/events.js))**: Estandarizar la comunicación desacoplada entre vistas (`comparison-saved`, etc.) mediante un catálogo tipado de constantes (`APP_EVENTS`) y utilidades para emitir y escuchar eventos (`emitAppEvent`, `onAppEvent`).
4. **Saneamiento de Consumidores**: Actualizar todas las vistas y utilidades para consumir los nuevos módulos, purgando variables y llamadas huérfanas (como `window.reloadCurrentView`).
5. **Cero Dependencias NPM y Cero Pasos de Compilación Adicionales**: Mantener el rendimiento instantáneo de Tauri y la arquitectura sin bundler (`"frontendDist": "../src"` y `"withGlobalTauri": true`).

---

## 2. Restricciones y Principios Globales

- **Cero regresiones:** Las llamadas existentes hacia `window.showToast` o `window.showConfirm` deben seguir operando gracias al puente de retrocompatibilidad en `ui.js`.
- **Compatibilidad con Tauri v2:** `ipc.js` debe soportar transparentemente tanto `window.__TAURI__.core.invoke` como `window.__TAURI__.invoke`.
- **Cero dependencias npm añadidas:** Todo el código implementado y las pruebas unitarias deben funcionar con JavaScript estándar y el test runner nativo de Node (`node:test`, `node:assert/strict`).
- **Verificación continua:** Cada módulo debe ser validado con `node --check` y suites unitarias automatizadas.

---

## 3. Componente 1: Módulo Central de UI (`src/js/ui.js`)

### 3.1. Funciones Exportadas
- `showToast(message, type = 'success')`:
  - Inserta un elemento div en `#toast-container` con clases `m3-toast ${type}`.
  - Programa la animación de salida (`m3-toast-fadeout`) tras 4 segundos y la eliminación del nodo al terminar la animación.
- `showActionToast(message, actions = [])`:
  - Permite botones de acción con callbacks personalizados dentro de la notificación.
- `showConfirm(mensaje, titulo = 'Confirmación')`:
  - Muestra el modal `#dialog-confirm`, reemplaza los clones de botones para evitar listeners duplicados y resuelve una promesa a `true` (Aceptar) o `false` (Cancelar).

### 3.2. Puente de Retrocompatibilidad
Al final de `ui.js`:
```javascript
if (typeof window !== 'undefined') {
  window.showToast = showToast;
  window.showActionToast = showActionToast;
  window.showConfirm = showConfirm;
}
```

---

## 4. Componente 2: Capa de Abstracción Tauri IPC (`src/js/ipc.js`)

### 4.1. Funciones Exportadas
- `async invoke(cmd, args = {})`:
  - Obtiene la función invoke de `window.__TAURI__.core?.invoke` o `window.__TAURI__?.invoke`.
  - Si no existe el entorno Tauri, rechaza la promesa con un error explicativo.
  - Ejecuta la llamada y retorna el resultado tipado.
- `async listen(eventName, handler)`:
  - Se suscribe a eventos emitidos desde Tauri (`window.__TAURI__?.event?.listen`).
  - Retorna una función de desuscripción limpia.

---

## 5. Componente 3: Catálogo y Bus de Eventos (`src/js/events.js`)

### 5.1. Constantes y Helpers
```javascript
export const APP_EVENTS = Object.freeze({
  COMPARISON_SAVED: 'comparison-saved',
  CLIENTS_UPDATED: 'clients-updated',
  AGENTS_UPDATED: 'agents-updated',
  TARIFFS_UPDATED: 'tariffs-updated',
  SETTINGS_UPDATED: 'settings-updated'
});

export function emitAppEvent(eventName, detail = null) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

export function onAppEvent(eventName, handler) {
  if (typeof window !== 'undefined') {
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }
  return () => {};
}
```

---

## 6. Componente 4: Refactorización de Vistas Consumidoras

1. [`src/js/app.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/app.js):
   - Elimina la definición local de `showToast`, `showActionToast` y `showConfirm`.
   - Importa `showToast`, `showActionToast`, `showConfirm` desde `./ui.js`.
   - Usa `emitAppEvent(APP_EVENTS.COMPARISON_SAVED)` en el evento de navegación de historial.
2. [`src/js/db.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/db.js):
   - Importa `invoke` desde `./ipc.js`.
   - Sustituye todas las apariciones de `const invoke = window.__TAURI__...` por la función unificada `invoke(...)`.
3. [`src/js/auth.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/auth.js):
   - Importa `invoke` desde `./ipc.js` y `showToast` desde `./ui.js`.
4. [`src/js/pdf.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/pdf.js):
   - Importa `invoke` desde `./ipc.js` y `showToast` desde `./ui.js`.
5. [`src/js/csv_importer.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/csv_importer.js):
   - Importa `invoke` y `listen` desde `./ipc.js` y `showToast` desde `./ui.js`.
6. [`src/js/views/backup.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/backup.js):
   - Importa `invoke` desde `../ipc.js` y `showToast`, `showConfirm` desde `../ui.js`.
7. [`src/js/views/calculator_view.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/calculator_view.js):
   - Importa `showToast` desde `../ui.js` y `emitAppEvent`, `APP_EVENTS` desde `../events.js`.
8. [`src/js/views/history.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/history.js):
   - Importa `onAppEvent`, `APP_EVENTS` desde `../events.js` para suscribir `refreshHistory`.
9. [`src/js/views/agents.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/agents.js):
   - Importa `showToast`, `showConfirm` desde `../ui.js`.
   - Elimina la comprobación huérfana de `window.reloadCurrentView`.
10. [`src/js/views/clients.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/clients.js), [`src/js/views/tariffs.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/tariffs.js), [`src/js/views/settings.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/settings.js), [`src/js/views/renewals.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/renewals.js):
   - Importan explícitamente `showToast` y `showConfirm` desde `../ui.js`.

---

## 7. Plan de Verificación

### 7.1. Pruebas Automatizadas Unitarias
- Crear [`test/ipc_and_ui.test.js`](file:///c:/Users/polca/Documents/github/Comparetica/test/ipc_and_ui.test.js) con `node:test`:
  1. `invoke`: Verifica que lanza excepción cuando `window.__TAURI__` está ausente, y que resuelve correctamente cuando se le pasa un mock de backend.
  2. `events`: Verifica que `APP_EVENTS` es inmutable (`Object.isFrozen`), que `emitAppEvent` dispara el evento y que la función de retorno de `onAppEvent` desuscribe el listener.
  3. `ui`: Verifica que `showToast` y `showConfirm` se asignan correctamente en el objeto global y responden a contratos esperados.
- Ejecutar:
  ```powershell
  node --test test/calculator.test.js test/settings_dom.test.js test/ipc_and_ui.test.js
  ```
  Esperado: 100% de tests pasando.

### 7.2. Chequeo de Sintaxis
- Ejecutar `node --check` en cada archivo de `src/js/` para garantizar sintaxis ES6 válida.

### 7.3. Suite de Regresión Backend
- Ejecutar `cargo test --package comparetica` (5/5 tests pasando).
- Ejecutar `cargo check` (0 errores).
