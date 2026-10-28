// quit_guard.rs (macOS)
//
// Quitting while recording must not lose the meeting. Saving takes two steps:
// the backend stops the recording (audio file, transcript flush), then the
// frontend writes the meeting to the database on `recording-stop-complete`.
//
// tao handles Cmd+Q / NSApp terminate by exiting without an ExitRequested
// that can be prevented, so the app menu's Quit is replaced with our own item
// that goes through `app.exit()`. Every quit (menu, tray, Cmd+Q) then arrives
// as RunEvent::ExitRequested, where a recording is stopped and saved before
// the app actually exits.
//
// A system-initiated terminate (logout, shutdown) still bypasses this; the
// Exit handler then stops the recording so at least the audio is written.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{AppHandle, Emitter, Listener, Manager, Runtime};

const QUIT_MENU_ID: &str = "notesify-quit";
/// The frontend emits this once the stopped recording is saved
const SAVED_EVENT: &str = "recording-post-processing-done";
const SAVE_TIMEOUT: Duration = Duration::from_secs(30);

static EXIT_ALLOWED: AtomicBool = AtomicBool::new(false);
static SAVING: AtomicBool = AtomicBool::new(false);

/// Replace the default app menu's Quit with one routed through `app.exit()`
pub fn install_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        for item in app_menu.items()? {
            if let MenuItemKind::Predefined(predefined) = &item {
                if predefined.text()?.starts_with("Quit") {
                    app_menu.remove(predefined)?;
                }
            }
        }
        let quit = MenuItem::with_id(
            app,
            QUIT_MENU_ID,
            format!("Quit {}", app.package_info().name),
            true,
            Some("CmdOrCtrl+Q"),
        )?;
        app_menu.append(&quit)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == QUIT_MENU_ID {
            app.exit(0);
        }
    });
    Ok(())
}

/// Called from RunEvent::ExitRequested. Returns true when the exit must be
/// prevented because a recording is being saved first.
pub fn should_hold_exit<R: Runtime>(app: &AppHandle<R>) -> bool {
    if EXIT_ALLOWED.load(Ordering::Acquire) {
        return false;
    }
    let recording = tauri::async_runtime::block_on(crate::audio::recording_commands::is_recording());
    if !recording {
        return false;
    }
    if !SAVING.swap(true, Ordering::AcqRel) {
        save_then_exit(app.clone());
    }
    true
}

fn save_then_exit<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        log::info!("Quit requested while recording: saving the meeting first");
        crate::tray::focus_main_window(&app);

        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let tx = std::sync::Mutex::new(Some(tx));
        let listener = app.once(SAVED_EVENT, move |_| {
            if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
                let _ = tx.send(());
            }
        });

        match stop_recording(&app).await {
            Ok(()) => {
                // The frontend saves the meeting, then emits SAVED_EVENT
                let _ = app.emit("recording-stop-complete", true);
                if tokio::time::timeout(SAVE_TIMEOUT, rx).await.is_err() {
                    log::warn!("Meeting save did not finish within {:?}; quitting anyway", SAVE_TIMEOUT);
                }
            }
            Err(e) => log::error!("Failed to stop recording before quitting: {}", e),
        }

        app.unlisten(listener);
        EXIT_ALLOWED.store(true, Ordering::Release);
        app.exit(0);
    });
}

async fn stop_recording<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let save_path = data_dir.join(format!("recording-{}.wav", timestamp));
    crate::audio::recording_commands::stop_recording(
        app.clone(),
        crate::audio::recording_commands::RecordingArgs {
            save_path: save_path.to_string_lossy().to_string(),
        },
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Called from RunEvent::Exit, when quitting could not be held (logout,
/// shutdown). Stops a running recording so its audio reaches disk.
pub fn stop_recording_on_exit<R: Runtime>(app: &AppHandle<R>) {
    if EXIT_ALLOWED.load(Ordering::Acquire) {
        return;
    }
    tauri::async_runtime::block_on(async {
        if !crate::audio::recording_commands::is_recording().await {
            return;
        }
        log::warn!("App terminating while recording: stopping so the audio is saved");
        match tokio::time::timeout(Duration::from_secs(10), stop_recording(app)).await {
            Ok(Ok(())) => log::info!("Recording stopped before exit"),
            Ok(Err(e)) => log::error!("Failed to stop recording before exit: {}", e),
            Err(_) => log::error!("Stopping the recording timed out during exit"),
        }
    });
}
