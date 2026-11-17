//! Harper (Rust) plus the Harper.px extras, producing the same lint JSON the game used before.

use std::sync::Arc;

use harper_core::linting::{LintGroup, Suggestion};
use harper_core::spell::FstDictionary;
use harper_core::{Dialect, Document, remove_overlaps_map};
use serde::{Deserialize, Serialize};

use crate::extras::Extras;

/// Rules that judge taste rather than correctness don't count in a duel.
const IGNORED_RULES: &[&str] = &["LongSentences", "BoringWords", "SentenceLength"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SuggestionOut {
    pub text: String,
    pub kind: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LintOut {
    pub rule: String,
    pub kind: String,
    pub text: String,
    pub message: String,
    pub start16: usize,
    pub end16: usize,
    pub suggestions: Vec<SuggestionOut>,
}

pub struct Engine {
    group: LintGroup,
    extras: Extras,
}

impl Engine {
    /// Builds Harper's dictionary and rules (under a second).
    pub fn new() -> Self {
        let dict = FstDictionary::curated();
        let group = LintGroup::new_curated(dict.clone(), Dialect::American);
        Engine { group, extras: Extras::new(dict as Arc<FstDictionary>) }
    }

    pub fn extra_rule_names(&self) -> Vec<&'static str> {
        self.extras.rule_names()
    }

    /// Harper's issues for `text`, overlaps removed, sorted by position.
    pub fn lint(&mut self, text: &str) -> Vec<LintOut> {
        let doc = Document::new_plain_english_curated(text);
        let mut map = self.group.organized_lints(&doc);
        for (name, lints) in self.extras.lint(&doc) {
            map.entry(name).or_default().extend(lints);
        }
        remove_overlaps_map(&mut map);

        let chars = doc.get_source();
        let mut off16 = vec![0usize; chars.len() + 1];
        for (i, c) in chars.iter().enumerate() {
            off16[i + 1] = off16[i] + c.len_utf16();
        }
        let mut out = Vec::new();
        for (rule, lints) in map {
            if IGNORED_RULES.contains(&rule.as_str()) {
                continue;
            }
            for l in lints {
                let (s, e) = (l.span.start, l.span.end.min(chars.len()));
                out.push((
                    s,
                    e,
                    LintOut {
                        rule: rule.clone(),
                        kind: l.lint_kind.to_string_key(),
                        text: chars[s..e].iter().collect(),
                        message: l.message.clone(),
                        start16: off16[s],
                        end16: off16[e],
                        suggestions: l
                            .suggestions
                            .iter()
                            .map(|sg| match sg {
                                Suggestion::ReplaceWith(c) => SuggestionOut { text: c.iter().collect(), kind: "ReplaceWith".into() },
                                Suggestion::InsertAfter(c) => SuggestionOut { text: c.iter().collect(), kind: "InsertAfter".into() },
                                Suggestion::Remove => SuggestionOut { text: String::new(), kind: "Remove".into() },
                            })
                            .collect(),
                    },
                ));
            }
        }
        out.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        out.into_iter().map(|(_, _, l)| l).collect()
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
