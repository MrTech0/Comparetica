use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const ACCESS_DENIED: &str = "Solo se pueden leer archivos CSV o TXT arrastrados a esta ventana.";

#[derive(Default)]
pub struct DroppedCsvFiles {
    paths_by_window: HashMap<String, HashMap<PathBuf, PathBuf>>,
}

pub type SharedCsvDropState = Mutex<DroppedCsvFiles>;

impl DroppedCsvFiles {
    pub fn register_drop(&mut self, window_label: &str, paths: &[PathBuf]) {
        let allowed = paths
            .iter()
            .filter_map(|path| canonical_csv_path(path).map(|canonical| (path.clone(), canonical)))
            .collect();
        self.paths_by_window
            .insert(window_label.to_string(), allowed);
    }

    pub fn clear_window(&mut self, window_label: &str) {
        self.paths_by_window.remove(window_label);
    }

    pub fn read(&self, window_label: &str, path: &Path) -> Result<Vec<u8>, String> {
        // Comprobar la ruta registrada antes de consultar el sistema de archivos.
        let expected = self
            .paths_by_window
            .get(window_label)
            .and_then(|paths| paths.get(path))
            .ok_or_else(|| ACCESS_DENIED.to_string())?;
        let canonical = canonical_csv_path(path).ok_or_else(|| ACCESS_DENIED.to_string())?;
        if &canonical != expected {
            return Err(ACCESS_DENIED.to_string());
        }

        // Conservar los bytes originales para detectar la codificación en la interfaz.
        std::fs::read(canonical).map_err(|e| format!("Error al leer el archivo: {}", e))
    }
}

fn canonical_csv_path(path: &Path) -> Option<PathBuf> {
    let supported = |path: &Path| {
        path.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("csv") || extension.eq_ignore_ascii_case("txt")
            })
    };
    if !supported(path) {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    (canonical.is_file() && supported(&canonical)).then_some(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../test/fixtures")
            .join(name)
    }

    #[test]
    fn native_reader_rejects_files_not_dropped_by_user() {
        let files = DroppedCsvFiles::default();
        assert!(files.read("main", &fixture("clientes-utf8.csv")).is_err());
    }

    #[test]
    fn native_reader_accepts_windows1252_csv() {
        let path = fixture("clientes-windows1252.csv");
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            std::str::from_utf8(&bytes).is_err(),
            "fixture must require conversion"
        );
        let mut files = DroppedCsvFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert_eq!(files.read("main", &path).unwrap(), bytes);
    }

    #[test]
    fn native_reader_preserves_utf8_csv() {
        let path = fixture("clientes-utf8.csv");
        let bytes = std::fs::read(&path).unwrap();
        assert!(std::str::from_utf8(&bytes).is_ok());
        let mut files = DroppedCsvFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert_eq!(files.read("main", &path).unwrap(), bytes);
    }

    #[test]
    fn dropping_a_file_does_not_allow_a_sibling_file() {
        let mut files = DroppedCsvFiles::default();
        files.register_drop("main", &[fixture("clientes-utf8.csv")]);
        assert!(files
            .read("main", &fixture("clientes-con-agente.csv"))
            .is_err());
    }

    #[test]
    fn a_drop_only_authorizes_the_receiving_window() {
        let path = fixture("clientes-utf8.csv");
        let mut files = DroppedCsvFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert!(files.read("other", &path).is_err());
        assert!(files.read("main", &path).is_ok());
    }

    #[test]
    fn dropping_an_unsupported_file_does_not_authorize_it() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let mut files = DroppedCsvFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert!(files.read("main", &path).is_err());
    }

    #[test]
    fn the_next_drop_replaces_previous_permissions() {
        let first = fixture("clientes-utf8.csv");
        let next = fixture("clientes-windows1252.csv");
        let mut files = DroppedCsvFiles::default();
        files.register_drop("main", &[first.clone()]);
        files.register_drop("main", &[next.clone()]);
        assert!(files.read("main", &first).is_err());
        assert!(files.read("main", &next).is_ok());
        files.register_drop("main", &[]);
        assert!(files.read("main", &next).is_err());
    }

    #[test]
    fn clearing_a_window_revokes_its_permissions() {
        let path = fixture("clientes-utf8.csv");
        let mut files = DroppedCsvFiles::default();
        files.register_drop("main", &[path.clone()]);
        files.clear_window("main");
        assert!(files.read("main", &path).is_err());
    }

    #[test]
    fn dropped_txt_files_are_supported_case_insensitively() {
        let path = std::env::temp_dir().join(format!(
            "comparetica_csv_drop_{}.TXT",
            rand::random::<u64>()
        ));
        let bytes = b"Nombre;CIF\nEmpresa;B12345674";
        std::fs::write(&path, bytes).unwrap();
        let mut files = DroppedCsvFiles::default();
        files.register_drop("main", &[path.clone()]);
        let result = files.read("main", &path);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(result.unwrap(), bytes);
    }
}
