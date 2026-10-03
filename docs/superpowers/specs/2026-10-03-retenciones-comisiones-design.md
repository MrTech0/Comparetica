# Retenciones y reparto de comisiones

Fecha: 2026-10-03

Estado: aprobado por el usuario; implementación autorizada.

Actualización del 2026-10-04: el usuario solicita eliminar los nombres de las retenciones y abrir el selector de asignación debajo del campo.

## Objetivo y decisiones acordadas

Gestionar distintos tipos de retención y repartir la comisión de cada nueva comparativa entre la consultoría y el comercial responsable del cliente.

- La retención expresa el porcentaje que conserva la consultoría.
- Un tipo de retención puede utilizarse en varios comerciales. Cada comercial admite como máximo un tipo asignado.
- La asignación es opcional: «0%» entrega toda la comisión al comercial.
- «Comisión» en el historial muestra la parte de la consultoría. Se añade «Comisión comercial» junto a ella.
- Los resúmenes de pendientes y cobradas muestran la parte de la consultoría.
- Las comparativas existentes conservan sus importes y se identifican como «Sin reparto registrado».
- Los cambios posteriores de retención o comercial no modifican el reparto de una comparativa guardada.

## 1. Ubicación y gestión

Integrar dos pestañas en «Gestión de Agentes y Comerciales», reutilizando el sistema de pestañas y los controles existentes:

1. **Agentes:** mantener su gestión actual y añadir la columna «Retención» y un selector en su formulario de alta/edición. La primera opción será «0%», con la explicación de que el comercial recibe el 100 %.
2. **Retenciones:** listado con porcentaje, comerciales asignados y acciones; formulario para crear o editar únicamente el porcentaje.

Cada porcentaje será único y el catálogo se ordenará de menor a mayor. El porcentaje admite de 0 a 100 inclusive y hasta dos decimales. Se aceptará coma o punto como separador decimal, validando siempre el valor antes de guardarlo. No se guardan nombres para los tipos de retención.

El selector de la ficha del comercial muestra únicamente los porcentajes y se abre debajo del campo. Su altura se adapta al espacio disponible, permitiendo desplazarse por la lista cuando sea necesario.

Un tipo podrá eliminarse cuando ningún comercial lo tenga asignado. Si sigue en uso, se indicará que debe cambiarse primero la asignación de esos comerciales. Los repartos históricos conservarán sus datos aunque el tipo o el comercial desaparezcan.

Editar el porcentaje afecta a las nuevas comparativas de todos los comerciales que utilizan ese tipo. El formulario explicará este efecto.

## 2. Cálculo del reparto

Trabajar con cantidades enteras en céntimos y con el porcentaje en centésimas de punto porcentual: 20,25 % se almacena como 2025; 100 % como 10000.

1. Convertir la comisión total del contrato a céntimos, conservando el importe total que ya guarda la app.
2. Calcular la parte de la consultoría: redondear a céntimos `total_centimos × porcentaje_centesimas / 10000`.
3. Calcular la parte del comercial como `total_centimos − consultoria_centimos`.

Así, las partes suman exactamente el total y el redondeo no produce una diferencia de un céntimo. Rechazar porcentajes o importes inválidos, negativos o fuera del intervalo numérico seguro.

| Total | Retención | Consultoría | Comercial |
|---:|---:|---:|---:|
| 100,00 € | 20 % | 20,00 € | 80,00 € |
| 250,00 € | 30 % | 75,00 € | 175,00 € |
| 100,00 € | Sin retención / 0 % | 0,00 € | 100,00 € |
| 100,00 € | 100 % | 100,00 € | 0,00 € |

## 3. Guardado e identidad del comercial

El reparto queda fijado al guardar la comparativa en el historial. Se utiliza el cliente seleccionado mediante su identificador, evitando deducir su comercial a partir de nombres que pueden repetirse o cambiar.

La persistencia guardará en la misma operación el total y una copia del reparto aplicado, con versión de formato, identificador y nombre del cliente/comercial, identificador de la retención, porcentaje e importes en céntimos. Los nuevos repartos usan la versión 2, sin nombre de retención. Se mantienen compatibles los repartos de versión 1; en pantalla se muestra solo su porcentaje.

La asignación del comercial y el porcentaje se verificarán en el momento del guardado, de forma que un cambio concurrente no guarde un reparto basado en datos obsoletos. Si el cliente o el comercial ya no están disponibles, se mostrará un error para revisar la ficha y se permitirá reintentar. Un fallo al leer los datos no se interpretará como una retención del 0 %.

Para luz y gas se aplica el porcentaje a la comisión calculada por la tarifa. Si se guarda una comparativa dual, se aplica al total conjunto una vez, con el mismo criterio de redondeo.

## 4. Historial y resúmenes

- «Comisión» muestra el importe de la consultoría y se ordena por ese importe.
- «Comisión comercial» muestra el importe que corresponde al comercial, con el mismo tratamiento de privacidad y formato monetario.
- El detalle del reparto permite consultar el total del contrato, el comercial y el porcentaje aplicado.
- Conservar las búsquedas por Cliente/CUPS y los filtros por Tipo, Estado, Contrato y Cobro.
- Conservar el bloqueo de Estado a los cinco segundos y al avanzar el contrato, la actualización de Contrato sin refrescar la fila y el bloqueo definitivo de un cobro registrado.

Las tarjetas se identificarán como comisiones de la consultoría. Se mantendrán los criterios actuales de inclusión según Estado, Contrato y Cobro, sustituyendo el importe total por la parte guardada de la consultoría.

El diálogo de cobro identificará el importe total del contrato y su reparto, para que se pueda comprobar por qué el resumen contabiliza únicamente la parte de la consultoría. El estado de cobro mantiene su significado actual de cobro del contrato; esta funcionalidad calcula el importe que corresponde al comercial.

### Comparativas anteriores

No deducir ni rellenar su reparto con la asignación actual del cliente. Se conserva su comisión total, señalada como «Sin reparto registrado», y la columna comercial muestra «—».

Estos importes se muestran aparte de los resúmenes de la consultoría, bajo «Importes totales sin reparto registrado», distinguiendo pendientes y cobradas. Al ordenar por «Comisión», las comparativas sin reparto se sitúan después de las que tienen una parte conocida de la consultoría, conservando su orden por fecha entre ellas.

## 5. Datos, migraciones y restauración

- Añadir una tabla `retenciones` con identificador y porcentaje validado y único.
- Migrar el catálogo anterior con nombres de forma atómica: unificar porcentajes repetidos conservando el identificador menor, actualizar las asignaciones de agentes y preservar el límite de identificadores ya usados. Los JSON históricos permanecen intactos. Si falla la migración, revertir los cambios y restaurar la comprobación de referencias.
- Añadir a `agentes` una referencia opcional `retencion_id`. El valor vacío significa 0 %.
- Añadir a `comparativas` un campo opcional `reparto_comision_json` para la copia inmutable del reparto. El campo vacío identifica las comparativas anteriores.
- Mantener `comision_total` como el importe total original del contrato.
- Aplicar migraciones compatibles tanto con instalaciones existentes como nuevas y con la restauración de copias anteriores. Repetir el arranque no debe alterar datos ni duplicar el catálogo.
- Guardar el catálogo, las asignaciones y los repartos dentro de la base cifrada actual, utilizando el formato de copia de seguridad existente.
- Conservar los datos de marca, logotipo, tarifa e inputs ya fijados en cada comparativa y el funcionamiento de sus PDF.

## 6. Componentes afectados

- `src-tauri/src/db.rs`: esquema, migraciones y pruebas de persistencia/restauración.
- `src/js/db.js`: gestión de retenciones, asignación a agentes y guardado del reparto.
- Un módulo de cálculo de reparto con validación y redondeo compartidos.
- `src/js/views/agents.js` y una vista de retenciones: pestañas, catálogo y selector de asignación.
- `src/js/views/calculator_view.js`: conservar la identidad del cliente al guardar.
- `src/js/views/history.js`: importes, detalle, ordenación, resúmenes y tratamiento del historial anterior.
- `src/index.html` y estilos existentes: controles y presentación coherentes con la app.
- README: documentar la funcionalidad y su estructura cuando esté implementada.

## 7. Verificación y entrega

Pruebas necesarias:

1. Porcentajes 0 %, 100 %, con decimales y valores inválidos; importes pequeños y redondeo; suma exacta de ambas partes.
2. Altas y edición de porcentajes, porcentajes repetidos, asignación opcional/única y eliminación de tipos en uso. Verificar que el selector aparece debajo en ventanas pequeñas y permite acceder a toda la lista.
3. Guardado con el cliente/comercial correctos aunque sus nombres se repitan; errores y cambios concurrentes.
4. Permanencia del reparto al editar la retención, reasignar clientes o eliminar sus referencias originales.
5. Conservación de comparativas anteriores y separación de sus importes en los resúmenes.
6. Interacción de ordenación/filtros con los nuevos importes y conservación de los bloqueos existentes.
7. Migración desde el esquema anterior y restauración de copias con y sin esta funcionalidad.
8. Suite completa de la app y comprobación manual en el servidor de desarrollo. Comprobar los cambios nativos necesarios sin generar una compilación de distribución.

Entregar pasos concretos para la prueba del usuario. Crear commits y subirlos a GitHub después de que confirme el funcionamiento, siguiendo el flujo acordado.
