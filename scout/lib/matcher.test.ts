import { describe, expect, it } from 'vitest';
import { computeVerdict, findFlags, hitCategories, normalize } from './matcher';
import { DEFAULT_ENABLED, FLAG_IDS, FLAGS } from './flags';

const ALL = [...FLAG_IDS];

describe('normalize', () => {
  it('lowercases and collapses punctuation to single spaces', () => {
    expect(normalize('Soybean Oil, Water; (Salt)').text).toBe('soybean oil water salt');
  });

  it('maps normalized offsets back to the original string', () => {
    const source = 'Water, SOYBEAN  OIL.';
    const { text, map } = normalize(source);
    const idx = text.indexOf('soybean oil');
    expect(source.slice(map[idx], map[idx + 'soybean oil'.length - 1] + 1)).toBe('SOYBEAN  OIL');
  });
});

describe('word-boundary matching', () => {
  it('does not flag "corn" alone for the "corn oil" keyword', () => {
    const hits = findFlags('Sweet corn, butter, salt', { enabled: ALL });
    expect(hits).toHaveLength(0);
  });

  it('flags "corn oil" when it actually appears', () => {
    const hits = findFlags('Sweet corn, corn oil, salt', { enabled: ALL });
    expect(hitCategories(hits)).toEqual(['seed-oils']);
    expect(hits[0].matchedText).toBe('corn oil');
  });

  it('does not match a term embedded inside a longer word', () => {
    // "tvp" must not match inside "tvpx" or "attvp"
    expect(findFlags('contains tvpx blend', { enabled: ALL })).toHaveLength(0);
    expect(findFlags('contains TVP blend', { enabled: ALL })).toHaveLength(1);
  });

  it('matches across punctuation and irregular whitespace', () => {
    const hits = findFlags('PARTIALLY-HYDROGENATED   soybean\noil', { enabled: ['seed-oils'] });
    const terms = hits.map((h) => h.term).sort();
    expect(terms).toEqual(['partially hydrogenated', 'soybean oil']);
  });
});

describe('evidence', () => {
  it('always returns the exact source substring that matched', () => {
    const source = 'Ingredients: Water, Canola Oil, Sea Salt';
    const hits = findFlags(source, { enabled: ['seed-oils'] });
    expect(hits).toHaveLength(1);
    expect(source.slice(hits[0].start, hits[0].end)).toBe(hits[0].matchedText);
    expect(hits[0].matchedText).toBe('Canola Oil');
  });

  it('reports brand matches separately from keyword matches', () => {
    const hits = findFlags('Impossible Burger patty', { enabled: ['analog'] });
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('brand');
    expect(hits[0].term).toBe('Impossible');
  });
});

describe('deduplication', () => {
  it('keeps the longest match and drops nested ones for the same flag', () => {
    const hits = findFlags('vegetable oil', { enabled: ['seed-oils'] });
    expect(hits).toHaveLength(1);
    expect(hits[0].term).toBe('vegetable oil');
  });

  it('keeps separate occurrences of the same term', () => {
    const hits = findFlags('canola oil, water, canola oil', { enabled: ['seed-oils'] });
    expect(hits).toHaveLength(2);
  });
});

describe('strictness', () => {
  const label =
    'Beef, water, salt. Contains 2% or less of: soybean oil, spices. May contain canola oil.';

  it('strict flags trace and minor ingredients', () => {
    const hits = findFlags(label, { enabled: ['seed-oils'], strictness: 'strict' });
    expect(hits.map((h) => h.term).sort()).toEqual(['canola oil', 'soybean oil']);
    expect(hits.find((h) => h.term === 'canola oil')?.trace).toBe(true);
  });

  it('relaxed flags only primary ingredients', () => {
    const hits = findFlags(label, { enabled: ['seed-oils'], strictness: 'relaxed' });
    expect(hits).toHaveLength(0);
  });

  it('relaxed still flags a primary seed oil', () => {
    const hits = findFlags('Potatoes, sunflower oil, salt.', {
      enabled: ['seed-oils'],
      strictness: 'relaxed',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].primary).toBe(true);
  });
});

describe('enabled categories', () => {
  it('returns nothing when no categories are enabled', () => {
    expect(findFlags('soybean oil, Impossible patty', { enabled: [] })).toHaveLength(0);
  });

  it('a user avoiding seed oils gets a clear on an Impossible burger', () => {
    const hits = findFlags('Impossible patty, water, methylcellulose', { enabled: ['seed-oils'] });
    expect(hits).toHaveLength(0);
  });

  it('the same text flags for a user avoiding analogs', () => {
    const hits = findFlags('Impossible patty, water, methylcellulose', { enabled: ['analog'] });
    expect(hitCategories(hits)).toEqual(['analog']);
  });

  it('default enabled categories are real flag ids', () => {
    for (const id of DEFAULT_ENABLED) expect(FLAGS[id]).toBeDefined();
  });
});

describe('taxonomy integrity', () => {
  it('every flag has an explainer and at least one match term', () => {
    for (const id of FLAG_IDS) {
      const flag = FLAGS[id];
      expect(flag.explainer.length).toBeGreaterThan(20);
      expect(flag.keywords.length + flag.brandNames.length).toBeGreaterThan(0);
    }
  });
});

describe('computeVerdict', () => {
  const noHits = { hits: [] };

  it('flags whenever there is a hit, regardless of coverage', () => {
    const hits = findFlags('canola oil', { enabled: ['seed-oils'] });
    expect(computeVerdict({ analyzedCount: 1, withIngredients: 1, minConfidence: 0.2, hits })).toBe(
      'flagged',
    );
  });

  it('returns unknown when nothing was analyzed', () => {
    expect(computeVerdict({ analyzedCount: 0, withIngredients: 0, minConfidence: 1, ...noHits })).toBe(
      'unknown',
    );
  });

  it('returns unknown on thin data rather than a confident clear', () => {
    expect(computeVerdict({ analyzedCount: 8, withIngredients: 2, minConfidence: 1, ...noHits })).toBe(
      'unknown',
    );
  });

  it('returns unknown when confidence is low', () => {
    expect(
      computeVerdict({ analyzedCount: 10, withIngredients: 10, minConfidence: 0.3, ...noHits }),
    ).toBe('unknown');
  });

  it('returns clear only with enough high-confidence ingredient data', () => {
    expect(
      computeVerdict({ analyzedCount: 10, withIngredients: 6, minConfidence: 0.8, ...noHits }),
    ).toBe('clear');
  });
});
