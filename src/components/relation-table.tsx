import { forwardRef } from 'react';
import { cn } from 'cn';
import { columnLabels } from '@/engine/evaluator';
import type { Relation, Value } from '@/engine/types';

export const fmtCell = (v: Value): string => (v === null ? 'null' : String(v));

export function statsText(rel: Relation, count = rel.rows.length): string {
  return `degree ${rel.columns.length} · cardinality ${count}`;
}

interface Props {
  rel: Relation;
  keyCols?: number[];
  /** For join outputs: how many leading columns came from the left input. */
  leftCount?: number;
  /** Columns to fade (e.g. the ones π will drop). */
  dimCols?: number[];
  /** Only render the first n rows (the result table grows as the animation runs). */
  limit?: number;
  rowClass?: (i: number) => string | undefined;
  className?: string;
}

/** A relation as an HTML table. Rows carry data-i so the stage can find and measure them. */
export const RelationTable = forwardRef<HTMLDivElement, Props>(function RelationTable(
  { rel, keyCols = [], leftCount, dimCols = [], limit, rowClass, className }, ref,
) {
  const keys = new Set(keyCols);
  const dims = new Set(dimCols);
  const rows = limit === undefined ? rel.rows : rel.rows.slice(0, limit);
  return (
    <div ref={ref} className={cn('table-scroll', className)}>
      <table className="rel">
        <thead>
          <tr>
            <th className="rownum">#</th>
            {columnLabels(rel).map((label, i) => (
              <th key={i} className={cn(keys.has(i) && 'key', dims.has(i) && 'dim',
                leftCount !== undefined && (i < leftCount ? 'from-l' : 'from-r'))}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} data-i={ri} className={rowClass?.(ri)} style={{ '--i': ri } as React.CSSProperties}>
              <td className="rownum">{ri + 1}</td>
              {row.map((v, ci) => (
                <td key={ci} className={cn(v === null && 'null', keys.has(ci) && 'key', dims.has(ci) && 'dim')}>{fmtCell(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
