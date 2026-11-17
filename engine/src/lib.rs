//! Labas engine, called from the Mongoose (C) server through the functions below.
//! Every function returning `char *` hands over a heap string (JSON unless noted) that the
//! caller frees with `duel_free`, or NULL on failure. See `duelcore.h`.

pub mod google;
pub mod view;
pub mod vocab;

use std::ffi::{CStr, CString, c_char};
use std::panic::{AssertUnwindSafe, catch_unwind};

use base64::Engine as _;
use serde_json::{Value, json};
use sha1::Sha1;
use sha2::{Digest, Sha256};

unsafe fn arg<'a>(p: *const c_char) -> Option<&'a str> {
    if p.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(p) }.to_str().ok()
}

fn out(s: String) -> *mut c_char {
    CString::new(s).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

/// Runs `f`, turning a panic into NULL so it never unwinds into C.
fn guard(f: impl FnOnce() -> Option<String>) -> *mut c_char {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Some(s)) => out(s),
        _ => std::ptr::null_mut(),
    }
}

/// Exercises for `targets_json` (words to practise), with options and tiles drawn from `pool_json`
/// (every word). `mode`: "lesson", "review" or "duel". Returns a JSON array of challenges.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_challenges(targets_json: *const c_char, pool_json: *const c_char, mode: *const c_char) -> *mut c_char {
    let (targets, pool, mode) = unsafe { (arg(targets_json), arg(pool_json), arg(mode)) };
    guard(|| {
        let targets: Vec<vocab::Word> = serde_json::from_str(targets?).ok()?;
        let pool: Vec<vocab::Word> = serde_json::from_str(pool?).ok()?;
        let mode = vocab::Mode::parse(mode?)?;
        let list = vocab::build(&targets, &pool, mode, &mut vocab::Rng::from_os());
        serde_json::to_string(&list).ok()
    })
}

/// Grades a typed answer. `accepted_json`: ["main answer", "alternative", ...]; `others_json`: the other
/// Lithuanian words in the course. Returns {verdict: exact|accents|typo|wrong, correct, expected, confused}.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_grade(accepted_json: *const c_char, others_json: *const c_char, answer: *const c_char, allow_typos: i32) -> *mut c_char {
    let (accepted, others, answer) = unsafe { (arg(accepted_json), arg(others_json), arg(answer)) };
    guard(|| {
        let accepted: Vec<String> = serde_json::from_str(accepted?).ok()?;
        let others: Vec<String> = serde_json::from_str(others.unwrap_or("[]")).unwrap_or_default();
        let g = vocab::grade(&accepted, &others, answer?, allow_typos != 0);
        Some(json!({ "verdict": g.verdict.as_str(), "correct": g.verdict.correct(), "expected": g.expected, "confused": g.confused }).to_string())
    })
}

/// Accepted answers for a word as a JSON array: `lt` plus the `;`-separated `also`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_accepted(lt: *const c_char, also: *const c_char) -> *mut c_char {
    let (lt, also) = unsafe { (arg(lt), arg(also)) };
    guard(|| serde_json::to_string(&vocab::accepted(lt?, also.unwrap_or(""))).ok())
}

/// Scores a duel answer sheet: {points, correct, total, results}.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_score(questions_json: *const c_char, answers_json: *const c_char) -> *mut c_char {
    let (questions, answers) = unsafe { (arg(questions_json), arg(answers_json)) };
    guard(|| {
        let questions: Value = serde_json::from_str(questions?).ok()?;
        let answers: Value = serde_json::from_str(answers?).ok()?;
        Some(view::score(&questions, &answers).to_string())
    })
}

/// What `viewer_id` sees of a duel (see `view::duel_view`).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_view(duel_json: *const c_char, subs_json: *const c_char, viewer_id: i64) -> *mut c_char {
    let (duel, subs) = unsafe { (arg(duel_json), arg(subs_json)) };
    guard(|| {
        let duel: Value = serde_json::from_str(duel?).ok()?;
        let subs: Value = serde_json::from_str(subs?).ok()?;
        Some(view::duel_view(&duel, &subs, viewer_id).to_string())
    })
}

/// Verifies a Google ID token. Returns {"sub","name","email","picture"} or {"error": "..."}.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_verify_google(token: *const c_char, client_id: *const c_char) -> *mut c_char {
    let (token, client_id) = unsafe { (arg(token), arg(client_id)) };
    guard(|| {
        Some(match google::verify(token?, client_id?) {
            Ok(c) => serde_json::to_string(&c).ok()?,
            Err(e) => json!({ "error": e }).to_string(),
        })
    })
}

/// 32 random bytes as base64url (a session token). Plain string, not JSON.
#[unsafe(no_mangle)]
pub extern "C" fn duel_random_token() -> *mut c_char {
    guard(|| {
        let mut buf = [0u8; 32];
        getrandom::getrandom(&mut buf).ok()?;
        Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf))
    })
}

/// Hex SHA-256 of `s`. Plain string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_sha256_hex(s: *const c_char) -> *mut c_char {
    let s = unsafe { arg(s) };
    guard(|| Some(hex(&Sha256::digest(s?.as_bytes()))))
}

/// Hex SHA-1 of `s` (cache keys). Plain string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_sha1_hex(s: *const c_char) -> *mut c_char {
    let s = unsafe { arg(s) };
    guard(|| Some(hex(&Sha1::digest(s?.as_bytes()))))
}

/// Frees a string returned by any `duel_*` function.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_free(s: *mut c_char) {
    if !s.is_null() {
        drop(unsafe { CString::from_raw(s) });
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
