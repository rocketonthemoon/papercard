// Checks the Rust engine against the JavaScript port's expectations:
//   - every extra rule fixes its examples and leaves correct English alone,
//   - every random duel text has at least 4 issues, scores 0 when deleted,
//     and scores well when Harper's own fixes are applied.

use duelcore::engine::{Engine, LintOut};
use duelcore::passages::PASSAGES;
use duelcore::scoring::score;

include!("common/cases.rs");

fn apply(text: &str, l: &LintOut, n: usize) -> String {
    // Offsets are UTF-16; convert through a UTF-16 buffer.
    let units: Vec<u16> = text.encode_utf16().collect();
    let s = &l.suggestions[n];
    let mut out: Vec<u16> = Vec::new();
    match s.kind.as_str() {
        "InsertAfter" => {
            out.extend_from_slice(&units[..l.end16]);
            out.extend(s.text.encode_utf16());
            out.extend_from_slice(&units[l.end16..]);
        }
        "Remove" => {
            out.extend_from_slice(&units[..l.start16]);
            out.extend_from_slice(&units[l.end16..]);
        }
        _ => {
            out.extend_from_slice(&units[..l.start16]);
            out.extend(s.text.encode_utf16());
            out.extend_from_slice(&units[l.end16..]);
        }
    }
    String::from_utf16(&out).unwrap()
}

fn fix(engine: &mut Engine, rule: &str, text: &str) -> Option<String> {
    let lints = engine.lint(text);
    let l = lints.iter().find(|l| l.rule == rule)?;
    Some(apply(text, l, 0))
}

#[test]
fn extra_rules_match_the_javascript_port() {
    let mut engine = Engine::new();
    let mut failures = Vec::new();
    for (rule, input, expected) in FIXES {
        let got = fix(&mut engine, rule, input);
        if got.as_deref() != Some(*expected) {
            failures.push(format!("{rule}: {input:?} -> {got:?}, expected {expected:?}"));
        }
    }
    for (rule, input) in ALLOWS {
        if let Some(got) = fix(&mut engine, rule, input) {
            failures.push(format!("{rule} should allow {input:?} but changed it to {got:?}"));
        }
    }
    let covered: std::collections::HashSet<&str> = FIXES.iter().map(|f| f.0).collect();
    for name in engine.extra_rule_names() {
        if !covered.contains(name) {
            failures.push(format!("{name} has no test case"));
        }
    }
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn every_random_text_plays_fair() {
    let mut engine = Engine::new();
    let mut report = Vec::new();
    let mut bad = false;
    for p in PASSAGES {
        let lints = engine.lint(p.text);
        let deleted = score(p.text, &lints, "Short.", &engine.lint("Short."));
        let mut fixed_text = p.text.to_string();
        let mut sorted = lints.clone();
        sorted.sort_by(|a, b| b.start16.cmp(&a.start16));
        for l in &sorted {
            if !l.suggestions.is_empty() {
                fixed_text = apply(&fixed_text, l, 0);
            }
        }
        let fixed = score(p.text, &lints, &fixed_text, &engine.lint(&fixed_text));
        let ok = lints.len() >= 4 && deleted.points == 0 && fixed.points as f64 >= fixed.max as f64 * 0.6;
        bad |= !ok;
        report.push(format!(
            "{} {:>2} issues · delete {} · auto-fix {}/{}  {}  [{}]",
            if ok { "ok " } else { "BAD" },
            lints.len(),
            deleted.points,
            fixed.points,
            fixed.max,
            p.title,
            lints.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(" · ")
        ));
    }
    println!("{}", report.join("\n"));
    assert!(!bad, "{}", report.join("\n"));
}
