-- Chat history for "Ask about this meeting" (Granola-style follow-up questions)
CREATE TABLE IF NOT EXISTS meeting_chat_messages (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_chat_messages_meeting_id ON meeting_chat_messages(meeting_id);

-- Per-user default template for "Enhance notes" (Granola picks a template per meeting; we remember the last one)
ALTER TABLE settings ADD COLUMN defaultTemplateId TEXT;
