// Every "fix" challenge in the starter content (server/seed.json) must be gradeable:
// Harper flags at least one mistake, and applying Harper's fixes clears all of them without new ones.

use duelcore::engine::Engine;
use duelcore::scoring::{apply_fixes, score};

#[test]
fn every_seed_fix_challenge_is_gradeable() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../server/seed.json");
    let seed: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("server/seed.json")).unwrap();
    let mut engine = Engine::new();
    let mut report = Vec::new();
    let mut bad = 0;
    let mut count = 0;
    for unit in seed["units"].as_array().unwrap() {
        for lesson in unit["lessons"].as_array().unwrap() {
            for ch in lesson["challenges"].as_array().unwrap() {
                if ch["type"] == "choose" {
                    let correct = ch["options"].as_array().unwrap().iter().filter(|o| o["correct"] == true).count();
                    if correct != 1 {
                        bad += 1;
                        report.push(format!("BAD choose with {correct} correct options: {}", ch["question"]));
                    }
                    continue;
                }
                count += 1;
                let text = ch["text"].as_str().unwrap();
                let lints = engine.lint(text);
                let fixed = apply_fixes(text, &lints);
                let after = engine.lint(&fixed);
                let r = score(text, &lints, &fixed, &after);
                let ok = !lints.is_empty() && r.fixed == r.total && r.introduced.is_empty();
                bad += usize::from(!ok);
                report.push(format!(
                    "{} {:<48} [{}] -> {:?}",
                    if ok { "ok " } else { "BAD" },
                    text,
                    lints.iter().map(|l| format!("{}: {}", l.rule, l.text)).collect::<Vec<_>>().join(", "),
                    fixed
                ));
            }
        }
    }
    println!("{}", report.join("\n"));
    assert!(count > 0);
    assert_eq!(bad, 0, "{}", report.join("\n"));
}
