import { NextResponse, type NextRequest } from 'next/server';
import { voteOnReport } from '@/lib/db/repository';
import { ensureToken } from '@/lib/prefs';

export const runtime = 'nodejs';

/**
 * One vote per report per anonymous token. A report at net -3 is hidden;
 * at net +5 it is promoted to `confirmed` and factored into the venue verdict.
 */
export async function POST(request: NextRequest) {
  const token = await ensureToken();

  let body: { reportId?: string; value?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const { reportId, value } = body;
  if (!reportId || (value !== 1 && value !== -1)) {
    return NextResponse.json(
      { error: 'bad_request', message: 'reportId and a value of 1 or -1 are required.' },
      { status: 400 },
    );
  }

  const { outcome, report } = voteOnReport(reportId, token, value);

  if (outcome === 'not-found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (outcome === 'already-voted') {
    return NextResponse.json(
      { error: 'already_voted', message: 'You already voted on this report.' },
      { status: 409 },
    );
  }

  return NextResponse.json({ report });
}
