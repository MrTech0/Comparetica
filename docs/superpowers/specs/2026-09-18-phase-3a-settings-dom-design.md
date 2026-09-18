# Especificación de Diseño - Fase 3A: Integridad de Ajustes y Saneamiento del DOM

## 1. Resumen y Objetivos

Esta especificación detalla el diseño de la **Fase 3A** de Comparetica, orientada a:
1. **Unificar el almacenamiento de configuración en SQLite cifrada (tabla `ajustes`)**: Resolver la deficiencia crítica por la cual las copias de seguridad (`.bak`) no respaldaban el logotipo de empresa, los datos fiscales/comerciales ni los umbrales de renovaciones por residir en `localStorage` o archivos externos en texto plano.
2. **Desacoplar el DOM eliminando el monkey-patching global**: Reemplazar la mutación global de `HTMLSelectElement.prototype.value` en [`src/js/app.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/app.js) por enganches locales por instancia en los selectores `.m3-select`, manteniendo el 100% de compatibilidad con las vistas existentes sin alterar el motor nativo del navegador.
3. **Saneamiento final de residuos de mock en [`src/js/db.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/db.js)**: Eliminar todas las bifurcaciones muertas `else { /* Modo mock */ }` y referencias a `localStorage` para clientes, comparativas y puntos de suministro.

---

## 2. Restricciones y Principios Globales

- **Cero regresiones:** Mantener 100% la compatibilidad con la base de datos cifrada (`comparetica.db.enc`), el esquema existente y las llamadas IPC de Tauri (`"withGlobalTauri": true`).
- **Migración automática sin pérdida de datos:** Si el usuario ya tiene configuración de empresa o logotipo guardados previamente en `localStorage` o `config.json`, la aplicación debe migrarlos a SQLite automáticamente en el primer arranque.
- **Inclusión transparente en backups:** La tabla `ajustes` forma parte de la base de datos SQLite principal (`comparetica.db.enc`), por lo que cualquier comando `export_backup` respaldará automáticamente todos los ajustes sin requerir cambios de formato en el `.bak`.

---

## 3. Componente 1: Tabla `ajustes` en SQLite Cifrada

### 3.1. Esquema en `src-tauri/src/db.rs`
En `init_schema()` de [`src-tauri/src/db.rs`](file:///c:/Users/polca/Documents/github/Comparetica/src-tauri/src/db.rs), se añade:
```sql
CREATE TABLE IF NOT EXISTS ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2. Claves Estándar y Estructura de Datos
- `'company_config'`: Objeto JSON serializado:
  ```json
  {
    "nombre": "Mi Asesoría Energética",
    "cif": "B12345678",
    "direccion": "Calle Principal 1",
    "email": "contacto@asesoria.es",
    "telefono": "912345678",
    "web": "https://asesoria.es",
    "iban": "ES00 ...",
    "notas": "Texto pie de página"
  }
  ```
- `'company_logo'`: String Data URI de la imagen (`data:image/png;base64,...` o `data:image/svg+xml;base64,...`).
- `'renewal_thresholds'`: Objeto JSON con los umbrales de alerta:
  ```json
  {
    "critical": 30,
    "warning": 60,
    "radar": 90
  }
  ```
- `'app_preferences'`: Tema visual y comportamiento general:
  ```json
  {
    "theme": "dark",
    "color_theme": "blue",
    "auto_update_enabled": true
  }
  ```

### 3.3. Métodos de Abstracción en `src/js/db.js`
Se incorporan las siguientes funciones exportadas:
```javascript
export async function getAjuste(clave, defaultValue = null) {
  const db = await getDb();
  const rows = await db.select("SELECT valor FROM ajustes WHERE clave = $1 LIMIT 1;", [clave]);
  if (rows && rows.length > 0) {
    try {
      return JSON.parse(rows[0].valor);
    } catch {
      return rows[0].valor;
    }
  }
  return defaultValue;
}

export async function setAjuste(clave, valor) {
  const db = await getDb();
  const serialized = typeof valor === 'string' ? valor : JSON.stringify(valor);
  await db.execute(`
    INSERT INTO ajustes (clave, valor, actualizado_en)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT(clave) DO UPDATE SET
      valor = excluded.valor,
      actualizado_en = CURRENT_TIMESTAMP;
  `, [clave, serialized]);
}
```

Junto con helpers de conveniencia:
- `getCompanyConfig()` / `saveCompanyConfig(config)`
- `getCompanyLogo()` / `saveCompanyLogo(logoDataUri)` / `deleteCompanyLogo()`
- `getRenewalThresholds()` / `saveRenewalThresholds(thresholds)`

---

## 4. Componente 2: Saneamiento del DOM en `src/js/app.js`

### 4.1. Eliminación de la Mutación de `HTMLSelectElement.prototype`
En [`src/js/app.js:L327-L341`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/app.js#L327-L341), se **elimina por completo** el código:
```javascript
// ELIMINAR:
const originalValueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
if (originalValueProp && !HTMLSelectElement.prototype._customValueHooked) {
  Object.defineProperty(HTMLSelectElement.prototype, 'value', { ... });
}
```

### 4.2. Enganche Local por Instancia
En el bucle `nativeSelects.forEach(select => { ... })` de `initCustomSelects()`:
1. Se preserva el descriptor original de la propiedad `value` de la instancia.
2. Se redefine la propiedad `value` **únicamente sobre ese elemento `<select>` concreto**:
   ```javascript
   const protoDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
   Object.defineProperty(select, 'value', {
     get() {
       return protoDescriptor.get.call(this);
     },
     set(val) {
       protoDescriptor.set.call(this, val);
       populateOptions();
     },
     configurable: true
   });
   ```
3. El prototipo global de `HTMLSelectElement` permanece virgen y estándar en todo el Webview.
4. Cualquier asignación `select.value = '...'` desde cualquier vista sigue funcionando de forma transparente e inmediata.

---

## 5. Componente 3: Purgado de Código Muerto de Mock en `src/js/db.js`

Se eliminarán todas las bifurcaciones y variables residuales que hacían referencia a emulación de bases de datos mediante `localStorage`:
- En `deleteCliente`: eliminar el bloque `else` de filtrado sobre `mockClients` y guardado en `mock_comparativas`.
- En `getPuntosSuministro`, `guardarPuntoSuministro`, `getPuntosSuministroAll`: eliminar todas las lecturas/escrituras en `mock_puntos_suministro`.
- En `purgarComparativasObsoletas`: eliminar la rama de purga en `mock_clientes` y `mock_comparativas`.
- En `vaciarBaseDeDatos`: eliminar la rama `else` que llamaba a `localStorage.removeItem('mock_...')`.
- En `setupMasterPassword`: eliminar el fallback a `generateMockRecoveryKey()`.

---

## 6. Componente 4: Actualización de Vistas Consumidoras

- **[`src/js/views/settings.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/settings.js)**:
  - Carga y guardado de datos fiscales de empresa y logo migrados a `getCompanyConfig()` / `saveCompanyConfig()` y `getCompanyLogo()` / `saveCompanyLogo()`.
  - Carga y guardado de umbrales de renovación migrados a `getRenewalThresholds()` / `saveRenewalThresholds()`.
- **[`src/js/views/renewals.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/renewals.js)**:
  - Uso de `getRenewalThresholds()` para calcular los estados de vencimiento (Crítico, Advertencia, Radar).
- **[`src/js/pdf.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/pdf.js)**:
  - Empleo de `getCompanyConfig()` y `getCompanyLogo()` para la cabecera del informe comparativo en PDF.
- **[`src/js/views/wizard.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/wizard.js)**:
  - Paso de configuración inicial persistiendo en la tabla `ajustes`.

---

## 7. Plan de Verificación

1. **Pruebas de Rust:**
   - Añadir una prueba unitaria en `src-tauri/src/db.rs` que verifique que la tabla `ajustes` se crea en `init_schema`, soporta inserciones/actualizaciones y se persiste atómicamente.
   - Ejecutar `cargo test --package comparetica` (5/5 tests pasando).
2. **Pruebas de JavaScript:**
   - Ejecutar `node --test test/calculator.test.js` (8/8 tests pasando).
   - Crear un test específico `test/settings_dom.test.js` que verifique:
     - Que `HTMLSelectElement.prototype` no está modificado.
     - Que la serialización y deserialización de ajustes funciona limpiamente.
3. **Chequeo de compilación:**
   - `cargo check` sin errores ni advertencias.
4. **Validación de sintaxis:**
   - `node --check src/js/db.js` y `node --check src/js/app.js`.
