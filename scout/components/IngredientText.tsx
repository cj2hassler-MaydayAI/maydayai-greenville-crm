import type { FlagHit } from '@/lib/matcher';

/**
 * Renders an ingredient string in mono type with every matched span highlighted
 * in place. This is the evidence — we never flag anything we cannot point at, so
 * this component is how the promise gets kept.
 */
export function IngredientText({
  text,
  hits,
  className = '',
}: {
  text: string;
  hits: FlagHit[];
  className?: string;
}) {
  const ordered = [...hits].sort((a, b) => a.start - b.start);
  const segments: React.ReactNode[] = [];
  let cursor = 0;

  ordered.forEach((hit, index) => {
    if (hit.start < cursor) return; // overlapping match already rendered
    if (hit.start > cursor) {
      segments.push(<span key={`t${index}`}>{text.slice(cursor, hit.start)}</span>);
    }
    segments.push(
      <mark key={`h${index}`} className="ingredient-hit" title={`Matched: ${hit.term}`}>
        {text.slice(hit.start, hit.end)}
      </mark>,
    );
    cursor = hit.end;
  });

  if (cursor < text.length) segments.push(<span key="tail">{text.slice(cursor)}</span>);

  return <p className={`ingredients ${className}`}>{segments}</p>;
}
