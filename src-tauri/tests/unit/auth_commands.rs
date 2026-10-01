use crate::db::{DbState, SharedDbState};
use std::fs;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;

// Tauri enlaza su manifiesto de Windows con la app; estas pruebas también lo necesitan.
#[cfg(all(target_os = "windows", target_env = "msvc"))]
#[link(name = "resource", kind = "static")]
unsafe extern "C" {}

const PASSWORD: &str = "FixturePassword032!";

struct LoginFixture {
    dir: PathBuf,
    state: SharedDbState,
}

impl LoginFixture {
    fn new() -> Self {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("comparetica-login-ipc-{}-{id}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        fs::write(
            dir.join("comparetica.db.enc"),
            include_bytes!("../fixtures/rusqlite-0.32.1/database.enc"),
        )
        .unwrap();
        fs::write(
            dir.join("vault.json"),
            include_bytes!("../fixtures/rusqlite-0.32.1/vault.json"),
        )
        .unwrap();
        let state = Arc::new(Mutex::new(DbState::new(dir.clone())));
        Self { dir, state }
    }

    fn app(&self) -> tauri::App<MockRuntime> {
        mock_builder()
            .manage(Arc::clone(&self.state))
            .invoke_handler(tauri::generate_handler![crate::db_login])
            .build(mock_context(noop_assets()))
            .unwrap()
    }
}

impl Drop for LoginFixture {
    fn drop(&mut self) {
        self.state.lock().unwrap().conn = None;
        fs::remove_dir_all(&self.dir).unwrap();
    }
}

fn login_request(password: &str) -> InvokeRequest {
    InvokeRequest {
        cmd: "db_login".into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body: InvokeBody::Json(serde_json::json!({ "password": password })),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.into(),
    }
}

#[test]
fn login_command_releases_the_ui_thread_before_waiting_for_the_database() {
    let fixture = LoginFixture::new();
    let app = fixture.app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let state = Arc::clone(&fixture.state);
    let (ready_tx, ready_rx) = mpsc::channel();
    let (ui_free_tx, ui_free_rx) = mpsc::channel();
    let database_thread = std::thread::spawn(move || {
        let guard = state.lock().unwrap();
        ready_tx.send(()).unwrap();
        // La espera acotada permite detectar el bloqueo sin dejar la prueba colgada.
        let ui_was_free = ui_free_rx.recv_timeout(Duration::from_secs(5)).is_ok();
        drop(guard);
        ui_was_free
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();

    let (response_tx, response_rx) = mpsc::channel();
    webview.as_ref().clone().on_message(
        login_request(PASSWORD),
        Box::new(move |_, _, response, _, _| {
            response_tx.send(response).unwrap();
        }),
    );
    let _ = ui_free_tx.send(());
    let ui_was_free = database_thread.join().unwrap();
    let response = response_rx.recv_timeout(Duration::from_secs(30)).unwrap();

    assert!(
        ui_was_free,
        "El comando de acceso bloqueó el hilo que atiende la ventana"
    );
    match response {
        InvokeResponse::Ok(body) => assert_eq!(
            body.deserialize::<serde_json::Value>().unwrap(),
            serde_json::Value::Null
        ),
        InvokeResponse::Err(error) => panic!("El acceso válido debe funcionar: {error:?}"),
    }
    assert!(
        fixture
            .state
            .lock()
            .unwrap()
            .get_status()
            .unwrap()
            .is_unlocked
    );
}

#[test]
fn login_command_rejects_wrong_password_and_allows_retry_and_relogin() {
    let fixture = LoginFixture::new();
    let app = fixture.app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    let wrong = tauri::test::get_ipc_response(&webview, login_request("WrongPassword2026!"));
    assert!(wrong.is_err());
    assert!(
        !fixture
            .state
            .lock()
            .unwrap()
            .get_status()
            .unwrap()
            .is_unlocked
    );

    for _ in 0..2 {
        let valid = tauri::test::get_ipc_response(&webview, login_request(PASSWORD));
        assert_eq!(
            valid.unwrap().deserialize::<serde_json::Value>().unwrap(),
            serde_json::Value::Null
        );
        let mut state = fixture.state.lock().unwrap();
        assert!(state.get_status().unwrap().is_unlocked);
        state.logout().unwrap();
        assert!(!state.get_status().unwrap().is_unlocked);
    }
}
