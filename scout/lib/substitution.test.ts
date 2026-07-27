/**
 * Tests for the anti-fabrication guard on the substitution engine.
 *
 * The prompt tells the model to say "unknown" rather than guess, but a prompt is
 * not an enforcement mechanism. `sanitize` is: anything the model asserts that we
 * cannot point at in the supplied menu text is dropped before it reaches a user.
 */

import { describe, expect, it } from 'vitest';
import { cacheKey, localSubstitution, menuHash, sanitize } from './substitution';
import type { ScoredMenuItem } from './db/repository';
import { findFlags } from './matcher';

function item(
  name: string,
  ingredientsText: string | null,
  confidence = 0.8,
): ScoredMenuItem {
  return {
    id: `id-${name}`,
    name,
    description: null,
    ingredientsText,
    source: 'seed',
    confidence,
    sourceNote: null,
    verifiedAt: null,
    hits: findFlags(ingredientsText, { enabled: ['seed-oils', 'analog'] }),
  };
}

const MENU: ScoredMenuItem[] = [
  item('Fries', 'Potatoes, canola oil, salt.'),
  item('Grilled Chicken', 'Chicken breast, salt, black pepper.'),
  item('Mystery Special', null),
];

describe('sanitize', () => {
  it('drops an avoid entry whose matched text is not in the menu', () => {
    const result = sanitize(
      {
        recommended: [],
        avoid: [
          { item: 'Fries', flag: 'seed-oils', matched: 'canola oil' },
          // Fabricated: nothing in the menu says this.
          { item: 'Grilled Chicken', flag: 'seed-oils', matched: 'soybean oil' },
        ],
        caveats: [],
      },
      MENU,
      ['seed-oils'],
    );

    expect(result.avoid).toHaveLength(1);
    expect(result.avoid[0].matched).toBe('canola oil');
  });

  it('drops an avoid entry for a category the user did not enable', () => {
    const result = sanitize(
      {
        recommended: [],
        avoid: [{ item: 'Fries', flag: 'analog', matched: 'canola oil' }],
        caveats: [],
      },
      MENU,
      ['seed-oils'],
    );
    expect(result.avoid).toHaveLength(0);
  });

  it('drops a recommendation for an item that is not on the menu', () => {
    const result = sanitize(
      {
        recommended: [
          { item: 'Grilled Chicken', why: 'No flagged ingredients.', confidence: 'high' },
          { item: 'Kale Smoothie', why: 'Invented out of thin air.', confidence: 'high' },
        ],
        avoid: [],
        caveats: [],
      },
      MENU,
      ['seed-oils'],
    );
    expect(result.recommended.map((r) => r.item)).toEqual(['Grilled Chicken']);
  });

  it('matches item names case-insensitively', () => {
    const result = sanitize(
      {
        recommended: [{ item: 'grilled chicken', why: 'ok', confidence: 'medium' }],
        avoid: [],
        caveats: [],
      },
      MENU,
      ['seed-oils'],
    );
    expect(result.recommended).toHaveLength(1);
  });

  it('survives a malformed payload without throwing', () => {
    const result = sanitize(
      { recommended: undefined, avoid: undefined, caveats: undefined } as never,
      MENU,
      ['seed-oils'],
    );
    expect(result).toEqual({ recommended: [], avoid: [], caveats: [] });
  });

  it('caps caveats and recommendations so the screen stays scannable', () => {
    const result = sanitize(
      {
        recommended: Array.from({ length: 20 }, () => ({
          item: 'Grilled Chicken',
          why: 'ok',
          confidence: 'high' as const,
        })),
        avoid: [],
        caveats: ['a', 'b', 'c', 'd', 'e'],
      },
      MENU,
      ['seed-oils'],
    );
    expect(result.recommended).toHaveLength(8);
    expect(result.caveats).toHaveLength(3);
  });
});

describe('localSubstitution (no API key path)', () => {
  it('recommends only items with real ingredient text and no hits', () => {
    const result = localSubstitution(MENU);
    expect(result.recommended.map((r) => r.item)).toEqual(['Grilled Chicken']);
  });

  it('reports every hit as an avoid entry with its evidence', () => {
    const result = localSubstitution(MENU);
    expect(result.avoid).toEqual([{ item: 'Fries', flag: 'seed-oils', matched: 'canola oil' }]);
  });

  it('raises the shared-fryer caveat when a seed oil is present', () => {
    const result = localSubstitution(MENU);
    expect(result.caveats.some((c) => c.includes('fryer'))).toBe(true);
  });

  it('says so when some items were not assessed', () => {
    const result = localSubstitution(MENU);
    expect(result.caveats.some((c) => c.includes('no published ingredients'))).toBe(true);
  });
});

describe('cache keys', () => {
  it('hashes the menu independently of item order', () => {
    expect(menuHash(MENU)).toBe(menuHash([...MENU].reverse()));
  });

  it('changes the hash when ingredient text changes', () => {
    const changed = [item('Fries', 'Potatoes, beef tallow, salt.'), MENU[1], MENU[2]];
    expect(menuHash(changed)).not.toBe(menuHash(MENU));
  });

  it('is independent of the order the categories were enabled in', () => {
    const hash = menuHash(MENU);
    expect(cacheKey('ven_1', ['seed-oils', 'analog'], hash)).toBe(
      cacheKey('ven_1', ['analog', 'seed-oils'], hash),
    );
  });

  it('separates users with different enabled categories', () => {
    const hash = menuHash(MENU);
    expect(cacheKey('ven_1', ['seed-oils'], hash)).not.toBe(
      cacheKey('ven_1', ['seed-oils', 'analog'], hash),
    );
  });
});
