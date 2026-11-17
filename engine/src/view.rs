//! Word duels: scoring a player's answers, and what one player sees of a duel.
//! Scores and the answer key stay hidden until you've played.

use serde_json::{Value, json};

pub const POINTS_PER_ANSWER: i64 = 10;

/// Scores `answers` (one option id or null per question) against the duel's `questions` (each has `answerId`).
/// Returns {points, correct, total, results: [bool], answers: [id or null]} (`answers` cleaned up, one per question).
pub fn score(questions: &Value, answers: &Value) -> Value {
    let empty = Vec::new();
    let qs = questions.as_array().unwrap_or(&empty);
    let picked: Vec<Option<i64>> = (0..qs.len()).map(|i| answers.get(i).and_then(Value::as_i64)).collect();
    let results: Vec<bool> = qs.iter().zip(&picked).map(|(q, a)| a.is_some() && *a == q["answerId"].as_i64()).collect();
    let correct = results.iter().filter(|r| **r).count() as i64;
    json!({ "points": correct * POINTS_PER_ANSWER, "correct": correct, "total": qs.len(), "results": results, "answers": picked })
}

fn option_text(q: &Value, id: Option<i64>) -> Value {
    let id = match id {
        Some(id) => id,
        None => return Value::Null,
    };
    q["options"].as_array().and_then(|o| o.iter().find(|x| x["id"].as_i64() == Some(id))).map_or(Value::Null, |x| x["text"].clone())
}

/// `duel`: {code, title, createdAt, creator: {id, name, picture}, questions: [{kind, prompt, pos, gender, options, answerId}]}
/// `subs`: submissions, best first: [{userId, name, picture, answers, points, correct, elapsedMs}]
pub fn duel_view(duel: &Value, subs: &Value, viewer_id: i64) -> Value {
    let empty = Vec::new();
    let subs = subs.as_array().unwrap_or(&empty);
    let questions = duel["questions"].as_array().unwrap_or(&empty);
    let mine = subs.iter().find(|s| s["userId"].as_i64() == Some(viewer_id));
    let reveal = mine.is_some();

    // The questions as players see them: never the answer.
    let public: Vec<Value> = questions
        .iter()
        .map(|q| json!({ "kind": q["kind"], "prompt": q["prompt"], "pos": q["pos"], "gender": q["gender"], "options": q["options"] }))
        .collect();
    let you = match mine {
        Some(s) => json!({ "submitted": true, "points": s["points"], "correct": s["correct"], "elapsedMs": s["elapsedMs"], "answers": s["answers"] }),
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
                o.insert("correct".into(), s["correct"].clone());
                o.insert("elapsedMs".into(), s["elapsedMs"].clone());
            }
            p
        })
        .collect();
    let key = mine.map(|s| {
        Value::Array(
            questions
                .iter()
                .enumerate()
                .map(|(i, q)| {
                    let yours = s["answers"].get(i).and_then(Value::as_i64);
                    json!({
                        "kind": q["kind"],
                        "prompt": q["prompt"],
                        "answer": option_text(q, q["answerId"].as_i64()),
                        "yours": option_text(q, yours),
                        "right": yours.is_some() && yours == q["answerId"].as_i64(),
                    })
                })
                .collect(),
        )
    });
    let decided = reveal && subs.len() >= 2;
    let tie = decided && subs[0]["points"] == subs[1]["points"] && subs[0]["elapsedMs"] == subs[1]["elapsedMs"];
    json!({
        "code": duel["code"],
        "title": duel["title"],
        "count": questions.len(),
        "maxPoints": questions.len() as i64 * POINTS_PER_ANSWER,
        "questions": public,
        "createdAt": duel["createdAt"],
        "creator": { "id": duel["creator"]["id"], "name": duel["creator"]["name"], "picture": duel["creator"]["picture"] },
        "you": you,
        "players": players,
        "winner": if decided { subs[0]["name"].clone() } else { Value::Null },
        "tie": tie,
        "key": key.unwrap_or(Value::Null),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn duel() -> Value {
        json!({ "code": "ABC234", "title": "A1 · Food", "createdAt": 1, "creator": { "id": 1, "name": "A", "picture": null },
            "questions": [
                { "kind": "pick_en", "prompt": "kava", "pos": "noun", "gender": "f", "options": [{ "id": 5, "text": "tea" }, { "id": 7, "text": "coffee" }], "answerId": 7 },
                { "kind": "pick_lt", "prompt": "tea", "pos": "noun", "gender": "f", "options": [{ "id": 5, "text": "arbata" }, { "id": 7, "text": "kava" }], "answerId": 5 }
            ] })
    }

    #[test]
    fn scores_right_answers_only() {
        let d = duel();
        assert_eq!(score(&d["questions"], &json!([7, 5])), json!({ "points": 20, "correct": 2, "total": 2, "results": [true, true], "answers": [7, 5] }));
        assert_eq!(score(&d["questions"], &json!([5, null]))["points"], 0);
        assert_eq!(score(&d["questions"], &json!([7]))["correct"], 1);
        assert_eq!(score(&d["questions"], &json!([7]))["answers"], json!([7, null]));
        assert_eq!(score(&d["questions"], &json!(["x", 5, 9, 9]))["answers"], json!([null, 5]));
        assert_eq!(score(&d["questions"], &json!("junk"))["points"], 0);
    }

    #[test]
    fn hides_answers_and_scores_until_you_play() {
        let d = duel();
        let subs = json!([
            { "userId": 1, "name": "A", "picture": null, "answers": [7, 5], "points": 20, "correct": 2, "elapsedMs": 9 },
            { "userId": 2, "name": "B", "picture": null, "answers": [5, 5], "points": 10, "correct": 1, "elapsedMs": 3 }
        ]);
        let outsider = duel_view(&d, &subs, 3);
        assert_eq!(outsider["key"], Value::Null);
        assert!(outsider["questions"][0].get("answerId").is_none());
        assert_eq!(outsider["questions"][0]["options"][1]["text"], "coffee");
        assert_eq!(outsider["winner"], Value::Null);
        assert!(outsider["players"][0].get("points").is_none());

        let b = duel_view(&d, &subs, 2);
        assert_eq!(b["winner"], "A");
        assert_eq!(b["maxPoints"], 20);
        assert_eq!(b["players"][1]["isYou"], true);
        assert_eq!(b["tie"], false);
        assert_eq!(b["key"][0], json!({ "kind": "pick_en", "prompt": "kava", "answer": "coffee", "yours": "tea", "right": false }));
        assert_eq!(b["key"][1]["right"], true);
    }
}
