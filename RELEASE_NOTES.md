# Novedades en la versión v0.2.3

Esta versión perfecciona las opciones del comparador de tarifas, simplifica los textos de cumplimiento normativo y amplía el modo privado del consultor.

### 📋 Cambios Introducidos:

* **⚖️ Simplificación y ajuste del Bono Social:**
  * Se elimina el campo de "Ayuda Bono Social (%)" del comparador por no ser viable su tramitación, garantizando un flujo más realista.
  * La "Tasa del Bono Social" fija diaria se mantiene para el cómputo del coste.

* **✍️ Reducción del texto de consentimiento LOPD/RGPD:**
  * Se ha simplificado la redacción del descargo de responsabilidad y conformidad en el formulario de cálculo.

* **🔒 Modo Privado en Gestión de Tarifas:**
  * El botón para activar/desactivar el "Modo Privado" (que difumina las comisiones del consultor) ahora también está disponible en la pestaña de "Gestión de Tarifas y Comisiones" para permitir ediciones seguras frente al cliente.

---

# Novedades en la versión v0.2.2

Esta versión introduce desgloses exactos en los reportes de comparativas de luz y gas, y una nueva pestaña "Acerca de" en el menú de configuración.

### 📋 Cambios Introducidos:

* **📊 Desglose de Factura 100% Real:**
  * Eliminadas las estimaciones porcentuales fijas de la columna "Actual" del reporte PDF.
  * Ahora el reporte muestra los costes anuales reales de potencia, energía, tasas e impuestos calculados de la factura real del cliente.
  * Añadidos campos opcionales para "Otros Conceptos / Mantenimiento" y "Reactiva / Penalizaciones" que se integran en la base imponible del reporte de forma dinámica y conforme a la normativa fiscal.
  * Las propuestas simulan la eliminación del mantenimiento mostrando el consiguiente ahorro comercial neto.

* **ℹ️ Nueva pestaña "Acerca de":**
  * Añadida una nueva sección en el panel de Configuración que muestra dinámicamente las versiones del software.
  * Informa de las versiones de la APP, Node.js, Rust, Tauri, SQLite y la librería jsPDF.

* **🔒 Ajuste de Visibilidad del Modo Privado:**
  * El interruptor de "Modo Privado" para ocultar comisiones del asesor se muestra exclusivamente en el menú del Historial de Comparativas.

---

# Novedades en la versión v0.2.1

Esta versión introduce mejoras de seguridad en los formularios de registro y refina la experiencia de búsqueda y cumplimiento legal de borrado.

### 📋 Cambios Introducidos:

* **🔍 Búsqueda Case y Accent Insensitive:**
  * Corregido un error de referencia de búsqueda en el menú de Clientes.
  * Implementado filtrado insensible a mayúsculas, minúsculas, tildes y diacríticos en las búsquedas de los paneles de *Gestión de Clientes* (por Nombre, CIF/DNI y CUPS) e *Historial de Comparativas* (por Nombre y CUPS).

* **🛡️ Validación de DNI / NIE / CIF:**
  * Se valida matemáticamente el formato y el carácter de control de los documentos de identidad españoles al registrar o actualizar clientes, previniendo errores tipográficos involuntarios.

* **⚖️ Aviso Informativo al Intentar Borrar Comparativas Aceptadas:**
  * Se permite hacer clic en el botón de borrar de las comparativas del historial que estén en estado *Aceptada*. En lugar de estar deshabilitado, al pulsarlo se muestra un diálogo modal Material Design 3 informativo sobre las obligaciones de retención del Artículo 30 del Código de Comercio.

---

# Novedades en la versión v0.2.0

Esta actualización introduce el nuevo régimen de retención legal obligatoria de datos y soluciona por completo el restablecimiento de fábrica limpio con reinicio de IDs a 1.

### 📋 Cambios Introducidos:

* **⚖️ Retención Legal Fija de Datos (Cumplimiento LOPDGDD y Código de Comercio):**
  * **Comparativas Aceptadas:** Se conservan obligatoriamente durante **6 años** (72 meses) para actuar como justificante mercantil. No se pueden eliminar manualmente del historial (botón de borrado bloqueado).
  * **Comparativas Pendientes/Rechazadas:** Se conservan durante **12 meses** desde su creación.
  * **Clientes Potenciales:** Se eliminan de forma automática si no tienen ninguna comparativa asociada activa tras **12 meses**.
  * Se elimina la configuración manual de retención por parte del usuario para evitar incumplimientos legales. Quedan detalladas informativamente en *Configuración > Parámetros*.

* **👥 Columna "Tipo Cliente" (Clientes Reales y Potenciales):**
  * Se inyecta una nueva columna en el panel de Gestión de Clientes que clasifica visualmente al cliente como **Real** (tiene al menos una comparativa aprobada) o **Potencial** mediante chips de Material Design 3.

* **⏱️ Periodo de Gracia de 1 Minuto para Cambio de Estado:**
  * Para prevenir errores de clic al cambiar el estado de una comparativa a *Aceptada* o *Rechazada*, se concede un periodo de gracia de 60 segundos para corregir el estado. Tras este lapso, el selector se bloquea definitivamente.

* **🔄 Restablecimiento de Fábrica Completo (IDs desde 1):**
  * Se solventa el problema por el cual los IDs de las comercializadoras (y demás tablas) no empezaban desde 1 tras restablecer la aplicación.
  * Implementada la eliminación física de los archivos de base de datos SQLite (`comparetica.db` y transacciones WAL) en el arranque nativo de la aplicación.
  * En producción, la app realiza un reinicio de proceso nativo inmediato, logrando un estado 100% libre de residuos y con IDs correlativos correctos.
