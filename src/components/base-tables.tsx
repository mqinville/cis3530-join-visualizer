import { cn } from 'cn';
import type { Database } from '@/engine/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationTable, statsText } from './relation-table';

interface Props {
  db: Database;
  used: Set<string>;
  /** For imported tables: the file each relation came from. */
  files?: Record<string, string>;
}

export function BaseTables({ db, used, files }: Props) {
  return (
    <Card className="gap-0 py-4 shadow-(--shadow)">
      <CardHeader className="px-4">
        <CardTitle className="text-[13px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{files ? 'Your tables' : 'Tables'}</CardTitle>
      </CardHeader>
      {/* Tables sit side by side; the row scrolls horizontally when they don't all fit. */}
      <CardContent id="base-tables" className="mt-2.5 flex items-start gap-4 overflow-x-auto px-4 pb-1">
        {Object.values(db).map((rel) => {
          const inQuery = used.has(rel.name.toLowerCase());
          return (
            <div key={rel.name} data-table={rel.name} className={cn('base-table w-max max-w-[min(100%,520px)] min-w-[220px] shrink-0 transition-opacity duration-300', inQuery && 'used', used.size > 0 && !inQuery && 'opacity-60 hover:opacity-100')}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className={cn('flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold transition-colors', inQuery && 'text-primary')}>
                  <span className="truncate">{rel.name}</span>
                  {inQuery && <Badge variant="secondary" className="h-4.5 bg-brand-soft px-1.5 text-[10.5px] font-normal text-primary animate-in zoom-in-75 fade-in duration-300">in query</Badge>}
                </h3>
                <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">{statsText(rel)}</span>
              </div>
              {files?.[rel.name] && <p className="mb-1 truncate text-[11.5px] text-muted-foreground">from {files[rel.name]}</p>}
              <RelationTable rel={rel} className="compact" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
