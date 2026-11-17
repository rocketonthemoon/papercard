//! What one player sees of a duel. Scores and the answer key stay hidden until they've played.

use serde_json::{Value, json};

/// `duel`: {code, title, source, text, lints, createdAt, creator: {id, name, picture}}
/// `subs`: submissions, best first: [{userId, name, picture, text, points, elapsedMs, result}]
pub fn duel_view(duel: &Value, subs: &Value, viewer_id: i64) -> Value {
    let empty = Vec::new();
    let subs = subs.as_array().unwrap_or(&empty);
    let issue_count = duel["lints"].as_array().map_or(0, |a| a.len());
    let mine = subs.iter().find(|s| s["userId"].as_i64() == Some(viewer_id));
    let marks: Vec<Value> = duel["lints"]
        .as_array()
        .map(|a| a.iter().map(|l| json!({ "start16": l["start16"], "end16": l["end16"] })).collect())
        .unwrap_or_default();
    let reveal = mine.is_some();

    let you = match mine {
        Some(s) => json!({ "submitted": true, "text": s["text"], "points": s["points"], "elapsedMs": s["elapsedMs"], "result": s["result"] }),
        None => json!({ "submitted": false }),
    };
    let players: Vec<Value> = subs
        .iter()
        .enumerate()
        .map(|(rank, s)| {
            let mut p = json!({ "name": s["name"], "picture": s["picture"], "isYou": s["userId"].as_i64() == Some(viewer_id) });
            if reveal {
                let o = p.as_object_mut().unwrap();
                o.insert("rank".into(), json!(rank + 1));
                o.insert("points".into(), s["points"].clone());
                o.insert("fixed".into(), s["result"]["fixed"].clone());
                o.insert("introduced".into(), json!(s["result"]["introduced"].as_array().map_or(0, |a| a.len())));
                o.insert("elapsedMs".into(), s["elapsedMs"].clone());
            }
            p
        })
        .collect();
    let decided = reveal && subs.len() >= 2;
    let tie = decided && subs[0]["points"] == subs[1]["points"] && subs[0]["elapsedMs"] == subs[1]["elapsedMs"];
    json!({
        "code": duel["code"],
        "title": duel["title"],
        "source": duel["source"],
        "text": duel["text"],
        "issueCount": issue_count,
        // Where the mistakes are (no messages or fixes), so the text can be underlined before playing.
        "marks": marks,
        "maxPoints": issue_count * 10,
        "createdAt": duel["createdAt"],
        "creator": { "id": duel["creator"]["id"], "name": duel["creator"]["name"], "picture": duel["creator"]["picture"] },
        "you": you,
        "players": players,
        "winner": if decided { subs[0]["name"].clone() } else { Value::Null },
        "tie": tie,
        "answers": if reveal { duel["lints"].clone() } else { Value::Null },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_scores_until_you_play() {
        let duel = json!({ "code": "ABC234", "title": "T", "source": "random", "text": "x", "lints": [{}, {}], "createdAt": 1, "creator": { "id": 1, "name": "A", "picture": null } });
        let subs = json!([
            { "userId": 1, "name": "A", "picture": null, "text": "y", "points": 20, "elapsedMs": 5, "result": { "fixed": 2, "introduced": [] } },
            { "userId": 2, "name": "B", "picture": null, "text": "z", "points": 10, "elapsedMs": 3, "result": { "fixed": 1, "introduced": [] } }
        ]);
        let outsider = duel_view(&duel, &subs, 3);
        assert_eq!(outsider["answers"], Value::Null);
        assert_eq!(outsider["marks"].as_array().unwrap().len(), 2);
        assert!(outsider["marks"][0].get("message").is_none());
        assert_eq!(outsider["winner"], Value::Null);
        assert!(outsider["players"][0].get("points").is_none());
        let b = duel_view(&duel, &subs, 2);
        assert_eq!(b["winner"], "A");
        assert_eq!(b["maxPoints"], 20);
        assert_eq!(b["players"][1]["isYou"], true);
        assert_eq!(b["tie"], false);
    }
}
