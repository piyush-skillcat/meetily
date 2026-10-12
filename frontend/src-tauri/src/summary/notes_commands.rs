//! Tauri commands for the user's own meeting notes (the "My notes" pad).

use crate::database::repositories::notes::{MeetingNotes, MeetingNotesRepository};
use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;
use tauri::{AppHandle, Runtime};
use tracing::info;

#[tauri::command]
pub async fn api_get_meeting_notes<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<MeetingNotes>, String> {
    MeetingNotesRepository::get(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(|e| format!("Failed to load notes: {}", e))
}

#[tauri::command]
pub async fn api_save_meeting_notes<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    notes_markdown: String,
    notes_json: Option<String>,
) -> Result<(), String> {
    info!("api_save_meeting_notes for {} ({} chars)", meeting_id, notes_markdown.len());
    MeetingNotesRepository::upsert(state.db_manager.pool(), &meeting_id, &notes_markdown, notes_json.as_deref())
        .await
        .map_err(|e| format!("Failed to save notes: {}", e))
}

#[tauri::command]
pub async fn api_get_default_template<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    SettingsRepository::get_default_template_id(state.db_manager.pool())
        .await
        .map_err(|e| format!("Failed to read default template: {}", e))
}

#[tauri::command]
pub async fn api_set_default_template<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    template_id: String,
) -> Result<(), String> {
    SettingsRepository::set_default_template_id(state.db_manager.pool(), &template_id)
        .await
        .map_err(|e| format!("Failed to save default template: {}", e))
}
