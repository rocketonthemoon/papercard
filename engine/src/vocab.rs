//! Lithuanian vocabulary: exercise generation and answer grading.
//!
//! Exercise kinds:
//! - `pick_en`  a Lithuanian word or phrase; pick its English meaning
//! - `pick_lt`  an English word; pick the Lithuanian one
//! - `type_lt`  an English word; type the Lithuanian one
//! - `build`    an English phrase; put Lithuanian word tiles in order

use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, Deserialize)]
pub struct Word {
    pub id: i64,
    pub lt: String,
    pub en: String,
    #[serde(default)]
    pub pos: String,
    #[serde(default)]
    pub gender: String,
    #[serde(default, rename = "unitId")]
    pub unit_id: i64,
    #[serde(default)]
    pub completed: bool,
}

impl Word {
    fn is_phrase(&self) -> bool {
        self.pos == "phrase"
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Two passes over the words: recognise them (pick), then produce them (type or build).
    Lesson,
    /// One production exercise per word, for spaced-repetition review.
    Review,
    /// One multiple-choice question per word, with the answer stored for scoring.
    Duel,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "lesson" => Some(Mode::Lesson),
            "review" => Some(Mode::Review),
            "duel" => Some(Mode::Duel),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------- randomness

/// xorshift64*: small and good enough for shuffling options.
pub struct Rng(u64);

impl Rng {
    pub fn seeded(seed: u64) -> Rng {
        Rng(seed.max(1))
    }

    pub fn from_os() -> Rng {
        let mut b = [0u8; 8];
        let _ = getrandom::getrandom(&mut b);
        Rng::seeded(u64::from_le_bytes(b))
    }

    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 { 0 } else { (self.next() % n as u64) as usize }
    }

    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = self.below(i + 1);
            v.swap(i, j);
        }
    }
}

// ---------------------------------------------------------------- text normalisation

/// Lowercase, punctuation removed, whitespace collapsed. Keeps Lithuanian letters as they are.
pub fn norm(s: &str) -> String {
    let lowered: String = s.chars().flat_map(char::to_lowercase).map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { '\u{0}' }).filter(|&c| c != '\u{0}').collect();
    lowered.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `norm`, then Lithuanian (and common Latin) diacritics folded to plain letters: ą→a, š→s, ū→u...
pub fn fold(s: &str) -> String {
    norm(s)
        .chars()
        .map(|c| match c {
            'ą' | 'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' | 'ā' => 'a',
            'č' | 'ç' | 'ć' => 'c',
            'ę' | 'ė' | 'è' | 'é' | 'ê' | 'ë' | 'ē' => 'e',
            'į' | 'ì' | 'í' | 'î' | 'ï' | 'ī' | 'ı' => 'i',
            'š' | 'ś' => 's',
            'ų' | 'ū' | 'ù' | 'ú' | 'û' | 'ü' => 'u',
            'ž' | 'ź' | 'ż' => 'z',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' | 'ø' | 'ō' => 'o',
            'ñ' | 'ń' => 'n',
            'ł' => 'l',
            'ý' | 'ÿ' => 'y',
            other => other,
        })
        .collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// How many typos a word of this length may have and still count.
fn typo_allowance(len: usize) -> usize {
    match len {
        0..=4 => 0,
        5..=9 => 1,
        _ => 2,
    }
}

// ---------------------------------------------------------------- grading

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Exactly right (ignoring case and punctuation).
    Exact,
    /// Right apart from diacritics (ą, č, ė...). Counts as correct.
    Accents,
    /// One or two letters off. Counts as correct.
    Typo,
    Wrong,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Exact => "exact",
            Verdict::Accents => "accents",
            Verdict::Typo => "typo",
            Verdict::Wrong => "wrong",
        }
    }

    pub fn correct(self) -> bool {
        self != Verdict::Wrong
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grade {
    pub verdict: Verdict,
    /// The accepted answer to show the player (the one they were closest to).
    pub expected: String,
    /// Another word in the course the answer matches instead (e.g. išlipti for įlipti).
    pub confused: Option<String>,
}

/// Grades a typed answer against the accepted answers (first = main one). `others` are the other words
/// in the course: an answer that is one of them is wrong even when it is only a letter away.
pub fn grade(accepted: &[String], others: &[String], answer: &str, allow_typos: bool) -> Grade {
    let main = accepted.first().cloned().unwrap_or_default();
    let ans_norm = norm(answer);
    let ans_fold = fold(answer);
    let wrong = |confused: Option<String>| Grade { verdict: Verdict::Wrong, expected: main.clone(), confused };
    if ans_norm.is_empty() {
        return wrong(None);
    }
    if accepted.iter().any(|a| norm(a) == ans_norm) {
        return Grade { verdict: Verdict::Exact, expected: main, confused: None };
    }
    if let Some(a) = accepted.iter().find(|a| fold(a) == ans_fold) {
        return Grade { verdict: Verdict::Accents, expected: a.clone(), confused: None };
    }
    // A different word from the course, typed (nearly) correctly, is a real mistake, not a typo.
    if let Some(o) = others.iter().find(|o| fold(o) == ans_fold && !accepted.iter().any(|a| fold(a) == fold(o))) {
        return wrong(Some(o.clone()));
    }
    if allow_typos {
        let best = accepted.iter().map(|a| (levenshtein(&fold(a), &ans_fold), a)).min_by_key(|(d, _)| *d);
        if let Some((d, a)) = best {
            if d > 0 && d <= typo_allowance(fold(a).chars().count()) {
                return Grade { verdict: Verdict::Typo, expected: a.clone(), confused: None };
            }
        }
    }
    wrong(None)
}

/// Accepted answers for a word: its Lithuanian form plus the `;`-separated alternatives.
pub fn accepted(lt: &str, also: &str) -> Vec<String> {
    std::iter::once(lt.trim().to_string()).chain(also.split(';').map(|s| s.trim().to_string()).filter(|s| !s.is_empty())).collect()
}

// ---------------------------------------------------------------- exercises

/// The tiles of a phrase: its words with surrounding punctuation removed (Wi-Fi keeps its hyphen).
pub fn phrase_tokens(phrase: &str) -> Vec<String> {
    phrase
        .split_whitespace()
        .map(|t| t.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

/// Up to three wrong options for `w`, as (id, text). Prefers the same part of speech, then the same unit.
fn distractors(w: &Word, pool: &[Word], en: bool, rng: &mut Rng) -> Vec<(i64, String)> {
    let text = |x: &Word| if en { x.en.clone() } else { x.lt.clone() };
    let mut cands: Vec<&Word> = pool
        .iter()
        .filter(|d| d.id != w.id && fold(&d.lt) != fold(&w.lt) && fold(&d.en) != fold(&w.en))
        .collect();
    rng.shuffle(&mut cands);
    // Stable sort keeps the shuffle within each tier.
    cands.sort_by_key(|d| std::cmp::Reverse(2 * u8::from(d.pos == w.pos) + u8::from(d.unit_id == w.unit_id)));
    let mut out: Vec<(i64, String)> = Vec::new();
    for d in cands {
        let t = text(d);
        if out.iter().any(|(_, x)| fold(x) == fold(&t)) {
            continue;
        }
        out.push((d.id, t));
        if out.len() == 3 {
            break;
        }
    }
    out
}

fn options(w: &Word, pool: &[Word], en: bool, rng: &mut Rng) -> Value {
    let mut opts = distractors(w, pool, en, rng);
    opts.push((w.id, if en { w.en.clone() } else { w.lt.clone() }));
    rng.shuffle(&mut opts);
    Value::Array(opts.into_iter().map(|(id, text)| json!({ "id": id, "text": text })).collect())
}

/// The phrase's tiles plus up to three decoys from other words (same unit first), shuffled.
fn tiles(w: &Word, pool: &[Word], rng: &mut Rng) -> Value {
    let mut tiles = phrase_tokens(&w.lt);
    let mine: Vec<String> = tiles.iter().map(|t| fold(t)).collect();
    let mut others: Vec<&Word> = pool.iter().filter(|d| d.id != w.id).collect();
    rng.shuffle(&mut others);
    others.sort_by_key(|d| std::cmp::Reverse(u8::from(d.unit_id == w.unit_id)));
    let mut decoys: Vec<String> = Vec::new();
    for d in others {
        for t in phrase_tokens(&d.lt) {
            if decoys.len() < 3 && !mine.contains(&fold(&t)) && !decoys.iter().any(|x| fold(x) == fold(&t)) {
                decoys.push(t);
            }
        }
        if decoys.len() == 3 {
            break;
        }
    }
    tiles.extend(decoys);
    rng.shuffle(&mut tiles);
    json!(tiles)
}

fn challenge(kind: &str, w: &Word, pool: &[Word], mode: Mode, rng: &mut Rng) -> Value {
    let prompt = if kind == "pick_en" { &w.lt } else { &w.en };
    let mut c = json!({ "kind": kind, "wordId": w.id, "prompt": prompt, "pos": w.pos, "gender": w.gender, "completed": w.completed });
    let o = c.as_object_mut().unwrap();
    match kind {
        "pick_en" | "pick_lt" => {
            o.insert("options".into(), options(w, pool, kind == "pick_en", rng));
            if mode == Mode::Duel {
                o.insert("answerId".into(), json!(w.id));
            }
        }
        "build" => {
            o.insert("tiles".into(), tiles(w, pool, rng));
        }
        _ => {}
    }
    c
}

/// The exercises for `targets` (see `Mode`). `pool` is every word in the course, for wrong options and decoy tiles.
pub fn build(targets: &[Word], pool: &[Word], mode: Mode, rng: &mut Rng) -> Vec<Value> {
    let mut out = Vec::new();
    match mode {
        Mode::Lesson => {
            for (i, w) in targets.iter().enumerate() {
                let kind = if w.is_phrase() || i % 2 == 0 { "pick_en" } else { "pick_lt" };
                out.push(challenge(kind, w, pool, mode, rng));
            }
            for w in targets {
                out.push(challenge(if w.is_phrase() { "build" } else { "type_lt" }, w, pool, mode, rng));
            }
        }
        Mode::Review => {
            for (i, w) in targets.iter().enumerate() {
                let kind = if w.is_phrase() { "build" } else if i % 3 == 2 { "pick_lt" } else { "type_lt" };
                out.push(challenge(kind, w, pool, mode, rng));
            }
        }
        Mode::Duel => {
            for (i, w) in targets.iter().enumerate() {
                out.push(challenge(if i % 2 == 0 { "pick_en" } else { "pick_lt" }, w, pool, mode, rng));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(id: i64, lt: &str, en: &str, pos: &str, unit: i64) -> Word {
        Word { id, lt: lt.into(), en: en.into(), pos: pos.into(), gender: String::new(), unit_id: unit, completed: false }
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn normalises_case_punctuation_and_space() {
        assert_eq!(norm("  Ką tai   reiškia? "), "ką tai reiškia");
        assert_eq!(norm("Wi-Fi"), "wifi");
        assert_eq!(fold("Ąžuolas ŠILUMA ūkis"), "azuolas siluma ukis");
    }

    #[test]
    fn grades_exact_accents_typos_and_wrong() {
        let acc = s(&["šaltis"]);
        assert_eq!(grade(&acc, &[], "Šaltis", true).verdict, Verdict::Exact);
        assert_eq!(grade(&acc, &[], "saltis", true).verdict, Verdict::Accents);
        assert_eq!(grade(&acc, &[], "šaltys", true).verdict, Verdict::Typo);
        assert_eq!(grade(&acc, &[], "šiluma", true).verdict, Verdict::Wrong);
        assert_eq!(grade(&acc, &[], "", true).verdict, Verdict::Wrong);
        // Short words get no typo allowance.
        assert_eq!(grade(&s(&["kava"]), &[], "kova", true).verdict, Verdict::Wrong);
        // Tiles (no typos): order matters.
        assert_eq!(grade(&s(&["Ką tai reiškia?"]), &[], "Ką tai reiškia", false).verdict, Verdict::Exact);
        assert_eq!(grade(&s(&["Ką tai reiškia?"]), &[], "Tai ką reiškia", false).verdict, Verdict::Wrong);
    }

    #[test]
    fn accepts_alternatives_and_reports_the_one_matched() {
        let acc = accepted("dalytis", "dalintis; ");
        assert_eq!(acc, s(&["dalytis", "dalintis"]));
        let g = grade(&acc, &[], "dalintis", true);
        assert_eq!(g.verdict, Verdict::Exact);
        let g = grade(&s(&["kambario draugas", "kambariokas"]), &[], "kambariokas", true);
        assert_eq!(g.verdict, Verdict::Exact);
    }

    #[test]
    fn another_course_word_is_not_a_typo() {
        let others = s(&["išlipti", "eiti"]);
        let g = grade(&s(&["įlipti"]), &others, "islipti", true);
        assert_eq!(g.verdict, Verdict::Wrong);
        assert_eq!(g.confused.as_deref(), Some("išlipti"));
        // ...but a genuine typo still counts.
        assert_eq!(grade(&s(&["įlipti"]), &others, "ilipt", true).verdict, Verdict::Typo);
    }

    #[test]
    fn options_have_the_answer_and_three_distinct_decoys_of_the_same_kind() {
        let pool = vec![
            w(1, "knyga", "book", "noun", 1),
            w(2, "pieštukas", "pencil", "noun", 1),
            w(3, "sąsiuvinis", "notebook", "noun", 1),
            w(4, "egzaminas", "exam", "noun", 1),
            w(5, "skaityti", "to read", "verb", 1),
            w(6, "knyga", "book", "noun", 2), // same word in another unit: never a decoy
            w(7, "kava", "coffee", "noun", 2),
        ];
        for seed in 1..50 {
            let mut rng = Rng::seeded(seed);
            let o = options(&pool[0], &pool, true, &mut rng);
            let texts: Vec<&str> = o.as_array().unwrap().iter().map(|x| x["text"].as_str().unwrap()).collect();
            assert_eq!(texts.len(), 4);
            assert_eq!(texts.iter().filter(|t| **t == "book").count(), 1);
            assert!(!texts.contains(&"to read"), "a noun's decoys are nouns from its unit first: {texts:?}");
            assert!(!texts.contains(&"coffee"));
        }
    }

    #[test]
    fn tiles_hold_the_phrase_plus_decoys() {
        let pool = vec![w(1, "Kur yra biblioteka?", "Where is the library?", "phrase", 1), w(2, "knyga", "book", "noun", 1), w(3, "Ką tai reiškia?", "What does this mean?", "phrase", 1), w(4, "kava", "coffee", "noun", 1)];
        let mut rng = Rng::seeded(7);
        let t = tiles(&pool[0], &pool, &mut rng);
        let mut t: Vec<String> = t.as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        assert_eq!(t.len(), 6);
        for word in ["Kur", "yra", "biblioteka"] {
            let i = t.iter().position(|x| x == word).expect(word);
            t.remove(i);
        }
        assert!(t.iter().all(|x| !["Kur", "yra", "biblioteka"].contains(&x.as_str())));
        assert_eq!(phrase_tokens("Man reikia Wi-Fi slaptažodžio."), s(&["Man", "reikia", "Wi-Fi", "slaptažodžio"]));
        assert_eq!(phrase_tokens("Mūsų pristatymo tema yra..."), s(&["Mūsų", "pristatymo", "tema", "yra"]));
    }

    #[test]
    fn lessons_recognise_then_produce() {
        let pool = vec![w(1, "knyga", "book", "noun", 1), w(2, "skaityti", "to read", "verb", 1), w(3, "Aš nesuprantu.", "I don't understand.", "phrase", 1)];
        let mut rng = Rng::seeded(3);
        let kinds: Vec<String> = build(&pool, &pool, Mode::Lesson, &mut rng).iter().map(|c| c["kind"].as_str().unwrap().to_string()).collect();
        assert_eq!(kinds, s(&["pick_en", "pick_lt", "pick_en", "type_lt", "type_lt", "build"]));
        let duel = build(&pool, &pool, Mode::Duel, &mut rng);
        assert!(duel.iter().all(|c| c["answerId"] == c["wordId"] && c["options"].as_array().is_some()));
        let lesson = build(&pool, &pool, Mode::Lesson, &mut rng);
        assert!(lesson.iter().all(|c| c.get("answerId").is_none()), "lessons never send the answer");
        let review = build(&pool, &pool, Mode::Review, &mut rng);
        assert_eq!(review.len(), 3);
    }
}
