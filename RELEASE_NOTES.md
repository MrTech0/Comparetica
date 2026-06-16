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
