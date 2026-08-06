use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use base64::{Engine as _, engine::general_purpose};
use argon2::{Argon2, Algorithm, Version, Params};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use rand::{RngCore, thread_rng};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Value, Map};

#[derive(Serialize, Deserialize, Debug)]
pub struct ClienteImportRow {
    pub nombre_empresa: String,
    pub cif: String,
    pub representante: Option<String>,
    pub cups: Option<String>,
    pub email: Option<String>,
    pub agente_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RenovacionImportRow {
    pub cliente_id: i64,
    pub tipo_energia: Option<String>,
    pub cups: Option<String>,
    pub comercializadora_actual: Option<String>,
    pub tarifa_actual: Option<String>,
    pub fecha_firma: String,
    pub duracion_meses: Option<i32>,
    pub fecha_vencimiento: String,
    pub notas: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VaultConfig {
    pub is_initialized: bool,
    pub salt_password: String,
    pub salt_recovery: String,
    pub encrypted_mdk_password: String,
    pub encrypted_mdk_recovery: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DbStatus {
    pub is_initialized: bool,
    pub is_unlocked: bool,
    pub needs_migration: bool,
}

pub struct DbState {
    pub conn: Option<Connection>,
    pub mdk: Option<[u8; 32]>,
    pub app_data_dir: PathBuf,
}

pub type SharedDbState = Arc<Mutex<DbState>>;

const UNAMBIGUOUS_ALPHABET: &[u8] = b"2345679ACDEFGHJKMNPQRSTVWXYZ";

pub fn generate_unambiguous_recovery_key() -> String {
    let mut rng = thread_rng();
    let mut raw = String::new();
    for _ in 0..16 {
        let idx = (rng.next_u32() as usize) % UNAMBIGUOUS_ALPHABET.len();
        raw.push(UNAMBIGUOUS_ALPHABET[idx] as char);
    }
    format!(
        "RC-{}-{}-{}-{}",
        &raw[0..4],
        &raw[4..8],
        &raw[8..12],
        &raw[12..16]
    )
}

fn derive_key(secret: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let params = Params::new(65536, 3, 1, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2.hash_password_into(secret.as_bytes(), salt, &mut key).map_err(|e| e.to_string())?;
    Ok(key)
}

fn encrypt_aes_gcm(key: &[u8; 32], plaintext: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| e.to_string())?;
    
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(general_purpose::STANDARD.encode(combined))
}

fn decrypt_aes_gcm(key: &[u8; 32], encoded: &str) -> Result<Vec<u8>, String> {
    let combined = general_purpose::STANDARD.decode(encoded).map_err(|e| e.to_string())?;
    if combined.len() < 12 {
        return Err("Datos cifrados inválidos".to_string());
    }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher.decrypt(nonce, ciphertext).map_err(|_| "Contraseña o clave incorrecta".to_string())
}

impl DbState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            conn: None,
            mdk: None,
            app_data_dir,
        }
    }

    pub fn vault_path(&self) -> PathBuf {
        self.app_data_dir.join("vault.json")
    }

    pub fn enc_db_path(&self) -> PathBuf {
        self.app_data_dir.join("comparetica.db.enc")
    }

    pub fn legacy_db_path(&self) -> PathBuf {
        self.app_data_dir.join("comparetica.db")
    }

    pub fn load_vault(&self) -> Result<Option<VaultConfig>, String> {
        let path = self.vault_path();
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let config: VaultConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(Some(config))
    }

    pub fn save_vault(&self, config: &VaultConfig) -> Result<(), String> {
        if !self.app_data_dir.exists() {
            fs::create_dir_all(&self.app_data_dir).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(self.vault_path(), content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_status(&self) -> Result<DbStatus, String> {
        let vault = self.load_vault()?;
        let is_initialized = vault.as_ref().map(|v| v.is_initialized).unwrap_or(false);
        let is_unlocked = self.conn.is_some();
        let needs_migration = !is_initialized && self.legacy_db_path().exists();
        Ok(DbStatus {
            is_initialized,
            is_unlocked,
            needs_migration,
        })
    }

    pub fn open_db(&mut self, mdk: [u8; 32]) -> Result<(), String> {
        let enc_path = self.enc_db_path();
        let legacy_path = self.legacy_db_path();

        let mut conn = Connection::open_in_memory().map_err(|e| e.to_string())?;

        if enc_path.exists() {
            let enc_bytes = fs::read(&enc_path).map_err(|e| e.to_string())?;
            let db_bytes = decrypt_aes_gcm(&mdk, &general_purpose::STANDARD.encode(enc_bytes))?;
            
            let temp_db = self.app_data_dir.join("temp_decrypted.db");
            fs::write(&temp_db, &db_bytes).map_err(|e| e.to_string())?;
            
            let disk_conn = Connection::open(&temp_db).map_err(|e| e.to_string())?;
            {
                let backup = rusqlite::backup::Backup::new(&disk_conn, &mut conn).map_err(|e| e.to_string())?;
                backup.run_to_completion(5, std::time::Duration::from_millis(10), None).map_err(|e| e.to_string())?;
            }
            drop(disk_conn);
            let _ = fs::remove_file(temp_db);
        } else if legacy_path.exists() {
            // Migrar base de datos legacy en texto plano
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

    pub fn persist_db(&self) -> Result<(), String> {
        let conn = match &self.conn {
            Some(c) => c,
            None => return Ok(()),
        };
        let mdk = match &self.mdk {
            Some(m) => m,
            None => return Ok(()),
        };

        let temp_db = self.app_data_dir.join("temp_persist.db");
        if temp_db.exists() {
            let _ = fs::remove_file(&temp_db);
        }

        let mut disk_conn = Connection::open(&temp_db).map_err(|e| e.to_string())?;
        {
            let backup = rusqlite::backup::Backup::new(conn, &mut disk_conn).map_err(|e| e.to_string())?;
            backup.run_to_completion(5, std::time::Duration::from_millis(10), None).map_err(|e| e.to_string())?;
        }
        drop(disk_conn);

        let db_bytes = fs::read(&temp_db).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&temp_db);

        let enc_str = encrypt_aes_gcm(mdk, &db_bytes)?;
        let enc_bytes = general_purpose::STANDARD.decode(enc_str).map_err(|e| e.to_string())?;
        
        fs::write(self.enc_db_path(), enc_bytes).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn import_legacy_sqlite(&mut self, bytes: &[u8]) -> Result<String, String> {
        let is_initialized = self.load_vault()?.map(|v| v.is_initialized).unwrap_or(false);

        if self.conn.is_some() && self.mdk.is_some() {
            // Caso 1: Bóveda desbloqueada -> Importar en memoria, cifrar a comparetica.db.enc y borrar temporal inmediatamente
            let temp_legacy = self.app_data_dir.join("temp_legacy_import.db");
            fs::write(&temp_legacy, bytes).map_err(|e| e.to_string())?;

            let disk_conn = Connection::open(&temp_legacy).map_err(|e| e.to_string())?;
            if let Some(ref mut in_mem_conn) = self.conn {
                let backup = rusqlite::backup::Backup::new(&disk_conn, in_mem_conn).map_err(|e| e.to_string())?;
                backup.run_to_completion(5, std::time::Duration::from_millis(10), None).map_err(|e| e.to_string())?;
            }
            drop(disk_conn);
            let _ = fs::remove_file(&temp_legacy);

            self.init_schema()?;
            self.persist_db()?;

            Ok("Base de datos antigua (sin cifrar) importada y cifrada correctamente con tu Contraseña Maestra activa.".to_string())
        } else if !is_initialized {
            // Caso 2: Primer uso antes de configurar contraseña
            let legacy_path = self.legacy_db_path();
            fs::write(&legacy_path, bytes).map_err(|e| e.to_string())?;
            Ok("Copia de seguridad antigua importada. Al configurar tu Contraseña Maestra, la base de datos se cifrará automáticamente.".to_string())
        } else {
            // Caso 3: Bóveda configurada pero aplicación bloqueada
            Err("Debes desbloquear la aplicación con tu Contraseña Maestra antes de importar una copia de seguridad sin cifrar.".to_string())
        }
    }

    pub fn setup_master_password(&mut self, password: &str) -> Result<String, String> {
        if password.trim().len() < 6 {
            return Err("La contraseña debe tener al menos 6 caracteres".to_string());
        }

        let mut salt_p = [0u8; 32];
        let mut salt_r = [0u8; 32];
        let mut mdk = [0u8; 32];
        thread_rng().fill_bytes(&mut salt_p);
        thread_rng().fill_bytes(&mut salt_r);
        thread_rng().fill_bytes(&mut mdk);

        let key_p = derive_key(password, &salt_p)?;
        let recovery_key = generate_unambiguous_recovery_key();
        let key_r = derive_key(&recovery_key, &salt_r)?;

        let encrypted_mdk_password = encrypt_aes_gcm(&key_p, &mdk)?;
        let encrypted_mdk_recovery = encrypt_aes_gcm(&key_r, &mdk)?;

        let config = VaultConfig {
            is_initialized: true,
            salt_password: general_purpose::STANDARD.encode(salt_p),
            salt_recovery: general_purpose::STANDARD.encode(salt_r),
            encrypted_mdk_password,
            encrypted_mdk_recovery,
        };

        self.save_vault(&config)?;
        self.open_db(mdk)?;

        Ok(recovery_key)
    }

    pub fn login(&mut self, password: &str) -> Result<(), String> {
        let vault = self.load_vault()?.ok_or_else(|| "La bóveda no está configurada".to_string())?;
        let salt_p = general_purpose::STANDARD.decode(&vault.salt_password).map_err(|e| e.to_string())?;
        let key_p = derive_key(password, &salt_p)?;

        let mdk_bytes = decrypt_aes_gcm(&key_p, &vault.encrypted_mdk_password)?;
        if mdk_bytes.len() != 32 {
            return Err("Error de integridad de clave".to_string());
        }

        let mut mdk = [0u8; 32];
        mdk.copy_from_slice(&mdk_bytes);

        self.open_db(mdk)?;
        Ok(())
    }

    pub fn recover_access(&mut self, recovery_key: &str, new_password: &str) -> Result<String, String> {
        if new_password.trim().len() < 6 {
            return Err("La nueva contraseña debe tener al menos 6 caracteres".to_string());
        }

        let vault = self.load_vault()?.ok_or_else(|| "La bóveda no está configurada".to_string())?;
        let clean_recovery_key = recovery_key.trim().to_uppercase().replace(" ", "");
        let salt_r = general_purpose::STANDARD.decode(&vault.salt_recovery).map_err(|e| e.to_string())?;
        let key_r = derive_key(&clean_recovery_key, &salt_r)?;

        let mdk_bytes = decrypt_aes_gcm(&key_r, &vault.encrypted_mdk_recovery)?;
        if mdk_bytes.len() != 32 {
            return Err("Clave de recuperación incorrecta".to_string());
        }

        let mut mdk = [0u8; 32];
        mdk.copy_from_slice(&mdk_bytes);

        // Generar nuevos salts y NUEVA clave de recuperación (invalidando la anterior)
        let mut new_salt_p = [0u8; 32];
        let mut new_salt_r = [0u8; 32];
        thread_rng().fill_bytes(&mut new_salt_p);
        thread_rng().fill_bytes(&mut new_salt_r);

        let new_recovery_key = generate_unambiguous_recovery_key();
        let new_key_p = derive_key(new_password, &new_salt_p)?;
        let new_key_r = derive_key(&new_recovery_key, &new_salt_r)?;

        let encrypted_mdk_password = encrypt_aes_gcm(&new_key_p, &mdk)?;
        let encrypted_mdk_recovery = encrypt_aes_gcm(&new_key_r, &mdk)?;

        let new_config = VaultConfig {
            is_initialized: true,
            salt_password: general_purpose::STANDARD.encode(new_salt_p),
            salt_recovery: general_purpose::STANDARD.encode(new_salt_r),
            encrypted_mdk_password,
            encrypted_mdk_recovery,
        };

        self.save_vault(&new_config)?;
        self.open_db(mdk)?;

        Ok(new_recovery_key)
    }

    pub fn change_password(&mut self, current_password: &str, new_password: &str) -> Result<String, String> {
        if new_password.trim().len() < 6 {
            return Err("La nueva contraseña debe tener al menos 6 caracteres".to_string());
        }
        let mdk = match self.mdk {
            Some(m) => m,
            None => return Err("La aplicación está bloqueada".to_string()),
        };

        let vault = self.load_vault()?.ok_or_else(|| "La bóveda no está configurada".to_string())?;
        let salt_p = general_purpose::STANDARD.decode(&vault.salt_password).map_err(|e| e.to_string())?;
        let key_p = derive_key(current_password, &salt_p)?;

        // Verificar contraseña actual
        let _ = decrypt_aes_gcm(&key_p, &vault.encrypted_mdk_password)?;

        // Generar nuevos salts y NUEVA clave de recuperación (invalidando la anterior)
        let mut new_salt_p = [0u8; 32];
        let mut new_salt_r = [0u8; 32];
        thread_rng().fill_bytes(&mut new_salt_p);
        thread_rng().fill_bytes(&mut new_salt_r);

        let new_recovery_key = generate_unambiguous_recovery_key();
        let new_key_p = derive_key(new_password, &new_salt_p)?;
        let new_key_r = derive_key(&new_recovery_key, &new_salt_r)?;

        let encrypted_mdk_password = encrypt_aes_gcm(&new_key_p, &mdk)?;
        let encrypted_mdk_recovery = encrypt_aes_gcm(&new_key_r, &mdk)?;

        let new_config = VaultConfig {
            is_initialized: true,
            salt_password: general_purpose::STANDARD.encode(new_salt_p),
            salt_recovery: general_purpose::STANDARD.encode(new_salt_r),
            encrypted_mdk_password,
            encrypted_mdk_recovery,
        };

        self.save_vault(&new_config)?;
        Ok(new_recovery_key)
    }

    fn init_schema(&mut self) -> Result<(), String> {
        let conn = self.conn.as_ref().ok_or_else(|| "BD no conectada".to_string())?;
        
        conn.execute("PRAGMA foreign_keys = ON;", []).map_err(|e| e.to_string())?;

        conn.execute("
            CREATE TABLE IF NOT EXISTS agentes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL,
                telefono TEXT,
                email TEXT,
                activo INTEGER DEFAULT 1,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ", []).map_err(|e| e.to_string())?;

        conn.execute("
            CREATE TABLE IF NOT EXISTS clientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre_empresa TEXT NOT NULL,
                cif TEXT NOT NULL UNIQUE,
                representante TEXT,
                cups TEXT,
                email TEXT,
                agente_id INTEGER REFERENCES agentes(id),
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ", []).map_err(|e| e.to_string())?;

        // Migración defensiva: asegurar que la columna agente_id existe en bases de datos existentes
        let client_cols: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(clientes);").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        if !client_cols.contains(&"agente_id".to_string()) {
            conn.execute("ALTER TABLE clientes ADD COLUMN agente_id INTEGER REFERENCES agentes(id);", []).map_err(|e| e.to_string())?;
        }

        conn.execute("
            CREATE TABLE IF NOT EXISTS comercializadoras (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ", []).map_err(|e| e.to_string())?;

        conn.execute("
            CREATE TABLE IF NOT EXISTS tarifas_luz (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                comercializadora_id INTEGER NOT NULL,
                nombre TEXT NOT NULL,
                tipo_tarifa TEXT NOT NULL DEFAULT '2.0TD',
                potencia_p1 REAL NOT NULL,
                potencia_p2 REAL NOT NULL,
                potencia_p3 REAL DEFAULT 0.0,
                potencia_p4 REAL DEFAULT 0.0,
                potencia_p5 REAL DEFAULT 0.0,
                potencia_p6 REAL DEFAULT 0.0,
                energia_p1 REAL NOT NULL,
                energia_p2 REAL NOT NULL,
                energia_p3 REAL NOT NULL,
                energia_p4 REAL DEFAULT 0.0,
                energia_p5 REAL DEFAULT 0.0,
                energia_p6 REAL DEFAULT 0.0,
                excedente REAL DEFAULT 0.0,
                comision_tramos_consumo TEXT,
                comision_tramos_potencia TEXT,
                notas TEXT,
                activo INTEGER DEFAULT 1,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (comercializadora_id) REFERENCES comercializadoras(id) ON DELETE CASCADE,
                UNIQUE(comercializadora_id, nombre)
            );
        ", []).map_err(|e| e.to_string())?;

        conn.execute("
            CREATE TABLE IF NOT EXISTS tarifas_gas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                comercializadora_id INTEGER NOT NULL,
                nombre TEXT NOT NULL,
                tipo_tarifa TEXT NOT NULL DEFAULT 'RL.1',
                termino_fijo REAL NOT NULL,
                termino_variable REAL NOT NULL,
                comision_tramos_consumo TEXT,
                notas TEXT,
                activo INTEGER DEFAULT 1,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (comercializadora_id) REFERENCES comercializadoras(id) ON DELETE CASCADE,
                UNIQUE(comercializadora_id, nombre)
            );
        ", []).map_err(|e| e.to_string())?;

        conn.execute("
            CREATE TABLE IF NOT EXISTS comparativas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_nombre TEXT NOT NULL,
                cliente_cups TEXT,
                tipo_energia TEXT NOT NULL,
                fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                datos_cliente_json TEXT NOT NULL,
                comercializadora_luz_propuesta_id INTEGER,
                tarifa_luz_propuesta_id INTEGER,
                ahorro_luz_anual REAL DEFAULT 0.0,
                comercializadora_gas_propuesta_id INTEGER,
                tarifa_gas_propuesta_id INTEGER,
                ahorro_gas_anual REAL DEFAULT 0.0,
                comision_total REAL DEFAULT 0.0,
                estado TEXT NOT NULL DEFAULT 'Pendiente de aceptación',
                estado_cambiado_en TEXT,
                estado_cobro TEXT NOT NULL DEFAULT 'Pendiente',
                fecha_cobro TEXT,
                estado_contrato TEXT NOT NULL DEFAULT 'Pendiente',
                motivo_rechazo_scoring TEXT DEFAULT '',
                FOREIGN KEY (tarifa_luz_propuesta_id) REFERENCES tarifas_luz(id) ON DELETE SET NULL,
                FOREIGN KEY (tarifa_gas_propuesta_id) REFERENCES tarifas_gas(id) ON DELETE SET NULL
            );
        ", []).map_err(|e| e.to_string())?;

        // Migración defensiva: asegurar columnas necesarias en comparativas
        let comp_cols: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(comparativas);").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        if !comp_cols.contains(&"ahorro_gas_anual".to_string()) {
            conn.execute("ALTER TABLE comparativas ADD COLUMN ahorro_gas_anual REAL DEFAULT 0.0;", []).map_err(|e| e.to_string())?;
        }
        if !comp_cols.contains(&"comision_total".to_string()) {
            conn.execute("ALTER TABLE comparativas ADD COLUMN comision_total REAL DEFAULT 0.0;", []).map_err(|e| e.to_string())?;
        }
        if !comp_cols.contains(&"estado".to_string()) {
            conn.execute("ALTER TABLE comparativas ADD COLUMN estado TEXT NOT NULL DEFAULT 'Pendiente de aceptación';", []).map_err(|e| e.to_string())?;
        }
        if !comp_cols.contains(&"estado_cambiado_en".to_string()) {
            conn.execute("ALTER TABLE comparativas ADD COLUMN estado_cambiado_en TEXT;", []).map_err(|e| e.to_string())?;
        }
        if !comp_cols.contains(&"estado_cobro".to_string()) {
            conn.execute("ALTER TABLE comparativas ADD COLUMN estado_cobro TEXT NOT NULL DEFAULT 'Pendiente';", []).map_err(|e| e.to_string())?;
        }
        if !comp_cols.contains(&"fecha_cobro".to_string()) {
            conn.execute("ALTER TABLE comparativas ADD COLUMN fecha_cobro TEXT;", []).map_err(|e| e.to_string())?;
        }
        if !comp_cols.contains(&"estado_contrato".to_string()) {
            conn.execute("ALTER TABLE comparativas ADD COLUMN estado_contrato TEXT NOT NULL DEFAULT 'Pendiente';", []).map_err(|e| e.to_string())?;
        }
        if !comp_cols.contains(&"motivo_rechazo_scoring".to_string()) {
            conn.execute("ALTER TABLE comparativas ADD COLUMN motivo_rechazo_scoring TEXT DEFAULT '';", []).map_err(|e| e.to_string())?;
        }

        conn.execute("
            CREATE TABLE IF NOT EXISTS renovaciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER NOT NULL,
                tipo_energia TEXT NOT NULL DEFAULT 'Luz',
                cups TEXT,
                comercializadora_actual TEXT,
                tarifa_actual TEXT,
                fecha_firma DATE NOT NULL,
                duracion_meses INTEGER DEFAULT 12,
                fecha_vencimiento DATE NOT NULL,
                fecha_aviso_personalizada DATE,
                estado_renovacion TEXT NOT NULL DEFAULT 'Pendiente',
                notas TEXT,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
            );
        ", []).map_err(|e| e.to_string())?;

        conn.execute("
            CREATE TABLE IF NOT EXISTS puntos_suministro (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER NOT NULL,
                cups TEXT NOT NULL,
                direccion_alias TEXT,
                tipo_energia TEXT DEFAULT 'LUZ',
                notas TEXT,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
            );
        ", []).map_err(|e| e.to_string())?;

        // Migración automática: Copiar CUPS de clientes a puntos_suministro si aún no existen
        conn.execute("
            INSERT INTO puntos_suministro (cliente_id, cups, direccion_alias, tipo_energia)
            SELECT c.id, c.cups, 'Principal', 'LUZ'
            FROM clientes c
            WHERE c.cups IS NOT NULL AND c.cups != ''
              AND NOT EXISTS (
                  SELECT 1 FROM puntos_suministro ps WHERE ps.cliente_id = c.id AND ps.cups = c.cups
              );
        ", []).map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn select(&self, query: &str, params: Vec<Value>) -> Result<Vec<Value>, String> {
        let conn = self.conn.as_ref().ok_or_else(|| "La base de datos está bloqueada. Por favor, introduce tu contraseña.".to_string())?;
        
        let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
        let col_names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();

        let rusqlite_params = params_to_rusqlite(&params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = rusqlite_params.iter().map(|p| p.as_ref()).collect();

        let mut rows = stmt.query(param_refs.as_slice()).map_err(|e| e.to_string())?;
        let mut results = Vec::new();

        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut map = Map::new();
            for (idx, name) in col_names.iter().enumerate() {
                let val: Value = match row.get_ref(idx).map_err(|e| e.to_string())? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(i) => Value::Number(serde_json::Number::from(i)),
                    rusqlite::types::ValueRef::Real(f) => serde_json::Number::from_f64(f)
                        .map(Value::Number)
                        .unwrap_or(Value::Null),
                    rusqlite::types::ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
                    rusqlite::types::ValueRef::Blob(b) => Value::String(general_purpose::STANDARD.encode(b)),
                };
                map.insert(name.clone(), val);
            }
            results.push(Value::Object(map));
        }

        Ok(results)
    }

    pub fn execute(&mut self, query: &str, params: Vec<Value>) -> Result<Value, String> {
        let conn = self.conn.as_ref().ok_or_else(|| "La base de datos está bloqueada. Por favor, introduce tu contraseña.".to_string())?;

        let rusqlite_params = params_to_rusqlite(&params);
        let param_refs: Vec<&dyn rusqlite::ToSql> = rusqlite_params.iter().map(|p| p.as_ref()).collect();

        let rows_affected = conn.execute(query, param_refs.as_slice()).map_err(|e| e.to_string())?;
        let last_insert_id = conn.last_insert_rowid();

        self.persist_db()?;

        let mut res = Map::new();
        res.insert("rowsAffected".to_string(), Value::Number(serde_json::Number::from(rows_affected)));
        res.insert("lastInsertId".to_string(), Value::Number(serde_json::Number::from(last_insert_id)));

        Ok(Value::Object(res))
    }

    pub fn import_clientes_batch(&mut self, rows: Vec<ClienteImportRow>, update_existing: bool) -> Result<(usize, usize, usize), String> {
        let conn = self.conn.as_mut().ok_or_else(|| "La base de datos está bloqueada. Por favor, introduce tu contraseña.".to_string())?;

        let mut added = 0;
        let mut updated = 0;
        let mut skipped = 0;

        let tx = conn.transaction().map_err(|e| format!("Error al iniciar transacción SQLite: {}", e))?;

        {
            let mut select_stmt = tx.prepare("SELECT id FROM clientes WHERE cif = ?;").map_err(|e| e.to_string())?;
            let mut insert_stmt = tx.prepare("INSERT INTO clientes (nombre_empresa, cif, representante, cups, email, agente_id) VALUES (?, ?, ?, ?, ?, ?);").map_err(|e| e.to_string())?;
            let mut update_stmt = tx.prepare("UPDATE clientes SET nombre_empresa = ?, representante = ?, cups = ?, email = ?, agente_id = COALESCE(?, agente_id) WHERE id = ?;").map_err(|e| e.to_string())?;
            let mut insert_ps_stmt = tx.prepare("INSERT INTO puntos_suministro (cliente_id, cups, direccion_alias, tipo_energia) SELECT ?, ?, 'Principal', 'LUZ' WHERE NOT EXISTS (SELECT 1 FROM puntos_suministro WHERE cliente_id = ? AND cups = ?);").map_err(|e| e.to_string())?;

            for row in rows {
                let cif = row.cif.trim();
                let nombre_empresa = row.nombre_empresa.trim();

                if cif.is_empty() || nombre_empresa.is_empty() {
                    skipped += 1;
                    continue;
                }

                let existing_id: Option<i64> = select_stmt.query_row([cif], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
                let cups_clean = row.cups.as_deref().map(str::trim).filter(|s| !s.is_empty());

                if let Some(id) = existing_id {
                    if update_existing {
                        update_stmt.execute(rusqlite::params![
                            nombre_empresa,
                            row.representante.as_deref().map(str::trim),
                            row.cups.as_deref().map(str::trim),
                            row.email.as_deref().map(str::trim),
                            row.agente_id,
                            id
                        ]).map_err(|e| e.to_string())?;

                        if let Some(cups_str) = cups_clean {
                            let _ = insert_ps_stmt.execute(rusqlite::params![id, cups_str, id, cups_str]);
                        }

                        updated += 1;
                    } else {
                        skipped += 1;
                    }
                } else {
                    insert_stmt.execute(rusqlite::params![
                        nombre_empresa,
                        cif,
                        row.representante.as_deref().map(str::trim),
                        row.cups.as_deref().map(str::trim),
                        row.email.as_deref().map(str::trim),
                        row.agente_id
                    ]).map_err(|e| e.to_string())?;

                    let new_id = tx.last_insert_rowid();
                    if let Some(cups_str) = cups_clean {
                        let _ = insert_ps_stmt.execute(rusqlite::params![new_id, cups_str, new_id, cups_str]);
                    }

                    added += 1;
                }
            }
        }

        tx.commit().map_err(|e| format!("Error al confirmar transacción SQLite: {}", e))?;

        if let Err(e) = self.persist_db() {
            eprintln!("Advertencia al guardar base de datos cifrada tras la importación: {}", e);
        }

        Ok((added, updated, skipped))
    }

    pub fn import_renovaciones_batch(&mut self, rows: Vec<RenovacionImportRow>) -> Result<usize, String> {
        let conn = self.conn.as_mut().ok_or_else(|| "La base de datos está bloqueada. Por favor, introduce tu contraseña.".to_string())?;

        let mut count = 0;
        let tx = conn.transaction().map_err(|e| format!("Error al iniciar transacción SQLite: {}", e))?;

        {
            let mut insert_stmt = tx.prepare("
                INSERT INTO renovaciones (cliente_id, tipo_energia, cups, comercializadora_actual, tarifa_actual, fecha_firma, duracion_meses, fecha_vencimiento, notas)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
            ").map_err(|e| e.to_string())?;

            for row in rows {
                let tipo = row.tipo_energia.as_deref().unwrap_or("Luz");
                let comercializadora = row.comercializadora_actual.as_deref().unwrap_or("Importado CSV");
                let tarifa = row.tarifa_actual.as_deref().unwrap_or("Tarifa CSV");
                let duracion = row.duracion_meses.unwrap_or(12);
                let notas = row.notas.as_deref().unwrap_or("Importado automáticamente desde CSV");

                insert_stmt.execute(rusqlite::params![
                    row.cliente_id,
                    tipo,
                    row.cups.as_deref().map(str::trim),
                    comercializadora,
                    tarifa,
                    row.fecha_firma.trim(),
                    duracion,
                    row.fecha_vencimiento.trim(),
                    notas
                ]).map_err(|e| e.to_string())?;

                count += 1;
            }
        }

        tx.commit().map_err(|e| format!("Error al confirmar transacción SQLite: {}", e))?;

        if let Err(e) = self.persist_db() {
            eprintln!("Advertencia al guardar base de datos cifrada tras importar renovaciones: {}", e);
        }

        Ok(count)
    }
}

fn params_to_rusqlite(params: &[Value]) -> Vec<Box<dyn rusqlite::ToSql>> {
    params.iter().map(|v| -> Box<dyn rusqlite::ToSql> {
        match v {
            Value::Null => Box::new(rusqlite::types::Null),
            Value::Bool(b) => Box::new(*b),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Box::new(i)
                } else if let Some(f) = n.as_f64() {
                    Box::new(f)
                } else {
                    Box::new(n.to_string())
                }
            }
            Value::String(s) => Box::new(s.clone()),
            _ => Box::new(v.to_string()),
        }
    }).collect()
}
