# Vectores de compatibilidad con Argon2 0.5.3

`derived-keys.json` contiene únicamente datos ficticios. Sus claves se
calcularon con **argon2 0.5.3** y la función `derive_key` del commit
`6f4e0085e1afc7a643969943f43467fa2fd13fa7`, antes de actualizar Argon2.

La derivación utiliza Argon2id versión 0x13, memoria 65536 KiB, 3 iteraciones,
1 vía y salida de 32 bytes. Las contraseñas se codifican como UTF-8.

- `old_vault_password` y `old_vault_recovery` reutilizan las credenciales y
  sales sintéticas de las muestras de `../rusqlite-0.32.1/`.
- `utf8_password` incluye tildes, eñe y un emoji; su sal son los bytes de 0 a 31.

La prueba ejecuta la función real y compara la salida con estos valores fijos.
Detecta cambios en la derivación que impedirían abrir las bóvedas anteriores.
Estos vectores deben permanecer fijos; no deben regenerarse con la versión nueva.
