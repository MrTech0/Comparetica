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
fn export_backup(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data_dir.join("comparetica.db");

    if !db_path.exists() {
        return Err("No se encontró el archivo de base de datos actual para respaldar. Por favor, asegúrate de haber guardado al menos algún dato primero.".to_string());
    }

    let save_path = rfd::FileDialog::new()
        .set_file_name("comparetica_backup.db")
        .add_filter("Base de datos SQLite", &["db", "sqlite"])
        .save_file();

    if let Some(save_path) = save_path {
        std::fs::copy(&db_path, &save_path).map_err(|e| e.to_string())?;
        Ok(save_path.to_string_lossy().to_string())
    } else {
        Err("Cancelado por el usuario".to_string())
    }
}

#[tauri::command]
fn import_backup(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_data_dir.join("comparetica.db");

    let open_path = rfd::FileDialog::new()
        .add_filter("Base de datos SQLite", &["db", "sqlite"])
        .pick_file();

    if let Some(open_path) = open_path {
        // Asegurarse de que el directorio de datos existe
        if !app_data_dir.exists() {
            std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        }

        // Crear una copia temporal de la base de datos actual antes de sobreescribir
        let temp_db_path = app_data_dir.join("comparetica.db.backup_temp");
        if db_path.exists() {
            std::fs::copy(&db_path, &temp_db_path).map_err(|e| e.to_string())?;
        }

        // Reemplazar la base de datos con el archivo de copia de seguridad
        if let Err(e) = std::fs::copy(&open_path, &db_path) {
            // Si falla, restauramos el backup temporal si existía
            if temp_db_path.exists() {
                let _ = std::fs::copy(&temp_db_path, &db_path);
                let _ = std::fs::remove_file(&temp_db_path);
            }
            return Err(format!("Error al restaurar la copia de seguridad: {}", e));
        }

        // Eliminar el archivo de backup temporal si todo sale bien
        if temp_db_path.exists() {
            let _ = std::fs::remove_file(&temp_db_path);
        }

        #[cfg(dev)]
        {
            Ok("DEV_MODE".to_string())
        }
        #[cfg(not(dev))]
        {
            // Reiniciar la aplicación de forma limpia en un hilo secundario
            // para permitir que la función devuelva la respuesta con éxito al frontend.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                app_handle.restart();
            });
            Ok("Copia de seguridad restaurada correctamente. Reiniciando la aplicación...".to_string())
        }
    } else {
        Err("Cancelado por el usuario".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                use tauri::Manager;
                let app_handle = window.app_handle();
                perform_auto_backup(&app_handle);
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet, 
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
            factory_reset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn perform_auto_backup(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    use std::time::UNIX_EPOCH;
    let app_data_dir = match app_handle.path().app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };
    let db_path = app_data_dir.join("comparetica.db");

    if !db_path.exists() {
        return; // No hay base de datos aún para guardar
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

    // Crear la nueva copia de seguridad con marca de tiempo Unix
    if let Ok(duration) = std::time::SystemTime::now().duration_since(UNIX_EPOCH) {
        let timestamp = duration.as_secs();
        let backup_path = backup_dir.join(format!("comparetica_auto_backup_{}.db", timestamp));
        let _ = std::fs::copy(&db_path, &backup_path);
    }

    // Limpieza de copias automáticas antiguas
    if let Ok(entries) = std::fs::read_dir(&backup_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                    if filename.starts_with("comparetica_auto_backup_") && filename.ends_with(".db") {
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
fn factory_reset(app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    use tauri::Manager;
    
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    
    let config_path = app_data_dir.join("config.json");
    if config_path.exists() {
        let _ = fs::remove_file(&config_path);
    }
    
    // Limpiar todos los logos posibles
    delete_all_logos(&app_data_dir);

    // No eliminamos comparetica.db ni reiniciamos el proceso aquí
    // para evitar bloqueos del sistema de archivos en Windows y desconexiones
    // del servidor de desarrollo del WebView (puertos ocupados/refusales).
    // El frontend se encarga de vaciar las tablas con DELETE queries y recargar la página.

    Ok("Configuración y logotipos eliminados con éxito.".to_string())
}
