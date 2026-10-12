//! Resolves the user's configured LLM provider (and its credentials/endpoints)
//! into an `LlmCallConfig`. Shared by summary enhancement and meeting chat.

use crate::database::repositories::setting::SettingsRepository;
use crate::summary::llm_client::{LLMProvider, LlmCallConfig};
use sqlx::SqlitePool;
use std::path::PathBuf;
use tracing::info;

/// Build an `LlmCallConfig` from explicit overrides or the saved model config.
///
/// * `provider_override` / `model_override` — values passed from the UI, if any.
///   When absent, the settings table decides.
pub async fn resolve_llm_config(
    pool: &SqlitePool,
    app_data_dir: Option<PathBuf>,
    provider_override: Option<&str>,
    model_override: Option<&str>,
) -> Result<LlmCallConfig, String> {
    let saved = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to read model config: {}", e))?;

    let provider_str = provider_override
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .or_else(|| saved.as_ref().map(|s| s.provider.clone()))
        .ok_or_else(|| "No AI model configured. Open Settings → AI Model to pick one.".to_string())?;

    let model_name = model_override
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .or_else(|| saved.as_ref().map(|s| s.model.clone()))
        .ok_or_else(|| "No AI model name configured.".to_string())?;

    let provider = LLMProvider::from_str(&provider_str)?;

    let mut cfg = LlmCallConfig {
        provider: provider.clone(),
        model_name,
        api_key: String::new(),
        ollama_endpoint: None,
        custom_openai_endpoint: None,
        max_tokens: None,
        temperature: None,
        top_p: None,
        app_data_dir,
    };

    match provider {
        LLMProvider::Ollama => {
            cfg.ollama_endpoint = saved.as_ref().and_then(|s| s.ollama_endpoint.clone());
        }
        LLMProvider::BuiltInAI => {}
        LLMProvider::CustomOpenAI => {
            let custom = SettingsRepository::get_custom_openai_config(pool)
                .await
                .map_err(|e| format!("Failed to read custom OpenAI config: {}", e))?
                .ok_or_else(|| "Custom OpenAI provider selected but no configuration found".to_string())?;
            cfg.custom_openai_endpoint = Some(custom.endpoint);
            cfg.api_key = custom.api_key.unwrap_or_default();
            cfg.max_tokens = custom.max_tokens.map(|t| t as u32);
            cfg.temperature = custom.temperature;
            cfg.top_p = custom.top_p;
        }
        _ => {
            let key = SettingsRepository::get_api_key(pool, &provider_str)
                .await
                .map_err(|e| format!("Failed to retrieve API key for {}: {}", provider_str, e))?
                .filter(|k| !k.trim().is_empty())
                .ok_or_else(|| format!("API key not found for {}. Add it in Settings → AI Model.", provider_str))?;
            cfg.api_key = key;
        }
    }

    info!("Resolved LLM config: provider={} model={}", provider_str, cfg.model_name);
    Ok(cfg)
}
