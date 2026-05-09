pub mod openrouter;

pub trait ModelProvider {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
}
