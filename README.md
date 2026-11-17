# Grammar Duel

A grammar game in two parts, checked by Harper:

- **Learn grammar:** a Duolingo-style path of units and lessons, with hearts, XP, a daily streak, quests and a leaderboard. Admins manage the content in a built-in editor.
- **Play:** a duel. One player sets a text full of mistakes, either a random one or their own. Both players fix it, and Harper scores both answers. The higher score wins.

There's no Node.js. The whole server is one static binary: [Mongoose](https://github.com/cesanta/mongoose) (C) with [Harper](https://writewithharper.com) (Rust) linked in.

## Run it

```sh
cd game
cp .env.example .env               # then fill in GOOGLE_CLIENT_ID (see below)
podman compose up --build          # needs podman-compose or docker-compose installed
```

Open http://localhost:8080.

The first build compiles Harper from source, which takes several minutes. Later builds reuse the cache. Give the Podman machine at least 4 GB of memory. On Windows this is set by `memory=` in `%USERPROFILE%\.wslconfig`, followed by `wsl --shutdown` and `podman machine start`.

### If `podman compose` doesn't start

`podman compose` hands the work to a separate compose program: `docker-compose` or `podman-compose`.

- **"looking up compose provider failed".** No compose program is installed. Install `docker-compose`, or run `pip install podman-compose`.
- **"failed to connect to the docker API at npipe:////./pipe/podman-machine-default" (Windows).** `docker-compose` reaches Podman through a pipe that Podman's helper `win-sshproxy` creates. On some PCs that helper fails during `podman machine start`. Run this after each `podman machine start`:

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\podman-pipe.ps1
  ```

- **Or skip the pipe entirely** with `python -m podman_compose up --build`. It drives Podman directly.

## Deploying with HTTPS

Google sign-in only works on `http://localhost` or over HTTPS. On a server, the optional Caddy service handles HTTPS: it gets and renews a free Let's Encrypt certificate for your domain.

1. Point your domain's DNS (A/AAAA record) at the server. Make sure ports 80 and 443 are open.
2. In `game/.env`:
   ```ini
   DOMAIN=grammarduel.example.com
   BIND=127.0.0.1          # the app only accepts traffic through Caddy
   COOKIE_SECURE=1
   ALLOW_DEV_LOGIN=0
   GOOGLE_CLIENT_ID=…
   ADMINS=you@gmail.com
   ```
3. In Google Cloud Console, add `https://grammarduel.example.com` to the OAuth client's **Authorized JavaScript origins**.
4. Start with the `https` profile:
   ```sh
   podman compose --profile https up -d --build
   ```

Rootless Podman on Linux can't bind ports below 1024 by default. Either allow it once with `sudo sysctl net.ipv4.ip_unprivileged_port_start=80`, or set `HTTP_PORT`/`HTTPS_PORT` to higher ports and forward 80/443 to them with your firewall.

### The admin panel after deployment

Sign in with Google using an email listed in `ADMINS`. An **Admin** link then appears in the top bar, or go to `https://your-domain/#/admin`. There's no separate admin password: the server checks your Google account against `ADMINS` on every request.

To add or remove an admin, edit `ADMINS` in `.env` and run `podman compose up -d` (no rebuild needed). The change takes effect immediately, even for people who are already signed in.

## Learn grammar

- **Units and lessons.** Lessons unlock in order. A finished lesson shows a check, and the next one says START.
- **Two kinds of challenge:**
  - **Fix the text:** mistakes are underlined, and Harper checks your answer. A wrong answer gets a hint and a "Show answer" option.
  - **Multiple choice:** a question with one correct option.
- **Hearts:** you start with 5 and lose one for each wrong answer. You get one back every 30 minutes, or for each correct answer when you practise a lesson you've already finished. With no hearts left, you can only practise.
- **XP and rewards:** each correct answer is worth 10 XP. XP counts toward the daily streak, the quests (20 to 1000 XP) and the leaderboard (this week, resetting on Mondays, and all time).
- **Free practice:** shuffle through texts or paste your own, with hints and answers. Nothing is scored or saved.
- **Suggest a change:** each unit banner has a "Suggest a change" button, and players are asked for feedback when they finish a unit. The form takes an optional 1–5 star rating, an optional category (too easy, too hard, mistake in a lesson, idea) and a message. Each player can send at most 5 suggestions per unit per day.

### The content editor (admins)

Open **Admin** in the top bar (`#/admin`). Admins are listed in `ADMINS` in `.env`: Google emails, or `dev:<name>` for guest logins.

- **Organise:** add, rename, reorder and delete units, lessons and challenges.
- **Fix challenges:** "Check with Harper" shows what Harper will underline. A text Harper finds nothing wrong with can't be saved, because players couldn't be graded on it.
- **Multiple choice:** needs at least two options and exactly one marked correct.
- **Suggestions tab:** lists players' unit feedback, newest first. Filter New, Done or All, then mark each suggestion done, reopen it or delete it. Units with new suggestions show a red count in the content tree.

The starter content (4 units, 12 lessons, 50 challenges) is loaded from `server/seed.json` the first time the server starts with an empty database. `cargo test` checks that Harper flags every "fix" text in it and that Harper's own fixes clear it.

## How a duel works

1. Sign in with Google.
2. Create a duel. You can use a random text (16 built in, each with 4–6 mistakes) or write your own. Harper checks a custom text when you create the duel, and refuses it if it finds no mistakes.
3. Fix the text and submit. Each player gets one try, and the clock starts when you first open the duel.
4. Copy the invite link and send it to a friend. They sign in and fix the same text.
5. Scores, the answer key and the winner are shown only after you've played. The page updates by itself when a friend finishes.

## Scoring

Harper checks both the original text and your answer. You get:

- **+10** for each mistake in the original that's gone.
- **−5** for each new mistake you introduce.
- **−3** for each word you change beyond what the fixes need. The edit allowance is 3 words per mistake plus 2, and at most 30% of the text. This stops you deleting or rewriting the whole text to get rid of the mistakes.

The score never goes below 0. The maximum is 10 × the number of mistakes. If two players tie, the faster one wins.

Scoring runs on the server, so it can't be faked from the browser. The rules are in `engine/src/scoring.rs`.

## Setting up Google sign-in

1. Go to https://console.cloud.google.com/apis/credentials.
2. Choose **Create credentials** → **OAuth client ID** → **Web application**.
3. Under **Authorized JavaScript origins**, add the address you use, e.g. `http://localhost:8080`. Add your real domain too, if you have one.
4. Copy the Client ID (it ends in `.apps.googleusercontent.com`) into `.env` as `GOOGLE_CLIENT_ID=…`.
5. Restart with `podman compose up -d`.

The browser gets a signed ID token from Google, and the server checks its signature against Google's public keys before it creates a session. The scoreboard shows only the player's Google name and picture.

For local testing without Google, set `ALLOW_DEV_LOGIN=1`. This adds a "Play as guest" name box, and anyone can then pick any name, so keep it off on a public server.

## Architecture

```
browser ──▶ app: grammar-duel (one static binary)
              Mongoose (C)    web pages, /api, sessions      server/main.c
              libduelcore     Harper + extras, scoring,      engine/ (Rust)
                              Google token checks
              SQLite          users, sessions, duels, scores ─▶ /data volume
            ──▶ memcached     cache for sessions, duels, scoreboards, Harper results
```

Measured: the app image is 32 MB, it uses about 120 MB of RAM, and Harper loads in about 1 second. Checking an answer takes a few milliseconds.

| Part | What it does |
|---|---|
| `server/main.c` | Built on Mongoose 7.14, which the build downloads and checks by checksum. It serves `web/`, handles the JSON API and sessions, and talks to SQLite and memcached. SQLite builds the JSON responses itself (`json_object`). The memcached client is a small blocking text-protocol client with 300 ms timeouts. If memcached is down, every lookup falls back to SQLite. |
| `engine/` | A Rust static library with a C API (`engine/duelcore.h`). It contains: Harper itself, from `engine/vendor/`; the Harper.px extra rules (`src/extras.rs`, a port of `harper/linting/extras.js`); scoring; the duel view (what each player may see); the random texts; and the Google ID-token check (RS256 against Google's keys). |
| `engine/vendor/` | A copy of Harper's `harper-core`, `harper-brill` and `harper-pos-utils`, so the folder builds on its own. `engine/vendor.sh` refreshes it from a Harper checkout. It patches the copy to use Harper's rule-based phrase chunker (as the JavaScript port does) and to leave out the 24 MB thesaurus. |
| `server/learn.c` | Learn mode and the content editor: units, lessons, challenges, hearts, XP, streaks and the leaderboard (included from `main.c`). |
| `server/seed.json` | The starter lessons. |
| `web/` | The pages: landing page, Learn path, lesson player, leaderboard, content editor, Play, duel and results. Plain HTML, CSS and JS, with no frameworks. |

### Security

- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie. Only a SHA-256 hash of the token is stored.
- Requests that change anything must be sent as JSON, which blocks cross-site form posts.
- Set `COOKIE_SECURE=1` when the site is served over HTTPS.

## Tests

```sh
# Engine: every extra rule against the JavaScript port's cases, and every random text plays fair
# (at least 4 mistakes, deleting scores 0, Harper's own fixes score well).
# Also: every "fix" challenge in server/seed.json is gradeable.
podman run --rm -v "$PWD/engine:/src" -v "$PWD/server:/server:ro" -w /src docker.io/library/rust:1-alpine \
  sh -c 'apk add musl-dev && cargo test --release'

# With the app running, ALLOW_DEV_LOGIN=1 and ADMINS=dev:alice (these scripts need Node on your machine, not on the server):
node tests/test_api.mjs http://localhost:8080          # duels, Learn (hearts, XP, practice, leaderboard) and the editor
node tests/test_browser.mjs http://localhost:8080/ out/ [--mobile] [--light]   # clicks through in headless Chrome
```
