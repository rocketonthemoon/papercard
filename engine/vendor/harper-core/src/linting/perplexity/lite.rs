//! A model-free way to raise perplexity: replace the stock connectors, clichés and favourite
//! adjectives of AI-written prose with less predictable equivalents from curated tables.
//!
//! Unlike [`PerplexityBooster`](super::PerplexityBooster) this needs no language model, so it is
//! instant and small enough for the browser. The trade-off is that nothing checks how well a
//! replacement fits its context, so the tables only contain swaps that keep the meaning and the
//! grammar in the contexts they are matched in (single words are matched by part of speech).

use harper_brill::UPOS;
use hashbrown::HashMap;

use super::connectors;
use crate::linting::{Lint, LintKind, Linter, Suggestion};
use crate::{Dialect, Document, InitialSound, Span, TokenStringExt, starts_with_vowel};

/// Connector replacements, measured with GPT-2 on held-out text: only targets that raised
/// perplexity in context are listed, best first. Without a model to check the context, picking
/// from the whole meaning group backfires: everyday idioms like "In the end" or "On top of that"
/// are *more* predictable than the stock connector they replace. Connectors not listed here
/// (e.g. "Ultimately", where no same-meaning alternative helped) are left alone.
const CONNECTOR_TARGETS: &[(&str, &[&str])] = &[
    ("however", &["nonetheless", "all the same", "that said"]),
    ("that said", &["still"]),
    // "Also" raised perplexity in under half the contexts it was tried in, so it is not a target.
    ("furthermore", &["besides"]),
    ("moreover", &["besides"]),
    ("additionally", &["besides"]),
    ("in addition", &["besides", "what's more"]),
    ("consequently", &["so", "thus"]),
    ("as a result", &["so", "thus"]),
    ("therefore", &["so", "thus"]),
    ("overall", &["to sum up"]),
    ("in conclusion", &["overall"]),
    ("in summary", &["overall"]),
    ("it is important to note", &["keep in mind", "bear in mind", "note"]),
    ("it's important to note", &["keep in mind", "bear in mind", "note"]),
    ("it should be noted", &["keep in mind", "note"]),
    ("finally", &["lastly"]),
    ("to get started", &["first"]),
    ("as always", &["as ever"]),
    ("once again", &["again"]),
    ("in today's fast-paced world", &["these days"]),
];

/// Words that mark statistical writing, where "significant(ly)" means statistically significant
/// and must not be swapped.
const STATISTICAL_CUES: &[&str] = &[
    "regression",
    "statistically",
    "p-value",
    "p <",
    "p<",
    "p =",
    "correlation",
    "coefficient",
    "variance",
    "hypothesis",
    "confidence interval",
    "participants",
    "respondents",
    "sample size",
];

/// Adverbs of degree that only modify adjectives. A word after them is an adjective even when
/// the tagger says otherwise ("the most rewarding part").
const DEGREE_ADVERBS: &[&str] = &[
    "most",
    "more",
    "very",
    "so",
    "really",
    "truly",
    "extremely",
    "highly",
    "quite",
];

/// Nouns before which "vibrant" means "colourful", where "lively" would shift the sense.
const VISUAL_NOUNS: &[&str] = &[
    "colors", "colours", "color", "colour", "hues", "hue", "palette", "landscapes", "landscape",
    "paintings", "painting", "prints", "art", "artwork", "murals", "mural", "tones", "shades",
];

/// A word or phrase typical of AI prose and its replacements, in order of preference.
struct Replacement {
    phrase: &'static str,
    /// Required part of speech for single words (so "perfect" the verb is left alone).
    pos: Option<UPOS>,
    with: &'static [&'static str],
}

const fn word(phrase: &'static str, pos: UPOS, with: &'static [&'static str]) -> Replacement {
    Replacement {
        phrase,
        pos: Some(pos),
        with,
    }
}

const fn phrase(phrase: &'static str, with: &'static [&'static str]) -> Replacement {
    Replacement {
        phrase,
        pos: None,
        with,
    }
}

/// Curated replacements. Entries were checked against distilgpt2 and GPT-2 small on AI-style
/// text (tuning and held-out sets): each raises perplexity without changing the meaning.
/// "unlock the full potential of" was removed because its replacement lowered perplexity.
const REPLACEMENTS: &[Replacement] = &[
    // Adjectives
    word("excellent", UPOS::ADJ, &["superb", "outstanding"]),
    word("innovative", UPOS::ADJ, &["inventive", "original"]),
    word("perfect", UPOS::ADJ, &["ideal"]),
    word("valuable", UPOS::ADJ, &["worthwhile"]),
    word("productive", UPOS::ADJ, &["fruitful"]),
    word("significant", UPOS::ADJ, &["considerable", "sizable"]),
    word("comprehensive", UPOS::ADJ, &["thorough"]),
    word("robust", UPOS::ADJ, &["solid", "sturdy"]),
    word("vibrant", UPOS::ADJ, &["lively"]),
    word("seamless", UPOS::ADJ, &["smooth", "effortless"]),
    word("breathtaking", UPOS::ADJ, &["striking", "spectacular"]),
    word("unforgettable", UPOS::ADJ, &["memorable"]),
    word("remarkable", UPOS::ADJ, &["striking", "notable"]),
    word("thrilled", UPOS::ADJ, &["delighted"]),
    word("crucial", UPOS::ADJ, &["vital"]),
    word("gripping", UPOS::ADJ, &["tense"]),
    word("rewarding", UPOS::ADJ, &["satisfying"]),
    word("reliable", UPOS::ADJ, &["dependable"]),
    // Adverbs
    word("rapidly", UPOS::ADV, &["quickly", "swiftly"]),
    word("significantly", UPOS::ADV, &["considerably", "markedly"]),
    word("seamlessly", UPOS::ADV, &["smoothly", "effortlessly"]),
    word("tirelessly", UPOS::ADV, &["relentlessly"]),
    word("incredibly", UPOS::ADV, &["remarkably"]),
    // Nouns
    word("inconvenience", UPOS::NOUN, &["trouble"]),
    // Phrases
    phrase("a wide range of", &["a broad mix of", "all kinds of"]),
    phrase("a wide variety of", &["a broad mix of", "all kinds of"]),
    phrase("delve into", &["dig into", "explore"]),
    phrase("delves into", &["digs into", "explores"]),
    phrase("delving into", &["digging into", "exploring"]),
    phrase("when it comes to", &["for"]),
    phrase("don't hesitate to reach out to", &["feel free to contact"]),
    phrase("do not hesitate to reach out to", &["feel free to contact"]),
    phrase("in no time", &["before long"]),
    phrase("explores themes of", &["deals with"]),
    phrase("it is also wise to", &["it also pays to"]),
    phrase("lasting difference", &["lasting change"]),
    phrase("generous gift", &["kind gift"]),
    phrase("sensitive information", &["private information"]),
    phrase("embark on", &["set out on"]),
    phrase("embarks on", &["sets out on"]),
    phrase("rich tapestry of", &["rich mix of", "rich blend of"]),
    phrase("navigate the complexities of", &["work through", "deal with"]),
    phrase("in the realm of", &["in the world of", "in the field of"]),
    phrase("a testament to", &["proof of", "a sign of"]),
    phrase("game-changer", &["breakthrough"]),
    phrase("cutting-edge", &["leading-edge", "advanced"]),
];

/// Model-free perplexity raiser. See the module docs.
#[derive(Debug, Default, Clone, Copy)]
pub struct PerplexityLite {
    max_suggestions: usize,
}

impl PerplexityLite {
    pub fn new() -> Self {
        Self { max_suggestions: 3 }
    }

    fn max_suggestions(&self) -> usize {
        if self.max_suggestions == 0 {
            3
        } else {
            self.max_suggestions
        }
    }

    fn connector_lints(&self, document: &Document) -> Vec<Lint> {
        let source = document.get_source();
        // How often each replacement has been suggested first, so a text doesn't end up with
        // the same new connector twice ("Nonetheless ... Nonetheless").
        let mut used: HashMap<&'static str, usize> = HashMap::new();
        let mut lints = Vec::new();

        for sentence in document.iter_sentences() {
            let Some(span) = sentence.span() else {
                continue;
            };
            let chars = span.get_content(source);

            for found in connectors::find_connectors(chars) {
                let original = found.span.get_content(chars);
                let original_lower: String = original
                    .iter()
                    .collect::<String>()
                    .to_lowercase()
                    .replace('\u{2019}', "'");

                let Some((_, targets)) =
                    CONNECTOR_TARGETS.iter().find(|(c, _)| *c == original_lower)
                else {
                    continue;
                };
                // Only targets not yet used in this text, in measured order. When all of them
                // are taken, leave the connector alone rather than repeat a replacement or fall
                // back to a weaker one.
                let alternatives: Vec<&'static str> = targets
                    .iter()
                    .copied()
                    .filter(|t| !used.contains_key(t))
                    .collect();
                let Some(first) = alternatives.first() else {
                    continue;
                };
                used.insert(*first, 1);

                let suggestions: Vec<Suggestion> = alternatives
                    .into_iter()
                    .take(self.max_suggestions())
                    .map(|alt| {
                        Suggestion::ReplaceWith(connectors::match_capitalization(alt, original))
                    })
                    .collect();
                if suggestions.is_empty() {
                    continue;
                }

                let original_str: String = original.iter().collect();
                lints.push(Lint {
                    span: found.span.pushed_by(span.start),
                    lint_kind: LintKind::Enhancement,
                    suggestions,
                    message: format!(
                        "“{original_str}” is a stock transition. A less common connector with the same meaning makes the text less predictable."
                    ),
                    priority: 127,
                });
            }
        }

        lints
    }

    fn replacement_lints(&self, document: &Document, taken: &[Span<char>]) -> Vec<Lint> {
        let source = document.get_source();
        let lower: Vec<char> = source.iter().flat_map(|c| c.to_lowercase()).collect();
        // Lowercasing can change lengths for a few exotic characters; fall back to no phrase
        // matching rather than producing misaligned spans.
        let can_scan = lower.len() == source.len();

        let mut taken: Vec<Span<char>> = taken.to_vec();
        let mut lints = Vec::new();

        let statistical = {
            let text: String = lower.iter().collect();
            STATISTICAL_CUES.iter().any(|cue| text.contains(cue))
        };

        // Single words, matched on tagged tokens so the part of speech can be checked.
        let tokens = document.get_tokens();
        for (i, tok) in tokens.iter().enumerate() {
            let Some(Some(meta)) = tok.kind.as_word() else {
                continue;
            };
            let text = tok.span.get_content_string(source).to_lowercase();
            let previous_word = tokens[..i]
                .iter()
                .rev()
                .find(|t| !t.kind.is_whitespace())
                .map(|t| t.span.get_content_string(source).to_lowercase());
            let after_degree_adverb = previous_word
                .as_deref()
                .is_some_and(|w| DEGREE_ADVERBS.contains(&w));
            let Some(entry) = REPLACEMENTS.iter().find(|r| {
                r.pos.is_some()
                    && r.phrase == text
                    && (meta.pos_tag == r.pos || (r.pos == Some(UPOS::ADJ) && after_degree_adverb))
            }) else {
                continue;
            };
            if statistical && entry.phrase.starts_with("significant") {
                continue;
            }
            // The tagger sometimes calls a verb an adjective ("They perfect their craft").
            // An adjective is not directly followed by a determiner or pronoun; a verb often is.
            let next_word = tokens[i + 1..].iter().find(|t| !t.kind.is_whitespace());
            if entry.pos == Some(UPOS::ADJ)
                && next_word.is_some_and(|t| t.kind.is_determiner() || t.kind.is_pronoun())
            {
                continue;
            }
            // "vibrant colours" means colourful, not lively.
            if entry.phrase == "vibrant"
                && next_word.is_some_and(|t| {
                    let w = t.span.get_content_string(source).to_lowercase();
                    VISUAL_NOUNS.contains(&w.as_str())
                })
            {
                continue;
            }
            self.push_replacement(source, tok.span, entry, &mut taken, &mut lints);
        }

        // Multi-word and hyphenated phrases, matched on the raw text.
        if can_scan {
            for entry in REPLACEMENTS.iter().filter(|r| r.pos.is_none()) {
                let pattern: Vec<char> = entry.phrase.chars().collect();
                for start in find_all(&lower, &pattern) {
                    let span = Span::new(start, start + pattern.len());
                    // "a testament to an artist who..." -> "proof of an artist" reads oddly.
                    if entry.phrase == "a testament to" && followed_by_article(&lower, span.end) {
                        continue;
                    }
                    self.push_replacement(source, span, entry, &mut taken, &mut lints);
                }
            }
        }

        lints
    }

    fn push_replacement(
        &self,
        source: &[char],
        span: Span<char>,
        entry: &Replacement,
        taken: &mut Vec<Span<char>>,
        lints: &mut Vec<Lint>,
    ) {
        let article = preceding_article(source, span.start);
        let full_span = article.map_or(span, |a| Span::new(a.start, span.end));
        if taken.iter().any(|t| t.overlaps_with(full_span)) {
            return;
        }

        let original = span.get_content(source);
        let suggestions: Vec<Suggestion> = entry
            .with
            .iter()
            .take(self.max_suggestions())
            .map(|w| {
                let replacement = connectors::match_capitalization(w, original);
                match article {
                    Some(a) => {
                        let mut out = fix_article(a.get_content(source), &replacement);
                        out.push(' ');
                        out.extend(replacement);
                        Suggestion::ReplaceWith(out)
                    }
                    None => Suggestion::ReplaceWith(replacement),
                }
            })
            .collect();

        let original_str: String = original.iter().collect();
        taken.push(full_span);
        lints.push(Lint {
            span: full_span,
            lint_kind: LintKind::Enhancement,
            suggestions,
            message: format!(
                "“{original_str}” is a favourite of AI-generated text. A less expected word makes it less predictable."
            ),
            priority: 127,
        });
    }
}

impl Linter for PerplexityLite {
    fn lint(&mut self, document: &Document) -> Vec<Lint> {
        let mut lints = self.connector_lints(document);
        let taken: Vec<Span<char>> = lints.iter().map(|l| l.span).collect();
        lints.extend(self.replacement_lints(document, &taken));
        lints.sort_by_key(|l| l.span.start);
        lints
    }

    fn description(&self) -> &str {
        "Suggests less predictable alternatives for stock connectors, clichés and adjectives typical of AI-generated text, without needing a language model."
    }
}

/// All non-overlapping occurrences of `pattern` in `text` that sit on word boundaries.
fn find_all(text: &[char], pattern: &[char]) -> Vec<usize> {
    let boundary = |c: Option<&char>| c.is_none_or(|c| !c.is_alphanumeric());
    let mut out = Vec::new();
    let mut i = 0;
    while i + pattern.len() <= text.len() {
        if text[i..i + pattern.len()] == *pattern
            && boundary(i.checked_sub(1).and_then(|j| text.get(j)))
            && boundary(text.get(i + pattern.len()))
        {
            out.push(i);
            i += pattern.len();
        } else {
            i += 1;
        }
    }
    out
}

/// Whether the word after `end` (skipping one space) is "a" or "an". `text` is lowercase.
fn followed_by_article(text: &[char], end: usize) -> bool {
    let rest: String = text.get(end..).unwrap_or(&[]).iter().take(4).collect();
    rest.starts_with(" a ") || rest.starts_with(" an ")
}

/// The span of an "a"/"an" directly before `start` (separated by one space), if any.
fn preceding_article(source: &[char], start: usize) -> Option<Span<char>> {
    if start < 2 || source[start - 1] != ' ' {
        return None;
    }
    let end = start - 1;
    let word_start = source[..end]
        .iter()
        .rposition(|c| !c.is_alphabetic())
        .map_or(0, |i| i + 1);
    let word: String = source[word_start..end].iter().collect::<String>().to_lowercase();
    (word == "a" || word == "an").then(|| Span::new(word_start, end))
}

/// The article that fits before `next`, with the capitalisation of `article`.
fn fix_article(article: &[char], next: &[char]) -> Vec<char> {
    let vowel = matches!(
        starts_with_vowel(next, Dialect::American),
        Some(InitialSound::Vowel)
    );
    let fixed = if vowel { "an" } else { "a" };
    connectors::match_capitalization(fixed, article)
}

#[cfg(test)]
mod tests {
    use super::PerplexityLite;
    use crate::Document;
    use crate::linting::{Lint, Linter, Suggestion};

    fn lint(text: &str) -> Vec<Lint> {
        PerplexityLite::new().lint(&Document::new_plain_english_curated(text))
    }

    fn suggestions(lint: &Lint) -> Vec<String> {
        lint.suggestions
            .iter()
            .map(|s| match s {
                Suggestion::ReplaceWith(v) => v.iter().collect(),
                other => panic!("unexpected suggestion {other:?}"),
            })
            .collect()
    }

    fn flagged(text: &str, lint: &Lint) -> String {
        let chars: Vec<char> = text.chars().collect();
        lint.span.get_content_string(&chars)
    }

    #[test]
    fn connector_uses_measured_targets() {
        let text = "It rained. However, we went out.";
        let lints = lint(text);
        assert_eq!(lints.len(), 1);
        assert_eq!(flagged(text, &lints[0]), "However");
        assert_eq!(
            suggestions(&lints[0]),
            vec!["Nonetheless", "All the same", "That said"]
        );
    }

    #[test]
    fn addition_and_result_connectors() {
        assert_eq!(suggestions(&lint("It works. Moreover, it is cheap.")[0])[0], "Besides");
        assert_eq!(suggestions(&lint("It broke. Consequently, we left.")[0])[0], "So");
        assert_eq!(suggestions(&lint("We met. Overall, it went well.")[0])[0], "To sum up");
    }

    #[test]
    fn repeated_connectors_get_different_replacements() {
        let lints = lint("However, it was fine. We left. However, it was good.");
        assert_eq!(lints.len(), 2);
        assert_eq!(suggestions(&lints[0])[0], "Nonetheless");
        assert_eq!(suggestions(&lints[1])[0], "All the same");
    }

    #[test]
    fn no_weak_fallback_when_target_is_used() {
        // "Besides" goes to the first; the second is left alone rather than becoming "Also".
        let text = "It is fast. Moreover, it is cheap. Furthermore, it is quiet.";
        let lints = lint(text);
        assert_eq!(lints.len(), 1);
        assert_eq!(flagged(text, &lints[0]), "Moreover");
        assert_eq!(suggestions(&lints[0]), vec!["Besides"]);
    }

    #[test]
    fn significant_is_kept_in_statistical_text() {
        assert!(lint("Income varies significantly by region in the regression model.").is_empty());
        let lints = lint("Sales rose significantly last year.");
        assert_eq!(suggestions(&lints[0])[0], "considerably");
    }

    #[test]
    fn testament_before_article_is_skipped() {
        assert!(lint("This album is a testament to an artist who takes risks.").is_empty());
        let lints = lint("The result is a testament to the team's effort.");
        assert_eq!(suggestions(&lints[0])[0], "proof of");
    }

    #[test]
    fn adjective_after_degree_adverb() {
        let text = "It was the most rewarding part of the trip.";
        let lints = lint(text);
        assert_eq!(lints.len(), 1);
        assert_eq!(flagged(text, &lints[0]), "rewarding");
        assert_eq!(suggestions(&lints[0]), vec!["satisfying"]);
    }

    #[test]
    fn unmeasured_connectors_are_left_alone() {
        // No same-meaning alternative to "Ultimately" raised perplexity, so it isn't touched.
        assert!(lint("We tried. Ultimately, it worked.").is_empty());
    }

    #[test]
    fn new_sequence_connectors() {
        assert_eq!(suggestions(&lint("Finally, rest well.")[0])[0], "Lastly");
        assert_eq!(suggestions(&lint("As always, thanks.")[0])[0], "As ever");
    }

    #[test]
    fn clause_connector_after_contrast() {
        let text = "However, it is important to note that sleep matters.";
        let lints = lint(text);
        assert_eq!(lints.len(), 2);
        assert_eq!(flagged(text, &lints[1]), "it is important to note");
        assert_eq!(suggestions(&lints[1])[0], "keep in mind");
    }

    #[test]
    fn vibrant_before_visual_noun_is_skipped() {
        assert!(lint("The gallery shows vibrant colors.").is_empty());
        let lints = lint("It has a vibrant community.");
        assert_eq!(suggestions(&lints[0]), vec!["a lively"]);
    }

    #[test]
    fn coverage_phrases() {
        let text = "When it comes to safety, please don't hesitate to reach out to us.";
        let lints = lint(text);
        assert_eq!(lints.len(), 2);
        assert_eq!(suggestions(&lints[0]), vec!["For"]);
        assert_eq!(suggestions(&lints[1]), vec!["feel free to contact"]);
    }

    #[test]
    fn replaces_ai_adjective_and_fixes_article() {
        let text = "This is an excellent idea.";
        let lints = lint(text);
        assert_eq!(lints.len(), 1);
        assert_eq!(flagged(text, &lints[0]), "an excellent");
        assert_eq!(suggestions(&lints[0]), vec!["a superb", "an outstanding"]);
    }

    #[test]
    fn article_case_is_kept() {
        let lints = lint("An excellent idea came up.");
        assert_eq!(suggestions(&lints[0])[0], "A superb");
    }

    #[test]
    fn adjective_without_article() {
        let text = "It is the perfect choice for busy people.";
        let lints = lint(text);
        assert_eq!(lints.len(), 1);
        assert_eq!(flagged(text, &lints[0]), "perfect");
        assert_eq!(suggestions(&lints[0]), vec!["ideal"]);
    }

    #[test]
    fn leaves_verb_uses_alone() {
        assert!(lint("They perfect their craft every day.").is_empty());
    }

    #[test]
    fn replaces_multiword_cliche() {
        let text = "Let us delve into the data.";
        let lints = lint(text);
        assert_eq!(lints.len(), 1);
        assert_eq!(flagged(text, &lints[0]), "delve into");
        assert_eq!(suggestions(&lints[0]), vec!["dig into", "explore"]);
    }

    #[test]
    fn capitalized_cliche() {
        let lints = lint("Delve into the details first.");
        assert_eq!(suggestions(&lints[0])[0], "Dig into");
    }

    #[test]
    fn hyphenated_cliche() {
        let text = "This tool is a game-changer for teams.";
        let lints = lint(text);
        assert_eq!(lints.len(), 1);
        assert_eq!(flagged(text, &lints[0]), "a game-changer");
        assert_eq!(suggestions(&lints[0]), vec!["a breakthrough"]);
    }

    #[test]
    fn phrase_needs_word_boundaries() {
        assert!(lint("They redelve intolerably.").is_empty());
    }

    #[test]
    fn wide_range_phrase() {
        let text = "We offer a wide range of tools.";
        let lints = lint(text);
        assert_eq!(flagged(text, &lints[0]), "a wide range of");
        assert_eq!(suggestions(&lints[0])[0], "a broad mix of");
    }

    #[test]
    fn plain_text_is_untouched() {
        assert!(lint("The cat sat on the mat and looked at the rain.").is_empty());
    }
}
