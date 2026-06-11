# Novedades en la versión v0.1.7

- **Corrección de Checkbox Duplicado**: Solucionado el problema visual donde se renderizaba simultáneamente el checkbox nativo de HTML y el switch personalizado de Material 3 en la pestaña de Actualizaciones.
- **Robustez del Sistema de Actualizaciones**: Configurado un endpoint centralizado `latest.json` para simplificar y dinamizar futuras comprobaciones de versión sin requerir archivos individuales para cada versión nueva.
- **Detalle de Errores de Conexión**: Añadida la visualización detallada del mensaje de error exacto en la interfaz de usuario ante fallos de conexión o verificación con el servidor de actualizaciones.
- **Logging de Diagnóstico**: Registrado un comando en Rust (`log_frontend_error`) para capturar y reportar los fallos del frontend directamente en la terminal de diagnóstico de Tauri.
