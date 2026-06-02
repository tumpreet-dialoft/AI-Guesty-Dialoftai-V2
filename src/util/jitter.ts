export function jitter(maxMs: number = 500): number {
  return Math.floor(Math.random() * maxMs);
}
