// Pure helpers for a lesson/review session: what to ask, what the keyboard
// does, and what to send to the server. No DOM or Svelte state in here.

/** The kind of input a challenge needs: 'pick' | 'build' | 'type'. */
export function inputKind(challenge) {
  if (challenge?.options) return 'pick';
  if (challenge?.tiles) return 'build';
  return 'type';
}

/** The short instruction shown above the prompt. */
export function instructionFor(challenge, targetLang = 'Lithuanian') {
  switch (challenge?.kind) {
    case 'pick_en':
      return 'What does this mean?';
    case 'pick_lt':
      return `Pick the ${targetLang} word`;
    case 'build':
      return `Build it in ${targetLang}`;
    case 'type_lt':
      return `Type it in ${targetLang}`;
    default:
      return 'Choose the correct answer';
  }
}

/** Keyboard hint for the footer, matched to the input kind and turn. */
export function keyHint(challenge, turnMode) {
  if (turnMode === 'continue') return 'Enter to continue';
  if (inputKind(challenge) === 'pick') {
    const n = challenge.options.length;
    return `Press 1–${n} · Enter to check`;
  }
  return 'Enter to check';
}

/** True once the learner has given something that can be checked. */
export function hasAnswer(challenge, { selectedOptionId, builtTiles, typedText }) {
  switch (inputKind(challenge)) {
    case 'pick':
      return selectedOptionId !== null && selectedOptionId !== undefined;
    case 'build':
      return builtTiles.length > 0;
    default:
      return typedText.trim().length > 0;
  }
}

/** Request body for POST /learn/words/:id/answer. */
export function answerBody(challenge, { selectedOptionId, builtTiles, typedText }, review = false) {
  const body = { kind: challenge.kind, review };
  const kind = inputKind(challenge);
  if (kind === 'pick') body.optionId = selectedOptionId;
  else if (kind === 'build') body.text = builtTiles.map((t) => t.text).join(' ');
  else body.text = typedText.trim();
  return body;
}

/** Option id for a number key ("1"–"9"), or null when there's no such option. */
export function optionForKey(challenge, key) {
  if (inputKind(challenge) !== 'pick' || !/^[1-9]$/.test(key)) return null;
  return challenge.options[Number(key) - 1]?.id ?? null;
}

/** Fresh tile state for a build challenge. */
export function tilesFor(challenge) {
  return (challenge?.tiles || []).map((text, id) => ({ id, text, used: false }));
}

/** First-try accuracy as a whole percentage. */
export function accuracy(total, mistakes) {
  if (!total) return 100;
  return Math.round((100 * total) / (total + mistakes));
}
