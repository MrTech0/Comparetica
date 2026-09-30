# Muestras de compatibilidad con rusqlite 0.32.1

Estas muestras contienen únicamente datos ficticios. Se generaron con el módulo
`src-tauri/src/db.rs` del commit `343f839a6d4e46e0e534e5d63710f6b10b438334`,
rusqlite **0.32.1**, libsqlite3-sys **0.30.1** y SQLite **3.46.0**, antes de
actualizar las dependencias de la aplicación.

El cifrado original utiliza **aes-gcm 0.10.3** y **argon2 0.5.3**, según el
`Cargo.lock` de ese commit. Estas mismas muestras permiten comprobar que las
actualizaciones del cifrado mantienen la lectura de datos y copias anteriores,
el cambio de contraseña y la recuperación con la clave de emergencia.

- `database.enc` y `vault.json`: base cifrada y bóveda creadas mediante
  `DbState::setup_master_password` y `DbState::execute`. Incluyen un cliente,
  una comercializadora, una tarifa de gas con precios decimales y texto UTF-8.
- `legacy.sqlite`: copia SQLite sin cifrar, creada por la versión anterior,
  con un cliente y un esquema que todavía no incluye las columnas de agente,
  estado y bloqueo.
- `metadata.json`: versiones de origen, commit y credenciales **exclusivas de
  prueba**. No contiene contraseñas ni claves de ningún usuario.

Las pruebas de `db.rs` abren y modifican la base cifrada, restauran la pareja
base/bóveda y migran la copia sin cifrar. Después vuelven a abrir los datos
persistidos y comprueban sus valores.

Estas muestras deben permanecer fijas: regenerarlas con la versión actual
eliminaría la comprobación de compatibilidad con archivos anteriores. Las
muestras de una versión posterior deben guardarse en otro directorio.
