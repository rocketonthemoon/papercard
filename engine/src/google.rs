//! Verifies "Sign in with Google" ID tokens (JWT, RS256) against Google's published keys.
//! See https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

use std::cell::RefCell;
use std::time::{Duration, Instant};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::{Deserialize, Serialize};

const CERTS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub name: Option<String>,
    pub email: Option<String>,
    pub picture: Option<String>,
}

thread_local! {
    static KEYS: RefCell<Option<(JwkSet, Instant)>> = const { RefCell::new(None) };
}

fn fetch_keys() -> Result<(JwkSet, Instant), String> {
    let res = ureq::get(CERTS_URL).timeout(Duration::from_secs(5)).call().map_err(|e| format!("couldn't fetch Google's keys: {e}"))?;
    let max_age = res
        .header("cache-control")
        .and_then(|h| h.split(',').find_map(|p| p.trim().strip_prefix("max-age=")?.parse::<u64>().ok()))
        .unwrap_or(3600);
    let set: JwkSet = res.into_json().map_err(|e| format!("bad key set: {e}"))?;
    Ok((set, Instant::now() + Duration::from_secs(max_age)))
}

fn with_key<T>(kid: &str, f: impl Fn(&DecodingKey) -> T) -> Result<T, String> {
    KEYS.with(|cell| {
        let mut cache = cell.borrow_mut();
        let fresh = matches!(&*cache, Some((_, until)) if Instant::now() < *until);
        if !fresh {
            *cache = Some(fetch_keys()?);
        }
        let mut jwk = cache.as_ref().and_then(|(set, _)| set.find(kid).cloned());
        if jwk.is_none() {
            // Google rotates keys; refetch once before giving up.
            *cache = Some(fetch_keys()?);
            jwk = cache.as_ref().and_then(|(set, _)| set.find(kid).cloned());
        }
        let jwk = jwk.ok_or("unknown signing key")?;
        let key = DecodingKey::from_jwk(&jwk).map_err(|e| format!("bad key: {e}"))?;
        Ok(f(&key))
    })
}

/// The token's claims if it is a valid Google ID token for `client_id`.
pub fn verify(token: &str, client_id: &str) -> Result<Claims, String> {
    let header = decode_header(token).map_err(|_| "malformed token".to_string())?;
    if header.alg != Algorithm::RS256 {
        return Err("unexpected algorithm".into());
    }
    let kid = header.kid.ok_or("token has no key id")?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);
    validation.leeway = 60;
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    let data = with_key(&kid, |key| decode::<Claims>(token, key, &validation))?.map_err(|e| match e.kind() {
        jsonwebtoken::errors::ErrorKind::ExpiredSignature => "token expired".to_string(),
        jsonwebtoken::errors::ErrorKind::InvalidAudience => "token is for another app".to_string(),
        jsonwebtoken::errors::ErrorKind::InvalidIssuer => "wrong issuer".to_string(),
        jsonwebtoken::errors::ErrorKind::InvalidSignature => "bad signature".to_string(),
        _ => format!("invalid token: {e}"),
    })?;
    Ok(data.claims)
}
