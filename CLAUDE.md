# Agent instructions

## CodeScene

After changing code, run `code_health_review` on the changed files. If Code Health drops, fix the issues, run the review again, and use `code_health_score` to confirm the result. Before finishing, run `pre_commit_code_health_safeguard` and only stop when it passes.

CodeScene can't analyze `.svelte` files. Keep non-trivial frontend logic in plain `.js` modules under `frontend/src/lib/` (e.g. `routes.js`, `format.js`, `lessonSession.js`) so it gets checked, and keep components focused on markup and state.
