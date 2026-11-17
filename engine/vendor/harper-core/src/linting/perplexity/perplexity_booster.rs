use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::num::NonZero;
use std::sync::Arc;

use hashbrown::HashSet;
use lru::LruCache;

use super::{CandidateScore, LanguageModel, connectors};
use crate::edit_distance::edit_distance;
use crate::linting::{Lint, LintKind, Linter, Suggestion};
use crate::{Document, Span, Token, TokenKind, TokenStringExt, thesaurus_helper};

/// Produces replacement candidates for a (lowercase) word.
pub type SynonymSource = fn(&str, &TokenKind) -> Vec<String>;

/// Tuning knobs for [`PerplexityBooster`]. All surprisal values are in nats.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PerplexityConfig {
    /// Words whose surprisal is below this are considered "highly predictable" and get flagged.
    /// The default of `1.5` corresponds to the model assigning the word a probability above ~22%.
    pub min_surprisal: f32,
    /// A candidate must raise the word's surprisal by at least this much to be suggested.
    pub min_gain: f32,
    /// A candidate may raise the word's surprisal by at most this much. Very large gains almost
    /// always come from words that don't fit (wrong sense, broken idiom).
    pub max_gain: f32,
    /// Plausibility check: the candidate itself must not be more surprising than this in context
    /// (the default of `5.0` means the model gives it at least ~0.7% probability).
    pub max_candidate_surprisal: f32,
    /// How much more surprising the following words may become after the swap. A big jump means
    /// the candidate broke the sentence.
    pub max_context_increase: f32,
    /// Weight of the knock-on surprise when ranking. Candidates are ranked by
    /// `gain - context_penalty_weight * max(0, context increase)`.
    pub context_penalty_weight: f32,
    /// Only accept candidates that list the original word as a synonym too. This removes most
    /// loose associations from the thesaurus (e.g. "history" -> "intelligence").
    pub require_mutual_synonyms: bool,
    /// At most this many words are flagged per sentence (the most predictable first).
    pub max_flags_per_sentence: usize,
    /// How many synonyms are scored with the model for each flagged word.
    pub num_candidates: usize,
    /// How many suggestions are attached to each lint.
    pub max_suggestions: usize,
    /// Also suggest replacements for stock connectors at the start of sentences ("However,",
    /// "Moreover,", "It is important to note that"), using only connectors with the same meaning.
    pub connectors: bool,
    /// Plausibility limit for a replacement connector. Connectors are often several tokens long,
    /// so this is looser than [`Self::max_candidate_surprisal`].
    pub connector_max_candidate_surprisal: f32,
}

impl Default for PerplexityConfig {
    fn default() -> Self {
        Self {
            min_surprisal: 1.5,
            min_gain: 0.5,
            max_gain: 3.0,
            max_candidate_surprisal: 5.0,
            max_context_increase: 1.0,
            context_penalty_weight: 1.0,
            require_mutual_synonyms: true,
            max_flags_per_sentence: 2,
            num_candidates: 10,
            max_suggestions: 3,
            connectors: true,
            connector_max_candidate_surprisal: 15.0,
        }
    }
}

/// Flags highly predictable content words and suggests synonyms that raise the perplexity of the
/// text, as measured by a [`LanguageModel`], while keeping the sentence plausible.
///
/// This linter needs a model, so it is not part of [`LintGroup::new_curated`](crate::linting::LintGroup::new_curated).
/// Front-ends add it with [`LintGroup::add`](crate::linting::LintGroup::add) once a model is loaded.
pub struct PerplexityBooster {
    lm: Arc<dyn LanguageModel>,
    config: PerplexityConfig,
    synonyms: SynonymSource,
    /// Sentence hash -> lints with spans relative to the start of the sentence.
    cache: LruCache<u64, Vec<Lint>>,
}

impl PerplexityBooster {
    pub fn new(lm: Arc<dyn LanguageModel>) -> Self {
        Self {
            lm,
            config: PerplexityConfig::default(),
            synonyms: thesaurus_synonyms,
            cache: LruCache::new(NonZero::new(1000).unwrap()),
        }
    }

    pub fn with_config(mut self, config: PerplexityConfig) -> Self {
        self.config = config;
        self.cache.clear();
        self
    }

    pub fn with_synonym_source(mut self, synonyms: SynonymSource) -> Self {
        self.synonyms = synonyms;
        self.cache.clear();
        self
    }

    /// Thesaurus candidates for `lower` that pass the meaning guards, in thesaurus order.
    fn candidates_for(&self, lower: &str, kind: &TokenKind) -> Vec<String> {
        let cfg = &self.config;
        let mut out: Vec<String> = Vec::new();

        for cand in (self.synonyms)(lower, kind) {
            let cand_lower = cand.to_lowercase();
            if cand_lower.is_empty()
                || is_spelling_variant(lower, &cand_lower)
                || out
                    .iter()
                    .any(|c| is_spelling_variant(&c.to_lowercase(), &cand_lower))
                || are_siblings(lower, &cand_lower)
            {
                continue;
            }
            if cfg.require_mutual_synonyms
                && !(self.synonyms)(&cand_lower, kind)
                    .iter()
                    .any(|back| back.to_lowercase() == lower)
            {
                continue;
            }
            out.push(cand);
            if out.len() >= cfg.num_candidates {
                break;
            }
        }

        out
    }

    /// Suggest same-meaning replacements for the connectors at the start of a sentence.
    /// `previous` is the preceding sentence, used as context. Spans are relative to the sentence.
    fn lint_connectors(&self, chars: &[char], previous: &[char]) -> Vec<Lint> {
        let cfg = &self.config;
        let mut lints = Vec::new();

        for found in connectors::find_connectors(chars) {
            let original = found.span.get_content(chars);
            let original_str: String = original.iter().collect();
            let original_lower = original_str.to_lowercase().replace('\u{2019}', "'");

            let alternatives: Vec<Vec<char>> = found
                .group
                .phrases
                .iter()
                .filter(|p| **p != original_lower)
                .map(|p| connectors::match_capitalization(p, original))
                .collect();

            let mut batch = vec![original_str.clone()];
            batch.extend(alternatives.iter().map(|a| a.iter().collect::<String>()));

            let prefix: String = previous
                .iter()
                .chain(&chars[..found.span.start])
                .collect();
            let suffix: String = chars[found.span.end..].iter().collect();
            let scores = self.lm.score_candidates(&prefix, &batch, &suffix);
            if scores.len() != batch.len() {
                continue;
            }

            // Connectors are a deliberate choice rather than a predictable word, so no gain cap:
            // any same-group alternative that is more surprising and still fits is fine.
            let connector_cfg = PerplexityConfig {
                max_gain: f32::INFINITY,
                max_candidate_surprisal: cfg.connector_max_candidate_surprisal,
                ..*cfg
            };
            let mut ranked: Vec<(f32, Vec<char>)> = alternatives
                .into_iter()
                .zip(&scores[1..])
                .filter_map(|(alt, score)| Some((rank(&connector_cfg, &scores[0], score)?, alt)))
                .collect();
            ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
            ranked.truncate(cfg.max_suggestions);

            if ranked.is_empty() {
                continue;
            }

            lints.push(Lint {
                span: found.span,
                lint_kind: LintKind::Enhancement,
                suggestions: ranked
                    .into_iter()
                    .map(|(_, alt)| Suggestion::ReplaceWith(alt))
                    .collect(),
                message: format!(
                    "“{original_str}” is a stock transition. A less common connector with the same meaning raises the text's perplexity."
                ),
                priority: 127,
            });
        }

        lints
    }

    /// Lint one sentence. `chars` is the sentence's text, `offset` its start in the document and
    /// `previous` the text of the preceding sentence. Returned spans are relative to the sentence.
    fn lint_sentence(
        &self,
        sentence: &[Token],
        offset: usize,
        chars: &[char],
        previous: &[char],
    ) -> Vec<Lint> {
        let cfg = &self.config;

        let mut lints = if cfg.connectors {
            self.lint_connectors(chars, previous)
        } else {
            Vec::new()
        };
        // Words inside a connector are handled by the connector stage only.
        let connector_spans: Vec<Span<char>> = lints.iter().map(|l| l.span).collect();

        let text: String = chars.iter().collect();
        let surprisals = self.lm.token_surprisals(&text);
        let protected = fixed_phrase_starts(sentence, offset, chars);

        let mut flagged: Vec<(f32, Span<char>)> = sentence
            .iter()
            .filter_map(|tok| {
                let rel = Span::new(tok.span.start - offset, tok.span.end - offset);
                if rel.len() < 3
                    || protected.contains(&rel.start)
                    || connector_spans.iter().any(|c| c.overlaps_with(rel))
                    || !is_content_word(&tok.kind, rel.get_content(chars))
                {
                    return None;
                }
                let mut total = 0.0;
                let mut seen = false;
                for (span, value) in &surprisals {
                    if span.overlaps_with(rel) {
                        total += value;
                        seen = true;
                    }
                }
                (seen && total < cfg.min_surprisal).then_some((total, rel))
            })
            .collect();

        flagged.sort_by(|a, b| a.0.total_cmp(&b.0));
        flagged.truncate(cfg.max_flags_per_sentence);

        for (_, rel) in flagged {
            let tok = sentence
                .iter()
                .find(|t| t.span.start - offset == rel.start)
                .expect("flagged span comes from a sentence token");
            let word_chars = rel.get_content(chars);
            let word: String = word_chars.iter().collect();

            let candidates = self.candidates_for(&word.to_lowercase(), &tok.kind);
            if candidates.is_empty() {
                continue;
            }

            // Match the original word's casing so the model scores the text as it would appear.
            let cased: Vec<Vec<char>> = candidates
                .iter()
                .map(|c| {
                    match Suggestion::replace_with_match_case(c.chars().collect(), word_chars) {
                        Suggestion::ReplaceWith(v) => v,
                        _ => unreachable!("replace_with_match_case always yields ReplaceWith"),
                    }
                })
                .collect();

            // Score the original alongside the candidates so the comparison uses identical context.
            let mut batch = Vec::with_capacity(cased.len() + 1);
            batch.push(word.clone());
            batch.extend(cased.iter().map(|c| c.iter().collect::<String>()));

            let prefix: String = chars[..rel.start].iter().collect();
            let suffix: String = chars[rel.end..].iter().collect();
            let scores = self.lm.score_candidates(&prefix, &batch, &suffix);
            if scores.len() != batch.len() {
                continue;
            }

            let mut ranked: Vec<(f32, Vec<char>)> = cased
                .into_iter()
                .zip(scores[1..].iter())
                .filter_map(|(cand, score)| Some((rank(cfg, &scores[0], score)?, cand)))
                .collect();
            ranked.sort_by(|a, b| b.0.total_cmp(&a.0));
            ranked.truncate(cfg.max_suggestions);

            if ranked.is_empty() {
                continue;
            }

            lints.push(Lint {
                span: rel,
                lint_kind: LintKind::Enhancement,
                suggestions: ranked
                    .into_iter()
                    .map(|(_, cand)| Suggestion::ReplaceWith(cand))
                    .collect(),
                message: format!(
                    "“{word}” is highly predictable here. A less expected word raises the text's perplexity."
                ),
                priority: 127,
            });
        }

        lints
    }
}

/// The ranking score of a candidate relative to the original, or `None` if the candidate should
/// be rejected.
fn rank(
    cfg: &PerplexityConfig,
    original: &CandidateScore,
    candidate: &CandidateScore,
) -> Option<f32> {
    let gain = candidate.word - original.word;
    let context_increase = candidate.context - original.context;

    let acceptable = gain.is_finite()
        && context_increase.is_finite()
        && gain >= cfg.min_gain
        && gain <= cfg.max_gain
        && candidate.word <= cfg.max_candidate_surprisal
        && context_increase <= cfg.max_context_increase;
    if !acceptable {
        return None;
    }

    let score = gain - cfg.context_penalty_weight * context_increase.max(0.0);
    (score > 0.0).then_some(score)
}

impl Linter for PerplexityBooster {
    fn lint(&mut self, document: &Document) -> Vec<Lint> {
        let source = document.get_source();
        let mut lints = Vec::new();
        let mut previous: &[char] = &[];

        for sentence in document.iter_sentences() {
            let Some(span) = sentence.span() else {
                continue;
            };
            let chars = span.get_content(source);

            // The previous sentence is context for connectors, so it is part of the key.
            let mut hasher = DefaultHasher::new();
            previous.hash(&mut hasher);
            chars.hash(&mut hasher);
            let key = hasher.finish();

            let relative = if let Some(cached) = self.cache.get(&key) {
                cached.clone()
            } else {
                let fresh = self.lint_sentence(sentence, span.start, chars, previous);
                self.cache.put(key, fresh.clone());
                fresh
            };
            previous = chars;

            lints.extend(relative.into_iter().map(|mut lint| {
                lint.span.push_by(span.start);
                lint
            }));
        }

        lints
    }

    fn description(&self) -> &str {
        "Uses a local language model to find highly predictable words and suggests less expected synonyms, raising the perplexity of the text."
    }
}

/// Fixed expressions whose words must not be swapped individually ("on date", "at present").
/// Matched on consecutive words, ignoring punctuation, so "must-read" matches `["must", "read"]`.
const FIXED_PHRASES: &[&[&str]] = &[
    &["on", "time"],
    &["in", "time"],
    &["at", "times"],
    &["at", "the", "same", "time"],
    &["make", "a", "difference"],
    &["makes", "a", "difference"],
    &["made", "a", "difference"],
    &["next", "steps"],
    &["next", "step"],
    &["end", "of", "the"],
    &["ever", "wondered"],
    &["must", "read"],
    &["of", "course"],
    &["at", "least"],
    &["in", "fact"],
    &["as", "well"],
    &["for", "example"],
    &["for", "instance"],
    &["in", "order", "to"],
    &["as", "a", "result"],
    &["on", "the", "other", "hand"],
    &["first", "time"],
    &["right", "now"],
    &["each", "other"],
    &["take", "place"],
    &["takes", "place"],
    &["took", "place"],
    &["so", "far"],
    &["in", "general"],
    &["after", "all"],
    &["by", "the", "way"],
    &["make", "sure"],
    &["in", "other", "words"],
    &["take", "care"],
    &["look", "forward"],
    &["looking", "forward"],
    &["play", "a", "role"],
    &["plays", "a", "role"],
    &["played", "a", "role"],
    &["playing", "a", "role"],
    &["play", "a", "part"],
    &["plays", "a", "part"],
    &["take", "a", "moment"],
    &["takes", "a", "moment"],
    &["wide", "range"],
    &["wide", "variety"],
];

/// Words that are related but not interchangeable: swapping within a group changes the meaning
/// ("end of the week" -> "start of the week", "every day" -> "every year").
const SIBLING_GROUPS: &[&[&str]] = &[
    &["start", "end", "beginning", "finish", "close", "middle", "outset"],
    &["second", "minute", "hour", "day", "week", "month", "year", "decade", "century"],
    &["world", "globe", "earth", "universe", "cosmos"],
    &["state", "country", "nation", "city", "town", "region", "county", "province"],
    &["past", "present", "future"],
    &["first", "last", "final", "next", "previous"],
    &["always", "never", "sometimes", "often", "ever"],
    &["more", "less", "most", "least"],
    &["increase", "decrease", "rise", "fall"],
    &["north", "south", "east", "west"],
    &["morning", "afternoon", "evening", "night"],
];

/// Common verbs that are better left alone even when the tagger calls them content words.
const LIGHT_VERBS: &[&str] = &[
    "be", "am", "is", "are", "was", "were", "been", "being", "have", "has", "had", "having", "do",
    "does", "did", "done", "get", "gets", "got",
];

/// Both words are "category" words from the sibling lists (times, places, positions...), where a
/// swap almost always changes the meaning. This applies across groups too, so "world" -> "state"
/// is blocked. Only explicit near-synonym pairs ("world"/"globe") are allowed through.
fn are_siblings(a: &str, b: &str) -> bool {
    const INTERCHANGEABLE: &[(&str, &str)] = &[("world", "globe"), ("world", "earth")];
    if INTERCHANGEABLE
        .iter()
        .any(|&(x, y)| (x == a && y == b) || (x == b && y == a))
    {
        return false;
    }
    let listed = |w: &str| SIBLING_GROUPS.iter().any(|group| group.contains(&w));
    listed(a) && listed(b)
}

/// The same word or a spelling variant of it ("favorite"/"favourite", "savor"/"savour"): swapping
/// one for the other only changes the dialect, not the wording.
fn is_spelling_variant(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    // Short words like "car"/"bar" are different words even at distance 1.
    a.len().min(b.len()) >= 5 && edit_distance(&a, &b) <= 2 && a[..3] == b[..3]
}

/// How many extra words may sit between two words of a fixed phrase ("make a *big* difference").
const FIXED_PHRASE_GAP: usize = 1;

/// Start offsets (relative to the sentence) of every word that is part of a fixed phrase.
fn fixed_phrase_starts(sentence: &[Token], offset: usize, chars: &[char]) -> HashSet<usize> {
    let words: Vec<(String, usize)> = sentence
        .iter()
        .filter(|tok| tok.kind.is_word())
        .map(|tok| {
            let rel = Span::new(tok.span.start - offset, tok.span.end - offset);
            (rel.get_content_string(chars).to_lowercase(), rel.start)
        })
        .collect();

    let mut protected = HashSet::new();
    for phrase in FIXED_PHRASES {
        for first in 0..words.len() {
            if let Some(matched) = match_phrase(&words, first, phrase) {
                protected.extend(matched.into_iter().map(|i| words[i].1));
            }
        }
    }
    protected
}

/// Match `phrase` starting at `words[first]`, allowing up to [`FIXED_PHRASE_GAP`] unrelated
/// words between consecutive phrase words. Returns the indices of the matched words.
fn match_phrase(words: &[(String, usize)], first: usize, phrase: &[&str]) -> Option<Vec<usize>> {
    let (head, rest) = phrase.split_first()?;
    if words.get(first)?.0 != *head {
        return None;
    }
    let mut matched = vec![first];
    let mut pos = first;
    for part in rest {
        let next = (pos + 1..=pos + 1 + FIXED_PHRASE_GAP)
            .take_while(|&i| i < words.len())
            .find(|&i| words[i].0 == *part)?;
        matched.push(next);
        pos = next;
    }
    Some(matched)
}

/// Only open-class words are worth swapping. Function words and names are left alone.
///
/// The dictionary merges metadata across casings, so common words like "house" or "bill" also
/// carry a proper-noun flag (from "House", "Bill"). Such a word is only treated as a name when it
/// is actually written capitalized.
fn is_content_word(kind: &TokenKind, text: &[char]) -> bool {
    let lower: String = text.iter().collect::<String>().to_lowercase();
    let looks_like_name =
        kind.is_proper_noun() && text.first().is_some_and(|c| c.is_uppercase());
    kind.is_word()
        && (kind.is_noun() || kind.is_verb() || kind.is_adjective() || kind.is_adverb())
        && !looks_like_name
        && !LIGHT_VERBS.contains(&lower.as_str())
        && !kind.is_auxiliary_verb()
        && !kind.is_pronoun()
        && !kind.is_determiner()
        && !kind.is_preposition()
}

fn thesaurus_synonyms(word: &str, kind: &TokenKind) -> Vec<String> {
    thesaurus_helper::get_synonyms_sorted(word, kind)
        .unwrap_or_default()
        .into_iter()
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{PerplexityBooster, PerplexityConfig};
    use crate::linting::{CandidateScore, LanguageModel, Lint, Linter, Suggestion};
    use crate::{Document, Span, TokenKind};

    /// Deterministic stand-in for a real model: whole words are "tokens", surprisal comes from a
    /// fixed table, and the knock-on ("context") surprisal of a candidate from a second table.
    struct MockLm {
        surprisal: &'static [(&'static str, f32)],
        context: &'static [(&'static str, f32)],
        calls: AtomicUsize,
    }

    const DEFAULT_TOKEN: f32 = 5.0;
    const DEFAULT_CANDIDATE: f32 = 20.0;

    impl MockLm {
        fn new(surprisal: &'static [(&'static str, f32)]) -> Arc<Self> {
            Self::with_context(surprisal, &[])
        }

        fn with_context(
            surprisal: &'static [(&'static str, f32)],
            context: &'static [(&'static str, f32)],
        ) -> Arc<Self> {
            Arc::new(Self {
                surprisal,
                context,
                calls: AtomicUsize::new(0),
            })
        }

        fn lookup(table: &[(&str, f32)], word: &str) -> Option<f32> {
            let lower = word.to_lowercase();
            table.iter().find(|(w, _)| *w == lower).map(|(_, s)| *s)
        }
    }

    impl LanguageModel for MockLm {
        fn token_surprisals(&self, text: &str) -> Vec<(Span<char>, f32)> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let chars: Vec<char> = text.chars().collect();
            let mut out = Vec::new();
            let mut i = 0;
            while i < chars.len() {
                if chars[i].is_alphanumeric() {
                    let start = i;
                    while i < chars.len() && chars[i].is_alphanumeric() {
                        i += 1;
                    }
                    let word: String = chars[start..i].iter().collect();
                    let s = Self::lookup(self.surprisal, &word).unwrap_or(DEFAULT_TOKEN);
                    out.push((Span::new(start, i), s));
                } else {
                    i += 1;
                }
            }
            out
        }

        fn score_candidates(&self, _: &str, candidates: &[String], _: &str) -> Vec<CandidateScore> {
            candidates
                .iter()
                .map(|c| CandidateScore {
                    word: Self::lookup(self.surprisal, c).unwrap_or(DEFAULT_CANDIDATE),
                    context: Self::lookup(self.context, c).unwrap_or(0.0),
                })
                .collect()
        }
    }

    /// A tiny thesaurus. Entries are listed in both directions where the pair is meant to pass
    /// the mutual-synonym check.
    fn synonyms(word: &str, _: &TokenKind) -> Vec<String> {
        match word {
            "big" => vec!["large", "huge", "enormous", "big", "Large", "vast"],
            "large" | "huge" | "enormous" => vec!["big"],
            "vast" => vec!["wide"],
            "house" => vec!["home", "dwelling"],
            "home" => vec!["house"],
            "week" => vec!["month", "period"],
            "month" | "period" => vec!["week"],
            "time" => vec!["date", "moment"],
            "date" | "moment" => vec!["time"],
            "world" => vec!["state", "globe"],
            "state" | "globe" => vec!["world"],
            "difference" => vec!["change"],
            "change" => vec!["difference"],
            "favorite" => vec!["favourite", "preferred"],
            "favourite" | "preferred" => vec!["favorite"],
            _ => vec![],
        }
        .into_iter()
        .map(str::to_string)
        .collect()
    }

    fn run(lm: Arc<MockLm>, text: &str) -> Vec<Lint> {
        let mut linter = PerplexityBooster::new(lm).with_synonym_source(synonyms);
        linter.lint(&Document::new_plain_english_curated(text))
    }

    fn suggestion_strings(lint: &Lint) -> Vec<String> {
        lint.suggestions
            .iter()
            .map(|s| match s {
                Suggestion::ReplaceWith(v) => v.iter().collect(),
                other => panic!("unexpected suggestion {other:?}"),
            })
            .collect()
    }

    const TABLE: &[(&str, f32)] = &[
        ("big", 0.5),
        ("large", 2.5),
        ("huge", 3.0),
        ("enormous", 12.0),
        ("vast", 2.0),
    ];

    #[test]
    fn flags_predictable_word_and_ranks_by_gain() {
        let lints = run(MockLm::new(TABLE), "The house is very big.");
        assert_eq!(lints.len(), 1);
        assert_eq!(lints[0].span, Span::new(18, 21));
        // "enormous" is implausible, "Large" is a duplicate and "vast" isn't a mutual synonym.
        assert_eq!(suggestion_strings(&lints[0]), vec!["huge", "large"]);
    }

    #[test]
    fn preserves_capitalization() {
        let lints = run(MockLm::new(TABLE), "Big houses are nice.");
        assert_eq!(lints.len(), 1);
        assert_eq!(suggestion_strings(&lints[0]), vec!["Huge", "Large"]);
    }

    #[test]
    fn ignores_unpredictable_words() {
        let lints = run(MockLm::new(&[("large", 3.0)]), "The house is very big.");
        assert!(lints.is_empty());
    }

    #[test]
    fn ignores_function_words() {
        let lints = run(MockLm::new(&[("the", 0.1), ("is", 0.1)]), "The house is big.");
        assert!(lints.is_empty());
    }

    #[test]
    fn ignores_light_verbs() {
        let lints = run(
            MockLm::new(&[("has", 0.1), ("was", 0.1), ("got", 0.1)]),
            "She has a dog and was happy when she got it.",
        );
        assert!(lints.is_empty());
    }

    #[test]
    fn respects_min_gain() {
        let lints = run(
            MockLm::new(&[("big", 0.5), ("large", 0.7)]),
            "The house is very big.",
        );
        assert!(lints.is_empty());
    }

    #[test]
    fn rejects_gains_above_cap() {
        // "huge" would raise surprisal by 4.5 nats, more than the 3.0 cap.
        let lints = run(
            MockLm::new(&[("big", 0.5), ("huge", 5.0)]),
            "The house is very big.",
        );
        assert!(lints.is_empty());
    }

    #[test]
    fn rejects_implausible_candidates() {
        let mut linter = PerplexityBooster::new(MockLm::new(&[("big", 3.5), ("huge", 6.0)]))
            .with_synonym_source(synonyms)
            .with_config(PerplexityConfig {
                min_surprisal: 4.0,
                ..Default::default()
            });
        // Gain is 2.5 (allowed) but "huge" itself is too unlikely in context.
        let lints = linter.lint(&Document::new_plain_english_curated("The house is very big."));
        assert!(lints.is_empty());
    }

    #[test]
    fn rejects_candidates_that_break_following_words() {
        let lm = MockLm::with_context(TABLE, &[("huge", 3.0)]);
        let lints = run(lm, "The house is very big.");
        assert_eq!(lints.len(), 1);
        assert_eq!(suggestion_strings(&lints[0]), vec!["large"]);
    }

    #[test]
    fn context_penalty_changes_ranking() {
        // "huge" gains more (2.5 vs 2.0) but makes the next words 0.8 nats harder.
        let lm = MockLm::with_context(TABLE, &[("huge", 0.8)]);
        let lints = run(lm, "The house is very big.");
        assert_eq!(suggestion_strings(&lints[0]), vec!["large", "huge"]);
    }

    #[test]
    fn requires_mutual_synonyms() {
        let lints = run(
            MockLm::new(&[("big", 0.5), ("vast", 2.0)]),
            "The house is very big.",
        );
        assert!(lints.is_empty());
    }

    #[test]
    fn mutual_synonym_check_can_be_disabled() {
        let mut linter = PerplexityBooster::new(MockLm::new(&[("big", 0.5), ("vast", 2.0)]))
            .with_synonym_source(synonyms)
            .with_config(PerplexityConfig {
                require_mutual_synonyms: false,
                ..Default::default()
            });
        let lints = linter.lint(&Document::new_plain_english_curated("The house is very big."));
        assert_eq!(lints.len(), 1);
        assert_eq!(suggestion_strings(&lints[0]), vec!["vast"]);
    }

    #[test]
    fn blocks_sibling_words() {
        // "week" -> "month" changes the meaning, "week" -> "period" doesn't.
        let lints = run(
            MockLm::new(&[("week", 0.5), ("month", 2.0), ("period", 2.5)]),
            "We will ship it next week.",
        );
        assert_eq!(lints.len(), 1);
        assert_eq!(suggestion_strings(&lints[0]), vec!["period"]);
    }

    const CONNECTORS: &[(&str, f32)] = &[
        ("however", 1.0),
        ("that said", 3.0),
        ("still", 2.0),
        ("even so", 9.0),
        ("it is important to note", 1.0),
        ("keep in mind", 4.0),
    ];

    #[test]
    fn suggests_same_meaning_connectors() {
        let lints = run(MockLm::new(CONNECTORS), "It rained. However, we went out.");
        assert_eq!(lints.len(), 1);
        assert_eq!(lints[0].span, Span::new(11, 18));
        assert_eq!(
            suggestion_strings(&lints[0]),
            vec!["Even so", "That said", "Still"]
        );
    }

    #[test]
    fn handles_chained_connectors() {
        let lints = run(
            MockLm::new(CONNECTORS),
            "However, it is important to note that sleep matters.",
        );
        assert_eq!(lints.len(), 2);
        assert_eq!(suggestion_strings(&lints[1]), vec!["keep in mind"]);
    }

    #[test]
    fn connector_rejected_when_following_words_suffer() {
        let lm = MockLm::with_context(CONNECTORS, &[("even so", 3.0)]);
        let lints = run(lm, "It rained. However, we went out.");
        assert_eq!(suggestion_strings(&lints[0]), vec!["That said", "Still"]);
    }

    #[test]
    fn connectors_can_be_disabled() {
        let mut linter = PerplexityBooster::new(MockLm::new(CONNECTORS))
            .with_synonym_source(synonyms)
            .with_config(PerplexityConfig {
                connectors: false,
                ..Default::default()
            });
        let lints = linter.lint(&Document::new_plain_english_curated(
            "It rained. However, we went out.",
        ));
        assert!(lints.is_empty());
    }

    #[test]
    fn skips_spelling_variants() {
        let lints = run(
            MockLm::new(&[("favorite", 0.5), ("favourite", 2.0), ("preferred", 2.5)]),
            "This is my favorite song.",
        );
        assert_eq!(lints.len(), 1);
        assert_eq!(suggestion_strings(&lints[0]), vec!["preferred"]);
    }

    #[test]
    fn blocks_siblings_across_groups() {
        // "world" and "state" sit in different sibling groups but must still be blocked,
        // while the explicitly interchangeable "globe" passes.
        let lints = run(
            MockLm::new(&[("world", 0.5), ("state", 2.0), ("globe", 2.5)]),
            "People travel from all over the world.",
        );
        assert_eq!(lints.len(), 1);
        assert_eq!(suggestion_strings(&lints[0]), vec!["globe"]);
    }

    #[test]
    fn fixed_phrase_allows_one_extra_word() {
        let lints = run(
            MockLm::new(&[("difference", 0.3), ("change", 2.0)]),
            "Small habits can make a big difference.",
        );
        assert!(lints.is_empty());
    }

    #[test]
    fn fixed_phrase_gap_is_limited() {
        // Two words between "make" and "difference" is no longer the idiom.
        let lints = run(
            MockLm::new(&[("difference", 0.3), ("change", 2.0)]),
            "They make a very big difference.",
        );
        assert_eq!(lints.len(), 1);
    }

    #[test]
    fn leaves_fixed_phrases_alone() {
        let lints = run(
            MockLm::new(&[("time", 0.3), ("date", 2.0), ("moment", 2.0)]),
            "The package arrived on time.",
        );
        assert!(lints.is_empty());
    }

    #[test]
    fn same_word_outside_fixed_phrase_is_flagged() {
        let lints = run(
            MockLm::new(&[("time", 0.3), ("moment", 2.0)]),
            "This is the time to act.",
        );
        assert_eq!(lints.len(), 1);
        assert_eq!(suggestion_strings(&lints[0]), vec!["moment"]);
    }

    #[test]
    fn caches_per_sentence() {
        let lm = MockLm::new(TABLE);
        let mut linter = PerplexityBooster::new(lm.clone()).with_synonym_source(synonyms);
        let doc = Document::new_plain_english_curated("The house is very big. It is old.");

        let first = linter.lint(&doc);
        let calls_after_first = lm.calls.load(Ordering::SeqCst);
        let second = linter.lint(&doc);

        assert_eq!(first, second);
        assert_eq!(lm.calls.load(Ordering::SeqCst), calls_after_first);
    }

    #[test]
    fn cached_lints_are_reoffset() {
        let lm = MockLm::new(TABLE);
        let mut linter = PerplexityBooster::new(lm).with_synonym_source(synonyms);

        let a = linter.lint(&Document::new_plain_english_curated("The house is very big."));
        let b = linter.lint(&Document::new_plain_english_curated(
            "Hello there. The house is very big.",
        ));

        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].span.start - a[0].span.start, "Hello there. ".len());
    }

    #[test]
    fn max_flags_per_sentence() {
        let lm = MockLm::new(&[("big", 0.5), ("house", 0.4), ("huge", 3.0), ("home", 2.5)]);
        let mut linter = PerplexityBooster::new(lm)
            .with_synonym_source(synonyms)
            .with_config(PerplexityConfig {
                max_flags_per_sentence: 1,
                ..Default::default()
            });
        let lints = linter.lint(&Document::new_plain_english_curated("The house is very big."));
        assert_eq!(lints.len(), 1);
        // "house" is the more predictable of the two.
        assert_eq!(lints[0].span, Span::new(4, 9));
    }
}
