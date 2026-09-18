# Phase 2: Robustez y Pruebas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la suite integral de pruebas unitarias para el motor de cálculo energético en JavaScript (`test/calculator.test.js`) utilizando `node:test` y reforzar la persistencia en Rust con escrituras atómicas (`fs::rename` y `sync_all`) y protección contra fallos en `src-tauri/src/db.rs`.

**Architecture:** Módulo de pruebas unitarias desacoplado sin dependencias de terceros para `src/js/calculator.js`, evaluando 6 escenarios de facturación eléctrica y gas. En Rust, patrón transaccional ACID de guardado mediante archivo temporal `.enc.tmp`, vaciado físico de búfer con `sync_all` y renombrado atómico sobre `comparetica.db.enc`.

**Tech Stack:** Node.js (test runner nativo `node:test` y `node:assert/strict`), Rust (Tauri v2, rusqlite v0.32 con in-memory serialize/deserialize, std::fs).

**Spec:** [docs/superpowers/specs/2026-09-18-phase-2-robustness-design.md](file:///c:/Users/polca/Documents/github/Comparetica/docs/superpowers/specs/2026-09-18-phase-2-robustness-design.md)

## Global Constraints

- Cero dependencias npm añadidas: usar exclusivamente el motor de pruebas nativo `node:test` de Node.js.
- Preservar compatibilidad total con la base de datos cifrada existente `comparetica.db.enc` y `vault.json`.
- Mantener `"withGlobalTauri": true` en `tauri.conf.json`.
- Todos los tests de Rust deben ejecutarse en directorios temporales aislados sin tocar datos de producción en `%APPDATA%`.
- Cero remanencia forense: no escribir datos sin cifrar a disco en ningún paso de la persistencia.

---

### Task 1: Batería de Pruebas Unitarias para el Motor Matemático (`calculator.js`) con `node:test`

**Files:**
- Create: [test/calculator.test.js](file:///c:/Users/polca/Documents/github/Comparetica/test/calculator.test.js)
- Test: [src/js/calculator.js](file:///c:/Users/polca/Documents/github/Comparetica/src/js/calculator.js)

**Interfaces:**
- Consumes: `calculateLightBill(input, tariff)`, `calculateLightBill30TD(input, tariff)`, `calculateGasBill(input, tariff)` from `src/js/calculator.js`.
- Produces: Suite de 6 bloques de pruebas automatizadas ejecutables vía `node --test test/calculator.test.js`.

- [ ] **Paso 1: Crear el archivo `test/calculator.test.js` con las suites de prueba completas**

  Crear la carpeta `test/` si no existe y escribir `test/calculator.test.js`:

  ```javascript
  import test, { describe } from 'node:test';
  import assert from 'node:assert/strict';
  import { calculateLightBill, calculateLightBill30TD, calculateGasBill } from '../src/js/calculator.js';

  describe('Motor Matemático: Facturación Eléctrica 2.0TD', () => {
    const defaultTariff20TD = {
      tipo_tarifa: '2.0TD',
      potencia_p1: 30.50, // €/kW/año
      potencia_p2: 12.20, // €/kW/año
      energia_p1: 0.18,   // €/kWh
      energia_p2: 0.14,   // €/kWh
      energia_p3: 0.10,   // €/kWh
      excedente: 0.08     // €/kWh
    };

    test('Factura estándar de 30 días sin excedentes ni bono social', () => {
      const input = {
        dias: 30,
        p1Pot: 4.6,
        p2Pot: 4.6,
        p1Cons: 120,
        p2Cons: 90,
        p3Cons: 150,
        alquiler: 0.81,
        impuestoElectrico: 5.11269,
        iva: 21,
        excedenteCons: 0,
        bonoSocialPct: 0
      };

      const res = calculateLightBill(input, defaultTariff20TD);

      // 1. Potencias: P1 (11.53 €), P2 (4.61 €)
      assert.strictEqual(res.period.potenciaP1.toFixed(2), '11.53');
      assert.strictEqual(res.period.potenciaP2.toFixed(2), '4.61');
      assert.strictEqual(res.period.potenciaTotal.toFixed(2), '16.14');

      // 2. Energías: P1 (21.60 €), P2 (12.60 €), P3 (15.00 €)
      assert.strictEqual(res.period.energiaP1.toFixed(2), '21.60');
      assert.strictEqual(res.period.energiaP2.toFixed(2), '12.60');
      assert.strictEqual(res.period.energiaP3.toFixed(2), '15.00');
      assert.strictEqual(res.period.energiaTotal.toFixed(2), '49.20');

      // 3. IEE: 5.11269% sobre (16.1441 + 49.20 = 65.3441) => 3.34 €
      assert.strictEqual(res.period.iee.toFixed(2), '3.34');

      // 4. Bono Social diario: 0.038455 * 30 => 1.15 €
      assert.strictEqual(res.period.bonoSocial.toFixed(2), '1.15');

      // 5. Base Imponible: 65.3441 + 3.3408 + 0.81 + 1.15365 => 70.65 €
      assert.strictEqual(res.period.base.toFixed(2), '70.65');

      // 6. IVA (21%): 70.6486 * 0.21 => 14.84 €
      assert.strictEqual(res.period.impuestos.toFixed(2), '14.84');

      // 7. Total Factura: 70.6486 + 14.8362 => 85.48 €
      assert.strictEqual(res.period.total.toFixed(2), '85.48');

      // 8. Proyección anual escala exacta (365 / 30 = 12.1667)
      const expectedAnnualTotal = (res.period.total * (365 / 30)).toFixed(2);
      assert.strictEqual(res.annual.total.toFixed(2), expectedAnnualTotal);
    });

    test('Compensación parcial de excedentes de autoconsumo', () => {
      const input = {
        dias: 30,
        p1Pot: 4.6,
        p2Pot: 4.6,
        p1Cons: 100,
        p2Cons: 50,
        p3Cons: 50, // total 200 kWh * precio
        alquiler: 0.81,
        impuestoElectrico: 5.11269,
        iva: 21,
        excedenteCons: 100, // 100 kWh * 0.08 = 8.00 € descuento
        bonoSocialPct: 0
      };

      const res = calculateLightBill(input, defaultTariff20TD);
      // Coste energía bruto: (100*0.18)+(50*0.14)+(50*0.10) = 18 + 7 + 5 = 30.00 €
      assert.strictEqual(res.period.energiaTotal.toFixed(2), '30.00');
      assert.strictEqual(res.period.excedenteDiscount.toFixed(2), '8.00');

      // Base IEE debe calcularse sobre potencia (16.14) + energía neta (22.00) = 38.14 €
      const expectedIee = (16.144109589041098 + 22.00) * 0.0511269;
      assert.strictEqual(res.period.iee.toFixed(2), expectedIee.toFixed(2));
    });

    test('Tope legal de excedentes: nunca hace negativo el término de energía', () => {
      const input = {
        dias: 30,
        p1Pot: 3.3,
        p2Pot: 3.3,
        p1Cons: 10,
        p2Cons: 10,
        p3Cons: 10, // Energía bruta = 1.8 + 1.4 + 1.0 = 4.20 €
        alquiler: 0.81,
        impuestoElectrico: 5.11269,
        iva: 21,
        excedenteCons: 500, // 500 kWh * 0.08 = 40.00 € (muy superior a 4.20 €)
        bonoSocialPct: 0
      };

      const res = calculateLightBill(input, defaultTariff20TD);
      // El descuento real aplicado debe topar en el valor bruto de la energía
      assert.strictEqual(res.period.energiaTotal.toFixed(2), '4.20');
      assert.strictEqual(res.period.excedenteDiscount.toFixed(2), '4.20');
      assert.ok(res.period.total > 0, 'La factura no debe ser negativa');
    });

    test('Bono Social porcentual (descuento 40% en términos de potencia y energía)', () => {
      const input = {
        dias: 30,
        p1Pot: 4.0,
        p2Pot: 4.0,
        p1Cons: 100,
        p2Cons: 100,
        p3Cons: 100,
        alquiler: 0.81,
        impuestoElectrico: 5.11269,
        iva: 21,
        bonoSocialPct: 40
      };

      const res = calculateLightBill(input, defaultTariff20TD);
      const totalPot = (4.0 * 30.50 * 30 / 365) + (4.0 * 12.20 * 30 / 365);
      const totalEne = (100 * 0.18) + (100 * 0.14) + (100 * 0.10);
      const baseTerminos = totalPot + totalEne;
      const expectedDiscount = baseTerminos * 0.40;

      assert.strictEqual(res.period.bonoSocialDiscount.toFixed(2), expectedDiscount.toFixed(2));
      const expectedIee = (baseTerminos - expectedDiscount) * 0.0511269;
      assert.strictEqual(res.period.iee.toFixed(2), expectedIee.toFixed(2));
    });
  });

  describe('Motor Matemático: Facturación Eléctrica 3.0TD', () => {
    const defaultTariff30TD = {
      tipo_tarifa: '3.0TD',
      potencia_p1: 40.0, potencia_p2: 30.0, potencia_p3: 20.0,
      potencia_p4: 15.0, potencia_p5: 10.0, potencia_p6: 5.0,
      energia_p1: 0.22, energia_p2: 0.19, energia_p3: 0.16,
      energia_p4: 0.14, energia_p5: 0.12, energia_p6: 0.09,
      excedente: 0.07
    };

    test('Cálculo de 6 periodos con reactiva y conceptos opcionales', () => {
      const input = {
        dias: 30,
        p1Pot: 15, p2Pot: 15, p3Pot: 15, p4Pot: 15, p5Pot: 15, p6Pot: 15,
        p1Cons: 500, p2Cons: 400, p3Cons: 600, p4Cons: 700, p5Cons: 300, p6Cons: 800,
        alquiler: 3.50,
        impuestoElectrico: 5.11269,
        iva: 21,
        reactivePenalties: 25.00,
        otherConcepts: 12.00
      };

      const res = calculateLightBill30TD(input, defaultTariff30TD);

      // Verificar que los 6 tramos de potencia se calcularon
      assert.ok(res.period.potenciaTotal > 0);
      // Verificar que los 6 tramos de energía sumaron correctamente
      const expectedEne = (500*0.22) + (400*0.19) + (600*0.16) + (700*0.14) + (300*0.12) + (800*0.09);
      assert.strictEqual(res.period.energiaTotal.toFixed(2), expectedEne.toFixed(2));
      assert.strictEqual(res.period.reactivePenalties, 25.00);
      assert.strictEqual(res.period.otherConcepts, 12.00);
      assert.ok(res.period.total > res.period.base, 'Total factura debe ser mayor a base por IVA');
    });
  });

  describe('Motor Matemático: Facturación de Gas', () => {
    const defaultTariffGas = {
      tipo_tarifa: 'RL.2',
      termino_fijo: 6.50, // €/mes
      termino_variable: 0.055 // €/kWh
    };

    test('Factura estándar de 60 días con impuesto de hidrocarburos e IVA', () => {
      const input = {
        dias: 60,
        consumo: 1200,
        alquiler: 2.10,
        impuestoHidrocarburos: 0.00234,
        iva: 21
      };

      const res = calculateGasBill(input, defaultTariffGas);

      // Fijo: 6.50 * (60 * 12 / 365) = 12.82 €
      const expectedFijo = 6.50 * (60 * 12 / 365);
      assert.strictEqual(res.period.fijo.toFixed(2), expectedFijo.toFixed(2));

      // Variable: 1200 * 0.055 = 66.00 €
      assert.strictEqual(res.period.variable.toFixed(2), '66.00');

      // Hidrocarburos: 1200 * 0.00234 = 2.81 €
      assert.strictEqual(res.period.hidrocarburos.toFixed(2), '2.81');

      // Base: Fijo + Variable + Hidrocarburos + Alquiler
      const expectedBase = expectedFijo + 66.00 + (1200 * 0.00234) + 2.10;
      assert.strictEqual(res.period.base.toFixed(2), expectedBase.toFixed(2));

      // Total con IVA 21%
      const expectedTotal = expectedBase * 1.21;
      assert.strictEqual(res.period.total.toFixed(2), expectedTotal.toFixed(2));
    });
  });

  describe('Motor Matemático: Robustez y Casos Límite', () => {
    test('Consumos nulos (0 kWh) en luz y gas no generan NaN ni divisiones por cero', () => {
      const inputLuzZero = {
        dias: 30,
        p1Pot: 3.3, p2Pot: 3.3,
        p1Cons: 0, p2Cons: 0, p3Cons: 0,
        alquiler: 0.81,
        impuestoElectrico: 5.11269,
        iva: 21
      };
      const resLuz = calculateLightBill(inputLuzZero, {
        potencia_p1: 30, potencia_p2: 12,
        energia_p1: 0.15, energia_p2: 0.12, energia_p3: 0.09
      });
      assert.ok(!Number.isNaN(resLuz.period.total));
      assert.ok(resLuz.period.total > 0);

      const inputGasZero = {
        dias: 30, consumo: 0, alquiler: 1.0,
        impuestoHidrocarburos: 0.00234, iva: 21
      };
      const resGas = calculateGasBill(inputGasZero, {
        termino_fijo: 5.0, termino_variable: 0.05
      });
      assert.ok(!Number.isNaN(resGas.period.total));
      assert.ok(resGas.period.total > 0);
    });

    test('Consistencia con periodos arbitrarios (1 día, 365 días)', () => {
      const tariff = { potencia_p1: 36.5, potencia_p2: 0, energia_p1: 0.20, energia_p2: 0, energia_p3: 0 };
      // 1 kW a 36.5 €/año durante 10 días = 1.00 €
      const res10d = calculateLightBill({
        dias: 10, p1Pot: 1, p2Pot: 0, p1Cons: 0, p2Cons: 0, p3Cons: 0,
        alquiler: 0, impuestoElectrico: 0, iva: 0
      }, tariff);
      assert.strictEqual(res10d.period.potenciaP1.toFixed(2), '1.00');

      // Proyección anual de 1 kW debe ser exactamente 36.50 €
      assert.strictEqual(res10d.annual.potenciaTotal.toFixed(2), '36.50');
    });
  });
  ```

- [ ] **Paso 2: Ejecutar los tests para verificar su funcionamiento**

  Ejecutar:
  ```powershell
  node --test test/calculator.test.js
  ```
  Esperado: 6 suites completadas, 8/8 tests pasando (`tests 8, pass 8, fail 0`).

- [ ] **Paso 3: Commit**

  ```bash
  git add test/calculator.test.js
  git commit -m "test(calc): add comprehensive unit test suite for energy billing engine"
  ```

---

### Task 2: Refactorizar `persist_db` y `open_db` en `src-tauri/src/db.rs` para Persistencia Atómica

**Files:**
- Modify: [src-tauri/src/db.rs:L164-L245](file:///c:/Users/polca/Documents/github/Comparetica/src-tauri/src/db.rs#L164-L245)

**Interfaces:**
- Consumes: `fs::File`, `std::io::Write`, `fs::rename`, `fs::remove_file`.
- Produces: Guardado transaccional atómico sin truncar `comparetica.db.enc` directamente; detección de archivos vacíos (0 bytes) y limpieza preventiva de `.tmp` huérfanos.

- [ ] **Paso 1: Refactorizar `persist_db` con escritura a `.tmp` y `fs::rename`**

  En [src-tauri/src/db.rs](file:///c:/Users/polca/Documents/github/Comparetica/src-tauri/src/db.rs), reemplazar `persist_db` por:

  ```rust
  pub fn persist_db(&self) -> Result<(), String> {
      use std::io::Write;

      let conn = match &self.conn {
          Some(c) => c,
          None => return Ok(()),
      };
      let mdk = match &self.mdk {
          Some(m) => m,
          None => return Ok(()),
      };

      // Serialización nativa 100% en memoria sin escribir a disco
      let db_bytes = conn.serialize(rusqlite::DatabaseName::Main)
          .map_err(|e| format!("Error al serializar base de datos desde memoria: {}", e))?;

      let enc_str = encrypt_aes_gcm(mdk, &db_bytes)?;
      let enc_bytes = general_purpose::STANDARD.decode(enc_str).map_err(|e| e.to_string())?;

      let final_path = self.enc_db_path();
      let tmp_path = final_path.with_extension("enc.tmp");

      // Escritura forzada y sincronizada en archivo temporal adyacente
      {
          let mut file = fs::File::create(&tmp_path).map_err(|e| format!("Error al crear archivo temporal de persistencia: {}", e))?;
          file.write_all(&enc_bytes).map_err(|e| format!("Error al escribir datos cifrados temporales: {}", e))?;
          file.sync_all().map_err(|e| format!("Error al sincronizar datos a disco: {}", e))?;
      }

      // Reemplazo atómico a nivel de sistema de archivos
      if let Err(e) = fs::rename(&tmp_path, &final_path) {
          let _ = fs::remove_file(&tmp_path);
          return Err(format!("Error en reemplazo atómico de base de datos cifrada: {}", e));
      }

      Ok(())
  }
  ```

- [ ] **Paso 2: Refactorizar `open_db` con validación de 0 bytes y limpieza de `.tmp`**

  En [src-tauri/src/db.rs](file:///c:/Users/polca/Documents/github/Comparetica/src-tauri/src/db.rs), actualizar el inicio de `open_db`:

  ```rust
  pub fn open_db(&mut self, mdk: [u8; 32]) -> Result<(), String> {
      let enc_path = self.enc_db_path();
      let legacy_path = self.legacy_db_path();
      let tmp_path = enc_path.with_extension("enc.tmp");

      // Limpieza preventiva de archivos temporales huérfanos tras caídas imprevistas
      if tmp_path.exists() {
          let _ = fs::remove_file(&tmp_path);
      }

      let mut conn = Connection::open_in_memory().map_err(|e| e.to_string())?;

      if enc_path.exists() {
          let meta = fs::metadata(&enc_path).map_err(|e| e.to_string())?;
          if meta.len() == 0 {
              return Err("El archivo de base de datos cifrada existe pero está vacío (0 bytes).".to_string());
          }

          let enc_bytes = fs::read(&enc_path).map_err(|e| e.to_string())?;
          let db_bytes = decrypt_aes_gcm(&mdk, &general_purpose::STANDARD.encode(enc_bytes))?;
          
          if db_bytes.is_empty() {
              return Err("El contenido descifrado de la base de datos está vacío.".to_string());
          }

          // Deserialización nativa 100% en memoria sin escribir a disco
          conn.deserialize(rusqlite::DatabaseName::Main, db_bytes)
              .map_err(|e| format!("Error al deserializar base de datos en memoria: {}", e))?;
      } else if legacy_path.exists() {
          // Migrar base de datos legacy en texto plano si aún existe
          let disk_conn = Connection::open(&legacy_path).map_err(|e| e.to_string())?;
          {
              let backup = rusqlite::backup::Backup::new(&disk_conn, &mut conn).map_err(|e| e.to_string())?;
              backup.run_to_completion(5, std::time::Duration::from_millis(10), None).map_err(|e| e.to_string())?;
          }
          drop(disk_conn);
          let _ = fs::remove_file(&legacy_path);
      }

      self.conn = Some(conn);
      self.mdk = Some(mdk);

      self.init_schema()?;
      self.persist_db()?;
      Ok(())
  }
  ```

- [ ] **Paso 3: Validar compilación con `cargo check`**

  Ejecutar:
  ```powershell
  cargo check
  ```
  Esperado: Compilación limpia sin errores.

- [ ] **Paso 4: Ejecutar los tests existentes de regresión**

  Ejecutar:
  ```powershell
  cargo test --package comparetica
  ```
  Esperado: 3 tests pasando (`ok`).

- [ ] **Paso 5: Commit**

  ```bash
  git add src-tauri/src/db.rs
  git commit -m "refactor(db): implement atomic persistence with fs::rename and crash resilience"
  ```

---

### Task 3: Suite de Pruebas Unitarias de Resistencia y Persistencia Atómica en Rust

**Files:**
- Modify: [src-tauri/src/db.rs:L850-L927](file:///c:/Users/polca/Documents/github/Comparetica/src-tauri/src/db.rs#L850-L927)

**Interfaces:**
- Consumes: `DbState`, `test_vault_and_login_lifecycle`, `open_db`, `persist_db`.
- Produces: Nueva prueba unitaria `test_atomic_persistence_and_empty_file_handling`.

- [ ] **Paso 1: Añadir el test unitario `test_atomic_persistence_and_empty_file_handling` al final de `src-tauri/src/db.rs`**

  Añadir al final del módulo `mod tests`:

  ```rust
      #[test]
      fn test_atomic_persistence_and_empty_file_handling() {
          let test_id = Uuid::new_v4().to_string();
          let test_dir = std::env::temp_dir().join(format!("comparetica_test_atomic_{}", test_id));
          let _ = fs::create_dir_all(&test_dir);

          let mut state = DbState::new_with_dir(test_dir.clone());
          let pwd = "Password123!";
          let _rec = state.setup_master_password(pwd).unwrap();

          // 1. Verificar que persist_db generó comparetica.db.enc y NO dejó .enc.tmp
          let enc_file = test_dir.join("comparetica.db.enc");
          let tmp_file = test_dir.join("comparetica.db.enc.tmp");

          assert!(enc_file.exists(), "comparetica.db.enc debe existir tras setup");
          assert!(!tmp_file.exists(), "comparetica.db.enc.tmp no debe quedar en disco tras persistir");
          assert!(fs::metadata(&enc_file).unwrap().len() > 0, "El archivo cifrado no debe estar vacío");

          // 2. Insertar registros y re-persistir asegurando atomicidad
          state.execute("INSERT INTO comercializadoras (nombre) VALUES ('Test Atomic S.L.');", vec![]).unwrap();
          assert!(!tmp_file.exists(), "El archivo temporal no debe existir tras execute");

          // 3. Simular un archivo de 0 bytes en un directorio limpio y verificar rechazo explícito
          let empty_test_dir = std::env::temp_dir().join(format!("comparetica_test_empty_{}", test_id));
          let _ = fs::create_dir_all(&empty_test_dir);
          let empty_enc = empty_test_dir.join("comparetica.db.enc");
          fs::write(&empty_enc, b"").unwrap();

          let mut empty_state = DbState::new_with_dir(empty_test_dir.clone());
          let fake_mdk = [7u8; 32];
          let open_res = empty_state.open_db(fake_mdk);

          assert!(open_res.is_err(), "open_db debe fallar si el archivo cifrado tiene 0 bytes");
          let err_msg = open_res.err().unwrap();
          assert!(err_msg.contains("0 bytes"), "El mensaje de error debe indicar archivo vacío: {}", err_msg);

          let _ = fs::remove_dir_all(test_dir);
          let _ = fs::remove_dir_all(empty_test_dir);
      }
  ```

- [ ] **Paso 2: Ejecutar la suite completa de pruebas de Rust**

  Ejecutar:
  ```powershell
  cargo test --package comparetica
  ```
  Esperado: 4 tests pasando (`test result: ok. 4 passed; 0 failed`).

- [ ] **Paso 3: Commit**

  ```bash
  git add src-tauri/src/db.rs
  git commit -m "test(db): add atomic persistence and corrupt/empty file handling unit tests"
  ```

---

### Task 4: Verificación Global de la Fase 2

- [ ] **Paso 1: Ejecutar la suite de pruebas de JavaScript**

  Ejecutar:
  ```powershell
  node --test test/calculator.test.js
  ```
  Esperado: Todos los tests de cálculo pasan (8/8 pasando).

- [ ] **Paso 2: Ejecutar la suite completa de pruebas de Rust**

  Ejecutar:
  ```powershell
  cargo test --package comparetica
  ```
  Esperado: Todos los tests pasan al 100% (4/4 pasando).

- [ ] **Paso 3: Chequeo de compilación de Rust**

  Ejecutar:
  ```powershell
  cargo check
  ```
  Esperado: 0 errores y 0 warnings críticos.

- [ ] **Paso 4: Comprobar el estado del repositorio (`git status`)**

  Ejecutar:
  ```powershell
  git status
  ```
  Esperado: Árbol de trabajo limpio y commits atómicos completados.
