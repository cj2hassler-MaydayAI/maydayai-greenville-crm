import { NextResponse, type NextRequest } from 'next/server';
import {
  MAX_REPORTS_PER_DAY,
  countReportsToday,
  createReport,
  getVenue,
  listReports,
} from '@/lib/db/repository';
import { isFlagId } from '@/lib/flags';
import { ensureToken } from '@/lib/prefs';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const venueId = request.nextUrl.searchParams.get('venueId');
  if (!venueId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  return NextResponse.json({ reports: listReports(venueId) });
}

export async function POST(request: NextRequest) {
  const token = await ensureToken();

  let body: { venueId?: string; flagId?: string; itemName?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const { venueId, flagId } = body;
  if (!venueId || !flagId || !isFlagId(flagId)) {
    return NextResponse.json(
      { error: 'bad_request', message: 'venueId and a valid flagId are required.' },
      { status: 400 },
    );
  }

  if (!getVenue(venueId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (countReportsToday(token) >= MAX_REPORTS_PER_DAY) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `You can file ${MAX_REPORTS_PER_DAY} reports a day. Try again tomorrow.`,
      },
      { status: 429 },
    );
  }

  const report = createReport({
    venueId,
    userToken: token,
    flagId,
    itemName: body.itemName?.slice(0, 120) ?? null,
    note: body.note?.slice(0, 500) ?? null,
  });

  return NextResponse.json({ report }, { status: 201 });
}
