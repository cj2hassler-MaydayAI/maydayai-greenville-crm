/**
 * Ingredient matching.
 *
 * Rules, in order:
 *  1. Normalize to lowercase and strip punctuation to single spaces.
 *  2. Match on word boundaries, so "corn" never satisfies the "corn oil" keyword.
 *  3. Return the matched substring *from the original text* so the UI can always
 *     show the evidence. We never flag anything we cannot point at.
 */

import { FLAG_LIST, FLAGS, type FlagId, type Severity, type Strictness } from './flags';

export type MatchKind = 'keyword' | 'brand';

export interface FlagHit {
  flagId: FlagId;
  /** The exact text from the source string that triggered the flag. */
  matchedText: string;
  /** The registry term that produced the match. */
  term: string;
  kind: MatchKind;
  severity: Severity;
  /** Match came from a "may contain" / shared-equipment style statement. */
  trace: boolean;
  /** Match sits among the primary (pre-"2% or less") ingredients. */
  primary: boolean;
  start: number;
  end: number;
}

export interface MatchOptions {
  enabled: FlagId[];
  strictness?: Strictness;
}

const TRACE_MARKERS = [
  'may contain',
  'may also contain',
  'manufactured in a facility',
  'manufactured on equipment',
  'processed in a facility',
  'processed on equipment',
  'produced in a facility',
  'shared equipment',
  'shared fryer',
  'traces of',
];

const MINOR_MARKERS = [
  'contains 2 or less of',
  'contains 2 percent or less of',
  'contains less than 2 of',
  'contains less than 2 percent of',
  'less than 2 of the following',
  'less than 2 percent of',
  '2 or less of',
];

/**
 * Normalizes text while keeping a map back to the original offsets, so a match
 * found in normalized space can be quoted verbatim from the source.
 */
interface Normalized {
  text: string;
  /** normalized index -> original index */
  map: number[];
}

export function normalize(input: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // suppress leading whitespace

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const isWord = /[a-z0-9]/i.test(ch);

    if (isWord) {
      out.push(ch.toLowerCase());
      map.push(i);
      lastWasSpace = false;
    } else if (!lastWasSpace) {
      out.push(' ');
      map.push(i);
      lastWasSpace = true;
    }
  }

  // Drop a trailing separator so offsets stay tight.
  while (out.length > 0 && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }

  return { text: out.join(''), map };
}

/** Normalize a registry term to the same shape as the haystack. */
export function normalizeTerm(term: string): string {
  return normalize(term).text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary regex for a normalized term. Normalization has already collapsed
 * everything to `[a-z0-9 ]`, so the boundary check is simply "not alphanumeric".
 */
function termPattern(normalizedTerm: string): RegExp {
  const body = normalizedTerm
    .split(' ')
    .map(escapeRegExp)
    .join(' ');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'g');
}

function markerPositions(haystack: string, markers: string[]): number[] {
  const found: number[] = [];
  for (const marker of markers) {
    const needle = normalizeTerm(marker);
    if (!needle) continue;
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
      found.push(idx);
      idx = haystack.indexOf(needle, idx + 1);
    }
  }
  return found.sort((a, b) => a - b);
}

/**
 * Finds every flag hit in `text` for the enabled categories.
 *
 * `strictness`:
 *   - "strict"  flags any appearance, including trace / shared-equipment statements.
 *   - "relaxed" flags only primary ingredients — nothing after a "contains 2% or
 *     less" marker, and nothing inside a "may contain" statement.
 */
export function findFlags(text: string | null | undefined, options: MatchOptions): FlagHit[] {
  if (!text) return [];
  const enabled = new Set(options.enabled);
  if (enabled.size === 0) return [];

  const strictness: Strictness = options.strictness ?? 'strict';
  const { text: hay, map } = normalize(text);
  if (!hay) return [];

  const traceStarts = markerPositions(hay, TRACE_MARKERS);
  const minorStarts = markerPositions(hay, MINOR_MARKERS);
  const minorBoundary = minorStarts.length > 0 ? minorStarts[0] : Infinity;

  const hits: FlagHit[] = [];

  for (const flag of FLAG_LIST) {
    if (!enabled.has(flag.id)) continue;

    const terms: Array<{ term: string; kind: MatchKind }> = [
      ...flag.keywords.map((term) => ({ term, kind: 'keyword' as const })),
      ...flag.brandNames.map((term) => ({ term, kind: 'brand' as const })),
    ];

    for (const { term, kind } of terms) {
      const needle = normalizeTerm(term);
      if (!needle) continue;

      const re = termPattern(needle);
      let m: RegExpExecArray | null;
      while ((m = re.exec(hay)) !== null) {
        const nStart = m.index;
        const nEnd = m.index + m[0].length - 1;
        const start = map[nStart];
        const end = map[nEnd] + 1;

        // A trace statement owns everything after it until the next sentence-ish break.
        const trace = traceStarts.some((pos) => pos <= nStart && nStart - pos < 120);
        const primary = nStart < minorBoundary && !trace;

        hits.push({
          flagId: flag.id,
          matchedText: text.slice(start, end),
          term,
          kind,
          severity: flag.defaultSeverity,
          trace,
          primary,
          start,
          end,
        });
      }
    }
  }

  const deduped = dedupe(hits);
  if (strictness === 'relaxed') {
    return deduped.filter((hit) => hit.primary);
  }
  return deduped;
}

/**
 * Drops a hit when a longer hit for the same flag already covers its span —
 * "vegetable oil" should not also report a nested shorter term.
 */
function dedupe(hits: FlagHit[]): FlagHit[] {
  const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: FlagHit[] = [];

  for (const hit of sorted) {
    const covered = kept.some(
      (k) => k.flagId === hit.flagId && k.start <= hit.start && k.end >= hit.end,
    );
    if (!covered) kept.push(hit);
  }
  return kept;
}

/** Convenience: which categories were hit at all. */
export function hitCategories(hits: FlagHit[]): FlagId[] {
  return [...new Set(hits.map((h) => h.flagId))];
}

export function describeHit(hit: FlagHit): string {
  const flag = FLAGS[hit.flagId];
  const where = hit.trace ? ' (listed as a possible trace)' : '';
  return `${flag.label}: "${hit.matchedText}"${where}`;
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export type Verdict = 'flagged' | 'clear' | 'unknown';

export interface VerdictInput {
  /** Number of menu items / ingredient records we actually inspected. */
  analyzedCount: number;
  /** Of those, how many carried real ingredient text. */
  withIngredients: number;
  /** Lowest confidence among the records we used (0-1). */
  minConfidence: number;
  hits: FlagHit[];
}

/**
 * Three states, never two. "clear" is reserved for cases where we inspected
 * enough real ingredient data to say so; everything thinner is "unknown".
 */
export function computeVerdict(input: VerdictInput): Verdict {
  if (input.hits.length > 0) return 'flagged';
  if (input.analyzedCount === 0 || input.withIngredients === 0) return 'unknown';
  if (input.withIngredients < 3) return 'unknown';
  if (input.minConfidence < 0.6) return 'unknown';
  return 'clear';
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  flagged: 'FLAGGED',
  clear: 'VERIFIED CLEAN',
  unknown: 'NO DATA',
};
