import type { Verdict } from '@/lib/matcher';
import { VERDICT_LABEL } from '@/lib/matcher';

const CLASS: Record<Verdict, string> = {
  clear: 'stamp-verified',
  flagged: 'stamp-flagged',
  unknown: 'stamp-unknown',
};

/**
 * Three states, never two. "No data" is an honest and common answer, so it gets
 * the same visual weight as the other two rather than being hidden.
 */
export function VerdictStamp({
  verdict,
  size = 'lg',
  sub,
}: {
  verdict: Verdict;
  size?: 'lg' | 'sm';
  sub?: string;
}) {
  const label = VERDICT_LABEL[verdict];
  return (
    <span
      className={`stamp ${CLASS[verdict]} ${size === 'sm' ? 'stamp-sm' : 'text-xl'}`}
      role="status"
    >
      <span>{label}</span>
      {sub ? (
        <span className="text-[0.6rem] tracking-[0.12em] opacity-80 mt-0.5">{sub}</span>
      ) : null}
    </span>
  );
}
