// Audio permissions: microphone and system audio (macOS)
//
// On macOS a denied microphone or system-audio tap does not fail; it simply
// delivers silence. So "can I open the device" says nothing about permission.
// Instead:
// - microphone: AVCaptureDevice's authorization status and request
// - system audio (Core Audio taps, macOS 14.4+): the TCC service
//   kTCCServiceAudioCapture. Apple has no public API for it; TCC's
//   preflight/request functions are what system-audio recorders use outside
//   the App Store. If they are unavailable we fall back to starting a tap,
//   which shows the prompt the first time.
//
// Other platforms report both as authorized.
use anyhow::Result;
use log::{info, warn};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    Authorized,
    Denied,
    NotDetermined,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPermissions {
    pub microphone: PermissionState,
    pub system_audio: PermissionState,
}

#[cfg(target_os = "macos")]
mod mac {
    use super::PermissionState;
    use cidre::{av, blocks, cf};
    use log::{info, warn};
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::sync::OnceLock;
    use std::time::Duration;

    // How long to wait for the user to answer a permission prompt
    const PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

    pub fn microphone_status() -> PermissionState {
        match av::CaptureDevice::authorization_status_for_media_type(av::MediaType::audio()) {
            Ok(av::AuthorizationStatus::Authorized) => PermissionState::Authorized,
            Ok(av::AuthorizationStatus::NotDetermined) => PermissionState::NotDetermined,
            Ok(_) => PermissionState::Denied, // denied, or restricted by policy
            Err(_) => PermissionState::NotDetermined,
        }
    }

    /// Shows the microphone prompt if the user has not decided yet. Blocks
    /// until they answer, so call it off the async runtime.
    pub fn request_microphone() -> PermissionState {
        let status = microphone_status();
        if status != PermissionState::NotDetermined {
            return status;
        }
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        let mut block = blocks::SendBlock::<fn(bool)>::new1(move |granted: bool| {
            let _ = tx.send(granted);
        });
        if av::CaptureDevice::request_access_for_media_type_ch(av::MediaType::audio(), &mut block).is_err() {
            warn!("Microphone permission request failed to start");
            return microphone_status();
        }
        match rx.recv_timeout(PROMPT_TIMEOUT) {
            Ok(true) => PermissionState::Authorized,
            Ok(false) => PermissionState::Denied,
            Err(_) => microphone_status(),
        }
    }

    // --- TCC (system audio) -------------------------------------------------

    type PreflightFn = unsafe extern "C" fn(service: *const c_void, options: *const c_void) -> c_int;
    type RequestFn =
        unsafe extern "C" fn(service: *const c_void, options: *const c_void, completion: *mut c_void);

    extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    const RTLD_NOW: c_int = 0x2;
    const TCC_PATH: &CStr = c"/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC";

    struct Tcc {
        preflight: Option<PreflightFn>,
        request: Option<RequestFn>,
    }

    fn tcc() -> &'static Tcc {
        static TCC: OnceLock<Tcc> = OnceLock::new();
        TCC.get_or_init(|| unsafe {
            let handle = dlopen(TCC_PATH.as_ptr(), RTLD_NOW);
            if handle.is_null() {
                warn!("TCC framework not available; system audio permission status unknown");
                return Tcc { preflight: None, request: None };
            }
            let preflight = dlsym(handle, c"TCCAccessPreflight".as_ptr());
            let request = dlsym(handle, c"TCCAccessRequest".as_ptr());
            Tcc {
                preflight: (!preflight.is_null())
                    .then(|| std::mem::transmute::<*mut c_void, PreflightFn>(preflight)),
                request: (!request.is_null())
                    .then(|| std::mem::transmute::<*mut c_void, RequestFn>(request)),
            }
        })
    }

    fn audio_capture_service() -> cidre::arc::R<cf::String> {
        cf::String::from_str("kTCCServiceAudioCapture")
    }

    pub fn system_audio_status() -> PermissionState {
        let Some(preflight) = tcc().preflight else {
            return PermissionState::NotDetermined;
        };
        let service = audio_capture_service();
        // 0 = granted, 1 = denied, anything else = not asked yet
        match unsafe { preflight(&*service as *const cf::String as *const c_void, std::ptr::null()) } {
            0 => PermissionState::Authorized,
            1 => PermissionState::Denied,
            _ => PermissionState::NotDetermined,
        }
    }

    /// Shows the "Screen & System Audio Recording" prompt if the user has not
    /// decided yet. Blocks until they answer, so call it off the async runtime.
    pub fn request_system_audio() -> PermissionState {
        let status = system_audio_status();
        if status != PermissionState::NotDetermined {
            return status;
        }

        if let Some(request) = tcc().request {
            let (tx, rx) = std::sync::mpsc::channel::<bool>();
            let mut block = blocks::SendBlock::<fn(bool)>::new1(move |granted: bool| {
                let _ = tx.send(granted);
            });
            let service = audio_capture_service();
            unsafe {
                request(
                    &*service as *const cf::String as *const c_void,
                    std::ptr::null(),
                    &mut *block as *mut blocks::SendBlock<fn(bool)> as *mut c_void,
                );
            }
            return match rx.recv_timeout(PROMPT_TIMEOUT) {
                Ok(true) => PermissionState::Authorized,
                Ok(false) => PermissionState::Denied,
                Err(_) => system_audio_status(),
            };
        }

        // No TCC request function: starting a tap shows the prompt
        info!("Starting a system audio tap to show the permission prompt");
        match crate::audio::capture::CoreAudioCapture::new().and_then(|c| c.stream()) {
            Ok(stream) => {
                std::thread::sleep(Duration::from_secs(1));
                drop(stream);
            }
            Err(e) => warn!("Could not start a system audio tap: {}", e),
        }
        system_audio_status()
    }

    pub fn open_privacy_pane(pane: &str) -> std::io::Result<()> {
        std::process::Command::new("open")
            .arg(format!("x-apple.systempreferences:com.apple.preference.security?{}", pane))
            .spawn()
            .map(|_| ())
    }

    // --- Telling the UI about a silent tap -----------------------------------

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    pub fn set_app_handle(app: tauri::AppHandle) {
        let _ = APP.set(app);
    }

    pub fn notify_system_audio_silent() {
        use tauri::Emitter;
        if let Some(app) = APP.get() {
            let _ = app.emit("system-audio-silent", ());
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac::{notify_system_audio_silent, set_app_handle};

/// Current microphone and system audio permission, without prompting
pub fn audio_permissions() -> AudioPermissions {
    #[cfg(target_os = "macos")]
    {
        AudioPermissions {
            microphone: mac::microphone_status(),
            system_audio: mac::system_audio_status(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        AudioPermissions {
            microphone: PermissionState::Authorized,
            system_audio: PermissionState::Authorized,
        }
    }
}

/// Prompt for the microphone if undecided; blocks until answered (macOS)
#[cfg(target_os = "macos")]
pub fn request_microphone_permission() -> PermissionState {
    mac::request_microphone()
}

/// Whether system audio capture is allowed or still undecided (macOS 14.4+).
/// Undecided counts as allowed: macOS asks when the tap first starts.
#[cfg(target_os = "macos")]
pub fn check_screen_recording_permission() -> bool {
    mac::system_audio_status() != PermissionState::Denied
}

#[cfg(not(target_os = "macos"))]
pub fn check_screen_recording_permission() -> bool {
    true // Not required on other platforms
}

/// Open System Settings at "Screen & System Audio Recording"
#[cfg(target_os = "macos")]
pub fn request_screen_recording_permission() -> Result<()> {
    info!("Opening System Settings at Screen & System Audio Recording");
    mac::open_privacy_pane("Privacy_ScreenCapture")
        .map_err(|e| anyhow::anyhow!("Failed to open System Settings: {}", e))
}

#[cfg(not(target_os = "macos"))]
pub fn request_screen_recording_permission() -> Result<()> {
    Ok(()) // Not required on other platforms
}

/// Check and request Audio Capture permission if not granted
/// Returns true if permission is granted, false otherwise
pub fn ensure_screen_recording_permission() -> bool {
    if check_screen_recording_permission() {
        return true;
    }

    warn!("System audio permission denied - opening System Settings");

    if let Err(e) = request_screen_recording_permission() {
        log::error!("Failed to open System Settings: {}", e);
    }

    false
}

/// Tauri command to check Screen Recording permission
#[tauri::command]
pub async fn check_screen_recording_permission_command() -> bool {
    check_screen_recording_permission()
}

/// Tauri command to request Screen Recording permission
#[tauri::command]
pub async fn request_screen_recording_permission_command() -> Result<(), String> {
    request_screen_recording_permission()
        .map_err(|e| e.to_string())
}

/// Prompt for system audio if undecided. Ok(true) only when actually granted.
#[cfg(target_os = "macos")]
pub fn trigger_system_audio_permission() -> Result<bool> {
    let state = mac::request_system_audio();
    info!("System audio permission: {:?}", state);
    Ok(state == PermissionState::Authorized)
}

#[cfg(not(target_os = "macos"))]
pub fn trigger_system_audio_permission() -> Result<bool> {
    // System audio permissions not required on other platforms
    info!("System audio permissions not required on this platform");
    Ok(true)
}

/// Tauri command to trigger system audio permission request
/// Returns true if permission was granted, false if denied or unanswered
#[tauri::command]
pub async fn trigger_system_audio_permission_command() -> Result<bool, String> {
    // Run in blocking task to avoid blocking the async runtime
    tokio::task::spawn_blocking(|| {
        trigger_system_audio_permission()
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())
}

/// Tauri command: current microphone and system audio permission
#[tauri::command]
pub async fn get_audio_permissions() -> AudioPermissions {
    tokio::task::spawn_blocking(audio_permissions)
        .await
        .unwrap_or(AudioPermissions {
            microphone: PermissionState::NotDetermined,
            system_audio: PermissionState::NotDetermined,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_permission() {
        let has_permission = check_screen_recording_permission();
        println!("Has Screen Recording permission: {}", has_permission);
    }
}
