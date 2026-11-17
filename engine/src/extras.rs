//! Harper.px extras: rules for common real-life mistakes that upstream Harper doesn't catch.
//! A line-for-line port of `harper/linting/extras.js`; keep the two in sync.
//!
//! Each rule looks at one sentence at a time, as a list of word and punctuation items
//! (whitespace dropped), and returns a `Hit` covering `items[from..=to]`.

use std::collections::BTreeMap;
use std::sync::Arc;

use harper_brill::UPOS;
use harper_brill::UPOS::*;
use harper_core::linting::{Lint, LintKind, Suggestion};
use harper_core::spell::{Dictionary, FstDictionary};
use harper_core::{Document, IrregularVerbs, Punctuation, Span, TokenKind, TokenStringExt};

// ---------------------------------------------------------------- sentence view

struct Item {
    span: Span<char>,
    kind: TokenKind,
    raw: String,
    w: Option<String>,
}

pub struct Sent<'a> {
    doc: &'a Document,
    items: Vec<Item>,
}

impl<'a> Sent<'a> {
    fn new(doc: &'a Document, toks: &[harper_core::Token]) -> Self {
        let items = toks
            .iter()
            .filter(|t| !t.kind.is_whitespace() && !matches!(t.kind, TokenKind::ParagraphBreak))
            .map(|t| {
                let raw = doc.get_span_content_str(&t.span);
                let w = t.kind.is_word().then(|| raw.to_lowercase().replace(['\u{2018}', '\u{2019}'], "'"));
                Item { span: t.span, kind: t.kind.clone(), raw, w }
            })
            .collect();
        Sent { doc, items }
    }
    fn n(&self) -> isize {
        self.items.len() as isize
    }
    fn get(&self, i: isize) -> Option<&Item> {
        if i < 0 { None } else { self.items.get(i as usize) }
    }
    fn w(&self, i: isize) -> Option<&str> {
        self.get(i).and_then(|it| it.w.as_deref())
    }
    fn k(&self, i: isize) -> Option<&TokenKind> {
        self.get(i).map(|it| &it.kind)
    }
    fn raw(&self, i: isize) -> &str {
        self.get(i).map(|it| it.raw.as_str()).unwrap_or("")
    }
    fn is(&self, i: isize, alts: &str) -> bool {
        self.w(i).is_some_and(|w| alts.split('|').any(|a| a == w))
    }
    fn word_is(&self, i: isize, w: &str) -> bool {
        self.w(i) == Some(w)
    }
    /// Punctuation that breaks a clause (not apostrophes or hyphens), or the end of the sentence.
    fn stop(&self, i: isize) -> bool {
        match self.k(i) {
            None => true,
            Some(k) => k.is_punctuation() && !k.is_apostrophe() && !k.is_hyphen(),
        }
    }
    /// Sentence end: a terminator, or nothing left.
    fn end(&self, i: isize) -> bool {
        self.k(i).is_none_or(|k| k.is_sentence_terminator())
    }
    /// First word of a sentence or clause.
    fn start(&self, i: isize) -> bool {
        i == 0 || self.stop(i - 1)
    }
    fn hyphen(&self, i: isize) -> bool {
        self.k(i).is_some_and(|k| k.is_hyphen())
    }
    fn comma(&self, i: isize) -> bool {
        self.k(i).is_some_and(|k| k.is_comma())
    }
    fn question(&self, i: isize) -> bool {
        matches!(self.k(i), Some(TokenKind::Punctuation(Punctuation::Question)))
    }
    fn upos(&self, i: isize, tags: &[UPOS]) -> bool {
        self.k(i).is_some_and(|k| k.is_word() && tags.iter().any(|t| k.is_upos(*t)))
    }
    /// A plural count noun (not also singular, not a mass noun).
    fn plural(&self, i: isize) -> bool {
        self.k(i).is_some_and(|k| k.is_word() && k.is_plural_noun() && !k.is_singular_noun() && !k.is_mass_noun() && k.is_upos(NOUN))
    }
    /// A singular count noun (not also plural, not a mass noun).
    fn singular(&self, i: isize) -> bool {
        self.k(i).is_some_and(|k| k.is_word() && k.is_singular_noun() && !k.is_plural_noun() && !k.is_mass_noun() && k.is_upos(NOUN))
    }
    /// A verb in its base form, used as a verb here.
    fn base_verb(&self, i: isize) -> bool {
        self.k(i).is_some_and(|k| k.is_word() && k.is_verb_lemma() && (k.is_upos(VERB) || k.is_upos(AUX)))
    }
    fn text(&self, a: isize, b: isize) -> String {
        let (a, b) = (&self.items[a as usize], &self.items[b as usize]);
        self.doc.get_span_content_str(&Span::new(a.span.start, b.span.end))
    }
}

// ---------------------------------------------------------------- word helpers

const SUBJ: &str = "i|you|he|she|it|we|they";
const PERSON_SUBJ: &str = "i|you|he|she|we|they";
const OBJ_YOU: &str = "me|him|her|us|them|you";
const DETERMINERS: &str = "the|a|an|this|that|these|those|my|your|his|her|its|our|their|some|any|no|every|each";
const CONJ: &str = "and|but|so|because|when|if|that|then|since|before|after|until|while|where|though|although|once";
const AUX_BEFORE: &str = "do|does|did|don't|doesn't|didn't|will|would|can|could|should|shall|might|may|must|won't|wouldn't|can't|couldn't|shouldn't|to|let|let's|make|makes|made|help|helps|had|have|has";

fn to_subj(w: &str) -> Option<&'static str> {
    Some(match w {
        "me" | "myself" | "i" => "I",
        "him" | "he" => "he",
        "her" | "she" => "she",
        "them" | "they" => "they",
        "us" | "we" => "we",
        "you" => "you",
        _ => return None,
    })
}

fn singular_verb(w: &str) -> Option<&'static str> {
    Some(match w {
        "have" => "has",
        "are" => "is",
        "were" => "was",
        "do" => "does",
        "don't" => "doesn't",
        "aren't" => "isn't",
        "weren't" => "wasn't",
        "haven't" => "hasn't",
        _ => return None,
    })
}

fn plural_verb(w: &str) -> Option<&'static str> {
    Some(match w {
        "is" => "are",
        "was" => "were",
        "has" => "have",
        "does" => "do",
        "doesn't" => "don't",
        "isn't" => "aren't",
        "wasn't" => "weren't",
        "hasn't" => "haven't",
        _ => return None,
    })
}

pub struct Ctx {
    dict: Arc<FstDictionary>,
}

impl Ctx {
    fn is_lemma(&self, w: &str) -> bool {
        self.dict.get_word_metadata_str(w).is_some_and(|m| m.is_verb_lemma())
    }

    fn ing_form(&self, base: &str) -> Option<String> {
        let mut c = Vec::new();
        let chars: Vec<char> = base.chars().collect();
        if base.ends_with("ie") {
            c.push(format!("{}ying", &base[..base.len() - 2]));
        }
        if base.ends_with('e') && !(base.ends_with("ee") || base.ends_with("ye") || base.ends_with("oe")) {
            c.push(format!("{}ing", &base[..base.len() - 1]));
        }
        c.push(format!("{base}ing"));
        let vowel = |ch: char| "aeiou".contains(ch);
        if chars.len() >= 3 {
            let (x, y, z) = (chars[chars.len() - 3], chars[chars.len() - 2], chars[chars.len() - 1]);
            if !vowel(x) && vowel(y) && "bdgklmnprt".contains(z) {
                c.push(format!("{base}{z}ing"));
            }
        }
        c.into_iter().find(|x| self.dict.get_word_metadata_str(x).is_some_and(|m| m.is_verb_progressive_form()))
    }

    fn lemma_of(&self, w: &str, k: &TokenKind) -> Option<String> {
        let special = match w {
            "has" => Some("have"),
            "is" | "was" | "were" | "am" | "are" => Some("be"),
            "does" | "did" => Some("do"),
            _ => None,
        };
        if let Some(s) = special {
            return Some(s.to_string());
        }
        let mut c: Vec<String> = Vec::new();
        if k.is_verb_third_person_singular_present_form() {
            if let Some(stem) = w.strip_suffix("ies") {
                c.push(format!("{stem}y"));
            }
            if let Some(stem) = w.strip_suffix("es") {
                c.push(stem.to_string());
            }
            if let Some(stem) = w.strip_suffix('s') {
                c.push(stem.to_string());
            }
        }
        if k.is_verb_simple_past_form() {
            if let Some(irr) = IrregularVerbs::curated().get_lemma_for_preterite(w) {
                c.push(irr.to_string());
            }
            if let Some(stem) = w.strip_suffix("ied") {
                c.push(format!("{stem}y"));
            }
            if let Some(stem) = w.strip_suffix("ed") {
                c.push(stem.to_string());
                c.push(w[..w.len() - 1].to_string());
                let ch: Vec<char> = w.chars().collect();
                if ch.len() >= 4 && ch[ch.len() - 3] == ch[ch.len() - 4] {
                    c.push(ch[..ch.len() - 3].iter().collect());
                }
            }
        }
        c.into_iter().find(|x| self.is_lemma(x))
    }
}

/// Match the casing of the original text: ALL CAPS, Capitalized, or as written.
fn match_case(orig: &str, text: &str) -> String {
    if orig == "I" {
        return text.to_string(); // the pronoun "I" is capitalized everywhere
    }
    let letters: String = orig.chars().filter(|c| c.is_ascii_alphabetic()).collect();
    if letters.len() > 1 && letters == letters.to_uppercase() {
        return text.to_uppercase();
    }
    let starts_upper = orig.chars().next().is_some_and(|c| c.is_ascii_uppercase());
    let text_lower = text.chars().next().is_some_and(|c| c.is_ascii_lowercase());
    if starts_upper && text_lower {
        let mut out = text[..1].to_uppercase();
        out.push_str(&text[1..]);
        return out;
    }
    text.to_string()
}

fn cap(text: &str) -> String {
    match_case("X", text)
}

// ---------------------------------------------------------------- rules

pub struct Hit {
    from: isize,
    to: isize,
    sugg: Vec<String>,
    msg: Option<String>,
    kind: Option<LintKind>,
}

fn hit(from: isize, to: isize, sugg: impl Into<String>) -> Option<Hit> {
    Some(Hit { from, to, sugg: vec![sugg.into()], msg: None, kind: None })
}

fn hit_msg(from: isize, to: isize, sugg: impl Into<String>, msg: impl Into<String>) -> Option<Hit> {
    Some(Hit { from, to, sugg: vec![sugg.into()], msg: Some(msg.into()), kind: None })
}

type Check = Box<dyn Fn(&Sent, isize, &Ctx) -> Option<Hit>>;

pub struct Rule {
    pub name: &'static str,
    kind: LintKind,
    msg: &'static str,
    check: Check,
}

fn rule(name: &'static str, kind: LintKind, msg: &'static str, check: impl Fn(&Sent, isize, &Ctx) -> Option<Hit> + 'static) -> Rule {
    Rule { name, kind, msg, check: Box::new(check) }
}

// Fixed phrases. Each pattern element is a word ("a|b" alternatives), "-" (a hyphen), "-?" (optional hyphen) or ",".
type Fix = fn(&[String]) -> Vec<String>;

fn one(s: &str) -> Vec<String> {
    vec![s.to_string()]
}

const PHRASES: &[(LintKind, &str, Fix, &str)] = &[
    // Redundancies
    (LintKind::Redundancy, "free gift", |_| one("gift"), "A gift is free by definition."),
    (LintKind::Redundancy, "advance planning", |_| one("planning"), "Planning is always done in advance."),
    (LintKind::Redundancy, "unexpected surprise", |_| one("surprise"), "A surprise is unexpected by definition."),
    (LintKind::Redundancy, "end result", |_| one("result"), "A result is already the end."),
    (LintKind::Redundancy, "final outcome", |_| one("outcome"), "An outcome is already final."),
    (LintKind::Redundancy, "true fact", |_| one("fact"), "A fact is true by definition."),
    (LintKind::Redundancy, "close proximity", |_| one("proximity"), "Proximity already means closeness."),
    (LintKind::Redundancy, "added bonus", |_| one("bonus"), "A bonus is something added."),
    (LintKind::Redundancy, "past history", |_| one("history"), "History is always in the past."),
    (LintKind::Redundancy, "basic fundamentals", |_| one("fundamentals"), "Fundamentals are basic by definition."),
    (LintKind::Redundancy, "new innovation|innovations", |w| one(&w[1]), "An innovation is new by definition."),
    (LintKind::Redundancy, "first began", |_| one("began"), "\u{201c}Began\u{201d} already means it was the first time."),
    (LintKind::Redundancy, "combine|combines|combined|combining together", |w| one(&w[0]), "\u{201c}Combine\u{201d} already means to bring together."),
    (LintKind::Redundancy, "join|joins|joined|joining together", |w| one(&w[0]), "\u{201c}Join\u{201d} already means to bring together."),
    (LintKind::Redundancy, "merge|merges|merged|merging together", |w| one(&w[0]), "\u{201c}Merge\u{201d} already means to bring together."),
    (LintKind::Redundancy, "collaborate|collaborates|collaborated|collaborating together", |w| one(&w[0]), "\u{201c}Collaborate\u{201d} already means to work together."),
    (LintKind::Redundancy, "reply|replies|replied|replying back", |w| one(&w[0]), "\u{201c}Reply\u{201d} already means to answer back."),
    (LintKind::Redundancy, "return|returns|returned|returning back", |w| one(&w[0]), "\u{201c}Return\u{201d} already means to go or give back."),
    (LintKind::Redundancy, "revert|reverts|reverted|reverting back", |w| one(&w[0]), "\u{201c}Revert\u{201d} already means to go back."),
    (LintKind::Redundancy, "repeat|repeats|repeated|repeating again", |w| one(&w[0]), "\u{201c}Repeat\u{201d} already means to do again."),
    (LintKind::Redundancy, "the reason is|was because", |w| vec![format!("the reason {} that", w[2])], "\u{201c}The reason is\u{201d} and \u{201c}because\u{201d} say the same thing."),
    (LintKind::Redundancy, "the reason why is|was because", |w| vec![format!("the reason {} that", w[3])], "\u{201c}The reason is\u{201d} and \u{201c}because\u{201d} say the same thing."),
    // Usage
    (LintKind::Usage, "in regards to", |_| vec!["in regard to".into(), "regarding".into()], "The standard phrase is \u{201c}in regard to\u{201d} (or \u{201c}regarding\u{201d})."),
    (LintKind::Usage, "based off of", |_| one("based on"), "The standard phrase is \u{201c}based on\u{201d}."),
    (LintKind::Usage, "mostly everyone|everybody|everything", |w| vec![format!("almost {}", w[1])], "Use \u{201c}almost\u{201d} with \u{201c}everyone\u{201d}, \u{201c}everybody\u{201d} and \u{201c}everything\u{201d}."),
    (LintKind::Usage, "could care less", |_| one("couldn't care less"), "The idiom is \u{201c}couldn't care less\u{201d}: you care so little it can't get lower."),
    (LintKind::Usage, "first -? come , first -? serve", |_| one("first-come, first-served"), "The phrase is \u{201c}first-come, first-served\u{201d}."),
    // Eggcorns: mishearings of idioms
    (LintKind::Eggcorn, "nip|nipped|nipping it in the butt", |w| vec![format!("{} it in the bud", w[0])], "The idiom is \u{201c}nip it in the bud\u{201d}, like stopping a flower before it opens."),
    (LintKind::Eggcorn, "deep -? seeded", |_| one("deep-seated"), "The phrase is \u{201c}deep-seated\u{201d} (firmly established)."),
    (LintKind::Eggcorn, "slight of hand", |_| one("sleight of hand"), "The phrase is \u{201c}sleight of hand\u{201d}."),
    (LintKind::Eggcorn, "peace of cake", |_| one("piece of cake"), "The idiom is \u{201c}piece of cake\u{201d}."),
    (
        LintKind::Eggcorn,
        "biting|bite|bit my|your|his|her|our|their time",
        |w| {
            let v = match w[0].as_str() {
                "biting" => "biding",
                "bite" => "bide",
                _ => "bided",
            };
            vec![format!("{v} {} time", w[1])]
        },
        "The idiom is \u{201c}bide your time\u{201d} (wait patiently).",
    ),
    (LintKind::Eggcorn, "by in large", |_| one("by and large"), "The idiom is \u{201c}by and large\u{201d}."),
    (LintKind::Eggcorn, "hunger pains", |_| one("hunger pangs"), "The phrase is \u{201c}hunger pangs\u{201d}."),
    (LintKind::Eggcorn, "pass|passes|passed|passing mustard", |w| vec![format!("{} muster", w[0])], "The idiom is \u{201c}pass muster\u{201d}."),
    (LintKind::Eggcorn, "for granite", |_| one("for granted"), "The phrase is \u{201c}take for granted\u{201d}."),
    (
        LintKind::Eggcorn,
        "tow|tows|towed|towing the line",
        |w| {
            let v = match w[0].as_str() {
                "tow" => "toe",
                "tows" => "toes",
                "towed" => "toed",
                _ => "toeing",
            };
            vec![format!("{v} the line")]
        },
        "The idiom is \u{201c}toe the line\u{201d}.",
    ),
    (LintKind::Eggcorn, "shoe - in", |_| one("shoo-in"), "The word is \u{201c}shoo-in\u{201d} (a sure winner)."),
    (LintKind::Eggcorn, "doggy -? dog world", |_| one("dog-eat-dog world"), "The idiom is \u{201c}dog-eat-dog world\u{201d}."),
    (LintKind::Eggcorn, "thanks god", |_| one("thank God"), "The expression is \u{201c}thank God\u{201d}."),
];

enum Part {
    Words(Vec<&'static str>),
    Hyphen { optional: bool },
    Comma,
}

fn compile_phrase(pattern: &'static str) -> Vec<Part> {
    pattern
        .split(' ')
        .map(|p| match p {
            "-" => Part::Hyphen { optional: false },
            "-?" => Part::Hyphen { optional: true },
            "," => Part::Comma,
            _ => Part::Words(p.split('|').collect()),
        })
        .collect()
}

fn match_phrase(s: &Sent, i: isize, parts: &[Part]) -> Option<(isize, Vec<String>)> {
    let mut j = i;
    let mut words = Vec::new();
    for p in parts {
        match p {
            Part::Hyphen { optional } => {
                if s.hyphen(j) {
                    j += 1;
                } else if !optional {
                    return None;
                }
            }
            Part::Comma => {
                if !s.comma(j) {
                    return None;
                }
                j += 1;
            }
            Part::Words(set) => {
                let w = s.w(j)?;
                if !set.contains(&w) {
                    return None;
                }
                words.push(w.to_string());
                j += 1;
            }
        }
    }
    Some((j - 1, words))
}

fn phrase_rule(name: &'static str, kind: LintKind) -> Rule {
    let rows: Vec<(Vec<Part>, Fix, &'static str)> = PHRASES.iter().filter(|p| p.0 == kind).map(|(_, pat, fix, msg)| (compile_phrase(pat), *fix, *msg)).collect();
    rule(name, kind, "", move |s, i, _| {
        let w = s.w(i)?;
        for (parts, fix, msg) in &rows {
            let Part::Words(first) = &parts[0] else { continue };
            if !first.contains(&w) {
                continue;
            }
            if let Some((to, words)) = match_phrase(s, i, parts) {
                return Some(Hit { from: i, to, sugg: fix(&words), msg: Some((*msg).to_string()), kind: None });
            }
        }
        None
    })
}

pub fn all_rules() -> Vec<Rule> {
    use LintKind as K;
    vec![
        rule("PxWhomComplement", K::Grammar, "Use \u{201c}who\u{201d} here: after \u{201c}I am\u{201d}, \u{201c}you are\u{201d} and so on, the pronoun is not an object.", |s, i, _| {
            if !s.word_is(i, "whom") {
                return None;
            }
            let ok = (s.is(i + 1, SUBJ) && s.is(i + 2, "am|is|are|was|were") && s.stop(i + 3)) || (s.is(i + 1, "i'm|you're|he's|she's|it's|we're|they're") && s.stop(i + 2));
            if ok { hit(i, i, "who") } else { None }
        }),
        rule("PxObjectPronounAfterPreposition", K::Grammar, "After a preposition like \u{201c}between\u{201d}, \u{201c}to\u{201d} or \u{201c}for\u{201d}, use \u{201c}me\u{201d}, not \u{201c}I\u{201d}.", |s, i, _| {
            if !s.is(i, "between|to|for|with|from|about|like|at|by|among|against|without|behind|except|toward|towards") {
                return None;
            }
            let mut j = i + 2;
            while j <= i + 4 && j < s.n() {
                if !s.word_is(j, "and") {
                    j += 1;
                    continue;
                }
                for m in i + 1..j {
                    if !s.upos(m, &[PRON, NOUN, PROPN, DET, ADJ, NUM]) || s.is(m, "who|which|that|what") {
                        return None;
                    }
                }
                if !s.word_is(j + 1, "i") {
                    return None;
                }
                let next = j + 2;
                let ok = s.end(next) || (s.comma(next) && s.start(i)) || s.k(next).is_some_and(|k| k.is_word() && !k.is_verb() && !k.is_auxiliary_verb());
                return if ok { hit(j + 1, j + 1, "me") } else { None };
            }
            None
        }),
        rule("PxCompoundSubjectPronoun", K::Grammar, "", |s, i, _| {
            if !s.start(i) || !s.is(i, "me|him|her|them|us|myself|i") || !s.word_is(i + 1, "and") {
                return None;
            }
            let a = s.w(i)?.to_string();
            let mut b = i + 2;
            let b_text: String;
            let mut b_is_pronoun = false;
            if s.is(b, "me|him|her|them|us|i|he|she|they|we|you|myself") {
                let wb = s.w(b)?;
                b_text = to_subj(if wb == "myself" { "me" } else { wb })?.to_string();
                b_is_pronoun = true;
            } else {
                let mut e = b;
                while e < b + 3 && (s.upos(e, &[DET, ADJ, NOUN, PROPN, NUM]) || s.is(e, "my|your|his|her|our|their")) && !s.is(e, "who|which|that") {
                    e += 1;
                }
                if e == b || !s.upos(e - 1, &[NOUN, PROPN]) {
                    return None;
                }
                b_text = s.text(b, e - 1);
                b = e - 1;
            }
            let v = b + 1;
            if !s.upos(v, &[VERB, AUX]) || s.k(v)?.is_verb_progressive_form() {
                return None;
            }
            if a == "i" && !b_is_pronoun {
                // "I and my wife went": correct case, but convention puts "I" last.
                return Some(Hit {
                    from: i,
                    to: b,
                    sugg: vec![format!("{} and I", cap(&b_text))],
                    msg: Some("Put yourself last: \u{201c}my wife and I\u{201d}, not \u{201c}I and my wife\u{201d}.".into()),
                    kind: Some(K::Style),
                });
            }
            let wb = s.w(b).unwrap_or("");
            if a == "i" && to_subj(wb) == Some(wb) {
                return None; // "I and he": already subject case
            }
            if b_is_pronoun && to_subj(wb) == Some(wb) && to_subj(&a) == Some(a.as_str()) {
                return None;
            }
            let a_subj = to_subj(&a)?.to_string();
            let parts: [String; 2] = if a_subj == "I" {
                [b_text, "I".into()]
            } else if b_text == "I" {
                [a_subj, "I".into()]
            } else {
                [a_subj, b_text]
            };
            let first = if parts[0] == "I" { "I".to_string() } else { cap(&parts[0]) };
            let sugg = format!("{first} and {}", parts[1]);
            if sugg.to_lowercase() == s.text(i, b).to_lowercase() {
                return None;
            }
            hit_msg(i, b, sugg, "Use subject pronouns (I, he, she, we, they) for the people doing the action, and put \u{201c}I\u{201d} last.")
        }),
        rule("PxLessFewer", K::Usage, "Use \u{201c}fewer\u{201d} with things you can count (\u{201c}fewer people\u{201d}), and \u{201c}less\u{201d} with amounts (\u{201c}less water\u{201d}).", |s, i, _| {
            if s.word_is(i, "less") && s.plural(i + 1) { hit(i, i, "fewer") } else { None }
        }),
        rule("PxMuchMany", K::Usage, "Use \u{201c}many\u{201d} with things you can count (\u{201c}many people\u{201d}), and \u{201c}much\u{201d} with amounts (\u{201c}much water\u{201d}).", |s, i, _| {
            if s.word_is(i, "much") && s.plural(i + 1) && !s.word_is(i + 1, "thanks") { hit(i, i, "many") } else { None }
        }),
        rule("PxAmountNumber", K::Usage, "Use \u{201c}number of\u{201d} with things you can count, and \u{201c}amount of\u{201d} with things you can't.", |s, i, _| {
            if !s.word_is(i, "amount") || !s.word_is(i + 1, "of") {
                return None;
            }
            let n = if s.upos(i + 2, &[ADJ]) { i + 3 } else { i + 2 };
            if s.plural(n) { hit(i, i, "number") } else { None }
        }),
        rule("PxWhoseWhos", K::WordChoice, "", |s, i, _| {
            if s.word_is(i, "whose") && s.is(i + 1, "going|coming|doing|leaving|been|gonna|got|the|a|an|there|that|this|next|ready|here|not|never|always|still") {
                return hit_msg(i, i, "who's", "\u{201c}Who's\u{201d} means \u{201c}who is\u{201d} or \u{201c}who has\u{201d}; \u{201c}whose\u{201d} shows ownership.");
            }
            if s.is(i, "who's") && s.upos(i + 1, &[NOUN]) && s.is(i + 2, "is|was|are|were|do|does|did|will|can|should|would|could|has|had") {
                return hit_msg(i, i, "whose", "To ask who owns something, use \u{201c}whose\u{201d} (\u{201c}whose car is this?\u{201d}).");
            }
            None
        }),
        rule("PxPronounParticiple", K::Grammar, "\u{201c}Seen\u{201d}, \u{201c}done\u{201d}, \u{201c}been\u{201d} and \u{201c}gone\u{201d} need \u{201c}have\u{201d}, or use the simple past (\u{201c}saw\u{201d}, \u{201c}did\u{201d}, \u{201c}went\u{201d}).", |s, i, _| {
            if !s.is(i, SUBJ) || !s.is(i + 1, "seen|done|been|gone") {
                return None;
            }
            if !(s.start(i) || s.is(i - 1, CONJ)) {
                return None;
            }
            let has = if s.is(i, "he|she|it") { "has" } else { "have" };
            let part = s.w(i + 1)?;
            let mut sugg = Vec::new();
            if let Some(past) = match part {
                "seen" => Some("saw"),
                "done" => Some("did"),
                "gone" => Some("went"),
                _ => None,
            } {
                sugg.push(past.to_string());
            }
            sugg.push(format!("{has} {part}"));
            Some(Hit { from: i + 1, to: i + 1, sugg, msg: None, kind: None })
        }),
        rule("PxModalBaseVerb", K::Grammar, "After \u{201c}can\u{201d}, \u{201c}could\u{201d}, \u{201c}should\u{201d}, \u{201c}must\u{201d} and similar, use the base form of the verb.", |s, i, ctx| {
            if !s.is(i, "can|could|should|would|must|might|may|can't|cannot|couldn't|shouldn't|wouldn't|mustn't") {
                return None;
            }
            if s.is(i - 1, DETERMINERS) || (s.word_is(i, "might") && s.start(i)) {
                return None;
            }
            let k = s.k(i + 1)?;
            if !k.is_word() || !s.upos(i + 1, &[VERB, AUX]) || k.is_verb_lemma() {
                return None;
            }
            if !k.is_verb_third_person_singular_present_form() && !k.is_verb_simple_past_form() {
                return None;
            }
            if k.is_verb_past_participle_form() && !k.is_verb_simple_past_only() && !k.is_verb_third_person_singular_present_form() {
                return None;
            }
            let lemma = ctx.lemma_of(s.w(i + 1)?, k)?;
            hit(i + 1, i + 1, lemma)
        }),
        rule("PxDoBaseVerb", K::Grammar, "After \u{201c}do\u{201d}, \u{201c}does\u{201d} or \u{201c}doesn't\u{201d}, use the base form of the verb.", |s, i, ctx| {
            if !s.is(i, "do|does|did|don't|doesn't|didn't") || s.is(i - 1, "to|will|would|can|could|should|must|might|may") {
                return None;
            }
            // Without a pronoun in between, only the negative forms are clearly auxiliaries ("doesn't has").
            let v = if s.is(i + 1, SUBJ) {
                i + 2
            } else if s.is(i, "don't|doesn't|didn't") {
                i + 1
            } else {
                return None;
            };
            let k = s.k(v)?;
            if !k.is_word() || !k.is_verb_third_person_singular_present_form() || k.is_verb_lemma() || !s.upos(v, &[VERB, AUX]) {
                return None;
            }
            let lemma = ctx.lemma_of(s.w(v)?, k)?;
            if lemma == "be" { None } else { hit(v, v, lemma) }
        }),
        rule("PxModalTo", K::Grammar, "Modal verbs like \u{201c}can\u{201d} and \u{201c}must\u{201d} are followed directly by the verb, without \u{201c}to\u{201d}.", |s, i, _| {
            if !s.is(i, "can|could|must|should|might|will|would|may") || !s.word_is(i + 1, "to") || !s.base_verb(i + 2) {
                return None;
            }
            if s.is(i - 1, DETERMINERS) {
                return None; // "the will to live"
            }
            hit(i, i + 1, s.raw(i))
        }),
        rule("PxMakeSomeoneDo", K::Grammar, "\u{201c}Make someone do something\u{201d} takes the verb without \u{201c}to\u{201d}.", |s, i, _| {
            if !s.is(i, "make|makes|made|making") || !s.is(i + 1, OBJ_YOU) || !s.word_is(i + 2, "to") || !s.base_verb(i + 3) {
                return None;
            }
            hit(i, i + 2, format!("{} {}", s.raw(i), s.raw(i + 1)))
        }),
        rule("PxSuggestSomeoneTo", K::Grammar, "\u{201c}Suggest\u{201d} and \u{201c}recommend\u{201d} don't take \u{201c}someone to do\u{201d}: say \u{201c}I suggest you go\u{201d} or \u{201c}I suggest going\u{201d}.", |s, i, _| {
            if !s.is(i, "suggest|suggests|suggested|recommend|recommends|recommended") || !s.is(i + 1, OBJ_YOU) || !s.word_is(i + 2, "to") || !s.base_verb(i + 3) {
                return None;
            }
            hit(i, i + 3, format!("{} {} {}", s.raw(i), s.raw(i + 1), s.raw(i + 3)))
        }),
        rule("PxGerundAfterVerb", K::Grammar, "This verb is followed by the -ing form, not by \u{201c}to\u{201d}.", |s, i, ctx| {
            if !s.is(i, "enjoy|enjoys|enjoyed|enjoying|avoid|avoids|avoided|avoiding|finish|finishes|finished|finishing|mind|minds|minded|suggest|suggests|suggested|suggesting|recommend|recommends|recommended|deny|denies|denied|denying|quit|quits|quitting|postpone|postpones|postponed|imagine|imagines|imagined|practise|practises|practised") {
                return None;
            }
            if !s.word_is(i + 1, "to") || !s.base_verb(i + 2) || s.is(i - 1, DETERMINERS) || s.is(i - 1, "be|is|are|was|were|been|being") {
                return None;
            }
            let ing = ctx.ing_form(s.w(i + 2)?)?;
            hit(i + 1, i + 2, ing)
        }),
        rule("PxForwardToIng", K::Grammar, "In \u{201c}look forward to\u{201d}, \u{201c}to\u{201d} is a preposition, so it takes the -ing form.", |s, i, ctx| {
            if !s.is(i, "look|looks|looked") || !s.word_is(i + 1, "forward") || !s.word_is(i + 2, "to") || !s.base_verb(i + 3) {
                return None;
            }
            let ing = ctx.ing_form(s.w(i + 3)?)?;
            hit(i + 3, i + 3, ing)
        }),
        rule("PxUsedToIng", K::Grammar, "\u{201c}Be used to\u{201d} (accustomed to) takes the -ing form: \u{201c}I'm used to working late\u{201d}.", |s, i, ctx| {
            if !s.word_is(i, "used") || !s.word_is(i + 1, "to") || !s.base_verb(i + 2) {
                return None;
            }
            let ok = s.is(i - 1, "i'm|you're|we're|they're|he's|she's|get|gets|got|getting")
                || (s.is(i - 1, "am|are|is|was|were") && s.is(i - 2, PERSON_SUBJ))
                || (s.is(i - 1, "be|been") && s.is(i - 2, "will|to|have|has|had|'ve|never|not"));
            if !ok || s.w(i - 1).is_none() {
                return None;
            }
            let ing = ctx.ing_form(s.w(i + 2)?)?;
            hit(i + 2, i + 2, ing)
        }),
        rule("PxExplainToMe", K::Grammar, "\u{201c}Explain\u{201d} needs \u{201c}to\u{201d} before the person: \u{201c}explain to me\u{201d}.", |s, i, _| {
            if !s.is(i, "explain|explains|explained|explaining") || !s.is(i + 1, "me|us") {
                return None;
            }
            hit(i, i + 1, format!("{} to {}", s.raw(i), s.raw(i + 1)))
        }),
        rule("PxSaidToMe", K::Grammar, "\u{201c}Say\u{201d} needs \u{201c}to\u{201d} before the person (\u{201c}said to me\u{201d}), or use \u{201c}tell\u{201d} (\u{201c}told me\u{201d}).", |s, i, _| {
            if !s.is(i, "say|says|said") || !s.is(i + 1, "me|us|him") {
                return None;
            }
            let tell = match s.w(i)? {
                "say" => "tell",
                "says" => "tells",
                _ => "told",
            };
            Some(Hit {
                from: i,
                to: i + 1,
                sugg: vec![format!("{tell} {}", s.raw(i + 1)), format!("{} to {}", s.raw(i), s.raw(i + 1))],
                msg: None,
                kind: None,
            })
        }),
        rule("PxPastPassed", K::WordChoice, "The verb is \u{201c}passed\u{201d}. \u{201c}Past\u{201d} is a noun, adjective or preposition.", |s, i, _| {
            if !s.word_is(i + 1, "past") {
                return None;
            }
            let after_obj = s.is(i + 2, DETERMINERS) || s.is(i + 2, "it|me|him|them|us");
            if s.is(i, PERSON_SUBJ) && after_obj && (s.start(i) || s.is(i - 1, CONJ)) {
                return hit(i + 1, i + 1, "passed");
            }
            if s.is(i, "has|have|had|i've|you've|we've|they've") && (s.end(i + 2) || after_obj) {
                return hit(i + 1, i + 1, "passed");
            }
            None
        }),
        rule("PxUsedTo", K::Grammar, "For a past habit, write \u{201c}used to\u{201d}.", |s, i, _| {
            if !s.is(i, SUBJ) || !s.word_is(i + 1, "use") || !s.word_is(i + 2, "to") || !s.base_verb(i + 3) {
                return None;
            }
            if s.is(i - 1, "do|does|did|didn't|doesn't|don't|never") {
                return None; // "did you use to"
            }
            hit(i + 1, i + 1, "used")
        }),
        rule("PxYoureWelcome", K::WordChoice, "The reply to \u{201c}thank you\u{201d} is \u{201c}you're welcome\u{201d} (you are welcome).", |s, i, _| {
            if !s.start(i) || !s.is(i, "your|ur|youre") || !s.word_is(i + 1, "welcome") || !(s.stop(i + 2) || (s.word_is(i + 2, "to") && s.base_verb(i + 3))) {
                return None;
            }
            hit(i, i, "you're")
        }),
        rule("PxOfPluralAgreement", K::Agreement, "The subject is \u{201c}each\u{201d}, \u{201c}one\u{201d}, \u{201c}either\u{201d} or \u{201c}neither\u{201d}, which is singular.", |s, i, _| {
            let of = if s.word_is(i, "every") && s.word_is(i + 1, "one") {
                i + 2
            } else if s.is(i, "each|one|either|neither") {
                i + 1
            } else {
                return None;
            };
            if s.word_is(i, "one") && s.word_is(i + 1, "one") {
                return None;
            }
            if !s.word_is(of, "of") {
                return None;
            }
            let mut j = of + 1;
            while j <= of + 4 && j < s.n() {
                if let Some(sv) = s.w(j).and_then(singular_verb) {
                    let last = j - 1;
                    if last <= of {
                        return None;
                    }
                    let last_plural = s.is(last, "them|us|you|these|those") || s.k(last).is_some_and(|k| k.is_plural_nominal());
                    return if last_plural { hit(j, j, sv) } else { None };
                }
                if !s.upos(j, &[DET, ADJ, NOUN, PRON, PROPN, NUM]) || s.is(j, "who|which|that|whom|whose") {
                    return None;
                }
                j += 1;
            }
            None
        }),
        rule("PxIndefinitePronounAgreement", K::Agreement, "Words like \u{201c}everyone\u{201d}, \u{201c}someone\u{201d} and \u{201c}nobody\u{201d} are singular.", |s, i, _| {
            if !s.is(i, "everyone|everybody|someone|somebody|anyone|anybody|nobody|everything|something|nothing|anything") {
                return None;
            }
            let sv = s.w(i + 1).and_then(singular_verb)?;
            if s.is(i - 1, AUX_BEFORE) || s.upos(i - 1, &[VERB, AUX]) {
                return None; // "does anyone have", "let everyone have"
            }
            hit(i + 1, i + 1, sv)
        }),
        rule("PxThereArePlural", K::Agreement, "The noun after \u{201c}there is\u{201d} is plural, so use \u{201c}there are\u{201d}.", |s, i, _| {
            let (q, from, to, sugg) = if s.is(i, "there|here") && s.is(i + 1, "is|was") {
                (i + 2, i + 1, i + 1, if s.word_is(i + 1, "is") { "are" } else { "were" })
            } else if s.is(i, "there's|here's") {
                (i + 1, i, i, if s.word_is(i, "there's") { "there are" } else { "here are" })
            } else {
                return None;
            };
            let many = s.is(q, "many|several|numerous|various|both|two|three|four|five|six|seven|eight|nine|ten|dozens|hundreds|thousands|millions") || (s.word_is(q, "a") && s.word_is(q + 1, "few"));
            let bare = s.plural(q) && !s.word_is(q, "lots");
            if many || bare { hit(from, to, sugg) } else { None }
        }),
        rule("PxIrregularPluralAgreement", K::Agreement, "This noun is plural, so the verb should be plural too.", |s, i, _| {
            if !s.is(i, "children|people|men|women|feet|teeth|mice|geese|police|cattle") {
                return None;
            }
            let pv = s.w(i + 1).and_then(plural_verb)?;
            let det = s.is(i - 1, "the|these|those|my|our|your|their|his|her|some|many|all|most|no|other");
            let ok = if det { !s.word_is(i - 2, "of") && !s.word_is(i - 3, "of") } else { s.start(i) };
            if ok { hit(i + 1, i + 1, pv) } else { None }
        }),
        rule("PxDemonstrativeNumber", K::Agreement, "", |s, i, _| {
            if s.word_is(i, "this") && s.plural(i + 1) && !s.k(i + 1)?.is_verb() {
                return hit_msg(i, i, "these", "Use \u{201c}these\u{201d} with plural nouns.");
            }
            if s.is(i, "these|those") && s.singular(i + 1) && !s.is(i + 1, "kind|type|sort") && (s.is(i + 2, "is|was|has|does|isn't|wasn't|hasn't|doesn't") || s.end(i + 2)) {
                let r = if s.word_is(i, "these") { "this" } else { "that" };
                return hit_msg(i, i, r, format!("Use \u{201c}{r}\u{201d} with singular nouns."));
            }
            None
        }),
        rule("PxInterestedIn", K::WordChoice, "Describe how a person feels with -ed (\u{201c}interested\u{201d}, \u{201c}excited\u{201d}); -ing describes what causes the feeling.", |s, i, _| {
            let be = s.is(i, "i'm|you're|we're|they're|he's|she's") || (s.is(i, "am|are|is|was|were") && s.is(i - 1, PERSON_SUBJ));
            if !be {
                return None;
            }
            if s.word_is(i + 1, "interesting") && s.word_is(i + 2, "in") {
                return hit(i + 1, i + 1, "interested");
            }
            if s.word_is(i + 1, "exciting") && s.is(i + 2, "about|for") {
                return hit(i + 1, i + 1, "excited");
            }
            None
        }),
        rule("PxMarriedTo", K::Usage, "You are married \u{201c}to\u{201d} someone (\u{201c}married with\u{201d} means having, as in \u{201c}married with children\u{201d}).", |s, i, _| {
            if !s.word_is(i, "married") || !s.word_is(i + 1, "with") {
                return None;
            }
            let person = s.is(i + 2, "him|me|you|us") || (s.upos(i + 2, &[PROPN]) && s.raw(i + 2).chars().next().is_some_and(|c| c.is_ascii_uppercase()));
            if person { hit(i + 1, i + 1, "to") } else { None }
        }),
        rule("PxBorrowLend", K::WordChoice, "You \u{201c}lend\u{201d} something to someone; you \u{201c}borrow\u{201d} something from someone.", |s, i, _| {
            if s.is(i, "borrow|borrows|borrowed|borrowing") && s.is(i + 1, OBJ_YOU) && (s.is(i + 2, "my|your|his|her|our|their|a|an|the|some|this|that") || s.k(i + 2).is_some_and(|k| k.is_number())) {
                let l = match s.w(i)? {
                    "borrow" => "lend",
                    "borrows" => "lends",
                    "borrowed" => "lent",
                    _ => "lending",
                };
                return hit(i, i, l);
            }
            if s.is(i, "i|we") && s.word_is(i + 1, "lend") && s.is(i + 2, "your|his|her|their") && s.upos(i + 3, &[NOUN]) && s.stop(i + 4) {
                return hit(i + 1, i + 1, "borrow");
            }
            None
        }),
        rule("PxFeelBad", K::Usage, "\u{201c}Feel\u{201d} describes a state, so it takes the adjective \u{201c}bad\u{201d}.", |s, i, _| {
            if !s.is(i, "feel|feels|felt|feeling") || !s.word_is(i + 1, "badly") {
                return None;
            }
            if s.stop(i + 2) || s.is(i + 2, "about|for|that") { hit(i + 1, i + 1, "bad") } else { None }
        }),
        rule("PxLieDown", K::WordChoice, "To recline is \u{201c}lie down\u{201d}; \u{201c}lay\u{201d} needs an object (\u{201c}lay the book down\u{201d}).", |s, i, _| {
            if s.word_is(i, "lay") && s.word_is(i + 1, "down") && s.stop(i + 2) && (s.start(i) || s.is(i - 1, "to|will|can|could|should|must|might|i'll|we'll|you'll|he'll|she'll|they'll|gonna|wanna|let's|please")) {
                return hit(i, i, "lie");
            }
            if s.word_is(i, "laying") && s.word_is(i + 1, "down") && s.stop(i + 2) && s.is(i - 1, "i'm|you're|we're|they're|he's|she's|am|is|are|was|were|been|be|keep") {
                return hit(i, i, "lying");
            }
            None
        }),
        rule("PxWhereAt", K::Style, "\u{201c}Where\u{201d} already asks about a place, so the final \u{201c}at\u{201d} is unnecessary.", |s, i, _| {
            if !s.is(i, "where|where's") {
                return None;
            }
            let mut j = if s.word_is(i, "where") {
                if s.is(i + 1, "is|are|was|were") { i + 2 } else { return None }
            } else {
                i + 1
            };
            let start_np = j;
            while j < start_np + 3 && s.upos(j, &[PRON, DET, NOUN, PROPN, ADJ]) && !s.word_is(j, "at") {
                j += 1;
            }
            if j == start_np || !s.word_is(j, "at") || !s.question(j + 1) {
                return None;
            }
            hit(j - 1, j, s.raw(j - 1))
        }),
        rule("PxDoYouCan", K::Grammar, "Modal verbs form questions on their own: \u{201c}Can you help me?\u{201d}.", |s, i, _| {
            if !s.is(i, "do|does") || !s.is(i + 1, SUBJ) || !s.is(i + 2, "can|could|must|should|will|would") {
                return None;
            }
            let pron = if s.word_is(i + 1, "i") { "I" } else { s.w(i + 1)? };
            hit(i, i + 2, match_case(s.raw(i), &format!("{} {pron}", s.w(i + 2)?)))
        }),
        rule("PxItHas", K::Agreement, "\u{201c}It\u{201d} takes \u{201c}has\u{201d}.", |s, i, _| {
            // Not "were": "as if it were" is fine.
            if !s.word_is(i, "it") || !s.is(i + 1, "have|haven't|are|aren't") {
                return None;
            }
            if !(s.start(i) || s.is(i - 1, CONJ)) {
                return None;
            }
            let r = match s.w(i + 1)? {
                "have" => "has",
                "haven't" => "hasn't",
                "are" => "is",
                _ => "isn't",
            };
            hit(i + 1, i + 1, r)
        }),
        rule("PxAverseTo", K::WordChoice, "A person who dislikes something is \u{201c}averse\u{201d} to it; \u{201c}adverse\u{201d} means harmful (\u{201c}adverse effects\u{201d}).", |s, i, _| {
            if !s.word_is(i, "adverse") || !s.word_is(i + 1, "to") {
                return None;
            }
            if s.is(i - 1, "not|am|is|are|was|were|be|been|i'm|you're|we're|they're|he's|she's|never|very|so|too") { hit(i, i, "averse") } else { None }
        }),
        rule("PxOnTheOtherHand", K::Usage, "The phrase is \u{201c}on the other hand\u{201d}.", |s, i, _| {
            if !s.start(i) || !s.word_is(i, "in") || !s.word_is(i + 1, "the") || !s.word_is(i + 2, "other") || !s.word_is(i + 3, "hand") || !s.comma(i + 4) {
                return None;
            }
            hit(i, i, "on")
        }),
        rule("PxAdviceNoun", K::WordChoice, "The noun is \u{201c}advice\u{201d}; \u{201c}advise\u{201d} is the verb.", |s, i, _| {
            if !s.word_is(i, "advise") || !s.is(i - 1, "my|your|his|her|our|their|some|good|bad|great|any|the|this|that|much|of|for|with|no|helpful|useful|expert|legal|medical|financial") {
                return None;
            }
            hit(i, i, "advice")
        }),
        rule("PxPluralNounAgreement", K::Agreement, "The subject is plural, so the verb should be plural too.", |s, i, _| {
            if !s.is(i, "the|my|our|your|their|his|her|these|those|all|both|many|some|most") || !s.plural(i + 1) {
                return None;
            }
            let pv = s.w(i + 2).and_then(plural_verb)?;
            // "the color of the cars is", "my opinion on these matters is": the plural isn't the subject.
            let prep = (s.upos(i - 1, &[ADP]) || s.k(i - 1).is_some_and(|k| k.is_preposition())) && !s.is(i - 1, "but|and|or|so|because|while|when|if|that|since");
            if prep || s.word_is(i - 2, "of") {
                return None;
            }
            hit(i + 2, i + 2, pv)
        }),
        rule("PxTooAdjective", K::WordChoice, "\u{201c}Too\u{201d} means \u{201c}excessively\u{201d}; \u{201c}to\u{201d} is a preposition.", |s, i, _| {
            if !s.word_is(i + 1, "to") || !s.is(i, "is|was|are|were|be|been|it's|that's|he's|she's|i'm|you're|we're|they're|seems|seemed|looks|looked|feel|feels|felt") {
                return None;
            }
            let k = s.k(i + 2)?;
            if !k.is_word() || !k.is_adjective() || s.is(i + 2, "school|church|bed|work|town|home|class|blame|die|live|go|stay") {
                return None;
            }
            if s.stop(i + 3) || s.is(i + 3, "for|to|and|but|that") { hit(i + 1, i + 1, "too") } else { None }
        }),
        rule("PxWellAdverb", K::Usage, "To describe how something was done, use the adverb \u{201c}well\u{201d}.", |s, i, _| {
            if !s.is(i, "played|plays|play|playing|did|does|do|doing|performed|performs|sang|sings|worked|works|cooked|cooks|danced|dances|writes|wrote|drives|drove|ran|runs|swims|swam") || !s.word_is(i + 1, "good") {
                return None;
            }
            if s.stop(i + 2) || s.is(i + 2, "but|and|so|today|yesterday|tonight|too|enough|again") { hit(i + 1, i + 1, "well") } else { None }
        }),
        rule("PxExcitingExiting", K::Spelling, "Did you mean \u{201c}exciting\u{201d}? \u{201c}Exiting\u{201d} means leaving.", |s, i, _| {
            if s.word_is(i, "exiting") && s.is(i - 1, "very|really|so|too|super|quite|pretty|most|more|less|an|how") { hit(i, i, "exciting") } else { None }
        }),
        rule("PxItsAdjective", K::Punctuation, "\u{201c}It's\u{201d} (it is) needs an apostrophe; \u{201c}its\u{201d} shows possession.", |s, i, _| {
            if !s.start(i) || !s.word_is(i, "its") || !s.upos(i + 1, &[ADJ]) || s.k(i + 1)?.is_noun() {
                return None;
            }
            if s.stop(i + 2) || s.is(i + 2, "to|that|for|when|if|because|how|what") { hit(i, i, "it's") } else { None }
        }),
        rule("PxPluralApostrophe", K::Punctuation, "Plurals don't take an apostrophe: \u{201c}questions\u{201d}, not \u{201c}question's\u{201d}.", |s, i, ctx| {
            let w = s.w(i)?;
            if !w.ends_with("'s") || !s.raw(i).chars().next().is_some_and(|c| c.is_ascii_lowercase()) || !s.is(i - 1, "any|some|many|few|several|more|these|those|two|three|four|five") {
                return None;
            }
            // A possessive is followed by its noun ("some girl's bag"); a plural usually isn't.
            if let Some(next) = s.k(i + 1) {
                if !(next.is_sentence_terminator() || next.is_comma() || s.upos(i + 1, &[ADP, VERB, AUX, CCONJ])) {
                    return None;
                }
            }
            let base = &w[..w.len() - 2];
            if !ctx.dict.get_word_metadata_str(base).is_some_and(|m| m.is_noun()) {
                return None;
            }
            let plural = [format!("{base}s"), format!("{base}es")].into_iter().find(|p| ctx.dict.get_word_metadata_str(p).is_some_and(|m| m.is_plural_noun()))?;
            hit(i, i, plural)
        }),
        rule("PxLetsVerb", K::Punctuation, "\u{201c}Let's\u{201d} (let us) needs an apostrophe.", |s, i, _| {
            if s.start(i) && s.word_is(i, "lets") && s.base_verb(i + 1) { hit(i, i, "let's") } else { None }
        }),
        // One rule per group of fixed phrases.
        phrase_rule("PxRedundantPhrases", LintKind::Redundancy),
        phrase_rule("PxCommonPhrases", LintKind::Usage),
        phrase_rule("PxMisheardIdioms", LintKind::Eggcorn),
    ]
}

/// Runs every extra rule over a document.
pub struct Extras {
    rules: Vec<Rule>,
    ctx: Ctx,
}

impl Extras {
    pub fn new(dict: Arc<FstDictionary>) -> Self {
        Extras { rules: all_rules(), ctx: Ctx { dict } }
    }

    pub fn rule_names(&self) -> Vec<&'static str> {
        self.rules.iter().map(|r| r.name).collect()
    }

    /// Lints per rule name, like `LintGroup::organized_lints`.
    pub fn lint(&self, doc: &Document) -> BTreeMap<String, Vec<Lint>> {
        let sentences: Vec<Sent> = doc.iter_sentences().map(|toks| Sent::new(doc, toks)).collect();
        let mut out = BTreeMap::new();
        for rule in &self.rules {
            let mut lints = Vec::new();
            for s in &sentences {
                let mut i = 0;
                while i < s.n() {
                    if let Some(m) = (rule.check)(s, i, &self.ctx) {
                        let orig = s.text(m.from, m.to);
                        let mut suggs: Vec<String> = Vec::new();
                        for t in &m.sugg {
                            let t = match_case(&orig, t);
                            if t != orig && !suggs.contains(&t) {
                                suggs.push(t);
                            }
                        }
                        if !suggs.is_empty() {
                            lints.push(Lint {
                                span: Span::new(s.items[m.from as usize].span.start, s.items[m.to as usize].span.end),
                                lint_kind: m.kind.unwrap_or(rule.kind),
                                suggestions: suggs.into_iter().map(|t| Suggestion::ReplaceWith(t.chars().collect())).collect(),
                                message: m.msg.unwrap_or_else(|| rule.msg.to_string()),
                                ..Default::default()
                            });
                            i = m.to;
                        }
                    }
                    i += 1;
                }
            }
            out.insert(rule.name.to_string(), lints);
        }
        out
    }
}
