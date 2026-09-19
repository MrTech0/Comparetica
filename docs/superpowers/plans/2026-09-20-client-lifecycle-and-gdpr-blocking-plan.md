# Plan de Implementación: Ciclo de Vida del Cliente y Bloqueo LOPD/RGPD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la gestión del ciclo de vida de clientes (estados Activo, Inactivo y Bloqueado LOPD) con detección inteligente de inactividad, exclusión automática de clientes no activos en el comparador y renovaciones, filtro interactivo en la cabecera de columna, diálogo modal de bloqueo LOPD con garantías legales y generación bajo demanda del Certificado LOPD en PDF.

**Architecture:** El modelo de datos en SQLite se amplía defensivamente con columnas `estado`, `bloqueado_en` y `bloqueado_hasta` en la tabla `clientes`, junto con parámetros configurables en `ajustes`. Una capa lógica en `db.js` calcula y sincroniza la inactividad en base a vencimientos de contratos y fecha de registro de clientes nuevos, mientras que `calculator_view.js` y `renewals.js` excluyen clientes no activos. La interfaz de usuario en `clients.js` agrega la columna de estado con menú de filtrado desplegable en la cabecera y modal de bloqueo con doble confirmación, y `pdf.js` genera en memoria el certificado oficial de bloqueo según el Art. 32 LOPD-GDD.

**Tech Stack:** SQLite nativo en Rust (Tauri 2), Vanilla JavaScript ES Modules, jsPDF, Material Design 3, `node:test` para pruebas unitarias frontend, `cargo test` para backend en Rust.

**Spec:** `docs/superpowers/specs/2026-09-20-client-lifecycle-and-gdpr-blocking-design.md`

## Global Constraints
- Preservar compatibilidad total con la base de datos cifrada existente `comparetica.db.enc`, `vault.json` y formato `.bak`.
- Cero dependencias npm nuevas.
- Mantener `"withGlobalTauri": true` y seguir usando la capa de abstracción `src/js/ipc.js` y `src/js/ui.js`.
- Cero ficheros planos temporales en disco: generación del certificado PDF bajo demanda 100% en memoria.
- Rigor legal en LOPD-GDD: los clientes en estado `bloqueado` no pueden recibir ofertas, ser seleccionados en comparativas, ni ser modificados por automatismos.

---

### Task 1: Migración del Esquema y Soporte Backend en `src-tauri/src/db.rs`

**Files:**
- Modify: `src-tauri/src/db.rs:458-480` (migración de esquema en `init_schema`)
- Test: `src-tauri/src/db.rs:1140+` (test unitario de migración y persistencia de columnas)

**Interfaces:**
- Produces: Columnas `estado` (TEXT DEFAULT 'activo'), `bloqueado_en` (TIMESTAMP), `bloqueado_hasta` (DATE) en la tabla `clientes`.

- [ ] **Step 1: Escribir el test en Rust que verifica la existencia y persistencia de los nuevos campos de estado**
  En `src-tauri/src/db.rs`, añadir el test `test_cliente_estado_columns_and_migration` que crea un cliente, comprueba su valor por defecto `activo`, actualiza su estado a `bloqueado` con fechas `bloqueado_en` y `bloqueado_hasta`, y valida su lectura.
- [ ] **Step 2: Ejecutar `cargo test` para verificar que compila y el test pasa tras la migración**
- [ ] **Step 3: Añadir la migración defensiva en `init_schema()` en `src-tauri/src/db.rs`**
  Verificar mediante `PRAGMA table_info(clientes)` si existen las columnas `estado`, `bloqueado_en`, `bloqueado_hasta`. Si no existen, ejecutar `ALTER TABLE clientes ADD COLUMN...`.
- [ ] **Step 4: Ejecutar `cargo test` y confirmar que todos los tests de Rust (7 tests) pasan**
- [ ] **Step 5: Commit:**
  ```bash
  git add src-tauri/src/db.rs
  git commit -m "feat(db): add estado and blocking columns to clientes with automated migration"
  ```

---

### Task 2: Capa de Datos, Parámetros en Ajustes y Lógica de Inactividad en `src/js/db.js`

**Files:**
- Modify: `src/js/db.js`
- Test: `test/client_lifecycle.test.js`

**Interfaces:**
- Produces:
  - `getClientInactivityParams()`: `{ mesesNuevo: number, diasVencimiento: number }`
  - `saveClientInactivityParams({ mesesNuevo, diasVencimiento })`
  - `syncClientesEstadoAutomatico()`: evalúa clientes activos y transiciona a inactivo si no tienen contratos vigentes ni cortesía
  - `getClientesPaginated(page, pageSize, search, agentId, statusFilter)`: soporte para filtro `statusFilter` ('activo', 'inactivo', 'bloqueado', o null)
  - `updateClienteEstado(id, nuevoEstado, { bloqueado_en, bloqueado_hasta } = {})`
  - `getClientesForSelect(limit, soloActivos = true)`: omite inactivos/bloqueados por defecto
  - `searchClientes(term, limit, soloActivos = true)`: omite inactivos/bloqueados por defecto

- [ ] **Step 1: Escribir pruebas unitarias en `test/client_lifecycle.test.js`**
  Validar la lógica de transición automática:
  - Cliente nuevo (< 3 meses) $\rightarrow$ se mantiene `activo`.
  - Cliente nuevo sin contratos (> 3 meses) $\rightarrow$ pasa a `inactivo`.
  - Cliente con 2 CUPS (1 activo, 1 vencido) $\rightarrow$ se mantiene `activo`.
  - Cliente con todos los CUPS vencidos (> 30 días de gracia) $\rightarrow$ pasa a `inactivo`.
  - Cliente en estado `bloqueado` $\rightarrow$ NUNCA es modificado por la sincronización automática.
- [ ] **Step 2: Ejecutar `node --test test/client_lifecycle.test.js` y comprobar que falla antes de la implementación**
- [ ] **Step 3: Implementar métodos en `src/js/db.js`**
  - Implementar `getClientInactivityParams` y `saveClientInactivityParams` con valores por defecto 3 meses y 30 días.
  - Implementar `syncClientesEstadoAutomatico` consultando clientes y sus contratos/renovaciones.
  - Actualizar `getClientesPaginated` para aceptar `statusFilter`.
  - Actualizar `getClientesForSelect` y `searchClientes` con `soloActivos = true` por defecto.
  - Implementar `updateClienteEstado`.
- [ ] **Step 4: Ejecutar `node --test` y verificar que todas las pruebas (46 existentes + nuevas) pasan**
- [ ] **Step 5: Commit:**
  ```bash
  git add src/js/db.js test/client_lifecycle.test.js
  git commit -m "feat(db): add client lifecycle management, inactivity auto-sync and state filtering"
  ```

---

### Task 3: Omisión de Clientes Inactivos/Bloqueados en el Comparador y Renovaciones

**Files:**
- Modify: `src/js/views/calculator_view.js`
- Modify: `src/js/views/renewals.js`
- Test: `test/client_lifecycle.test.js`

**Interfaces:**
- Consumes: `getClientes`, `searchClientes` filtrados por `estado = 'activo'`.

- [ ] **Step 1: Escribir pruebas de exclusión en `test/client_lifecycle.test.js`**
  Verificar que clientes inactivos o bloqueados no aparecen en las sugerencias del comparador ni en el recuento de renovaciones activas.
- [ ] **Step 2: Ejecutar el test para confirmar la expectativa de fallo/cobertura**
- [ ] **Step 3: Modificar `src/js/views/calculator_view.js`**
  - En la búsqueda y autocompletado (`client-name` input): filtrar para incluir exclusivamente clientes donde `client.estado === 'activo' || !client.estado`.
  - En la validación de cálculo de comparativa: comprobar que el cliente existe y está activo; si está inactivo o bloqueado, mostrar toast de advertencia impidiendo el cálculo.
- [ ] **Step 4: Modificar `src/js/views/renewals.js`**
  - En la consulta `SELECT r.* FROM renovaciones r JOIN clientes c ON r.cliente_id = c.id`: añadir `WHERE (c.estado = 'activo' OR c.estado IS NULL)`.
- [ ] **Step 5: Ejecutar `pnpm test` y verificar que las suites pasan**
- [ ] **Step 6: Commit:**
  ```bash
  git add src/js/views/calculator_view.js src/js/views/renewals.js test/client_lifecycle.test.js
  git commit -m "feat(calculator, renewals): exclude inactive and blocked clients from search and alerts"
  ```

---

### Task 4: Generador del Certificado de Bloqueo LOPD en PDF (`src/js/pdf.js`)

**Files:**
- Modify: `src/js/pdf.js`
- Test: `test/client_lifecycle.test.js`

**Interfaces:**
- Produces: `generateLopdCertificatePdf(cliente, companyConfig)`
- Consumes: `jsPDF`, `save_pdf` de IPC.

- [ ] **Step 1: Escribir prueba unitaria en `test/client_lifecycle.test.js` para la generación del contenido del certificado LOPD**
  Verificar que la función compila correctamente los datos legales: NIF, fecha de solicitud (`bloqueado_en`), fecha de expiración (`bloqueado_hasta` = +6 años), artículos de la ley (Art. 32 LOPDGDD, Art. 17.3.b RGPD, Art. 30 C.Comercio).
- [ ] **Step 2: Ejecutar `node --test` y verificar fallo inicial**
- [ ] **Step 3: Implementar `generateLopdCertificatePdf` en `src/js/pdf.js`**
  - Generar maquetación formal y elegante con cabecera corporativa, logotipo en base64 si existe, clausulado legal riguroso y bloque de firma.
  - Devolver la cadena base64 del PDF generado y conectarlo con `save_pdf` nativo.
- [ ] **Step 4: Ejecutar `node --test` y verificar que el test pasa**
- [ ] **Step 5: Commit:**
  ```bash
  git add src/js/pdf.js test/client_lifecycle.test.js
  git commit -m "feat(pdf): implement on-demand LOPD data blocking certificate generator"
  ```

---

### Task 5: Diálogo de Bloqueo LOPD y Filtro en Cabecera de Columna (`clients.js` y `index.html`)

**Files:**
- Modify: `src/index.html` (agregar modales de confirmación de bloqueo LOPD y estructura de cabecera con filtro)
- Modify: `src/js/views/clients.js` (lógica del menú en cabecera, chips de estado, modal de doble confirmación, llamada a descarga de certificado)

**Interfaces:**
- Consumes: `updateClienteEstado`, `generateLopdCertificatePdf`, `showToast`, `showConfirm`.

- [ ] **Step 1: Agregar el diálogo modal de Bloqueo LOPD en `src/index.html`**
  - `#dialog-client-lopd-block`: Modal explicativo con título "Bloqueo de Datos Personales (Art. 32 LOPD-GDD)", cuerpo con resumen legal, fecha de retención (+6 años), botón de Cancelar y botón primario "Confirmar Bloqueo de Datos".
  - `#dialog-client-unblock`: Modal de confirmación para reactivación voluntaria del cliente.
- [ ] **Step 2: Modificar la cabecera de la tabla en `src/index.html`**
  - Añadir columna `<th>` para **Estado** con botón interactivo de filtro contextual.
- [ ] **Step 3: Implementar la interactividad del filtro y el ciclo de vida en `src/js/views/clients.js`**
  - Al hacer clic en `<th>Estado ▾</th>`: abrir dropdown contextual con opciones `Todos`, `Activos`, `Inactivos`, `Bloqueados LOPD`.
  - Renderizado de badges M3: `Activo` (verde), `Inactivo` (ámbar), `Bloqueado` (rojo con icono candado).
  - Acciones por fila:
    - Cliente Activo: Botón "Marcar Inactivo", Botón "Baja LOPD".
    - Cliente Inactivo: Botón "Reactivar", Botón "Baja LOPD".
    - Cliente Bloqueado: Botón "📄 Certificado LOPD" (genera el PDF bajo demanda), Botón "Reactivar".
  - Gestión del flujo de "Baja LOPD":
    - Si es Potencial (sin contratos aceptados): confirmación de borrado definitivo directo.
    - Si es Real (con contratos aceptados): abre `#dialog-client-lopd-block`, confirma, actualiza a `bloqueado`, establece fechas y notifica que el certificado está disponible.
- [ ] **Step 4: Comprobar sintaxis con `node --check src/js/views/clients.js`**
- [ ] **Step 5: Commit:**
  ```bash
  git add src/index.html src/js/views/clients.js
  git commit -m "feat(clients): add column header status filter, LOPD blocking dialog and certificate trigger"
  ```

---

### Task 6: Parámetros de Inactividad en Ajustes (`src/js/views/settings.js` y `index.html`)

**Files:**
- Modify: `src/index.html` (inputs con descripción en la pestaña de parámetros/alertas)
- Modify: `src/js/views/settings.js` (lectura y persistencia de `cliente_inactivo_meses_nuevo` y `cliente_inactivo_dias_vencimiento`)

**Interfaces:**
- Consumes: `getClientInactivityParams`, `saveClientInactivityParams`.

- [ ] **Step 1: Agregar inputs en `src/index.html` dentro de `#panel-settings-alerts`**
  - Input `settings-client-inactive-months`: "Meses de cortesía para clientes nuevos" con descripción detallada.
  - Input `settings-client-inactive-days`: "Días de margen tras vencimiento de contrato" con descripción detallada.
- [ ] **Step 2: Modificar `src/js/views/settings.js` para cargar y guardar los parámetros en `ajustes`**
  - En `loadSettings()`: recuperar valores y asignarlos a los inputs (valores por defecto 3 y 30).
  - En `saveSettings()`: validar y persistir los nuevos ajustes.
- [ ] **Step 3: Comprobar sintaxis con `node --check src/js/views/settings.js`**
- [ ] **Step 4: Commit:**
  ```bash
  git add src/index.html src/js/views/settings.js
  git commit -m "feat(settings): add client inactivity parameters with descriptions to settings panel"
  ```

---

### Task 7: Verificación Global de la Solución

**Files:** Todos los modificados.

- [ ] **Step 1: Ejecutar la suite completa de Rust**:
  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml
  ```
  Asegurar 7/7 tests pasando.
- [ ] **Step 2: Ejecutar `cargo check`**:
  ```bash
  cargo check --manifest-path src-tauri/Cargo.toml
  ```
  Asegurar 0 errores y 0 advertencias.
- [ ] **Step 3: Ejecutar la suite completa de JavaScript**:
  ```bash
  pnpm test
  ```
  Asegurar que todas las pruebas pasen.
- [ ] **Step 4: Commit final o resumen de entrega**:
  Actualizar `task.md` y documentar los resultados en el `walkthrough.md`.
