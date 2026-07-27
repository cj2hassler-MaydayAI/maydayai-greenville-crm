/**
 * The substitution engine. Given a venue's menu and the categories this user
 * enabled, produce something they can actually order.
 *
 * Two rules matter more than anything else here:
 *   1. The model says "unknown" rather than guessing. A fabricated ingredient
 *      claim destroys trust faster than an empty answer.
 *   2. Results are cached on (venue, sorted categories, menu hash) permanently.
 *      The same combination never costs a second API call.
 */

import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { FLAGS, type FlagId } from './flags';
import type { ScoredMenuItem, VenueRecord } from './db/repository';
import { readAnalysis, writeAnalysis } from './db/repository';

/** Sonnet tier, per the build spec. Override with SCOUT_MODEL if you want Opus. */
const MODEL = process.env.SCOUT_MODEL ?? 'claude-sonnet-5';

export type Confidence = 'high' | 'medium' | 'low';

export interface Recommendation {
  item: string;
  why: string;
  confidence: Confidence;
}

export interface Avoidance {
  item: string;
  flag: string;
  matched: string;
}

export interface SubstitutionResult {
  recommended: Recommendation[];
  avoid: Avoidance[];
  caveats: string[];
  /** Set when the result came from the cache rather than a fresh API call. */
  cached?: boolean;
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    recommended: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          why: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['item', 'why', 'confidence'],
        additionalProperties: false,
      },
    },
    avoid: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          flag: { type: 'string' },
          matched: { type: 'string' },
        },
        required: ['item', 'flag', 'matched'],
        additionalProperties: false,
      },
    },
    caveats: { type: 'array', items: { type: 'string' } },
  },
  required: ['recommended', 'avoid', 'caveats'],
  additionalProperties: false,
} as const;

function systemPrompt(enabled: FlagId[]): string {
  const categories = enabled
    .map((id) => `- ${FLAGS[id].id} (${FLAGS[id].label}): ${FLAGS[id].explainer}`)
    .join('\n');

  return `You help someone standing in a doorway decide what to order in about fifteen seconds. They are avoiding specific ingredient categories and need to know what is safe to eat here — and what to skip.

The categories this person is avoiding:
${categories}

Rules you must follow:

Say "unknown" rather than guessing. You are given the menu text that is actually available. If an item's ingredients are not stated, do not infer them from the item's name and do not assert what oil a kitchen uses. It is correct and expected to return few recommendations, or none. A fabricated ingredient claim is far worse than an empty list.

Recommend things a person actually wants to eat. Not "a side salad, dressing on the side" every time. If the only genuinely safe option is unappealing, say so plainly in the caveats rather than dressing it up. Rank recommendations by how appealing they are, not merely by how safe.

Surface cross-contamination. Shared fryers are the big one — if a venue fries anything in a seed-oil blend, every other fried item on that menu is suspect regardless of its own ingredient list. Say so in caveats. Also flag shared grills and shared equipment when the menu implies them.

For every entry in "avoid", "matched" must be a substring that genuinely appears in the provided menu text. Never invent the matched string. "flag" must be one of the category ids listed above.

Keep "why" to one short sentence. Keep caveats to at most three, each one sentence.

Only consider the categories listed above. An item that contains something from a category this person did not enable is not a problem and must not appear in "avoid".`;
}

function menuPayload(items: ScoredMenuItem[]): string {
  return items
    .map((item) => {
      const parts = [`ITEM: ${item.name}`];
      if (item.description) parts.push(`  description: ${item.description}`);
      parts.push(
        `  ingredients: ${item.ingredientsText?.trim() || '(not available — treat as unknown)'}`,
      );
      parts.push(`  data confidence: ${item.confidence.toFixed(2)} (source: ${item.source})`);
      return parts.join('\n');
    })
    .join('\n\n');
}

export function menuHash(items: ScoredMenuItem[]): string {
  const canonical = items
    .map((i) => `${i.name}|${i.description ?? ''}|${i.ingredientsText ?? ''}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function cacheKey(venueId: string, enabled: FlagId[], hash: string): string {
  return `${venueId}:${[...enabled].sort().join(',')}:${hash}`;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set');
    this.name = 'MissingApiKeyError';
  }
}

/**
 * Deterministic fallback used when there is no API key, or the call fails.
 * Built purely from matcher output, so it never claims anything we cannot show.
 */
export function localSubstitution(items: ScoredMenuItem[]): SubstitutionResult {
  const flagged = items.filter((i) => i.hits.length > 0);
  const known = items.filter(
    (i) => i.hits.length === 0 && (i.ingredientsText ?? '').trim().length > 0,
  );

  const caveats: string[] = [];
  if (flagged.some((i) => i.hits.some((h) => h.flagId === 'seed-oils'))) {
    caveats.push(
      'Fried items here matched a seed oil, so anything else out of the same fryer is suspect.',
    );
  }
  if (items.some((i) => !(i.ingredientsText ?? '').trim())) {
    caveats.push('Some items have no published ingredients and were not assessed.');
  }

  return {
    recommended: known.map((i) => ({
      item: i.name,
      why: 'Published ingredients contain nothing from the categories you enabled.',
      confidence: i.confidence >= 0.7 ? 'medium' : 'low',
    })),
    avoid: flagged.flatMap((i) =>
      i.hits.map((h) => ({ item: i.name, flag: h.flagId, matched: h.matchedText })),
    ),
    caveats,
  };
}

/**
 * Runs the substitution engine, hitting the cache first. Falls back to the
 * local, evidence-only result when no API key is configured.
 */
export async function suggestSubstitutions(
  venue: VenueRecord,
  items: ScoredMenuItem[],
  enabled: FlagId[],
): Promise<SubstitutionResult> {
  if (items.length === 0) {
    return { recommended: [], avoid: [], caveats: [] };
  }

  const hash = menuHash(items);
  const key = cacheKey(venue.id, enabled, hash);

  const cached = readAnalysis<SubstitutionResult>(key);
  if (cached) return { ...cached, cached: true };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return localSubstitution(items);

  let result: SubstitutionResult;
  try {
    result = await callClaude(venue, items, enabled, apiKey);
  } catch {
    // Never block the screen on a model failure — degrade to matcher evidence.
    return localSubstitution(items);
  }

  const sanitized = sanitize(result, items, enabled);
  writeAnalysis({
    key,
    venueId: venue.id,
    categories: [...enabled].sort().join(','),
    menuHash: hash,
    result: sanitized,
  });
  return sanitized;
}

async function callClaude(
  venue: VenueRecord,
  items: ScoredMenuItem[],
  enabled: FlagId[],
  apiKey: string,
): Promise<SubstitutionResult> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: systemPrompt(enabled),
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: RESULT_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Venue: ${venue.name} (${venue.kind.replace('_', ' ')})\n\nMenu data available:\n\n${menuPayload(items)}`,
      },
    ],
  });

  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') throw new Error('no text block in response');
  return JSON.parse(text.text) as SubstitutionResult;
}

/**
 * Enforces rule 1 after the fact: drop any "avoid" entry whose `matched` string
 * does not actually occur in the menu text we supplied, and any flag id outside
 * the user's enabled set. If the model invented it, it does not ship.
 */
export function sanitize(
  result: SubstitutionResult,
  items: ScoredMenuItem[],
  enabled: FlagId[],
): SubstitutionResult {
  const corpus = items
    .map((i) => `${i.name} ${i.description ?? ''} ${i.ingredientsText ?? ''}`)
    .join(' ')
    .toLowerCase();
  const itemNames = new Set(items.map((i) => i.name.toLowerCase()));
  const allowed = new Set<string>(enabled);

  return {
    recommended: (result.recommended ?? [])
      .filter((r) => r && typeof r.item === 'string' && itemNames.has(r.item.toLowerCase()))
      .slice(0, 8),
    avoid: (result.avoid ?? []).filter(
      (a) =>
        a &&
        typeof a.matched === 'string' &&
        allowed.has(a.flag) &&
        corpus.includes(a.matched.toLowerCase()),
    ),
    caveats: (result.caveats ?? []).filter((c) => typeof c === 'string' && c.length > 0).slice(0, 3),
  };
}
