use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const CSV_EXTENSIONS: &[&str] = &["csv", "txt"];
const LOGO_EXTENSIONS: &[&str] = &["svg", "png", "jpg", "jpeg", "webp", "avif"];
const SUPPORTED_EXTENSIONS: &[&str] = &["csv", "txt", "svg", "png", "jpg", "jpeg", "webp", "avif"];
const ACCESS_DENIED: &str = "Solo se pueden leer archivos del tipo solicitado arrastrados a esta ventana.";

#[derive(Default)]
pub struct DroppedFiles {
    paths_by_window: HashMap<String, HashMap<PathBuf, PathBuf>>,
}

pub type SharedDroppedFileState = Mutex<DroppedFiles>;

impl DroppedFiles {
    pub fn register_drop(&mut self, window_label: &str, paths: &[PathBuf]) {
        let allowed = paths
            .iter()
            .filter_map(|path| canonical_file_path(path, SUPPORTED_EXTENSIONS).map(|canonical| (path.clone(), canonical)))
            .collect();
        self.paths_by_window
            .insert(window_label.to_string(), allowed);
    }

    pub fn clear_window(&mut self, window_label: &str) {
        self.paths_by_window.remove(window_label);
    }

    pub fn read_csv(&self, window_label: &str, path: &Path) -> Result<Vec<u8>, String> {
        self.read(window_label, path, CSV_EXTENSIONS)
    }

    pub fn read_logo(&self, window_label: &str, path: &Path) -> Result<Vec<u8>, String> {
        self.read(window_label, path, LOGO_EXTENSIONS)
    }

    fn read(&self, window_label: &str, path: &Path, extensions: &[&str]) -> Result<Vec<u8>, String> {
        // Comprobar la ruta registrada antes de consultar el sistema de archivos.
        let expected = self
            .paths_by_window
            .get(window_label)
            .and_then(|paths| paths.get(path))
            .ok_or_else(|| ACCESS_DENIED.to_string())?;
        let canonical = canonical_file_path(path, extensions).ok_or_else(|| ACCESS_DENIED.to_string())?;
        if &canonical != expected {
            return Err(ACCESS_DENIED.to_string());
        }

        std::fs::read(canonical).map_err(|e| format!("Error al leer el archivo: {}", e))
    }
}

fn canonical_file_path(path: &Path, extensions: &[&str]) -> Option<PathBuf> {
    let supported = |path: &Path| {
        path.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extensions.iter().any(|allowed| extension.eq_ignore_ascii_case(allowed)))
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
        let files = DroppedFiles::default();
        assert!(files.read_csv("main", &fixture("clientes-utf8.csv")).is_err());
    }

    #[test]
    fn native_reader_accepts_windows1252_csv() {
        let path = fixture("clientes-windows1252.csv");
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            std::str::from_utf8(&bytes).is_err(),
            "fixture must require conversion"
        );
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert_eq!(files.read_csv("main", &path).unwrap(), bytes);
    }

    #[test]
    fn native_reader_preserves_utf8_csv() {
        let path = fixture("clientes-utf8.csv");
        let bytes = std::fs::read(&path).unwrap();
        assert!(std::str::from_utf8(&bytes).is_ok());
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert_eq!(files.read_csv("main", &path).unwrap(), bytes);
    }

    #[test]
    fn dropping_a_file_does_not_allow_a_sibling_file() {
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[fixture("clientes-utf8.csv")]);
        assert!(files
            .read_csv("main", &fixture("clientes-con-agente.csv"))
            .is_err());
    }

    #[test]
    fn a_drop_only_authorizes_the_receiving_window() {
        let path = fixture("clientes-utf8.csv");
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert!(files.read_csv("other", &path).is_err());
        assert!(files.read_csv("main", &path).is_ok());
    }

    #[test]
    fn dropping_an_unsupported_file_does_not_authorize_it() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert!(files.read_csv("main", &path).is_err());
    }

    #[test]
    fn the_next_drop_replaces_previous_permissions() {
        let first = fixture("clientes-utf8.csv");
        let next = fixture("clientes-windows1252.csv");
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[first.clone()]);
        files.register_drop("main", &[next.clone()]);
        assert!(files.read_csv("main", &first).is_err());
        assert!(files.read_csv("main", &next).is_ok());
        files.register_drop("main", &[]);
        assert!(files.read_csv("main", &next).is_err());
    }

    #[test]
    fn clearing_a_window_revokes_its_permissions() {
        let path = fixture("clientes-utf8.csv");
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        files.clear_window("main");
        assert!(files.read_csv("main", &path).is_err());
    }

    #[test]
    fn dropped_txt_files_are_supported_case_insensitively() {
        let path = std::env::temp_dir().join(format!(
            "comparetica_csv_drop_{}.TXT",
            rand::random::<u64>()
        ));
        let bytes = b"Nombre;CIF\nEmpresa;B12345674";
        std::fs::write(&path, bytes).unwrap();
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        let result = files.read_csv("main", &path);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(result.unwrap(), bytes);
    }

    #[test]
    fn dropped_logo_formats_preserve_binary_bytes() {
        for extension in ["SVG", "PNG", "jpg", "jpeg", "webp", "avif"] {
            let path = std::env::temp_dir().join(format!("comparetica_dropped_logo_{}.{}", rand::random::<u64>(), extension));
            let bytes = [0xFF, 0x00, 0x80, 0x42];
            std::fs::write(&path, bytes).unwrap();
            let mut files = DroppedFiles::default();
            files.register_drop("main", &[path.clone()]);
            let result = files.read_logo("main", &path);
            std::fs::remove_file(&path).unwrap();
            assert_eq!(result.unwrap(), bytes);
        }
    }

    #[test]
    fn dropped_logos_are_only_readable_from_the_receiving_window() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/assets/light-bulb.svg");
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert!(files.read_logo("other", &path).is_err());
        assert!(files.read_logo("main", &path).is_ok());
    }

    #[test]
    fn the_logo_reader_rejects_dropped_csv_files() {
        let path = fixture("clientes-utf8.csv");
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert!(files.read_logo("main", &path).is_err());
    }

    #[test]
    fn the_csv_reader_rejects_dropped_logos() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/assets/light-bulb.svg");
        let mut files = DroppedFiles::default();
        files.register_drop("main", &[path.clone()]);
        assert!(files.read_csv("main", &path).is_err());
    }
}
