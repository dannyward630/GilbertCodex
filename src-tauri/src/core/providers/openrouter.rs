use super::ModelProvider;

#[derive(Debug, Clone, Default)]
pub struct OpenRouterProvider;

impl ModelProvider for OpenRouterProvider {
    fn id(&self) -> &'static str {
        "openrouter"
    }

    fn display_name(&self) -> &'static str {
        "OpenRouter"
    }
}
