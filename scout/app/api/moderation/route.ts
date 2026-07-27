import { NextResponse } from 'next/server';
import { listReportsForModeration } from '@/lib/db/repository';

export const runtime = 'nodejs';

/**
 * STUB — NOT PRODUCTION READY.
 *
 * This route is unauthenticated and read-only. Before any public launch it needs,
 * at minimum:
 *
 *   - real authentication and an operator role (there are no accounts in v1)
 *   - takedown / edit actions, not just a queue listing
 *   - an audit trail of who actioned what and when
 *   - abuse handling: per-IP as well as per-token limits, and a way to ban a
 *     token whose reports are consistently downvoted
 *   - a defamation and liability review — reports name real businesses
 *
 * Crowdsourced ingredient claims about named restaurants carry real legal and
 * reputational risk. Do not expose user reports publicly without this.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production' && process.env.SCOUT_ENABLE_MODERATION !== '1') {
    return NextResponse.json(
      {
        error: 'disabled',
        message:
          'The moderation stub is disabled in production. It needs real auth before it can be turned on.',
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    warning: 'STUB. Unauthenticated. Needs real moderation before public launch.',
    queue: listReportsForModeration(),
  });
}
