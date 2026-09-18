# Especificación de Diseño - Fase 2: Robustez y Pruebas

## 1. Resumen y Objetivos

Esta especificación detalla el diseño de la **Fase 2** del proyecto Comparetica, centrada en elevar la robustez, fiabilidad y tolerancia a fallos del sistema mediante:
1. **Verificación formal del motor matemático financiero (`calculator.js`)** con una suite de pruebas unitarias exhaustiva basada en el runner nativo **`node:test`** de Node.js (sin introducir dependencias pesadas de npm).
2. **Persistencia atómica y resistencia ante apagones / caídas en Rust (`db.rs`)** mediante el patrón ACID de escritura temporal y reemplazo atómico con **`fs::rename`**.
3. **Control de casos límite y tolerancia ante datos anómalos** (ficheros vacíos, consumos nulos, cortes de suministro durante guardado).

---

## 2. Restricciones y Principios Globales

- **Cero regresiones:** Mantener 100% la compatibilidad con la base de datos cifrada (`comparetica.db.enc`), el esquema SQLite existente y la bóveda de claves (`vault.json`).
- **Sin dependencias npm añadidas:** Utilizar el ejecutor nativo `node:test` y `node:assert` disponible en el entorno Node.js, manteniendo la compatibilidad con una futura migración a Vite (Fase 3).
- **Aislamiento absoluto en pruebas:** Todas las pruebas de Rust y Node.js deben ejecutarse sin tocar ni mutar los datos de producción en `%APPDATA%`.
- **Integridad ACID en disco:** Las escrituras de la base de datos cifrada nunca deben dejar un fichero a medio escribir ni corrupto ante fallos imprevistos de alimentación o terminación del proceso.

---

## 3. Sección 1: Suite de Pruebas del Motor Matemático (`calculator.js`)

### 3.1. Arquitectura y Ubicación
- **Ruta del archivo de pruebas:** [`test/calculator.test.js`](file:///c:/Users/polca/Documents/github/Comparetica/test/calculator.test.js).
- **Módulo bajo prueba:** [`src/js/calculator.js`](file:///c:/Users/polca/Documents/github/Comparetica/src/js/calculator.js).
- **Herramienta:** Módulos estándar `node:test` y `node:assert/strict`.
- **Comando de ejecución:**
  ```powershell
  node --test test/calculator.test.js
  ```

### 3.2. Batería de Casos de Prueba

La suite contendrá 6 bloques principales de pruebas con aserciones numéricas estrictas ($\pm 0.001$ €):

#### Bloque 1: Tarifa 2.0TD Estándar (Doméstico / Pequeño Comercio)
- **Parámetros de entrada:**
  - Periodo: 30 días.
  - Potencias contratadas: P1 = 4.6 kW, P2 = 4.6 kW.
  - Consumos: P1 = 120 kWh, P2 = 90 kWh, P3 = 150 kWh (Total: 360 kWh).
  - Precios potencia: P1 = 30.50 €/kW/año, P2 = 12.20 €/kW/año.
  - Precios energía: P1 = 0.18 €/kWh, P2 = 0.14 €/kWh, P3 = 0.10 €/kWh.
  - Alquiler contador: 0.81 € (0.026767 €/día $\times$ 30 o valor fijo de periodo).
  - Impuesto Eléctrico (IEE): 5.11269%.
  - Financiación Bono Social: 0.038455 €/día $\times$ 30 = 1.15365 €.
  - IVA: 21%.
- **Validaciones:**
  - Potencia P1: $4.6 \times 30.50 \times (30 / 365) = 11.5315$ €.
  - Potencia P2: $4.6 \times 12.20 \times (30 / 365) = 4.6126$ €.
  - Potencia total: $16.1441$ €.
  - Energía: $(120 \times 0.18) + (90 \times 0.14) + (150 \times 0.10) = 21.60 + 12.60 + 15.00 = 49.20$ €.
  - Base IEE: Potencia + Energía = $16.1441 + 49.20 = 65.3441$ €.
  - Coste IEE: $65.3441 \times 0.0511269 = 3.3408$ €.
  - Base imponible: $65.3441 + 3.3408 + 0.81 + 1.15365 = 70.64855$ €.
  - IVA (21%): $70.64855 \times 0.21 = 14.8362$ €.
  - Total factura periodo: $85.4847$ €.
  - Proyección anual: Comprobar factor de escala exacto $365 / 30$.

#### Bloque 2: Tarifa 2.0TD con Autoconsumo y Compensación de Excedentes
- **Regla reguladora:** La compensación de excedentes descuenta del término de energía, pero el término de energía neta nunca puede ser inferior a 0 € (límite legal del RD 244/2019).
- **Caso A (Compensación parcial):**
  - Energía total: 49.20 €. Excedentes: 200 kWh a 0.08 €/kWh = 16.00 € descuento.
  - Término de energía neto: $49.20 - 16.00 = 33.20$ €.
  - Base del IEE calculada sobre Potencia + $33.20$ €.
- **Caso B (Compensación superior al consumo / Tope cero):**
  - Energía total: 30.00 €. Excedentes: 500 kWh a 0.10 €/kWh = 50.00 € descuento potencial.
  - Término de energía neto: debe ser exactamente **0.00 €** (no negativo).
  - Descuento real aplicado: **30.00 €**.
  - Base IEE: únicamente el término de potencia.

#### Bloque 3: Tarifa 2.0TD con Descuento de Bono Social Porcentual
- **Caso:** Consumidor vulnerable con 40% de descuento en términos de energía y potencia.
- **Validación:**
  - Base términos: Potencia + Energía.
  - Descuento Bono Social: $\text{Base} \times 0.40$.
  - Términos descontados: $\text{Base} \times 0.60$.
  - El IEE se aplica sobre la base ya descontada.

#### Bloque 4: Tarifa de Luz 3.0TD (6 Periodos)
- **Parámetros:**
  - 6 tramos de potencia contratada ($P_1$ a $P_6$).
  - 6 tramos de energía consumida ($P_1$ a $P_6$).
  - Penalizaciones por energía reactiva (recargo que suma a la base imponible).
  - Otros conceptos (mantenimiento o gestión).
- **Validación:**
  - Suma de 6 tramos de potencia proporcionales a días.
  - Suma de 6 tramos de energía.
  - Inclusión correcta de reactiva en base imponible y aplicación de IVA general.

#### Bloque 5: Factura de Gas (Tarifa RL.1 / RL.2 / TUR)
- **Parámetros:**
  - Periodo: 60 días. Consumo: 850 kWh.
  - Término fijo: 5.50 €/mes $\rightarrow$ Prorrateo: $5.50 \times (60 \times 12 / 365) = 10.8493$ €.
  - Término variable: $850 \times 0.065 = 55.25$ €.
  - Impuesto sobre Hidrocarburos: $850 \times 0.00234 = 1.989$ €.
  - Alquiler contador: 1.50 €.
  - Base imponible e IVA (21% o reducido según periodo).

#### Bloque 6: Robustez Numérica y Casos Límite
- Consumo 0 kWh (factura de mínimos: solo potencia y alquiler).
- Periodos con días arbitrarios (15 días, 31 días, año bisiesto 366 días).
- Validación de que no se producen valores `NaN`, `null` ni divisiones por cero.

---

## 4. Sección 2: Persistencia Atómica y Resistencia ante Caídas en Rust (`db.rs`)

### 4.1. Refactorización de `persist_db` en `src-tauri/src/db.rs`
- **Problema actual:** `fs::write(self.enc_db_path(), enc_bytes)` sobrescribe directamente en el destino.
- **Nuevo flujo atómico:**
  1. Obtener la ruta final: `let final_path = self.enc_db_path();`.
  2. Construir la ruta temporal en el mismo directorio: `let tmp_path = final_path.with_extension("enc.tmp");`.
  3. Crear el archivo `.tmp` y escribir `enc_bytes`:
     ```rust
     {
         let mut file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
         file.write_all(&enc_bytes).map_err(|e| e.to_string())?;
         file.sync_all().map_err(|e| e.to_string())?;
     }
     ```
  4. Realizar el reemplazo atómico mediante renombrado:
     ```rust
     fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;
     ```
  5. En caso de error durante la escritura previa al renombrado, limpiar el archivo `.tmp` para evitar residuos.

### 4.2. Refactorización de `open_db` en `src-tauri/src/db.rs`
- **Control de fichero vacío o corrupto:**
  - Al comprobar `enc_path.exists()`, verificar su tamaño con `fs::metadata(&enc_path)`.
  - Si el tamaño es `0` bytes, devolver un error explícito: `"El archivo de base de datos cifrada existe pero está vacío (0 bytes)."`.
- **Limpieza preventiva de `.tmp` huérfanos:**
  - Si existe `comparetica.db.enc.tmp` al arrancar (dejado por una caída previa del OS antes del rename), eliminarlo de forma segura.

### 4.3. Nueva Prueba Unitaria de Resiliencia en Rust
En `#[cfg(test)] mod tests` en [`src-tauri/src/db.rs`](file:///c:/Users/polca/Documents/github/Comparetica/src-tauri/src/db.rs):
- `test_atomic_persistence_and_empty_file_handling`:
  1. Configura una bóveda y base de datos en un directorio temporal aislado.
  2. Realiza inserciones y llama a `persist_db()`.
  3. Verifica que `comparetica.db.enc` existe, tiene contenido cifrado válido y que **no existe** ningún archivo residual `.tmp`.
  4. Simula un archivo vacío de 0 bytes y comprueba que `open_db` rechaza la apertura limpiamente con el mensaje de error esperado.

---

## 5. Plan de Verificación

1. **Pruebas de JavaScript:**
   ```powershell
   node --test test/calculator.test.js
   ```
   *Criterio de éxito:* 6/6 suites pasando, 0 fallos, 0 errores.
2. **Pruebas de Rust:**
   ```powershell
   cargo test --package comparetica
   ```
   *Criterio de éxito:* 4/4 pruebas unitarias pasando (`test_vault_and_login_lifecycle`, `test_recovery_key_flow`, `test_persistence_roundtrip_integrity`, `test_atomic_persistence_and_empty_file_handling`).
3. **Chequeo de compilación:**
   ```powershell
   cargo check
   ```
   *Criterio de éxito:* 0 errores, 0 advertencias críticas.
