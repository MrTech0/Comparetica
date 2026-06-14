# Novedades en la versión v0.1.8

Esta actualización introduce mejoras en la precisión de los cálculos del comparador, reajustes visuales y estructuración dinámica en las copias de seguridad de la aplicación:

- **Nombres Dinámicos de Copias de Seguridad**: Las copias de seguridad generadas automáticamente y de manera manual ahora incluyen marcas de tiempo legibles en sus nombres de archivo:
  - Copia manual: `comparetica_manual_backup_DIA_MES_HORA_MINUTO_SEGUNDO.db`
  - Copia automática al salir: `comparetica_auto_backup_DIA_MES_HORA_MINUTO_SEGUNDO.db`
- **Alineación del Impuesto Eléctrico**: Se establece el valor por defecto en `5.11269632%` y se aumenta la precisión del campo a 8 decimales en el Comparador de Tarifas.
- **Financiación del Bono Social configurable**: Añadido el campo regulado de "Financiación Bono Social (€/día)" sin valor por defecto (obligatorio) y con soporte para hasta 6 decimales de precisión.
- **Bono Social (%) configurable**: El descuento del bono social se inicia vacío, y en caso de no rellenarse se interpreta como que el cliente no tiene bonificación (0% de descuento). Soporta hasta 2 decimales de precisión.
- **Exclusión en Tarifas de Grandes Consumidores (3.0TD)**: Dado que el Bono Social (%) es una medida exclusiva para particulares, el campo de descuento (%) se oculta automáticamente si se selecciona una tarifa de tipo `3.0TD`, forzando además que su valor en el motor de cálculo sea `0`.
- **Ajustes de Proximidad en la Interfaz**: Los campos de "Bono Social (%)" y "Financiación Bono Social (€/día)" ahora se disponen juntos mediante una estructura flexbox, evitando el distanciamiento excesivo y la desalineación visual en pantallas anchas.
- **Correcciones y Depuración**: Eliminada la advertencia de compilación por importación obsoleta de `UNIX_EPOCH` en Rust.
