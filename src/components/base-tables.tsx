import { cn } from 'cn';
import { buildDatabase } from '@/engine/data';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RelationTable, statsText } from './relation-table';

export function BaseTables({ bachchan, used }: { bachchan: boolean; used: Set<string> }) {
  const db = buildDatabase(bachchan);
  return (
    <Card className="gap-0 py-4 shadow-(--shadow)">
      <CardHeader className="px-4">
        <CardTitle className="text-[13px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Tables</CardTitle>
      </CardHeader>
      <CardContent id="base-tables" className="mt-2.5 flex flex-col gap-3 px-4">
        {Object.values(db).map((rel) => {
          const inQuery = used.has(rel.name.toLowerCase());
          return (
            <div key={rel.name} className={cn('base-table transition-opacity duration-300', inQuery && 'used', used.size > 0 && !inQuery && 'opacity-60 hover:opacity-100')}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className={cn('flex items-center gap-1.5 text-[13.5px] font-semibold transition-colors', inQuery && 'text-primary')}>
                  {rel.name}
                  {inQuery && <Badge variant="secondary" className="h-4.5 bg-brand-soft px-1.5 text-[10.5px] font-normal text-primary animate-in zoom-in-75 fade-in duration-300">in query</Badge>}
                </h3>
                <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">{statsText(rel)}</span>
              </div>
              <RelationTable rel={rel} className="compact" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
