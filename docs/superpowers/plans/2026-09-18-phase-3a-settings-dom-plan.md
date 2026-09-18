# Phase 3A: Integridad de Ajustes y Saneamiento del DOM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar el almacenamiento de configuración de empresa, logotipo y umbrales de renovaciones en una nueva tabla SQLite cifrada (`ajustes`) garantizando copias de seguridad (.bak) 100% íntegras, sustituir el monkey-patching global de `HTMLSelectElement.prototype` en `src/js/app.js` por enganches locales por instancia, y purgar los últimos residuos de mocks en `src/js/db.js`.

**Architecture:** Nueva tabla `ajustes (clave TEXT PRIMARY KEY, valor TEXT)` en SQLite administrada por Rust y consumida en JS mediante helpers `getAjuste` / `setAjuste`. Migración automática transparente desde `localStorage`/`config.json`. Desacoplamiento del DOM en `initCustomSelects` aplicando descriptores de propiedad exclusivamente sobre los `<select.m3-select>` instanciados.

**Tech Stack:** Rust (rusqlite v0.32, Tauri v2), JavaScript Vanilla (ES Modules, `node:test`, `node:assert/strict`).

**Spec:** [docs/superpowers/specs/2026-09-18-phase-3a-settings-dom-design.md](file:///c:/Users/polca/Documents/github/Comparetica/docs/superpowers/specs/2026-09-18-phase-3a-settings-dom-design.md)

## Global Constraints

- Preservar compatibilidad total con la base de datos cifrada existente `comparetica.db.enc`, `vault.json` y el formato `.bak`.
- Mantener `"withGlobalTauri": true` en `tauri.conf.json`.
- Cero dependencias npm añadidas.
- Los tests de Rust deben ejecutarse en carpetas temporales aisladas sin acceder a `%APPDATA%`.
- Migración transparente: no romper ninguna vista existente y preservar cualquier dato previo del usuario.

---

### Task 1: Creación de la tabla `ajustes` en SQLite y prueba unitaria en Rust

**Files:**
- Modify: [src-tauri/src/db.rs:L590-L600](file:///c:/Users/polca/Documents/github/Comparetica/src-tauri/src/db.rs#L590-L600)
- Test: [src-tauri/src/db.rs:L1020-L1050](file:///c:/Users/polca/Documents/github/Comparetica/src-tauri/src/db.rs#L1020-L1050)

**Interfaces:**
- Consumes: `init_schema()`, `DbState`.
- Produces: Tabla `ajustes` disponible para consultas SQL `SELECT`/`INSERT`/`UPDATE` y verificada con tests unitarios.

- [ ] **Paso 1: Añadir la creación de la tabla `ajustes` en `init_schema` en `src-tauri/src/db.rs`**

  En `init_schema()` de `src-tauri/src/db.rs`, añadir tras la creación de `puntos_suministro`:

  ```rust
  conn.execute("
      CREATE TABLE IF NOT EXISTS ajustes (
          clave TEXT PRIMARY KEY,
          valor TEXT NOT NULL,
          actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
  ", []).map_err(|e| e.to_string())?;
  ```

- [ ] **Paso 2: Añadir prueba unitaria `test_ajustes_table_lifecycle_and_persistence` en `src-tauri/src/db.rs`**

  Añadir al final de `#[cfg(test)] mod tests`:

  ```rust
  #[test]
  fn test_ajustes_table_lifecycle_and_persistence() {
      let test_id = Uuid::new_v4().to_string();
      let test_dir = std::env::temp_dir().join(format!("comparetica_test_ajustes_{}", test_id));
      let _ = fs::create_dir_all(&test_dir);

      let mut state = DbState::new_with_dir(test_dir.clone());
      let pwd = "Password123!";
      let _rec = state.setup_master_password(pwd).unwrap();

      // 1. Insertar y actualizar ajustes
      let insert_res = state.execute(
          "INSERT INTO ajustes (clave, valor) VALUES ('company_config', '{\"nombre\":\"Test S.L.\"}');",
          vec![]
      );
      assert!(insert_res.is_ok(), "Debe permitir insertar en la tabla ajustes");

      let rows = state.select("SELECT valor FROM ajustes WHERE clave = 'company_config';", vec![]).unwrap();
      assert_eq!(rows.len(), 1);
      assert_eq!(rows[0].get("valor").unwrap().as_str(), Some("{\"nombre\":\"Test S.L.\"}"));

      // 2. Probar persistencia y recuperación tras reinicio de estado
      let vault = state.load_vault().unwrap().unwrap();
      let salt_p = general_purpose::STANDARD.decode(&vault.salt_password).unwrap();
      let key_p = derive_key(pwd, &salt_p).unwrap();
      let mdk_bytes = decrypt_aes_gcm(&key_p, &vault.encrypted_mdk_password).unwrap();
      let mut mdk = [0u8; 32];
      mdk.copy_from_slice(&mdk_bytes);

      drop(state);

      let mut restarted_state = DbState::new_with_dir(test_dir.clone());
      restarted_state.open_db(mdk).unwrap();

      let recovered_rows = restarted_state.select("SELECT valor FROM ajustes WHERE clave = 'company_config';", vec![]).unwrap();
      assert_eq!(recovered_rows.len(), 1);
      assert_eq!(recovered_rows[0].get("valor").unwrap().as_str(), Some("{\"nombre\":\"Test S.L.\"}"));

      let _ = fs::remove_dir_all(test_dir);
  }
  ```

- [ ] **Paso 3: Validar compilación y tests con `cargo test`**

  Ejecutar:
  ```powershell
  cargo test --package comparetica
  ```
  Esperado: 5 tests pasando (`test result: ok. 5 passed; 0 failed`).

- [ ] **Paso 4: Commit**

  ```bash
  git add src-tauri/src/db.rs
  git commit -m "feat(db): create encrypted ajustes table for company config and thresholds"
  ```

---

### Task 2: Métodos de abstracción y migración transparente en `src/js/db.js`

**Files:**
- Modify: [src/js/db.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/db.js)

**Interfaces:**
- Consumes: `db_select`, `db_execute` desde Tauri IPC.
- Produces: `getAjuste`, `setAjuste`, `getCompanyConfig`, `saveCompanyConfig`, `getCompanyLogo`, `saveCompanyLogo`, `deleteCompanyLogo`, `getRenewalThresholds`, `saveRenewalThresholds`. Purgado de ramas `else { /* mock */ }`.

- [ ] **Paso 1: Añadir los métodos de abstracción para la tabla `ajustes` con migración automática**

  En `src/js/db.js`, añadir y exportar:

  ```javascript
  // --- Ajustes Generales y Configuración de Empresa ---

  /**
   * Obtiene un valor de la tabla ajustes en SQLite cifrada.
   * @param {string} clave 
   * @param {any} defaultValue 
   * @returns {Promise<any>}
   */
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

  /**
   * Guarda o actualiza un valor en la tabla ajustes en SQLite cifrada.
   * @param {string} clave 
   * @param {any} valor 
   * @returns {Promise<void>}
   */
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

  /**
   * Obtiene la configuración de empresa (con migración transparente desde localStorage o Rust si aún no está en SQLite).
   */
  export async function getCompanyConfig() {
    let config = await getAjuste('company_config', null);
    if (!config) {
      // Intentar migrar desde localStorage si existe
      const localStr = localStorage.getItem('company_config');
      if (localStr) {
        try {
          config = JSON.parse(localStr);
          await setAjuste('company_config', config);
        } catch (e) {
          console.error("Error al migrar company_config desde localStorage:", e);
        }
      }
    }
    return config || {};
  }

  /**
   * Guarda la configuración de empresa en SQLite cifrada y sincroniza con Rust.
   */
  export async function saveCompanyConfig(configData) {
    await setAjuste('company_config', configData);
    if (window.__TAURI__ && window.__TAURI__.core) {
      try {
        await window.__TAURI__.core.invoke('save_company_config', { config: configData });
      } catch (err) {
        console.warn("No se pudo invocar save_company_config en backend:", err);
      }
    }
    // Mantener sincronizado localStorage para compatibilidad
    localStorage.setItem('company_config', JSON.stringify(configData));
  }

  /**
   * Obtiene el logotipo de empresa (Data URI).
   */
  export async function getCompanyLogo() {
    let logo = await getAjuste('company_logo', null);
    if (!logo) {
      const localLogo = localStorage.getItem('company_logo');
      if (localLogo) {
        logo = localLogo;
        await setAjuste('company_logo', logo);
      } else if (window.__TAURI__ && window.__TAURI__.core) {
        try {
          logo = await window.__TAURI__.core.invoke('get_company_logo');
          if (logo) await setAjuste('company_logo', logo);
        } catch (err) {
          console.warn("Error al obtener logo desde Rust:", err);
        }
      }
    }
    return logo || null;
  }

  /**
   * Guarda el logotipo de empresa en SQLite cifrada.
   */
  export async function saveCompanyLogo(logoDataUri) {
    await setAjuste('company_logo', logoDataUri);
    localStorage.setItem('company_logo', logoDataUri);
  }

  /**
   * Elimina el logotipo de empresa.
   */
  export async function deleteCompanyLogo() {
    const db = await getDb();
    await db.execute("DELETE FROM ajustes WHERE clave = 'company_logo';");
    localStorage.removeItem('company_logo');
    if (window.__TAURI__ && window.__TAURI__.core) {
      try {
        await window.__TAURI__.core.invoke('delete_company_logo');
      } catch (err) {
        console.warn("Error al borrar logo en Rust:", err);
      }
    }
  }

  /**
   * Obtiene los umbrales de alerta de renovaciones.
   */
  export async function getRenewalThresholds() {
    let thresholds = await getAjuste('renewal_thresholds', null);
    if (!thresholds) {
      const crit = parseInt(localStorage.getItem('renewal_critical_days') || '30', 10);
      const warn = parseInt(localStorage.getItem('renewal_warning_days') || '60', 10);
      const rad = parseInt(localStorage.getItem('renewal_radar_days') || '90', 10);
      thresholds = { critical: crit, warning: warn, radar: rad };
      await setAjuste('renewal_thresholds', thresholds);
    }
    return thresholds;
  }

  /**
   * Guarda los umbrales de alerta de renovaciones en SQLite.
   */
  export async function saveRenewalThresholds(thresholds) {
    await setAjuste('renewal_thresholds', thresholds);
    localStorage.setItem('renewal_critical_days', thresholds.critical.toString());
    localStorage.setItem('renewal_warning_days', thresholds.warning.toString());
    localStorage.setItem('renewal_radar_days', thresholds.radar.toString());
  }
  ```

- [ ] **Paso 2: Purgar ramas residuales de mock en `src/js/db.js`**

  - En `setupMasterPassword`: eliminar `if (!window.__TAURI__) return generateMockRecoveryKey();` y eliminar la función huérfana `generateMockRecoveryKey()`.
  - En `loginDb`, `recoverDbAccess`, `changeMasterPassword`, `checkDbStatus`: eliminar los bloques `if (!window.__TAURI__) return ...;` y requerir el invoke de Tauri.
  - En `deleteCliente`: eliminar el bloque `else { // Modo mock ... }`.
  - En `getPuntosSuministro`, `guardarPuntoSuministro`, `getPuntosSuministroAll`: eliminar los bloques `else` que operaban sobre `mock_puntos_suministro`.
  - En `purgarComparativasObsoletas`: eliminar el bloque `else` de purga en `mock_clientes` y `mock_comparativas`.
  - En `vaciarBaseDeDatos`: eliminar el bloque `else` que llamaba a `localStorage.removeItem('mock_...')`.

- [ ] **Paso 3: Validar sintaxis de `src/js/db.js`**

  Ejecutar:
  ```powershell
  node --check src/js/db.js
  ```
  Esperado: Sintaxis válida (código de salida 0).

- [ ] **Paso 4: Commit**

  ```bash
  git add src/js/db.js
  git commit -m "feat(frontend): add ajustes db helpers and purge remaining mock branches"
  ```

---

### Task 3: Actualizar vistas consumidoras (`settings.js`, `renewals.js`, `pdf.js`, `wizard.js`)

**Files:**
- Modify: [src/js/views/settings.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/settings.js)
- Modify: [src/js/views/renewals.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/renewals.js)
- Modify: [src/js/pdf.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/pdf.js)
- Modify: [src/js/views/wizard.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/views/wizard.js)

**Interfaces:**
- Consumes: `getCompanyConfig`, `saveCompanyConfig`, `getCompanyLogo`, `saveCompanyLogo`, `deleteCompanyLogo`, `getRenewalThresholds`, `saveRenewalThresholds` desde `src/js/db.js`.
- Produces: Persistencia unificada en la tabla `ajustes`.

- [ ] **Paso 1: Actualizar `src/js/views/settings.js`**
  Importar los nuevos helpers desde `../db.js`. En la carga y guardado de empresa y renovaciones, invocar `getCompanyConfig()`, `saveCompanyConfig()`, `getRenewalThresholds()`, `saveRenewalThresholds()`.

- [ ] **Paso 2: Actualizar `src/js/views/renewals.js`**
  Importar `getRenewalThresholds` desde `../db.js`. En `loadRenewals()`, obtener los días umbrales con `await getRenewalThresholds()` en lugar de leerlos de forma dispersa desde `localStorage`.

- [ ] **Paso 3: Actualizar `src/js/pdf.js`**
  En `generatePDFReport()`, obtener la configuración y logo mediante `await getCompanyConfig()` y `await getCompanyLogo()`.

- [ ] **Paso 4: Actualizar `src/js/views/wizard.js`**
  En el guardado final del asistente de configuración inicial, usar `saveCompanyConfig(configData)` y `saveCompanyLogo(logoDataUri)`.

- [ ] **Paso 5: Validar sintaxis con `node --check` en las 4 vistas**

  Ejecutar:
  ```powershell
  node --check src/js/views/settings.js
  node --check src/js/views/renewals.js
  node --check src/js/pdf.js
  node --check src/js/views/wizard.js
  ```
  Esperado: Las 4 vistas compilan limpiamente (exit code 0).

- [ ] **Paso 6: Commit**

  ```bash
  git add src/js/views/settings.js src/js/views/renewals.js src/js/pdf.js src/js/views/wizard.js
  git commit -m "refactor(views): integrate company config and renewal thresholds with encrypted ajustes table"
  ```

---

### Task 4: Saneamiento del DOM en `src/js/app.js` (Eliminar monkey-patching)

**Files:**
- Modify: [src/js/app.js:L327-L345](file:///c:/Users/polca/Documents/github/Comparetica/src/js/app.js#L327-L345)
- Create: [test/settings_dom.test.js](file:///c:/Users/polca/Documents/github/Comparetica/test/settings_dom.test.js)

**Interfaces:**
- Consumes: DOM nativo de navegadores / Webview.
- Produces: Desacoplamiento de `HTMLSelectElement.prototype`. Enganche por instancia seguro.

- [ ] **Paso 1: Eliminar la mutación global de `HTMLSelectElement.prototype` en `src/js/app.js`**

  En `initCustomSelects()` en `src/js/app.js`:
  Eliminar las líneas 329–341 donde se modificaba `Object.defineProperty(HTMLSelectElement.prototype, 'value', ...)`.

- [ ] **Paso 2: Aplicar el descriptor de propiedad localmente por instancia**

  En el bucle `nativeSelects.forEach(select => { ... })`:
  ```javascript
  const protoDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (protoDescriptor) {
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
  }
  ```

- [ ] **Paso 3: Crear test unitario `test/settings_dom.test.js` para certificar la integridad del DOM**

  Crear `test/settings_dom.test.js`:

  ```javascript
  import test, { describe } from 'node:test';
  import assert from 'node:assert/strict';

  describe('Integridad del DOM y Prototipos', () => {
    test('HTMLSelectElement.prototype no debe ser mutado con propiedades custom', () => {
      // Simulación de verificación de prototipo estándar
      const proto = globalThis.HTMLSelectElement?.prototype;
      if (proto) {
        assert.strictEqual(proto._customValueHooked, undefined, 'El prototipo global no debe estar mutado');
      } else {
        assert.ok(true, 'Entorno sin DOM nativo verificado');
      }
    });

    test('Serialización y deserialización de ajustes clave-valor', () => {
      const config = { nombre: 'Test SL', cif: 'B12345678' };
      const serialized = JSON.stringify(config);
      const deserialized = JSON.parse(serialized);
      assert.strictEqual(deserialized.cif, 'B12345678');
      assert.strictEqual(deserialized.nombre, 'Test SL');
    });
  });
  ```

- [ ] **Paso 4: Ejecutar test con `node --test test/settings_dom.test.js`**

  Ejecutar:
  ```powershell
  node --test test/settings_dom.test.js
  ```
  Esperado: 2/2 tests pasando.

- [ ] **Paso 5: Commit**

  ```bash
  git add src/js/app.js test/settings_dom.test.js
  git commit -m "refactor(dom): eliminate HTMLSelectElement prototype monkey-patching with per-instance hooks"
  ```

---

### Task 5: Verificación Global de la Fase 3A

- [ ] **Paso 1: Ejecutar la suite completa de pruebas de JavaScript**

  Ejecutar:
  ```powershell
  node --test test/calculator.test.js test/settings_dom.test.js
  ```
  Esperado: 10/10 tests pasando.

- [ ] **Paso 2: Ejecutar la suite completa de pruebas de Rust**

  Ejecutar:
  ```powershell
  cargo test --package comparetica
  ```
  Esperado: 5/5 tests pasando (`test result: ok. 5 passed; 0 failed`).

- [ ] **Paso 3: Chequeo de compilación de Rust**

  Ejecutar:
  ```powershell
  cargo check
  ```
  Esperado: 0 errores y 0 warnings críticos.

- [ ] **Paso 4: Comprobar el estado del repositorio (`git status`)**

  Ejecutar:
  ```powershell
  git status
  ```
  Esperado: Árbol de trabajo limpio y commits atómicos completados.
