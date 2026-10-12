use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

/// One turn of the "Ask about this meeting" chat. Mirrors `meeting_chat_messages`.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ChatMessageRow {
    pub id: String,
    pub meeting_id: String,
    /// "user" | "assistant"
    pub role: String,
    pub content: String,
    pub created_at: String,
}

pub struct MeetingChatRepository;

impl MeetingChatRepository {
    pub async fn list(pool: &SqlitePool, meeting_id: &str) -> Result<Vec<ChatMessageRow>, sqlx::Error> {
        sqlx::query_as::<_, ChatMessageRow>(
            "SELECT id, meeting_id, role, content, created_at FROM meeting_chat_messages WHERE meeting_id = ? ORDER BY created_at ASC, rowid ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn append(
        pool: &SqlitePool,
        meeting_id: &str,
        role: &str,
        content: &str,
    ) -> Result<ChatMessageRow, sqlx::Error> {
        let row = ChatMessageRow {
            id: format!("chat-{}", Uuid::new_v4()),
            meeting_id: meeting_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: Utc::now().to_rfc3339(),
        };
        sqlx::query(
            "INSERT INTO meeting_chat_messages (id, meeting_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&row.id)
        .bind(&row.meeting_id)
        .bind(&row.role)
        .bind(&row.content)
        .bind(&row.created_at)
        .execute(pool)
        .await?;
        Ok(row)
    }

    pub async fn clear(pool: &SqlitePool, meeting_id: &str) -> Result<u64, sqlx::Error> {
        let res = sqlx::query("DELETE FROM meeting_chat_messages WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(res.rows_affected())
    }
}
