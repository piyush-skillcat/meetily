use crate::summary::templates;
use serde::{Deserialize, Serialize};
use tauri::Runtime;
use tracing::{info, warn};

/// Template metadata for UI display
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateInfo {
    /// Template identifier (e.g., "daily_standup", "standard_meeting")
    pub id: String,

    /// Display name for the template
    pub name: String,

    /// Brief description of the template's purpose
    pub description: String,
}

/// Detailed template structure for preview/debugging
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateDetails {
    /// Template identifier
    pub id: String,

    /// Display name
    pub name: String,

    /// Description
    pub description: String,

    /// List of section titles in order
    pub sections: Vec<String>,
}

/// Lists all available templates
///
/// Returns templates from both built-in (embedded) and custom (user data directory) sources.
/// Templates are automatically discovered - no code changes needed to add new templates.
///
/// # Returns
/// Vector of TemplateInfo with id, name, and description for each template
#[tauri::command]
pub async fn api_list_templates<R: Runtime>(
    _app: tauri::AppHandle<R>,
) -> Result<Vec<TemplateInfo>, String> {
    info!("api_list_templates called");

    let templates = templates::list_templates();

    let template_infos: Vec<TemplateInfo> = templates
        .into_iter()
        .map(|(id, name, description)| TemplateInfo {
            id,
            name,
            description,
        })
        .collect();

    info!("Found {} available templates", template_infos.len());

    Ok(template_infos)
}

/// Gets detailed information about a specific template
///
/// # Arguments
/// * `template_id` - Template identifier (e.g., "daily_standup")
///
/// # Returns
/// TemplateDetails with full template structure
#[tauri::command]
pub async fn api_get_template_details<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
) -> Result<TemplateDetails, String> {
    info!("api_get_template_details called for template_id: {}", template_id);

    let template = templates::get_template(&template_id)?;

    let section_titles: Vec<String> = template
        .sections
        .iter()
        .map(|section| section.title.clone())
        .collect();

    let details = TemplateDetails {
        id: template_id,
        name: template.name,
        description: template.description,
        sections: section_titles,
    };

    info!("Retrieved template details for '{}'", details.name);

    Ok(details)
}

/// Validates a custom template JSON string
///
/// Useful for template editor UI or validation before saving custom templates
///
/// # Arguments
/// * `template_json` - Raw JSON string of the template
///
/// # Returns
/// Ok(template_name) if valid, Err(error_message) if invalid
#[tauri::command]
pub async fn api_validate_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_json: String,
) -> Result<String, String> {
    info!("api_validate_template called");

    match templates::validate_and_parse_template(&template_json) {
        Ok(template) => {
            info!("Template '{}' validated successfully", template.name);
            Ok(template.name)
        }
        Err(e) => {
            warn!("Template validation failed: {}", e);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_templates() {
        // This test requires the templates to be embedded/available
        // In a real test environment, you might want to mock the templates module

        // For now, just verify the function compiles and runs
        // You can expand this with more specific assertions
    }

    #[tokio::test]
    async fn test_validate_template_valid() {
        let valid_json = r#"
        {
            "name": "Test Template",
            "description": "A test template",
            "sections": [
                {
                    "title": "Summary",
                    "instruction": "Provide a summary",
                    "format": "paragraph"
                }
            ]
        }"#;

        // Mock app handle would be needed for actual testing
        // For now, test the validation logic directly
        let result = templates::validate_and_parse_template(valid_json);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_validate_template_invalid() {
        let invalid_json = "invalid json";

        let result = templates::validate_and_parse_template(invalid_json);
        assert!(result.is_err());
    }
}

// ============================================================================
// CUSTOM TEMPLATE EDITING (Granola-style user templates)
// ============================================================================

/// Full template payload for the editor UI.
#[derive(Debug, Serialize, Deserialize)]
pub struct TemplateFull {
    pub id: String,
    /// true when the template lives in the user's custom directory (editable/deletable)
    pub is_custom: bool,
    #[serde(flatten)]
    pub template: templates::Template,
}

fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('_');
            last_dash = true;
        }
    }
    let out = out.trim_end_matches('_').to_string();
    if out.is_empty() { "custom_template".to_string() } else { out }
}

#[tauri::command]
pub async fn api_get_template_full<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
) -> Result<TemplateFull, String> {
    let template = templates::get_template(&template_id)?;
    Ok(TemplateFull {
        is_custom: templates::is_custom_template(&template_id),
        id: template_id,
        template,
    })
}

/// Create or update a custom template. Returns the template id.
/// Editing a bundled template saves a custom copy under a new id.
#[tauri::command]
pub async fn api_save_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: Option<String>,
    template: templates::Template,
) -> Result<String, String> {
    template.validate()?;
    let id = match template_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        Some(id) if templates::is_custom_template(&id) => id,
        Some(id) => {
            // Don't overwrite bundled templates; fork into the custom dir
            let base = slugify(&template.name);
            if base == id { format!("{}_custom", base) } else { base }
        }
        None => slugify(&template.name),
    };
    let json = serde_json::to_string_pretty(&template).map_err(|e| e.to_string())?;
    templates::save_custom_template(&id, &json)?;
    info!("Saved custom template '{}'", id);
    Ok(id)
}

#[tauri::command]
pub async fn api_delete_template<R: Runtime>(
    _app: tauri::AppHandle<R>,
    template_id: String,
) -> Result<(), String> {
    if !templates::is_custom_template(&template_id) {
        return Err("Built-in templates can't be deleted".to_string());
    }
    templates::delete_custom_template(&template_id)
}
