//! Grammar Duel engine, called from the Mongoose (C) server through the functions below.
//! Every function returning `char *` hands over a heap string (JSON unless noted) that the
//! caller frees with `duel_free`, or NULL on failure. See `duelcore.h`.

pub mod engine;
pub mod extras;
pub mod google;
pub mod passages;
pub mod scoring;
pub mod view;

use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char};
use std::panic::{AssertUnwindSafe, catch_unwind};

use base64::Engine as _;
use serde_json::{Value, json};
use sha1::Sha1;
use sha2::{Digest, Sha256};

pub use engine::{Engine, LintOut};

thread_local! {
    static ENGINE: RefCell<Option<Engine>> = const { RefCell::new(None) };
}

fn with_engine<T>(f: impl FnOnce(&mut Engine) -> T) -> T {
    ENGINE.with(|cell| {
        let mut slot = cell.borrow_mut();
        f(slot.get_or_insert_with(Engine::new))
    })
}

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

/// Builds Harper's dictionary and rules. Returns 0 on success.
#[unsafe(no_mangle)]
pub extern "C" fn duel_init() -> i32 {
    match catch_unwind(|| with_engine(|_| ())) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

/// Harper's issues in `text`, as a JSON array.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_lint(text: *const c_char) -> *mut c_char {
    let text = unsafe { arg(text) };
    guard(|| {
        let text = text?;
        serde_json::to_string(&with_engine(|e| e.lint(text))).ok()
    })
}

/// Scores `submission` against `original` (whose issues are `orig_lints_json`). Returns the result JSON.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_score(original: *const c_char, orig_lints_json: *const c_char, submission: *const c_char) -> *mut c_char {
    let (original, orig, submission) = unsafe { (arg(original), arg(orig_lints_json), arg(submission)) };
    guard(|| {
        let (original, submission) = (original?, submission?);
        let orig: Vec<LintOut> = serde_json::from_str(orig?).ok()?;
        let sub = with_engine(|e| e.lint(submission));
        serde_json::to_string(&scoring::score(original, &orig, submission, &sub)).ok()
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

/// The random duel texts: [{"id","title","text"}].
#[unsafe(no_mangle)]
pub extern "C" fn duel_passages() -> *mut c_char {
    guard(|| {
        let list: Vec<Value> = passages::PASSAGES.iter().enumerate().map(|(id, p)| json!({ "id": id, "title": p.title, "text": p.text })).collect();
        Some(Value::Array(list).to_string())
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

/// `text` with the first suggestion of every lint in `lints_json` applied (the "answer" for Learn mode). Plain string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn duel_solution(text: *const c_char, lints_json: *const c_char) -> *mut c_char {
    let (text, lints) = unsafe { (arg(text), arg(lints_json)) };
    guard(|| {
        let lints: Vec<LintOut> = serde_json::from_str(lints?).ok()?;
        Some(scoring::apply_fixes(text?, &lints))
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
