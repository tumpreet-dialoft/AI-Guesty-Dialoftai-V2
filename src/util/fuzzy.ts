// Fuzzy name matching for reservation lookup.
//
// No new dependency on purpose: this is ~40 lines and it keeps the Render install
// lean. If you'd rather use `fastest-levenshtein`, the interface below is a drop-in.
//
// WHY THIS EXISTS
// The old lookup handed Guesty's `q=` text search whatever the speech recogniser
// heard. Guesty's `q=` is a substring match, so "Sara" does not find "Sarah", "Jon"
// does not find "John", and "Cavish" finds nothing at all. The agent then has to
// transfer a guest who already told it everything it needed.
//
// The saving grace is scale. The Thomas has EIGHT ROOMS. At any moment there are
// maybe 20-40 live reservations. That is not a search problem, it is a "pick one
// row out of thirty" problem, so we can afford to be generous.

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr: number[] = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

function ratio(a: string, b: string): number {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return (1 - dist / Math.max(a.length, b.length)) * 100;
}

/**
 * Score 0-100 for how well a heard name matches a name on file.
 *
 * Handles the three things speech recognition actually does to names:
 *   - misspells them     ("Sara" / "Sarah")
 *   - drops the surname  ("Sarah" / "Sarah Johnson")
 *   - reorders them      ("Johnson Sarah" / "Sarah Johnson")
 */
export function nameScore(heard: string, onFile: string): number {
  const a = normalize(heard);
  const b = normalize(onFile);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const aTokens = a.split(' ');
  const bTokens = b.split(' ');

  const sorted = ratio(aTokens.slice().sort().join(' '), bTokens.slice().sort().join(' '));

  // Best per-token pairing. This is what rescues "Sarah" against "Sarah Johnson":
  // the caller gave a first name only, and that should still be a strong match.
  let tokenBest = 0;
  for (const at of aTokens) {
    let best = 0;
    for (const bt of bTokens) best = Math.max(best, ratio(at, bt));
    tokenBest = Math.max(tokenBest, best);
  }

  const contains = b.includes(a) || a.includes(b) ? 90 : 0;

  return Math.max(sorted, tokenBest, contains);
}

/**
 * Deliberately LOOSE.
 *
 * Strict gives you zero matches, and the agent transfers a guest who told it their
 * name and their dates. Loose, against a pool of a few dozen rows, gives you exactly
 * one. When it genuinely gives two, the agent asks for a confirmation code, which is
 * the correct moment to ask for one and the only one.
 *
 * If post-call analytics show `identified_by: not_identified` running high, lower
 * this before you touch anything else.
 */
export const NAME_MATCH_THRESHOLD = 75;
