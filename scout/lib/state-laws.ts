/**
 * States that have banned the manufacture, sale, or distribution of cultivated meat.
 *
 * Copy shown to users is deliberately neutral and legal-factual. This area moves —
 * bans get enjoined, amended, and appealed — so every entry carries a lastVerified
 * date and a source, and the UI states when it was last checked.
 */

export interface StateLaw {
  state: string;
  code: string;
  statute: string;
  note?: string;
  source: string;
  lastVerified: string; // ISO date
}

export const CULTIVATED_MEAT_BANS: StateLaw[] = [
  {
    state: 'Florida',
    code: 'FL',
    statute: 'SB 1084 (2024)',
    source: 'https://www.flsenate.gov/Session/Bill/2024/1084',
    lastVerified: '2026-07-27',
  },
  {
    state: 'Alabama',
    code: 'AL',
    statute: 'SB 23 (2024)',
    source: 'https://legiscan.com/AL/bill/SB23/2024',
    lastVerified: '2026-07-27',
  },
  {
    state: 'Mississippi',
    code: 'MS',
    statute: 'SB 2400 (2025)',
    source: 'https://legiscan.com/MS/bill/SB2400/2025',
    lastVerified: '2026-07-27',
  },
  {
    state: 'Indiana',
    code: 'IN',
    statute: 'HB 1425 (2025)',
    note: 'Temporary prohibition with a stated expiration date.',
    source: 'https://iga.in.gov/legislative/2025/bills/house/1425',
    lastVerified: '2026-07-27',
  },
  {
    state: 'Montana',
    code: 'MT',
    statute: 'HB 401 (2025)',
    source: 'https://legiscan.com/MT/bill/HB401/2025',
    lastVerified: '2026-07-27',
  },
  {
    state: 'Nebraska',
    code: 'NE',
    statute: 'LB 246 (2025)',
    source: 'https://legiscan.com/NE/bill/LB246/2025',
    lastVerified: '2026-07-27',
  },
  {
    state: 'Texas',
    code: 'TX',
    statute: 'SB 261 (2025)',
    note: 'Prohibition with a stated expiration date.',
    source: 'https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89R&Bill=SB261',
    lastVerified: '2026-07-27',
  },
];

const BY_CODE = new Map(CULTIVATED_MEAT_BANS.map((law) => [law.code, law]));
const BY_NAME = new Map(
  CULTIVATED_MEAT_BANS.map((law) => [law.state.toLowerCase(), law] as const),
);

/** Accepts either a two-letter code or a full state name. */
export function findCultivatedMeatBan(state: string | null | undefined): StateLaw | null {
  if (!state) return null;
  const trimmed = state.trim();
  if (trimmed.length === 2) return BY_CODE.get(trimmed.toUpperCase()) ?? null;
  return BY_NAME.get(trimmed.toLowerCase()) ?? null;
}

export const BAN_BANNER_COPY = 'Cultivated meat sales are prohibited in this state.';
