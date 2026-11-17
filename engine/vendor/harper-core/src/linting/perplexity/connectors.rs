//! Discourse connectors ("However,", "Moreover,", "It is important to note that") grouped by
//! meaning. Swapping a connector for another one *from the same group* keeps the logic of the
//! text while replacing the stock transitions that make AI-written prose so predictable.

use crate::Span;

/// What must follow a connector for it to be recognised (and what its replacements rely on).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Follow {
    /// A comma: "However, ..."
    Comma,
    /// The word "that": "It is important to note that ..."
    That,
}

#[derive(Debug)]
pub(super) struct ConnectorGroup {
    pub follow: Follow,
    /// Lowercase phrases with the same discourse function. Any member can replace any other.
    pub phrases: &'static [&'static str],
}

/// A `static` (not `const`) so every reference points at the same group, which lets callers
/// identify a group by address.
pub(super) static CONNECTOR_GROUPS: &[ConnectorGroup] = &[
    // Contrast
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &[
            "however",
            "nevertheless",
            "nonetheless",
            "that said",
            "even so",
            "still",
            "all the same",
        ],
    },
    // Addition
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &[
            "moreover",
            "furthermore",
            "additionally",
            "in addition",
            "what's more",
            "on top of that",
            "besides",
            "also",
        ],
    },
    // Result
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &[
            "therefore",
            "consequently",
            "as a result",
            "thus",
            "for this reason",
            "because of this",
            "so",
        ],
    },
    // Conclusion
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &[
            "ultimately",
            "in conclusion",
            "overall",
            "in the end",
            "all in all",
            "to sum up",
            "in short",
            "in summary",
        ],
    },
    // Last item in a sequence
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &["finally", "lastly", "last of all"],
    },
    // Getting started
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &["to get started", "to begin", "first"],
    },
    // As usual
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &["as always", "as ever", "as usual"],
    },
    // Repetition
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &["once again", "again", "yet again"],
    },
    // Example
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &["for example", "for instance", "to illustrate", "as an example"],
    },
    // Emphasis
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &["indeed", "in fact", "notably", "importantly", "as it happens"],
    },
    // Present-day openers
    ConnectorGroup {
        follow: Follow::Comma,
        phrases: &[
            "in today's fast-paced world",
            "in today's world",
            "in this day and age",
            "nowadays",
            "these days",
            "today",
        ],
    },
    // "It is important to note that ..."
    ConnectorGroup {
        follow: Follow::That,
        phrases: &[
            "it is important to note",
            "it's important to note",
            "it is worth noting",
            "it's worth noting",
            "it should be noted",
            "keep in mind",
            "bear in mind",
            "note",
        ],
    },
];

/// A connector found in a sentence.
#[derive(Debug, Clone, Copy)]
pub(super) struct FoundConnector {
    /// Span of the connector phrase itself (without the trailing comma / "that").
    pub span: Span<char>,
    pub group: &'static ConnectorGroup,
}

/// How many connectors may be chained at the start of a sentence
/// ("However, it is important to note that ...").
const MAX_CHAIN: usize = 2;

/// Find connectors at the start of a sentence. `chars` is the sentence text.
pub(super) fn find_connectors(chars: &[char]) -> Vec<FoundConnector> {
    let mut found = Vec::new();
    let mut pos = skip_whitespace(chars, 0);

    while found.len() < MAX_CHAIN {
        let Some(hit) = match_at(chars, pos) else {
            break;
        };
        found.push(hit);
        if hit.group.follow == Follow::That {
            break;
        }
        // Continue after the comma.
        pos = skip_whitespace(chars, hit.span.end + 1);
    }

    found
}

/// The longest connector starting at `pos` that is followed by what its group requires.
fn match_at(chars: &[char], pos: usize) -> Option<FoundConnector> {
    let mut best: Option<FoundConnector> = None;

    for group in CONNECTOR_GROUPS {
        for phrase in group.phrases {
            let len = phrase.chars().count();
            let Some(candidate) = chars.get(pos..pos + len) else {
                continue;
            };
            if !eq_ignore_case(candidate, phrase) || !followed_by(chars, pos + len, group.follow) {
                continue;
            }
            if best.is_none_or(|b| b.span.len() < len) {
                best = Some(FoundConnector {
                    span: Span::new(pos, pos + len),
                    group,
                });
            }
        }
    }

    best
}

fn followed_by(chars: &[char], at: usize, follow: Follow) -> bool {
    match follow {
        Follow::Comma => chars.get(at) == Some(&','),
        Follow::That => {
            chars.get(at).is_some_and(|c| c.is_whitespace())
                && chars
                    .get(at + 1..at + 5)
                    .is_some_and(|w| eq_ignore_case(w, "that"))
                && chars.get(at + 5).is_none_or(|c| !c.is_alphanumeric())
        }
    }
}

/// Case-insensitive comparison that treats curly apostrophes as straight ones.
fn eq_ignore_case(chars: &[char], phrase: &str) -> bool {
    let normalize = |c: char| if c == '\u{2019}' { '\'' } else { c };
    chars.len() == phrase.chars().count()
        && chars
            .iter()
            .zip(phrase.chars())
            .all(|(a, b)| normalize(*a).to_lowercase().eq(normalize(b).to_lowercase()))
}

fn skip_whitespace(chars: &[char], mut pos: usize) -> usize {
    while chars.get(pos).is_some_and(|c| c.is_whitespace()) {
        pos += 1;
    }
    pos
}

/// Give `phrase` the capitalisation of the original connector: only the first letter matters.
pub(super) fn match_capitalization(phrase: &str, original: &[char]) -> Vec<char> {
    let upper = original.first().is_some_and(|c| c.is_uppercase());
    let mut chars = phrase.chars();
    let mut out = Vec::new();
    if let Some(first) = chars.next() {
        if upper {
            out.extend(first.to_uppercase());
        } else {
            out.push(first);
        }
    }
    out.extend(chars);
    out
}

#[cfg(test)]
mod tests {
    use super::{Follow, find_connectors, match_capitalization};

    fn find(text: &str) -> Vec<String> {
        let chars: Vec<char> = text.chars().collect();
        find_connectors(&chars)
            .into_iter()
            .map(|c| c.span.get_content_string(&chars))
            .collect()
    }

    #[test]
    fn finds_sentence_initial_connector() {
        assert_eq!(find("However, we went out."), vec!["However"]);
    }

    #[test]
    fn prefers_longest_match() {
        assert_eq!(
            find("In today's fast-paced world, speed matters."),
            vec!["In today's fast-paced world"]
        );
    }

    #[test]
    fn finds_chained_connectors() {
        assert_eq!(
            find(" However, it is important to note that rest helps."),
            vec!["However", "it is important to note"]
        );
    }

    #[test]
    fn requires_trailing_comma() {
        assert!(find("However we look at it, it works.").is_empty());
        assert!(find("Still water runs deep.").is_empty());
    }

    #[test]
    fn requires_that_for_clause_connectors() {
        assert!(find("Note the date.").is_empty());
        assert_eq!(find("Note that dates vary."), vec!["Note"]);
    }

    #[test]
    fn ignores_mid_sentence_words() {
        assert!(find("We tried; however, it failed.").is_empty());
    }

    #[test]
    fn handles_curly_apostrophes() {
        assert_eq!(find("What\u{2019}s more, it is cheap."), vec!["What\u{2019}s more"]);
    }

    #[test]
    fn capitalization_follows_original() {
        let cap: String = match_capitalization("that said", &['H', 'o']).into_iter().collect();
        let low: String = match_capitalization("keep in mind", &['i', 't']).into_iter().collect();
        assert_eq!(cap, "That said");
        assert_eq!(low, "keep in mind");
    }

    #[test]
    fn groups_are_well_formed() {
        for group in super::CONNECTOR_GROUPS {
            assert!(group.phrases.len() >= 3);
            for p in group.phrases {
                assert_eq!(*p, p.to_lowercase());
                if group.follow == Follow::That {
                    assert!(!p.ends_with("that"));
                }
            }
        }
    }
}
