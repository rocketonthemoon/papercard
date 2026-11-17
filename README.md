# Labas: learn Lithuanian words

A vocabulary game for English speakers learning Lithuanian, built around student life in Lithuania (A1 to B1).

- **Learn:** a Duolingo-style path of decks and lessons, with hearts, XP, a daily streak, quests and a leaderboard. Each lesson first asks you to recognise each word (multiple choice, both ways round), then to produce it: type it in Lithuanian, or build a phrase from word tiles.
- **Review:** spaced repetition (SM-2). A learned word comes back a day later, then after 3 days, then at growing gaps. Get it wrong and it starts again.
- **Play:** a word duel. Pick some decks; both players answer the same 10 multiple-choice questions once. Most right answers wins; ties go to the faster player.
- **Admin:** a content editor for decks, lessons and words, plus players' suggestions.

This folder used to hold Grammar Duel, an English grammar game checked by Harper; that version is in git history (tag `grammar-duel`). Labas keeps its app shell, with Harper taken out. The server is one static binary: [Mongoose](https://github.com/cesanta/mongoose) (C) with a small Rust engine linked in.

## Run it

```sh
cp .env.example .env               # then fill in GOOGLE_CLIENT_ID (see below)
podman compose up -d --build       # needs podman-compose or docker-compose installed
```

Open http://localhost:8080 (`PORT` in `.env`). It uses its own compose project (`labas`), database volume (`labas_labas-data`) and session cookie, so it never sees an old Grammar Duel database. Stop the old `grammar-duel` containers first if they still hold the port: `podman compose -p grammar-duel down`.

For local testing without Google, start it with guest logins and a guest admin:

```sh
ALLOW_DEV_LOGIN=1 ADMINS=dev:alice podman compose up -d --build
```

Shell variables override `.env` for that run only. Keep `ALLOW_DEV_LOGIN=0` on a public server.

## The course

`server/seed.json` holds the starter course: 12 decks (5 at A1, 4 at A2, 3 at B1), each with 3–4 lessons, 245 words and phrases in total. It's loaded the first time the server starts with an empty database. After that, the content editor (`#/admin`) is the source of truth.

Each word has:

| field | |
|---|---|
| `lt`, `en` | the Lithuanian and its English meaning. Each `lt` appears once in the course, because each word has its own progress and review schedule. |
| `pos` | `noun`, `verb`, `phrase` or `other`. Phrases are built from tiles; other words are typed. |
| `gender` | for nouns: `m`, `f`, `mpl`, `fpl` (plural-only, e.g. *pinigai*), or empty |
| `also` | other accepted answers, `;`-separated (e.g. *dalintis* for *dalytis*) |
| `note` | shown after answering: a second meaning, a gender trap, a usage tip |

### Grading typed answers

Case, punctuation and extra spaces are ignored. An answer that is right apart from diacritics (ą č ę ė į š ų ū ž) counts, and the player is shown the correct spelling. So does one typo in a 5–9 letter word, or two in a longer one. An answer that is another word in the course is always wrong, even when it's a letter away (*išlipti* for *įlipti*), and the player is told what it means. Phrase tiles must be in the right order.

### Hearts and XP

10 XP per correct answer. A wrong answer in a new lesson costs a heart (5 maximum, one back every 30 minutes). Practising a finished lesson, and reviewing, cost no hearts; practice earns a heart back per correct answer. Reviews earn XP only for words that are due.

### From the original curriculum plan

The words follow the 12-deck curriculum plan, with a few corrections:

- *sniegia* → **sninga** (it's snowing). *perlipti* (climb over) → **persėsti** (to transfer). *lipti* → **įlipti / išlipti** (get on / off).
- *skanauti* → **mėgautis** (to enjoy). *saugoti* (keep, protect) → **išsaugoti** (save a file). *koreguoti* → **taisyti** (to fix).
- *kasos aparatas* (cash register) → **kasa** (checkout). *kambariokas* → **kambario draugas** (*kambariokas* still accepted). *dalintis* → **dalytis** (*dalintis* still accepted).
- Repeats across decks were removed (*mokėti*, *rekomenduoti*, *sąskaita*, *kortelė*, *tikslas*), and two items with unclear meanings were dropped (*grafikas* as a bus timetable, *Keleivio bilietas*).
- Some phrases were made more natural, e.g. *Kuris autobusas važiuoja į centrą?*, *Kur galiu rasti cukraus?*, *Ar taikote studentų nuolaidą?*

The plan's PostgreSQL schema and CLARIN-LT import script aren't used: this app keeps everything in SQLite, and the plan's `determine_deck` (deck by frequency) would scatter the themed decks. A frequency list could later be used to order words within a deck or to suggest new words to admins.

Not done yet: audio (no `audio_url`), and example sentences.

## Setting up Google sign-in

1. Go to https://console.cloud.google.com/apis/credentials.
2. Choose **Create credentials** → **OAuth client ID** → **Web application**, or reuse an existing one.
3. Under **Authorized JavaScript origins**, add the address you use, e.g. `http://localhost:8080`, and your real domain.
4. Put the Client ID in `.env` as `GOOGLE_CLIENT_ID=…` and restart with `podman compose up -d`.

## Deploying with HTTPS

Point a domain at the server, set `DOMAIN`, `BIND=127.0.0.1`, `COOKIE_SECURE=1`, `ALLOW_DEV_LOGIN=0`, `GOOGLE_CLIENT_ID` and `ADMINS` in `.env`, add `https://<DOMAIN>` to the OAuth client's origins, and run `podman compose --profile https up -d --build`. Caddy gets the certificate.

Admins are listed in `ADMINS` (Google emails, or `dev:<name>` for guest logins) and are checked on every request.

## Architecture

```
browser ──▶ app: labas (one static binary)
              Mongoose (C)    web pages, /api, sessions, Learn, duels     server/main.c, server/learn.c
              libduelcore     exercises, grading, duel scoring/view,     engine/ (Rust)
                              Google token checks
              SQLite          users, course, progress, XP, duels ─▶ /data volume
            ──▶ memcached     cache for sessions and duels
```

| Part | What it does |
|---|---|
| `server/main.c` | HTTP, sessions, Google/guest sign-in, word duels (create, view, submit). |
| `server/learn.c` | Learn: the path, lessons, answers, hearts, XP, streaks, SM-2 review, the word list, leaderboard, feedback and the content editor. |
| `engine/src/vocab.rs` | Builds exercises from words (wrong options from the same part of speech and deck first, decoy tiles) and grades typed answers. |
| `engine/src/view.rs` | Duel scoring and what each player sees (answers hidden until you've played). |
| `engine/src/google.rs` | Verifies Google ID tokens (RS256). |
| `web/` | Plain HTML, CSS and JS, no frameworks. |

## Tests

```sh
# Engine unit tests, plus a check of the whole starter course (no duplicates, every phrase rebuildable from
# its tiles, 4 options for every word):
podman run --rm -v "$PWD/engine:/src" -v "$PWD/server:/server:ro" -w /src -e CARGO_TARGET_DIR=/tmp/target \
  docker.io/library/rust:1-alpine sh -c 'apk add musl-dev && cargo test --release'

# With a fresh server running with ALLOW_DEV_LOGIN=1 and ADMINS=dev:alice (needs Node on your machine):
node tests/test_api.mjs http://localhost:8080
node tests/test_browser.mjs http://localhost:8080/ out/ [--mobile] [--light]   # clicks through in headless Chrome
```
