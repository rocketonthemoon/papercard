//! Language-model-driven suggestions that raise the perplexity of text.
//!
//! `harper-core` only defines the [`LanguageModel`] abstraction and the [`PerplexityBooster`]
//! linter. Concrete models (e.g. GPT-2 in `harper-lm`) are provided by other crates.

mod connectors;
mod language_model;
mod lite;
mod perplexity_booster;

pub use language_model::{CandidateScore, LanguageModel};
pub use lite::PerplexityLite;
pub use perplexity_booster::{PerplexityBooster, PerplexityConfig, SynonymSource};
