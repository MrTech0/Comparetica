#![allow(linker_messages)]

mod db;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn save_pdf(filename: String, base64_data: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    use std::fs::File;
    use std::io::Write;

    let bytes = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| e.to_string())?;

    let path = rfd::FileDialog::new()
        .set_file_name(&filename)
        .add_filter("PDF", &["pdf"])
        .save_file();

    if let Some(path) = path {
        let mut file = File::create(&path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Cancelado por el usuario".to_string())
    }
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Error al leer el archivo: {}", e))
}

#[tauri::command]
fn db_check_status(state: tauri::State<'_, db::SharedDbState>) -> Result<db::DbStatus, String> {
    let db_state = state.lock().map_err(|e| e.to_string())?;
    db_state.get_status()
}

#[tauri::command]
fn db_setup_master_password(state: tauri::State<'_, db::SharedDbState>, password: String) -> Result<String, String> {
    let mut db_state = state.lock().map_err(|e| e.to_string())?;
    db_state.setup_master_password(&password)
}

#[tauri::command]
fn db_login(state: tauri::State<'_, db::SharedDbState>, password: String) -> Result<(), String> {
    let mut db_state = state.lock().map_err(|e| e.to_string())?;
    db_state.login(&password)
}

#[tauri::command]
fn db_recover_access(state: tauri::State<'_, db::SharedDbState>, recovery_key: String, new_password: String) -> Result<String, String> {
    let mut db_state = state.lock().map_err(|e| e.to_string())?;
    db_state.recover_access(&recovery_key, &new_password)
}

#[tauri::command]
fn db_change_password(state: tauri::State<'_, db::SharedDbState>, current_password: String, new_password: String) -> Result<String, String> {
    let mut db_state = state.lock().map_err(|e| e.to_string())?;
    db_state.change_password(&current_password, &new_password)
}

#[tauri::command]
fn db_select(state: tauri::State<'_, db::SharedDbState>, query: String, params: Option<Vec<serde_json::Value>>) -> Result<Vec<serde_json::Value>, String> {
    let db_state = state.lock().map_err(|e| e.to_string())?;
    db_state.select(&query, params.unwrap_or_default())
}

#[tauri::command]
fn db_execute(state: tauri::State<'_, db::SharedDbState>, query: String, params: Option<Vec<serde_json::Value>>) -> Result<serde_json::Value, String> {
    let mut db_state = state.lock().map_err(|e| e.to_string())?;
    db_state.execute(&query, params.unwrap_or_default())
}

#[tauri::command]
fn export_backup(app_handle: tauri::AppHandle, _state: tauri::State<'_, db::SharedDbState>) -> Result<String, String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let enc_db_path = app_data_dir.join("comparetica.db.enc");
    let vault_path = app_data_dir.join("vault.json");

    if !enc_db_path.exists() || !vault_path.exists() {
        return Err("No hay una base de datos cifrada activa para respaldar.".to_string());
    }

    let now = chrono::Local::now();
    let timestamp = now.format("%d_%m_%H_%M_%S").to_string();
    let default_filename = format!("comparetica_backup_{}.bak", timestamp);

    let save_path = rfd::FileDialog::new()
        .set_file_name(&default_filename)
        .add_filter("Copia de seguridad cifrada (*.bak)", &["bak", "zip"])
        .save_file();

    if let Some(save_path) = save_path {
        let db_bytes = std::fs::read(&enc_db_path).map_err(|e| e.to_string())?;
        let vault_bytes = std::fs::read(&vault_path).map_err(|e| e.to_string())?;
        
        let mut bundle = serde_json::Map::new();
        bundle.insert("db_enc".to_string(), serde_json::Value::String(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &db_bytes)));
        bundle.insert("vault".to_string(), serde_json::from_slice(&vault_bytes).unwrap_or(serde_json::Value::Null));

        let bundle_str = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
        std::fs::write(&save_path, bundle_str).map_err(|e| e.to_string())?;

        Ok(save_path.to_string_lossy().to_string())
    } else {
        Err("Cancelado por el usuario".to_string())
    }
}

#[tauri::command]
fn import_backup(app_handle: tauri::AppHandle, state: tauri::State<'_, db::SharedDbState>) -> Result<String, String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;

    let open_path = rfd::FileDialog::new()
        .add_filter("Copia de seguridad (*.bak, *.db, *.zip)", &["bak", "db", "zip"])
        .pick_file();

    if let Some(open_path) = open_path {
        if !app_data_dir.exists() {
            std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        }

        let bytes = std::fs::read(&open_path).map_err(|e| format!("No se pudo leer el archivo de copia de seguridad: {}", e))?;

        // 1. Intentar interpretar como paquete JSON cifrado (.bak)
        if let Ok(content_str) = std::str::from_utf8(&bytes) {
            if let Ok(bundle) = serde_json::from_str::<serde_json::Value>(content_str) {
                if let (Some(db_b64), Some(vault_val)) = (bundle.get("db_enc").and_then(|v| v.as_str()), bundle.get("vault")) {
                    let db_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, db_b64).map_err(|e| e.to_string())?;
                    let vault_str = serde_json::to_string_pretty(vault_val).map_err(|e| e.to_string())?;

                    std::fs::write(app_data_dir.join("comparetica.db.enc"), db_bytes).map_err(|e| e.to_string())?;
                    std::fs::write(app_data_dir.join("vault.json"), vault_str).map_err(|e| e.to_string())?;

                    // Limpiar estado en memoria
                    if let Ok(mut db_state) = state.lock() {
                        db_state.conn = None;
                        db_state.mdk = None;
                    }

                    #[cfg(not(dev))]
                    {
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(500));
                            app_handle.restart();
                        });
                    }
                    return Ok("Copia de seguridad cifrada restaurada con éxito. Reiniciando la aplicación...".to_string());
                }
            }
        }

        // 2. Intentar interpretar como base de datos SQLite legacy sin cifrar (cabecera "SQLite format 3\0")
        if bytes.len() >= 16 && &bytes[0..16] == b"SQLite format 3\0" {
            let mut db_state = state.lock().map_err(|e| e.to_string())?;
            return db_state.import_legacy_sqlite(&bytes);
        }

        Err("Formato de copia de seguridad no válido o no reconocido.".to_string())
    } else {
        Err("Cancelado por el usuario".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                let reset_flag = app_data_dir.join("reset_db.flag");
                if reset_flag.exists() {
                    let db_path = app_data_dir.join("comparetica.db");
                    let db_enc = app_data_dir.join("comparetica.db.enc");
                    let vault = app_data_dir.join("vault.json");
                    
                    let _ = std::fs::remove_file(&db_path);
                    let _ = std::fs::remove_file(&db_enc);
                    let _ = std::fs::remove_file(&vault);
                    let _ = std::fs::remove_file(&reset_flag);
                }

                let db_state = db::DbState::new(app_data_dir);
                app.manage(std::sync::Arc::new(std::sync::Mutex::new(db_state)));
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                use tauri::Manager;
                let app_handle = window.app_handle();
                perform_auto_backup(&app_handle);
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet, 
            read_text_file,
            save_pdf, 
            export_backup, 
            import_backup,
            get_backup_directory,
            set_backup_directory,
            select_backup_directory,
            get_backup_retention,
            set_backup_retention,
            save_company_logo,
            get_company_logo,
            get_company_config,
            save_company_config,
            delete_company_logo,
            factory_reset,
            restart_app,
            log_frontend_error,
            open_email_with_attachment,
            get_about_info,
            db_check_status,
            db_setup_master_password,
            db_login,
            db_recover_access,
            db_change_password,
            db_select,
            db_execute
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn perform_auto_backup(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    let app_data_dir = match app_handle.path().app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };
    let enc_db_path = app_data_dir.join("comparetica.db.enc");
    let vault_path = app_data_dir.join("vault.json");

    if !enc_db_path.exists() || !vault_path.exists() {
        return; // No hay base de datos cifrada aún para guardar
    }

    // Carpeta de copias de seguridad por defecto: home_dir
    let mut backup_dir = match app_handle.path().home_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };

    let mut retention_days = 7;

    // Intentar leer la ruta personalizada y la retención de config.json
    let config_path = app_data_dir.join("config.json");
    if config_path.exists() {
        if let Ok(config_str) = std::fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_str) {
                if let Some(custom_path) = config.get("backup_dir").and_then(|v| v.as_str()) {
                    let custom_dir = std::path::PathBuf::from(custom_path);
                    if custom_dir.exists() && custom_dir.is_dir() {
                        backup_dir = custom_dir;
                    }
                }
                if let Some(days) = config.get("retention_days").and_then(|v| v.as_u64()) {
                    retention_days = days as u32;
                }
            }
        }
    }

    let now = chrono::Local::now();
    let timestamp = now.format("%d_%m_%H_%M_%S").to_string();
    let backup_path = backup_dir.join(format!("comparetica_auto_backup_{}.bak", timestamp));
    
    if let (Ok(db_bytes), Ok(vault_bytes)) = (std::fs::read(&enc_db_path), std::fs::read(&vault_path)) {
        let mut bundle = serde_json::Map::new();
        bundle.insert("db_enc".to_string(), serde_json::Value::String(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &db_bytes)));
        bundle.insert("vault".to_string(), serde_json::from_slice(&vault_bytes).unwrap_or(serde_json::Value::Null));

        if let Ok(bundle_str) = serde_json::to_string_pretty(&bundle) {
            let _ = std::fs::write(&backup_path, bundle_str);
        }
    }

    // Limpieza de copias automáticas antiguas
    if let Ok(entries) = std::fs::read_dir(&backup_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                    if (filename.starts_with("comparetica_auto_backup_")) && (filename.ends_with(".bak") || filename.ends_with(".db")) {
                        if let Ok(metadata) = std::fs::metadata(&path) {
                            if let Ok(modified) = metadata.modified() {
                                if let Ok(elapsed) = modified.elapsed() {
                                    let elapsed_secs = elapsed.as_secs();
                                    let max_age_secs = (retention_days as u64) * 24 * 3600;
                                    if elapsed_secs > max_age_secs {
                                        let _ = std::fs::remove_file(path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn get_backup_directory(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = app_data_dir.join("config.json");

    if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_str) {
            if let Some(custom_path) = config.get("backup_dir").and_then(|v| v.as_str()) {
                return Ok(custom_path.to_string());
            }
        }
    }

    let home_dir = app_handle.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn set_backup_directory(app_handle: tauri::AppHandle, path: String) -> Result<String, String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;

    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    }

    let config_path = app_data_dir.join("config.json");
    
    let mut config = if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&config_str).unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()))
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    if let Some(obj) = config.as_object_mut() {
        if path.is_empty() {
            obj.remove("backup_dir");
        } else {
            let p = std::path::Path::new(&path);
            if !p.exists() || !p.is_dir() {
                return Err("La ruta seleccionada no existe o no es un directorio válido.".to_string());
            }
            obj.insert("backup_dir".to_string(), serde_json::Value::String(path.clone()));
        }
    }

    let config_str = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, config_str).map_err(|e| e.to_string())?;

    if path.is_empty() {
        let home_dir = app_handle.path().home_dir().map_err(|e| e.to_string())?;
        Ok(home_dir.to_string_lossy().to_string())
    } else {
        Ok(path)
    }
}

#[tauri::command]
fn select_backup_directory() -> Result<String, String> {
    let folder_path = rfd::FileDialog::new()
        .pick_folder();

    if let Some(folder_path) = folder_path {
        Ok(folder_path.to_string_lossy().to_string())
    } else {
        Err("Cancelado por el usuario".to_string())
    }
}

#[tauri::command]
fn get_backup_retention(app_handle: tauri::AppHandle) -> Result<u32, String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = app_data_dir.join("config.json");

    if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_str) {
            if let Some(days) = config.get("retention_days").and_then(|v| v.as_u64()) {
                return Ok(days as u32);
            }
        }
    }

    Ok(7) // Por defecto 7 días
}

#[tauri::command]
fn set_backup_retention(app_handle: tauri::AppHandle, days: u32) -> Result<u32, String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;

    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    }

    let config_path = app_data_dir.join("config.json");
    
    let mut config = if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&config_str).unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()))
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    if let Some(obj) = config.as_object_mut() {
        obj.insert("retention_days".to_string(), serde_json::Value::Number(serde_json::Number::from(days)));
    }

    let config_str = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, config_str).map_err(|e| e.to_string())?;

    Ok(days)
}

fn delete_all_logos(app_data_dir: &std::path::Path) {
    let extensions = ["svg", "png", "jpg", "jpeg", "webp", "avif"];
    for ext in &extensions {
        let path = app_data_dir.join(format!("logo.{}", ext));
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[tauri::command]
fn save_company_logo(app_handle: tauri::AppHandle, base64_data: String, extension: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    use std::fs;
    use tauri::Manager;

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    }

    // Limpiar logos previos
    delete_all_logos(&app_data_dir);

    let bytes = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| e.to_string())?;

    let ext = extension.to_lowercase();
    let supported = ["svg", "png", "jpg", "jpeg", "webp", "avif"];
    if !supported.contains(&ext.as_str()) {
        return Err("Formato de imagen no soportado".to_string());
    }

    let file_name = format!("logo.{}", ext);
    let logo_path = app_data_dir.join(&file_name);
    fs::write(&logo_path, &bytes).map_err(|e| e.to_string())?;

    Ok(file_name)
}

#[tauri::command]
fn get_company_logo(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use base64::{Engine as _, engine::general_purpose};
    use std::fs;
    use tauri::Manager;

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    
    let extensions = [
        ("svg", "image/svg+xml"),
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("webp", "image/webp"),
        ("avif", "image/avif"),
    ];

    for &(ext, mime) in &extensions {
        let path = app_data_dir.join(format!("logo.{}", ext));
        if path.exists() {
            let content = fs::read(&path).map_err(|e| e.to_string())?;
            let base64_str = general_purpose::STANDARD.encode(&content);
            return Ok(Some(format!("data:{};base64,{}", mime, base64_str)));
        }
    }

    Ok(None)
}

#[tauri::command]
fn get_company_config(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = app_data_dir.join("config.json");

    if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        let config: serde_json::Value = serde_json::from_str(&config_str).unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        Ok(config)
    } else {
        Ok(serde_json::Value::Object(serde_json::Map::new()))
    }
}

#[tauri::command]
fn save_company_config(app_handle: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;

    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    }

    let config_path = app_data_dir.join("config.json");
    
    let mut current_config = if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&config_str).unwrap_or(serde_json::Value::Object(serde_json::Map::new()))
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    if let (Some(current_obj), Some(new_obj)) = (current_config.as_object_mut(), config.as_object()) {
        for (k, v) in new_obj {
            current_obj.insert(k.clone(), v.clone());
        }
    } else {
        current_config = config;
    }

    let config_str = serde_json::to_string_pretty(&current_config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, config_str).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_company_logo(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    delete_all_logos(&app_data_dir);
    Ok(())
}

#[tauri::command]
fn factory_reset(app_handle: tauri::AppHandle, state: tauri::State<'_, db::SharedDbState>) -> Result<String, String> {
    use std::fs;
    use tauri::Manager;
    
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    
    // 1. Cerrar conexión en memoria y limpiar clave MDK en la sesión de Rust
    if let Ok(mut db_state) = state.lock() {
        db_state.conn = None;
        db_state.mdk = None;
    }

    // 2. Eliminar ficheros de base de datos, bóveda y configuración
    let config_path = app_data_dir.join("config.json");
    if config_path.exists() {
        let _ = fs::remove_file(&config_path);
    }
    
    let db_path = app_data_dir.join("comparetica.db");
    let db_enc = app_data_dir.join("comparetica.db.enc");
    let vault = app_data_dir.join("vault.json");
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_file(&db_enc);
    let _ = fs::remove_file(&vault);

    // 3. Limpiar todos los logos posibles
    delete_all_logos(&app_data_dir);

    #[cfg(dev)]
    {
        Ok("DEV_MODE".to_string())
    }
    #[cfg(not(dev))]
    {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(500));
            app_handle.restart();
        });
        Ok("Aplicación restablecida con éxito. Reiniciando la aplicación...".to_string())
    }
}

#[tauri::command]
fn restart_app(app_handle: tauri::AppHandle) {
    app_handle.restart();
}

#[tauri::command]
fn log_frontend_error(error: String) {
    println!("FRONTEND ERROR: {}", error);
}

#[tauri::command]
fn open_email_with_attachment(
    recipient: String,
    pdf_filename: String,
    pdf_base64: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use std::fs::File;
    use std::io::Write;
    use tauri_plugin_opener::OpenerExt;

    // Wrap base64 string to 76 chars per line for MIME spec compliance
    let mut wrapped_base64 = String::new();
    let chars: Vec<char> = pdf_base64.chars().collect();
    for chunk in chars.chunks(76) {
        let line: String = chunk.iter().collect();
        wrapped_base64.push_str(&line);
        wrapped_base64.push_str("\r\n");
    }

    // Generate EML content with X-Unsent: 1 to force compose mode
    let eml_content = format!(
        "X-Unsent: 1\r\n\
         To: {}\r\n\
         Subject: \r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: multipart/mixed; boundary=\"boundary\"\r\n\
         \r\n\
         --boundary\r\n\
         Content-Type: text/plain; charset=\"utf-8\"\r\n\
         Content-Transfer-Encoding: 7bit\r\n\
         \r\n\
         \r\n\
         --boundary\r\n\
         Content-Type: application/pdf; name=\"{}\"\r\n\
         Content-Transfer-Encoding: base64\r\n\
         Content-Disposition: attachment; filename=\"{}\"\r\n\
         \r\n\
         {}\r\n\
         --boundary--\r\n",
        recipient, pdf_filename, pdf_filename, wrapped_base64
    );

    // Save EML to temporary file
    let temp_dir = std::env::temp_dir();
    let random_id = chrono::Local::now().timestamp_millis();
    let eml_filename = format!("comparativa_correo_{}.eml", random_id);
    let eml_path = temp_dir.join(&eml_filename);
    
    let mut file = File::create(&eml_path).map_err(|e| e.to_string())?;
    file.write_all(eml_content.as_bytes()).map_err(|e| e.to_string())?;

    // Open using system opener
    let path_str = eml_path.to_string_lossy().to_string();
    app_handle
        .opener()
        .open_path(&path_str, None::<&str>)
        .map_err(|e| e.to_string())?;

    Ok("Correo abierto correctamente".to_string())
}

#[tauri::command]
fn get_about_info(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let app_version = app_handle.package_info().version.to_string();
    
    // Get Node version by running `node -v`
    let node_version = match std::process::Command::new("node").arg("-v").output() {
        Ok(output) => {
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            } else {
                "No instalado".to_string()
            }
        }
        Err(_) => "No instalado".to_string(),
    };
    
    // Get Rust version by running `rustc -V`
    let rust_version = match std::process::Command::new("rustc").arg("-V").output() {
        Ok(output) => {
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            } else {
                "No instalado".to_string()
            }
        }
        Err(_) => "No instalado".to_string(),
    };
    
    let tauri_version = tauri::VERSION.to_string();

    Ok(serde_json::json!({
        "app_version": app_version,
        "node_version": node_version,
        "rust_version": rust_version,
        "tauri_version": tauri_version
    }))
}
