//! Scoring a corrected text against the original, using Harper's issues for both.
//!
//!   +10  for every issue in the original that is gone
//!    -5  for every new issue the player introduced
//!    -3  for every word edit beyond the edit budget (3 per original issue, plus 2, but at most
//!        30% of the text), so rewriting or deleting the whole text doesn't pay
//!
//! The score never drops below 0; the maximum is 10 x the number of original issues.

use std::collections::HashMap;

use serde::Serialize;

use crate::engine::LintOut;

pub const FIXED: i64 = 10;
pub const INTRODUCED: i64 = 5;
pub const OVER_EDIT: i64 = 3;
pub const EDITS_PER_ISSUE: usize = 3;
pub const FREE_EDITS: usize = 2;
pub const MAX_EDIT_SHARE: f64 = 0.3;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Brief {
    pub rule: String,
    pub kind: String,
    pub text: String,
    pub message: String,
    pub start16: usize,
    pub end16: usize,
    pub suggestions: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScoreResult {
    pub points: i64,
    pub max: i64,
    pub total: usize,
    pub fixed: usize,
    pub remaining: Vec<Brief>,
    pub introduced: Vec<Brief>,
    pub edits: usize,
    pub edit_budget: usize,
    pub over_edits: usize,
}

fn brief(l: &LintOut) -> Brief {
    Brief {
        rule: l.rule.clone(),
        kind: l.kind.clone(),
        text: l.text.clone(),
        message: l.message.clone(),
        start16: l.start16,
        end16: l.end16,
        suggestions: l.suggestions.iter().take(3).map(|s| s.text.clone()).collect(),
    }
}

fn issue_key(l: &LintOut) -> String {
    format!("{}|{}", l.rule, l.text.to_lowercase())
}

/// Words and punctuation marks, lowercased, so the edit count ignores spacing.
pub fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    for c in text.to_lowercase().chars() {
        if c.is_alphanumeric() || c == '\'' || c == '\u{2019}' {
            word.push(c);
            continue;
        }
        if !word.is_empty() {
            out.push(std::mem::take(&mut word));
        }
        if !c.is_whitespace() {
            out.push(c.to_string());
        }
    }
    if !word.is_empty() {
        out.push(word);
    }
    out
}

/// Levenshtein distance over token lists (two rows).
pub fn edit_distance(a: &[String], b: &[String]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + usize::from(a[i - 1] != b[j - 1]));
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

pub fn score(original: &str, orig_lints: &[LintOut], submission: &str, sub_lints: &[LintOut]) -> ScoreResult {
    // An original issue counts as still there if the same rule flags the same words.
    let mut pool: HashMap<String, usize> = HashMap::new();
    for l in orig_lints {
        *pool.entry(issue_key(l)).or_default() += 1;
    }
    let mut remaining = Vec::new();
    let mut introduced = Vec::new();
    for l in sub_lints {
        match pool.get_mut(&issue_key(l)) {
            Some(n) if *n > 0 => {
                *n -= 1;
                remaining.push(brief(l));
            }
            _ => introduced.push(brief(l)),
        }
    }
    let total = orig_lints.len();
    let fixed = total - remaining.len();
    let orig_tokens = tokens(original);
    let edits = edit_distance(&orig_tokens, &tokens(submission));
    let share = ((MAX_EDIT_SHARE * orig_tokens.len() as f64).round() as usize).max(FREE_EDITS);
    let edit_budget = (EDITS_PER_ISSUE * total + FREE_EDITS).min(share);
    let over_edits = edits.saturating_sub(edit_budget);
    let raw = fixed as i64 * FIXED - introduced.len() as i64 * INTRODUCED - over_edits as i64 * OVER_EDIT;
    ScoreResult { points: raw.max(0), max: total as i64 * FIXED, total, fixed, remaining, introduced, edits, edit_budget, over_edits }
}

/// Applies the first suggestion of each lint (back to front, so earlier offsets stay valid).
pub fn apply_fixes(text: &str, lints: &[LintOut]) -> String {
    let mut units: Vec<u16> = text.encode_utf16().collect();
    let mut sorted: Vec<&LintOut> = lints.iter().filter(|l| !l.suggestions.is_empty()).collect();
    sorted.sort_by(|a, b| b.start16.cmp(&a.start16));
    let mut last_start = usize::MAX;
    for l in sorted {
        if l.end16 > last_start || l.end16 > units.len() {
            continue; // overlapping lints: keep the later fix
        }
        let s = &l.suggestions[0];
        let replacement: Vec<u16> = s.text.encode_utf16().collect();
        match s.kind.as_str() {
            "InsertAfter" => {
                units.splice(l.end16..l.end16, replacement);
            }
            "Remove" => {
                units.splice(l.start16..l.end16, std::iter::empty());
            }
            _ => {
                units.splice(l.start16..l.end16, replacement);
            }
        }
        last_start = l.start16;
    }
    String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_split_words_and_punctuation() {
        assert_eq!(tokens("It's  a TEST, ok."), vec!["it's", "a", "test", ",", "ok", "."]);
    }

    #[test]
    fn edit_distance_counts_word_changes() {
        let a = tokens("we was late");
        let b = tokens("we were late");
        assert_eq!(edit_distance(&a, &b), 1);
        assert_eq!(edit_distance(&a, &tokens("")), 3);
    }
}
