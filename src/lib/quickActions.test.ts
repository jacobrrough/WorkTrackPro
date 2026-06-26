import { describe, it, expect } from 'vitest';
import { reorderQuickActionKeys } from './quickActions';

describe('reorderQuickActionKeys', () => {
  it('moves a card forward, shifting the others', () => {
    expect(reorderQuickActionKeys(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a card backward', () => {
    expect(reorderQuickActionKeys(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('keeps an interspersed hidden card in its relative slot', () => {
    // 'b' is hidden (not draggable); dragging visible 'a' onto visible 'c'
    // must not lose or reposition 'b' relative to the cards around it.
    const result = reorderQuickActionKeys(['a', 'b', 'c', 'd'], 'a', 'c');
    expect(result).toContain('b');
    expect(result).toHaveLength(4);
    // 'b' still sits ahead of 'c' and 'd', exactly as before the move.
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('c'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('d'));
  });

  it('returns the same reference for a no-op (same key)', () => {
    const input = ['a', 'b', 'c'];
    expect(reorderQuickActionKeys(input, 'b', 'b')).toBe(input);
  });

  it('returns the same reference when a key is missing', () => {
    const input = ['a', 'b', 'c'];
    expect(reorderQuickActionKeys(input, 'a', 'z')).toBe(input);
    expect(reorderQuickActionKeys(input, 'z', 'a')).toBe(input);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c', 'd'];
    reorderQuickActionKeys(input, 'a', 'c');
    expect(input).toEqual(['a', 'b', 'c', 'd']);
  });
});
