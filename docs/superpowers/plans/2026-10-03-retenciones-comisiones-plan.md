# Plan de retenciones y reparto de comisiones

> Ejecución en esta sesión, con pruebas por tarea y revisión final independiente. El commit y la subida quedan pendientes de la prueba y confirmación del usuario.

**Especificación:** `docs/superpowers/specs/2026-10-03-retenciones-comisiones-design.md`.

## Restricciones generales

- Reutilizar las dependencias y el servidor de desarrollo actuales.
- Preservar las comparativas anteriores y los bloqueos del historial.
- Capturar el reparto al guardar con el ID estable del cliente, en una única sentencia SQL.
- Importes en céntimos; porcentajes en centésimas de punto porcentual.
- No crear commits hasta la confirmación manual del usuario.

## Tarea 1: cálculo, esquema y persistencia

**Archivos:** `src/js/commission_split.js`, `src/js/db.js`, `src-tauri/src/db.rs`, pruebas de cálculo/persistencia/migración.

**Interfaces:** `parseRetentionPercent(value)` devuelve un entero 0..10000; `moneyToCents(value)` redondea cantidades no negativas a céntimos; `splitCommission(total, percentage)` devuelve `total_centimos`, `consultoria_centimos`, `comercial_centimos`. `getCommissionSplit(comparison)` valida el JSON o devuelve null para registros anteriores. Snapshot versión 2 con cliente/comercial ID y nombre, retención ID, `porcentaje_centesimas` y las tres cantidades; admite también los snapshots existentes de versión 1.

1. Escribir y ejecutar pruebas de porcentajes, redondeo y snapshots inválidos. Esperado: fallo por módulo ausente.
2. Implementar cálculo sin pérdida de precisión y validación estricta. Esperado: pruebas verdes.
3. Escribir pruebas con SQLite real del catálogo, asignación, guardado atómico, clientes con nombres repetidos e inmutabilidad. Esperado: API/esquema ausentes.
4. Crear tabla `retenciones` (porcentaje entero único), referencia opcional de agentes y JSON opcional en comparativas; migraciones idempotentes. Migrar el catálogo anterior con nombres, unificando porcentajes y conservando asignaciones, IDs históricos y snapshots.
5. Añadir API CRUD; ampliar alta/edición de agentes con retención opcional y `addComparativa` con clienteId como décimo argumento. El INSERT SELECT toma el comercial y porcentaje actuales, y falla si falta la referencia.
6. Verificar migración y persistencia cifrada con pruebas Rust aisladas del ejecutable Tauri; catálogo y snapshots con SQLite real. Esperado: todos verdes.

## Tarea 2: calculadora y gestión de retenciones

**Archivos:** calculadora, agentes, nueva vista `retentions.js`, HTML y CSS, pruebas de formulario.

**Consume:** CRUD de tarea 1, porcentajes en centésimas, clienteId estable y opcional retencion_id.

1. Ampliar pruebas para comprobar que el cliente seleccionado llega al guardado; probar gestión, validaciones y reapertura sin duplicar eventos. Esperado: fallos por controles/datos ausentes.
2. Conservar clienteId en el resultado calculado y pasarlo al guardado; adaptar fixtures existentes a IDs reales.
3. Añadir pestañas Agentes/Retenciones; catálogo, diálogo y selector opcional. Mostrar únicamente el porcentaje en agentes, cargar opciones al abrir y refrescar al cambiar de pestaña. Abrir el selector debajo del campo con desplazamiento según el espacio disponible.
4. Prevenir escuchas duplicadas y dobles guardados; mostrar errores sin borrar formularios. Mantener reasignación, eliminación e inicio existentes.
5. Ejecutar pruebas de calculadora, agentes y catálogo. Esperado: todas verdes.

## Tarea 3: historial, privacidad y resúmenes

**Archivos:** historial, HTML/CSS, pruebas de historial.

**Consume:** snapshot validado de tarea 1; siempre conservar comision_total original.

1. Escribir pruebas de columnas, reparto, ordenación, pendientes/cobradas y registros anteriores. Esperado: importes/columnas/resúmenes incorrectos.
2. Mostrar Comisión de consultoría y Comisión comercial; detalle del total, comercial y porcentaje; ocultar datos monetarios en modo privado.
3. Separar importes anteriores sin reparto de las tarjetas de consultoría. Ordenar por neto conocido y situar anteriores al final por fecha.
4. Añadir reparto al diálogo de cobro y ajustar colspans. Mantener controles de estados, contrato y cobro.
5. Ejecutar pruebas de historial y bloqueos. Esperado: todas verdes.

## Tarea 4: documentación y verificación final

1. Actualizar README y estructura del código con la función y reglas históricas.
2. Ejecutar la suite completa Node y las comprobaciones nativas necesarias; revisar diff y residuos. Esperado: cero fallos, sin ejecutables nuevos.
3. Solicitar una única revisión independiente del conjunto y corregir hallazgos importantes con prueba RED/GREEN.
4. Entregar pasos de prueba manual del reparto, ausencia de retención, inmutabilidad e historial anterior. Esperar confirmación antes de commit/subida.

## Foco de revisión

Identidad estable al guardar, captura SQL atómica, precisión monetaria, corrupción del snapshot, errores de acceso al catálogo, asignación única, eliminación concurrente de tipos, migración/restauración, separación de históricos y privacidad. Revisar especialmente la conservación de eventos y bloqueos existentes del historial.
