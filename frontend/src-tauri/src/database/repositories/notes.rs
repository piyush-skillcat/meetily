use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

/// User-authored notes taken during (or after) a meeting.
/// Mirrors the `meeting_notes` table.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MeetingNotes {
    pub meeting_id: String,
    pub notes_markdown: Option<String>,
    /// BlockNote document JSON (string) for lossless editor round-trips
    pub notes_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct MeetingNotesRepository;

impl MeetingNotesRepository {
    pub async fn get(pool: &SqlitePool, meeting_id: &str) -> Result<Option<MeetingNotes>, sqlx::Error> {
        sqlx::query_as::<_, MeetingNotes>(
            "SELECT meeting_id, notes_markdown, notes_json, created_at, updated_at FROM meeting_notes WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn upsert(
        pool: &SqlitePool,
        meeting_id: &str,
        notes_markdown: &str,
        notes_json: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO meeting_notes (meeting_id, notes_markdown, notes_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                notes_markdown = excluded.notes_markdown,
                -- keep the editor's JSON document when a caller only has markdown
                notes_json = COALESCE(excluded.notes_json, meeting_notes.notes_json),
                updated_at = excluded.updated_at
            "#,
        )
        .bind(meeting_id)
        .bind(notes_markdown)
        .bind(notes_json)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;
        Ok(())
    }
}
