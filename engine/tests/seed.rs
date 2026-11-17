// The starter course (server/seed.json) must be well-formed and playable:
// valid parts of speech and genders, no duplicate words, every phrase can be built from its own tiles,
// every word grades its own answers as exact, and every unit has enough words for four-option questions.

use duelcore::vocab::{self, Mode, Rng, Verdict, Word};
use serde_json::Value;

fn seed() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../server/seed.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("server/seed.json")).expect("valid JSON")
}

#[test]
fn starter_course_is_well_formed_and_playable() {
    let seed = seed();
    let mut problems = Vec::new();
    let mut pool = Vec::new();
    let mut id = 0;
    for (u, unit) in seed["units"].as_array().unwrap().iter().enumerate() {
        let level = unit["level"].as_str().unwrap_or("");
        if !["A1", "A2", "B1", "B2"].contains(&level) {
            problems.push(format!("unit {u}: level {level:?}"));
        }
        let mut unit_words = 0;
        for lesson in unit["lessons"].as_array().unwrap() {
            let words = lesson["words"].as_array().unwrap();
            if words.is_empty() {
                problems.push(format!("empty lesson {}", lesson["title"]));
            }
            for w in words {
                id += 1;
                unit_words += 1;
                let lt = w["lt"].as_str().unwrap_or("");
                let en = w["en"].as_str().unwrap_or("");
                let pos = w["pos"].as_str().unwrap_or("");
                let gender = w["gender"].as_str().unwrap_or("");
                if lt.trim().is_empty() || en.trim().is_empty() {
                    problems.push(format!("empty word in {}", lesson["title"]));
                }
                if !["noun", "verb", "phrase", "other"].contains(&pos) {
                    problems.push(format!("{lt}: pos {pos:?}"));
                }
                if !["", "m", "f", "mpl", "fpl"].contains(&gender) || (pos != "noun" && !gender.is_empty()) {
                    problems.push(format!("{lt}: gender {gender:?} for a {pos}"));
                }
                let accepted = vocab::accepted(lt, w["also"].as_str().unwrap_or(""));
                if vocab::grade(&accepted, &[], lt, true).verdict != Verdict::Exact {
                    problems.push(format!("{lt}: doesn't grade its own answer as exact"));
                }
                if pos == "phrase" {
                    let built = vocab::phrase_tokens(lt).join(" ");
                    if vocab::grade(&accepted, &[], &built, false).verdict != Verdict::Exact {
                        problems.push(format!("{lt}: its tiles don't rebuild it ({built})"));
                    }
                }
                pool.push(Word { id, lt: lt.into(), en: en.into(), pos: pos.into(), gender: gender.into(), unit_id: u as i64, completed: false });
            }
        }
        if unit_words < 8 {
            problems.push(format!("unit {u} has only {unit_words} words"));
        }
    }
    // No word twice with the same meaning (each word has its own progress and review schedule).
    for (i, a) in pool.iter().enumerate() {
        for b in &pool[i + 1..] {
            if vocab::fold(&a.lt) == vocab::fold(&b.lt) {
                problems.push(format!("duplicate: {} ({}) and {} ({})", a.lt, a.en, b.lt, b.en));
            }
            if vocab::fold(&a.en) == vocab::fold(&b.en) {
                problems.push(format!("same English for {} and {}: {}", a.lt, b.lt, a.en));
            }
        }
    }
    // Every word gets a full set of four options, and an answer is never one of the other words.
    let mut rng = Rng::seeded(42);
    for c in vocab::build(&pool, &pool, Mode::Duel, &mut rng) {
        let n = c["options"].as_array().unwrap().len();
        if n != 4 {
            problems.push(format!("{}: {n} options", c["prompt"]));
        }
    }
    println!("{} words in {} units", pool.len(), seed["units"].as_array().unwrap().len());
    assert!(pool.len() > 100);
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
