import { describe, it, expect } from 'vitest';
import { nameScore, NAME_MATCH_THRESHOLD } from '../../src/util/fuzzy';

const matches = (heard: string, onFile: string) => nameScore(heard, onFile) >= NAME_MATCH_THRESHOLD;

describe('nameScore', () => {
  it('matches exactly', () => {
    expect(nameScore('Sarah Johnson', 'Sarah Johnson')).toBe(100);
  });

  // The whole reason this module exists. Guesty's q= substring search fails every
  // one of these, and every one of these is something ASR does to a name daily.
  it('survives what speech recognition does to names', () => {
    expect(matches('Sara Johnson', 'Sarah Johnson')).toBe(true);
    expect(matches('Jon Smith', 'John Smith')).toBe(true);
    expect(matches('Cavish Shah', 'Kavish Shah')).toBe(true);
    expect(matches('Steven Clark', 'Stephen Clark')).toBe(true);
  });

  it('matches on a first name alone, because that is what callers give you', () => {
    expect(matches('Sarah', 'Sarah Johnson')).toBe(true);
    expect(matches('Johnson', 'Sarah Johnson')).toBe(true);
  });

  it('does not care about name order', () => {
    expect(matches('Johnson Sarah', 'Sarah Johnson')).toBe(true);
  });

  it('ignores case, accents and punctuation', () => {
    expect(matches('jose garcia', 'José García')).toBe(true);
    expect(matches("O'Brien", 'OBrien')).toBe(true);
  });

  it('still rejects a genuinely different person', () => {
    expect(matches('Michael Chen', 'Sarah Johnson')).toBe(false);
    expect(matches('Rodriguez', 'Johnson')).toBe(false);
  });

  it('handles empty input without throwing', () => {
    expect(nameScore('', 'Sarah')).toBe(0);
    expect(nameScore('Sarah', '')).toBe(0);
  });
});
