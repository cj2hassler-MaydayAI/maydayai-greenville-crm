import { NextResponse } from 'next/server';
import { assessVenue, getVenue } from '@/lib/db/repository';
import { ensureToken, loadPrefs } from '@/lib/prefs';
import { suggestSubstitutions } from '@/lib/substitution';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Runs the substitution engine for a venue against this user's enabled
 * categories. Cached on (venue, categories, menu hash) — a repeat request for
 * the same combination never reaches the API.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await ensureToken();
  const prefs = loadPrefs(token);

  const venue = getVenue(id);
  if (!venue) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const assessment = assessVenue(venue, prefs.enabledCategories, prefs.strictness);
  if (assessment.items.length === 0) {
    return NextResponse.json({
      recommended: [],
      avoid: [],
      caveats: ['We have no menu data for this location, so there is nothing to rank yet.'],
      source: 'none',
    });
  }

  const result = await suggestSubstitutions(venue, assessment.items, prefs.enabledCategories);

  return NextResponse.json({
    ...result,
    source: process.env.ANTHROPIC_API_KEY ? 'ai' : 'local',
  });
}
