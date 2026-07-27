import { NextResponse } from 'next/server';
import { parseFlagIds } from '@/lib/flags';
import { ensureToken, loadPrefs, savePrefs } from '@/lib/prefs';

export const runtime = 'nodejs';

export async function GET() {
  const token = await ensureToken();
  const prefs = loadPrefs(token);
  return NextResponse.json({
    enabledCategories: prefs.enabledCategories,
    strictness: prefs.strictness,
  });
}

export async function POST(request: Request) {
  const token = await ensureToken();

  let body: { enabledCategories?: unknown; strictness?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const current = loadPrefs(token);
  const enabledCategories =
    body.enabledCategories === undefined
      ? current.enabledCategories
      : parseFlagIds(body.enabledCategories);
  const strictness =
    body.strictness === 'strict' || body.strictness === 'relaxed'
      ? body.strictness
      : current.strictness;

  const saved = savePrefs({ userToken: token, enabledCategories, strictness });
  return NextResponse.json({
    enabledCategories: saved.enabledCategories,
    strictness: saved.strictness,
  });
}
