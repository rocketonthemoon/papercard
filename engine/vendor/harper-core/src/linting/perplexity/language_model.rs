use crate::Span;
use crate::sync::LSend;

/// How surprising a replacement candidate is in context, in nats.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CandidateScore {
    /// Total surprisal of the candidate's own tokens.
    pub word: f32,
    /// Total surprisal of the first few tokens *after* the candidate. If a candidate makes the
    /// following words much harder to predict, it probably broke the sentence.
    pub context: f32,
}

/// A causal language model that can measure how surprising text is.
///
/// Harper itself ships no model. Implementations (such as the GPT-2 backend in `harper-lm`)
/// live in separate crates so that `harper-core` stays free of ML dependencies.
///
/// All surprisal values are in **nats** (`-ln p`). Higher means less predictable.
pub trait LanguageModel: LSend {
    /// Compute the surprisal of every model token in `text`.
    ///
    /// Each entry is the char span of the model token within `text` and its surprisal given all
    /// preceding text. Spans should exclude leading whitespace where possible, but consumers
    /// only rely on spans overlapping the words they belong to.
    fn token_surprisals(&self, text: &str) -> Vec<(Span<char>, f32)>;

    /// Score each candidate as a replacement between `prefix` and `suffix`.
    ///
    /// Implementations must use the same window of `suffix` tokens for every candidate so the
    /// [`CandidateScore::context`] values are comparable. The output has the same length and
    /// order as `candidates`, or is empty on failure.
    fn score_candidates(
        &self,
        prefix: &str,
        candidates: &[String],
        suffix: &str,
    ) -> Vec<CandidateScore>;
}
