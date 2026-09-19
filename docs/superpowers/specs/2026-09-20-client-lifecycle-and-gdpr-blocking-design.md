# Especificación de Diseño: Ciclo de Vida del Cliente y Bloqueo LOPD/RGPD

## 1. Visión General y Objetivos

Esta especificación define el modelo, la lógica de negocio, la experiencia de usuario y las garantías legales para gestionar el ciclo de vida de los clientes en **Comparetica**, con especial atención a dos estados críticos:
1. **Inactividad Comercial Automática y Manual**: Detección inteligente de clientes que han dejado de colaborar con la asesoría (por vencimiento de contratos en sus CUPS o falta de actividad tras el alta).
2. **Baja por LOPD / Ejercicio del Derecho de Supresión (Bloqueo Legal)**: Tratamiento conforme al **Art. 17 del RGPD** y **Art. 32 de la Ley Orgánica 3/2018 (LOPDGDD)** en combinación con el **Art. 30 del Código de Comercio**, implementando el régimen de **bloqueo de datos**, generación bajo demanda del **Certificado de Bloqueo LOPD** en PDF y exclusión estricta de la operativa comercial.

---

## 2. Marco Legal y Requisitos Normativos

### 2.1. Derecho de Supresión vs. Obligación de Conservación
- **Art. 17.1 RGPD**: El interesado tiene derecho a obtener del responsable del tratamiento la supresión de sus datos personales.
- **Art. 17.3.b RGPD**: La supresión no aplica cuando el tratamiento sea necesario para el cumplimiento de una obligación legal que requiera el tratamiento de datos.
- **Art. 30 Código de Comercio (España)**: Los comerciantes deben conservar libros, correspondencia, documentación y justificantes concernientes a su negocio debidamente ordenados durante **6 años** a partir del último asiento realizado. En una asesoría energética, las comparativas aceptadas y contratos constituyen la justificación de las comisiones devengadas y transacciones.
- **Art. 32 LOPD-GDD (Bloqueo de Datos)**:
  - Cuando los datos deban ser suprimidos pero exista obligación legal de conservación, el responsable debe proceder a su **bloqueo**.
  - El bloqueo consiste en identificar y reservar los datos, adoptando medidas técnicas y organizativas para impedir su tratamiento (incluyendo visualización y uso comercial), manteniéndolos a disposición exclusiva de jueces, tribunales, Ministerio Fiscal o Administraciones Públicas competentes (AEPD, AEAT) para la exigencia de responsabilidades derivadas del tratamiento.
  - El plazo de conservación bloqueada es estrictamente el de prescripción de dichas responsabilidades (6 años).
  - Vencido el plazo, se procede a la destrucción o anonimización irreversible.

### 2.2. Distinción Operativa entre Tipos y Estados

| Dimensión | Valores | Significado |
| :--- | :--- | :--- |
| **Tipo de Cliente** | `Real` / `Potencial` | Se mantiene la lógica existente. `Real` si tiene al menos 1 comparativa aceptada; `Potencial` si solo tiene estudios pendientes/rechazados o ninguno. Determina si aplica o no la retención legal de 6 años. |
| **Estado del Cliente** | `activo` / `inactivo` / `bloqueado` | Refleja la situación operativa y legal actual del cliente en la asesoría. |

---

## 3. Modelo de Datos y Persistencia (SQLite)

### 3.1. Modificación de la Tabla `clientes`
Se incorporan 3 nuevas columnas a la tabla `clientes` (con migración defensiva en `src-tauri/src/db.rs:init_schema`):

```sql
ALTER TABLE clientes ADD COLUMN estado TEXT NOT NULL DEFAULT 'activo';
ALTER TABLE clientes ADD COLUMN bloqueado_en TIMESTAMP;
ALTER TABLE clientes ADD COLUMN bloqueado_hasta DATE;
```

- `estado`:
  - `'activo'`: Cliente con relación comercial vigente o nuevo en prospección.
  - `'inactivo'`: Cliente sin contratos vigentes o sin actividad tras el periodo de cortesía.
  - `'bloqueado'`: Cliente que ha solicitado la baja/supresión por LOPD y cuyos datos están legalmente bloqueados.
- `bloqueado_en`: Marca de tiempo ISO del momento exacto en que se ejecutó el bloqueo.
- `bloqueado_hasta`: Fecha límite calculada exactamente a 6 años vista (`date(bloqueado_en, '+6 years')`).

### 3.2. Parámetros de Configuración en `ajustes`
Se añaden dos claves configurables en la tabla `ajustes`:
1. `cliente_inactivo_meses_nuevo`: Número entero (por defecto `3`). Meses de cortesía para clientes nuevos antes de pasar a inactivos si no contratan.
2. `cliente_inactivo_dias_vencimiento`: Número entero (por defecto `30`). Días de gracia tras el vencimiento del último contrato/CUPS antes de considerar al cliente inactivo.

---

## 4. Reglas de Negocio del Ciclo de Vida

### 4.1. Detección y Transición Automática a Inactivo
Una rutina en `src/js/db.js` (`syncClientesEstadoAutomatico()`) se ejecuta al cargar la vista de clientes:
- Evalúa solo los clientes cuyo estado actual sea `'activo'`. **Los clientes en estado `'bloqueado'` nunca son alterados por ningún automatismo.**
- **Regla 1 (Clientes nuevos sin contratos ni comparativas aceptadas):**
  - Si `tiene_aceptada == false` y `dias_desde_creacion > (cliente_inactivo_meses_nuevo * 30)`, pasa a `'inactivo'`.
- **Regla 2 (Clientes con contratos/suministros CUPS):**
  - Un cliente tiene N puntos de suministro / renovaciones.
  - Si el cliente tiene **al menos un contrato vigente** (fecha de vencimiento futura o vencida hace $\le$ `cliente_inactivo_dias_vencimiento`), se mantiene `'activo'`.
  - Si **todos los contratos/renovaciones del cliente han vencido** hace más de `cliente_inactivo_dias_vencimiento` y no cuenta con nuevas comparativas recientes, pasa a `'inactivo'`.

### 4.2. Reactivación de Clientes
- **De Inactivo a Activo:**
  - Manualmente: Mediante botón en la tabla de clientes ("Reactivar").
  - Automáticamente: Si se registra una nueva renovación o se acepta una nueva comparativa.
- **De Bloqueado a Activo:**
  - Requiere acción manual explícita con diálogo de confirmación: *"El cliente solicitó el bloqueo LOPD. Si vuelve a contratar, confirma que dispones de nuevo consentimiento expreso para reactivarlo."*

---

## 5. Exclusión Estricta en el Comparador y Renovaciones

Tal y como se ha especificado:
1. **Comparador de Tarifas (`views/calculator_view.js`)**:
   - Al buscar o autocompletar clientes por nombre, CIF o CUPS: **los clientes con estado `'inactivo'` o `'bloqueado'` son completamente omitidos** de los resultados.
   - En la validación de existencia del cliente al calcular, solo se consideran válidos los clientes con `estado === 'activo'`. Si está inactivo o bloqueado, la app avisa: *"El cliente está inactivo o bloqueado. Para realizarle una comparativa, debes reactivarlo primero desde la sección de Clientes."*
2. **Selector de Clientes en el Asistente (`getClientesForSelect` / `searchClientes`)**:
   - Por defecto añade la cláusula `WHERE estado = 'activo'`.
3. **Gestión de Renovaciones (`views/renewals.js`)**:
   - La consulta de renovaciones filtra `WHERE c.estado = 'activo'` para que ninguna alerta ni llamada comercial se dirija a clientes inactivos o bloqueados por LOPD.

---

## 6. Interfaz de Usuario y Experiencia (UX)

### 6.1. Filtro en la Cabecera de Columna ("Estado")
- La tabla de clientes en `views/clients.js` incorpora la columna **Estado**:
  - Badge `[Activo]` (verde).
  - Badge `[Inactivo]` (gris / ámbar).
  - Badge `[Bloqueado LOPD]` (rojo / púrpura con icono de candado).
- La cabecera `<th>Estado ▾</th>` es interactiva:
  - Al hacer clic, abre un menú desplegable contextual flotante (M3 menu/dropdown).
  - Opciones de filtro:
    - **Todos**
    - **Activos**
    - **Inactivos**
    - **Bloqueados LOPD**
  - Al seleccionar una opción, se actualiza la paginación y la tabla inmediatamente. Si hay un filtro activo distinto de "Todos", la cabecera muestra un indicador visual (icono de filtro activo).

### 6.2. Flujo de Baja por LOPD (Modal con Doble Confirmación)
Al seleccionar la acción "Baja LOPD / Bloquear" en un cliente:
1. **Comprobación previa:**
   - Si el cliente es `Potencial` (sin comparativas aceptadas):
     - Diálogo: *"Este cliente no tiene contratos aceptados ni justificantes comerciales que deban conservarse por ley. Procede la supresión total inmediata. ¿Desea eliminar definitivamente todos sus datos?"*
     - Opciones: `Cancelar` / `Eliminar Definitivamente`.
   - Si el cliente es `Real` (con comparativas aceptadas):
     - Se abre el diálogo modal informativo: **"Bloqueo Legal de Datos (Art. 32 LOPD-GDD / Art. 17 RGPD)"**.
     - **Cuerpo del diálogo:**
       - Explica que no se puede borrar de inmediato por la obligación del Art. 30 del Código de Comercio (6 años).
       - Explica el cese inmediato de todo contacto comercial y la exclusión de comparativas/renovaciones.
       - Muestra la fecha exacta de expiración del bloqueo (Fecha actual + 6 años).
       - Informa que el certificado legal acreditativo quedará disponible para su descarga en cualquier momento.
     - **Doble confirmación:** Botón primario *"Confirmar Bloqueo de Datos"*.

### 6.3. Generación Bajo Demanda del Certificado LOPD (PDF)
- **Generación en memoria:** No se almacena ningún archivo PDF en disco. Se genera al vuelo mediante `jsPDF` cuando el usuario pulsa el botón **"📄 Certificado LOPD"** presente en las acciones del cliente bloqueado.
- **Contenido del Certificado:**
  - Membrete y logotipo de la asesoría (desde `getCompanyConfig()` y `getCompanyLogo()`).
  - Identificación del Responsable del Tratamiento y del Interesado (Cliente).
  - Fecha formal de aplicación del bloqueo (`bloqueado_en`).
  - Base jurídica motivada: Art. 17.3.b del RGPD, Art. 32 LOPD-GDD y Art. 30 Código de Comercio.
  - Fecha de expiración de la custodia legal (`bloqueado_hasta`).
  - Cláusula informativa de tutela de derechos ante la Agencia Española de Protección de Datos (AEPD).
  - Apertura del diálogo nativo de Tauri (`save_pdf`) para que el usuario guarde el archivo en la ubicación que elija.

### 6.4. Parámetros en Configuración (`views/settings.js`)
En la pestaña de Parámetros de Ajustes:
- Input numérico: **"Meses de cortesía para clientes nuevos"** (por defecto `3`).
  - Descripción de ayuda: *"Tiempo máximo que un cliente nuevo permanece como Activo sin necesidad de tener comparativas o contratos formalizados."*
- Input numérico: **"Margen de vencimiento de contratos (días)"** (por defecto `30`).
  - Descripción de ayuda: *"Días de margen posteriores al vencimiento del último contrato/CUPS antes de que el cliente sea clasificado automáticamente como Inactivo si no ha sido renovado."*

---

## 7. Plan de Verificación

1. **Pruebas de Base de Datos (Rust)**:
   - Migración automática: verificar que bases de datos existentes añaden las columnas `estado`, `bloqueado_en` y `bloqueado_hasta`.
   - Consulta y persistencia de estados.
2. **Pruebas de Lógica Frontend (`node:test`)**:
   - Evaluación automática de clientes inactivos (casuística nuevo cliente < 3 meses vs > 3 meses).
   - Casuística múltiples CUPS (1 activo + 2 vencidos = cliente Activo; todos vencidos + margen = cliente Inactivo).
   - Filtrado en el comparador (omisión de inactivos y bloqueados).
   - Generación del certificado LOPD en PDF con datos históricos de bloqueo.
3. **Pruebas de Interfaz (Manual)**:
   - Clic en cabecera de columna para filtrar.
   - Apertura del modal de bloqueo LOPD, doble confirmación y comprobación de que no se muestra en el comparador.
   - Descarga bajo demanda del PDF de certificado.
