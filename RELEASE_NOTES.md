# Novedades en la versión v0.1.6

- **Sistema de Actualizaciones Automáticas**: Implementación del plugin `tauri-plugin-updater` para mantener la aplicación actualizada de manera segura y consecutiva.
- **Pestaña "Actualizaciones" en Configuración**: Añadida una nueva sección para comprobar actualizaciones manualmente, ver el progreso de la descarga en tiempo real y alternar la comprobación automática.
- **Verificación al Iniciar**: La aplicación comprueba si hay nuevas versiones al arrancar, ofreciendo la opción de instalarla al momento o posponerla durante 24 horas (1 día natural).
- **Seguridad Criptográfica**: Regeneración de claves de firma con una contraseña robusta y configuración segura mediante variables de entorno en el pipeline de CI/CD.
- **Flujo de Integración Continua (CI/CD)**: Creación de un workflow en GitHub Actions para compilar, firmar y publicar automáticamente las releases firmadas en Windows sin el sufijo de idioma `_en-US`.
