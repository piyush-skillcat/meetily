use reqwest::{header, Client};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::info;

const REQUEST_TIMEOUT_DURATION: Duration = Duration::from_secs(300);

// Generic structure for OpenAI-compatible API chat messages
#[derive(Debug, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// Generic structure for OpenAI-compatible API chat requests
#[derive(Debug, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
}

// Generic structure for OpenAI-compatible API chat responses
#[derive(Deserialize, Debug)]
pub struct ChatResponse {
    pub choices: Vec<Choice>,
}

#[derive(Deserialize, Debug)]
pub struct Choice {
    pub message: MessageContent,
}

#[derive(Deserialize, Debug)]
pub struct MessageContent {
    pub content: String,
}

// Claude-specific request structure
#[derive(Debug, Serialize)]
pub struct ClaudeRequest {
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

// Claude-specific response structure
#[derive(Deserialize, Debug)]
pub struct ClaudeChatResponse {
    pub content: Vec<ClaudeChatContent>,
}

#[derive(Deserialize, Debug)]
pub struct ClaudeChatContent {
    pub text: String,
}

/// LLM Provider enumeration for multi-provider support
#[derive(Debug, Clone, PartialEq)]
pub enum LLMProvider {
    OpenAI,
    Claude,
    Groq,
    Ollama,
    OpenRouter,
    BuiltInAI,
    CustomOpenAI,
}

impl LLMProvider {
    /// Parse provider from string (case-insensitive)
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "openai" => Ok(Self::OpenAI),
            "claude" => Ok(Self::Claude),
            "groq" => Ok(Self::Groq),
            "ollama" => Ok(Self::Ollama),
            "openrouter" => Ok(Self::OpenRouter),
            "builtin-ai" | "local-llama" | "localllama" => Ok(Self::BuiltInAI),
            "custom-openai" => Ok(Self::CustomOpenAI),
            _ => Err(format!("Unsupported LLM provider: {}", s)),
        }
    }
}

/// Generates a summary using the specified LLM provider
///
/// # Arguments
/// * `client` - Reqwest HTTP client (reused for performance)
/// * `provider` - The LLM provider to use
/// * `model_name` - The specific model to use (e.g., "gpt-4", "claude-3-opus")
/// * `api_key` - API key for the provider (not needed for Ollama)
/// * `system_prompt` - System instructions for the LLM
/// * `user_prompt` - User query/content to process
/// * `ollama_endpoint` - Optional custom Ollama endpoint (defaults to localhost:11434)
/// * `custom_openai_endpoint` - Optional custom OpenAI-compatible endpoint
/// * `max_tokens` - Optional max tokens (for CustomOpenAI provider)
/// * `temperature` - Optional temperature (for CustomOpenAI provider)
/// * `top_p` - Optional top_p (for CustomOpenAI provider)
/// * `app_data_dir` - Optional app data directory (for BuiltInAI provider)
/// * `cancellation_token` - Optional token to cancel the request
///
/// # Returns
/// The generated summary text or an error message
pub async fn generate_summary(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    // Check if cancelled before starting
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err("Summary generation was cancelled".to_string());
        }
    }

    // Handle BuiltInAI provider separately (uses local sidecar, no HTTP API)
    if provider == &LLMProvider::BuiltInAI {
        let app_data_dir = app_data_dir
            .ok_or_else(|| "app_data_dir is required for BuiltInAI provider".to_string())?;

        return crate::summary::summary_engine::generate_with_builtin(
            app_data_dir,
            model_name,
            system_prompt,
            user_prompt,
            cancellation_token,
        )
        .await
        .map_err(|e| e.to_string());
    }

    let (api_url, mut headers) = match provider {
        LLMProvider::OpenAI => (
            "https://api.openai.com/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
        ),
        LLMProvider::Groq => (
            "https://api.groq.com/openai/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
        ),
        LLMProvider::OpenRouter => (
            "https://openrouter.ai/api/v1/chat/completions".to_string(),
            header::HeaderMap::new(),
        ),
        LLMProvider::Ollama => {
            let host = ollama_endpoint
                .map(|s| s.to_string())
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            (
                format!("{}/v1/chat/completions", host),
                header::HeaderMap::new(),
            )
        }
        LLMProvider::CustomOpenAI => {
            let endpoint = custom_openai_endpoint
                .ok_or_else(|| "Custom OpenAI endpoint not configured".to_string())?;
            (
                format!("{}/chat/completions", endpoint.trim_end_matches('/')),
                header::HeaderMap::new(),
            )
        }
        LLMProvider::Claude => {
            let mut header_map = header::HeaderMap::new();
            header_map.insert(
                "x-api-key",
                api_key
                    .parse()
                    .map_err(|_| "Invalid API key format".to_string())?,
            );
            header_map.insert(
                "anthropic-version",
                "2023-06-01"
                    .parse()
                    .map_err(|_| "Invalid anthropic version".to_string())?,
            );
            ("https://api.anthropic.com/v1/messages".to_string(), header_map)
        }
        LLMProvider::BuiltInAI => {
            // This case is handled earlier with early returns
            unreachable!("BuiltInAI is handled before this match statement")
        }
    };

    // Add authorization header for non-Claude providers
    if provider != &LLMProvider::Claude {
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {}", api_key)
                .parse()
                .map_err(|_| "Invalid authorization header".to_string())?,
        );
    }
    headers.insert(
        header::CONTENT_TYPE,
        "application/json"
            .parse()
            .map_err(|_| "Invalid content type".to_string())?,
    );

    // Build request body based on provider
    let request_body = if provider != &LLMProvider::Claude {
        // For CustomOpenAI, apply optional parameters if provided
        let (max_tokens_val, temperature_val, top_p_val) = if provider == &LLMProvider::CustomOpenAI {
            (max_tokens, temperature, top_p)
        } else {
            (None, None, None)
        };

        serde_json::json!(ChatRequest {
            model: model_name.to_string(),
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user_prompt.to_string(),
                }
            ],
            max_tokens: max_tokens_val,
            temperature: temperature_val,
            top_p: top_p_val,
        })
    } else {
        serde_json::json!(ClaudeRequest {
            system: system_prompt.to_string(),
            model: model_name.to_string(),
            max_tokens: 2048,
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            }]
        })
    };

    info!("🐞 LLM Request to {}: model={}", provider_name(provider), model_name);

    // Send request with timeout and cancellation support
    let request_future = client
        .post(api_url)
        .headers(headers)
        .json(&request_body)
        .timeout(REQUEST_TIMEOUT_DURATION)
        .send();

    // Use tokio::select to race between cancellation and request completion
    let response = if let Some(token) = cancellation_token {
        tokio::select! {
            result = request_future => {
                result.map_err(|e| {
                    if e.is_timeout() {
                        format!("LLM request timed out after 60 seconds")
                    } else {
                        format!("Failed to send request to LLM: {}", e)
                    }
                })?
            }
            _ = token.cancelled() => {
                return Err("Summary generation was cancelled".to_string());
            }
        }
    } else {
        request_future.await.map_err(|e| {
            if e.is_timeout() {
                format!("LLM request timed out after 60 seconds")
            } else {
                format!("Failed to send request to LLM: {}", e)
            }
        })?
    };

    if !response.status().is_success() {
        let error_body = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("LLM API request failed: {}", error_body));
    }

    // Parse response based on provider
    if provider == &LLMProvider::Claude {
        let chat_response = response
            .json::<ClaudeChatResponse>()
            .await
            .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

        info!("🐞 LLM Response received from Claude");

        let content = chat_response
            .content
            .get(0)
            .ok_or("No content in LLM response")?
            .text
            .trim();
        Ok(content.to_string())
    } else {
        let chat_response = response
            .json::<ChatResponse>()
            .await
            .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

        info!("🐞 LLM Response received from {}", provider_name(provider));

        let content = chat_response
            .choices
            .get(0)
            .ok_or("No content in LLM response")?
            .message
            .content
            .trim();
        Ok(content.to_string())
    }
}

/// Helper function to get provider name for logging
fn provider_name(provider: &LLMProvider) -> &str {
    match provider {
        LLMProvider::OpenAI => "OpenAI",
        LLMProvider::Claude => "Claude",
        LLMProvider::Groq => "Groq",
        LLMProvider::Ollama => "Ollama",
        LLMProvider::BuiltInAI => "Built-in AI",
        LLMProvider::OpenRouter => "OpenRouter",
        LLMProvider::CustomOpenAI => "Custom OpenAI",
    }
}

// ============================================================================
// STREAMING + MULTI-TURN SUPPORT (used by "Enhance notes" and "Ask" chat)
// ============================================================================

/// Everything needed to call one provider, resolved from settings.
#[derive(Debug, Clone)]
pub struct LlmCallConfig {
    pub provider: LLMProvider,
    pub model_name: String,
    pub api_key: String,
    pub ollama_endpoint: Option<String>,
    pub custom_openai_endpoint: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub app_data_dir: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
struct StreamChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
}

#[derive(Debug, Serialize)]
struct ClaudeStreamRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

const CLAUDE_MAX_OUTPUT_TOKENS: u32 = 8192;

/// Generate a chat completion, streaming text deltas to `on_delta` as they arrive.
/// Returns the full concatenated text. Works for every provider; BuiltInAI has no
/// token streaming so it delivers the whole answer in one delta.
pub async fn generate_stream<F>(
    client: &Client,
    cfg: &LlmCallConfig,
    system_prompt: &str,
    messages: Vec<ChatMessage>,
    cancellation_token: Option<&CancellationToken>,
    mut on_delta: F,
) -> Result<String, String>
where
    F: FnMut(&str) + Send,
{
    use futures_util::StreamExt;

    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err("Generation was cancelled".to_string());
        }
    }

    if cfg.provider == LLMProvider::BuiltInAI {
        let app_data_dir = cfg
            .app_data_dir
            .as_ref()
            .ok_or_else(|| "app_data_dir is required for BuiltInAI provider".to_string())?;
        // Flatten the conversation into one user prompt for the local model.
        let user_prompt = messages
            .iter()
            .map(|m| format!("{}: {}", m.role.to_uppercase(), m.content))
            .collect::<Vec<_>>()
            .join("\n\n");
        let text = crate::summary::summary_engine::generate_with_builtin(
            app_data_dir,
            &cfg.model_name,
            system_prompt,
            &user_prompt,
            cancellation_token,
        )
        .await
        .map_err(|e| e.to_string())?;
        on_delta(&text);
        return Ok(text);
    }

    let (api_url, mut headers) = match &cfg.provider {
        LLMProvider::OpenAI => ("https://api.openai.com/v1/chat/completions".to_string(), header::HeaderMap::new()),
        LLMProvider::Groq => ("https://api.groq.com/openai/v1/chat/completions".to_string(), header::HeaderMap::new()),
        LLMProvider::OpenRouter => ("https://openrouter.ai/api/v1/chat/completions".to_string(), header::HeaderMap::new()),
        LLMProvider::Ollama => {
            let host = cfg
                .ollama_endpoint
                .clone()
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            (format!("{}/v1/chat/completions", host.trim_end_matches('/')), header::HeaderMap::new())
        }
        LLMProvider::CustomOpenAI => {
            let endpoint = cfg
                .custom_openai_endpoint
                .as_deref()
                .ok_or_else(|| "Custom OpenAI endpoint not configured".to_string())?;
            (format!("{}/chat/completions", endpoint.trim_end_matches('/')), header::HeaderMap::new())
        }
        LLMProvider::Claude => {
            let mut h = header::HeaderMap::new();
            h.insert("x-api-key", cfg.api_key.parse().map_err(|_| "Invalid API key format".to_string())?);
            h.insert("anthropic-version", "2023-06-01".parse().map_err(|_| "Invalid anthropic version".to_string())?);
            ("https://api.anthropic.com/v1/messages".to_string(), h)
        }
        LLMProvider::BuiltInAI => unreachable!("handled above"),
    };

    if cfg.provider != LLMProvider::Claude {
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {}", cfg.api_key)
                .parse()
                .map_err(|_| "Invalid authorization header".to_string())?,
        );
    }
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
    headers.insert(header::ACCEPT, "text/event-stream".parse().unwrap());

    let body = if cfg.provider == LLMProvider::Claude {
        serde_json::to_value(ClaudeStreamRequest {
            model: cfg.model_name.clone(),
            max_tokens: cfg.max_tokens.unwrap_or(CLAUDE_MAX_OUTPUT_TOKENS),
            system: system_prompt.to_string(),
            messages,
            stream: true,
            temperature: cfg.temperature,
        })
        .map_err(|e| e.to_string())?
    } else {
        let mut all = Vec::with_capacity(messages.len() + 1);
        all.push(ChatMessage { role: "system".to_string(), content: system_prompt.to_string() });
        all.extend(messages);
        serde_json::to_value(StreamChatRequest {
            model: cfg.model_name.clone(),
            messages: all,
            stream: true,
            max_tokens: cfg.max_tokens,
            temperature: cfg.temperature,
            top_p: cfg.top_p,
        })
        .map_err(|e| e.to_string())?
    };

    info!("🐞 LLM stream request to {}: model={}", provider_name(&cfg.provider), cfg.model_name);

    let request_future = client
        .post(api_url)
        .headers(headers)
        .json(&body)
        .timeout(REQUEST_TIMEOUT_DURATION)
        .send();

    let response = if let Some(token) = cancellation_token {
        tokio::select! {
            r = request_future => r.map_err(|e| format!("Failed to send request to LLM: {}", e))?,
            _ = token.cancelled() => return Err("Generation was cancelled".to_string()),
        }
    } else {
        request_future.await.map_err(|e| format!("Failed to send request to LLM: {}", e))?
    };

    if !response.status().is_success() {
        let status = response.status();
        let err = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("LLM API request failed ({}): {}", status, err));
    }

    let is_claude = cfg.provider == LLMProvider::Claude;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full = String::new();

    loop {
        let next = if let Some(token) = cancellation_token {
            tokio::select! {
                n = stream.next() => n,
                _ = token.cancelled() => return Err("Generation was cancelled".to_string()),
            }
        } else {
            stream.next().await
        };

        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete lines; keep any partial trailing line in the buffer.
        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim_end_matches('\r').to_string();
            buffer.drain(..=newline);

            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let Ok(json) = serde_json::from_str::<serde_json::Value>(data) else { continue };

            let delta = if is_claude {
                match json.get("type").and_then(|t| t.as_str()) {
                    Some("content_block_delta") => json
                        .pointer("/delta/text")
                        .and_then(|t| t.as_str())
                        .map(str::to_string),
                    Some("error") => {
                        let msg = json.pointer("/error/message").and_then(|m| m.as_str()).unwrap_or("unknown");
                        return Err(format!("Claude stream error: {}", msg));
                    }
                    _ => None,
                }
            } else {
                if let Some(err) = json.get("error") {
                    return Err(format!("LLM stream error: {}", err));
                }
                json.pointer("/choices/0/delta/content")
                    .and_then(|t| t.as_str())
                    .map(str::to_string)
            };

            if let Some(text) = delta {
                if !text.is_empty() {
                    full.push_str(&text);
                    on_delta(&text);
                }
            }
        }
    }

    info!("🐞 LLM stream complete from {} ({} chars)", provider_name(&cfg.provider), full.len());
    Ok(full)
}

#[cfg(test)]
mod stream_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Spin up a one-shot HTTP server that answers any POST with an SSE stream.
    async fn sse_server(body: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 65536];
            let _ = sock.read(&mut buf).await.unwrap();
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            sock.write_all(resp.as_bytes()).await.unwrap();
            sock.shutdown().await.unwrap();
        });
        format!("http://{}/v1", addr)
    }

    #[tokio::test]
    async fn streams_openai_compatible_deltas() {
        let endpoint = sse_server(
            "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"# Title\\n\"}}]}\n\n\
             data: {\"choices\":[{\"delta\":{\"content\":\"- point\"}}]}\n\n\
             data: [DONE]\n\n",
        )
        .await;
        let cfg = LlmCallConfig {
            provider: LLMProvider::CustomOpenAI,
            model_name: "test".into(),
            api_key: "k".into(),
            ollama_endpoint: None,
            custom_openai_endpoint: Some(endpoint),
            max_tokens: None,
            temperature: None,
            top_p: None,
            app_data_dir: None,
        };
        let client = Client::new();
        let mut deltas = Vec::new();
        let full = generate_stream(
            &client,
            &cfg,
            "sys",
            vec![ChatMessage { role: "user".into(), content: "hi".into() }],
            None,
            |d| deltas.push(d.to_string()),
        )
        .await
        .unwrap();
        assert_eq!(full, "# Title\n- point");
        assert_eq!(deltas, vec!["# Title\n".to_string(), "- point".to_string()]);
    }

    #[tokio::test]
    async fn surfaces_stream_errors() {
        let endpoint = sse_server("data: {\"error\":{\"message\":\"quota\"}}\n\n").await;
        let cfg = LlmCallConfig {
            provider: LLMProvider::CustomOpenAI,
            model_name: "test".into(),
            api_key: "k".into(),
            ollama_endpoint: None,
            custom_openai_endpoint: Some(endpoint),
            max_tokens: None,
            temperature: None,
            top_p: None,
            app_data_dir: None,
        };
        let err = generate_stream(&Client::new(), &cfg, "sys", vec![], None, |_| {}).await.unwrap_err();
        assert!(err.contains("quota"), "{}", err);
    }
}
