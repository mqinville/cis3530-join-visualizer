import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, GraduationCap, Info, TriangleAlert, Upload } from 'lucide-react';
import { checkFileSize, CsvError, importCsvFiles, type CsvFile, type ImportedDatabase } from '@/engine/csv';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/** Which tables queries run against: the slide tables, or the student's own CSV import. */
export type Source = 'course' | 'import';

/** CSV files are usually UTF-8, but older Excel versions save "CSV" in Windows-1252. */
async function readCsvFile(f: File): Promise<CsvFile> {
  checkFileSize(f.name, f.size);
  const buf = await f.arrayBuffer();
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { text = new TextDecoder('windows-1252').decode(buf); }
  return { name: f.name, text };
}

interface Props {
  source: Source;
  imported: ImportedDatabase | null;
  onSource: (s: Source) => void;
  onImport: (imp: ImportedDatabase) => void;
}

export function DatabasePanel({ source, imported, onSource, onImport }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Nothing is stored: the import lives in React state only, so it is gone when the page is closed or reloaded.
  const importFiles = async (list: File[]) => {
    if (!list.length) return;
    try {
      const imp = importCsvFiles(await Promise.all(list.map(readCsvFile)));
      setError(null);
      onImport(imp);
    } catch (err) {
      setError(err instanceof CsvError ? err.message : `Could not read the file: ${(err as Error).message}`);
      setErrorKey((k) => k + 1);
    }
  };
  const importRef = useRef(importFiles);
  importRef.current = importFiles;

  // Files can be dropped anywhere on the page. Without this, dropping a file would make the browser
  // navigate to it and the session (including any import) would be lost.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDragging(false); } };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void importRef.current(Array.from(e.dataTransfer!.files));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const notes = imported?.tables.flatMap((t) => t.notes.map((n) => `${t.relation.name}: ${n}`)) ?? [];

  return (
    <Card className="gap-0 py-4 shadow-(--shadow)">
      <CardHeader className="px-4">
        <CardTitle className="text-[13px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Database</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <ToggleGroup id="db-source" type="single" variant="outline" aria-label="Tables to query" value={source}
          onValueChange={(v) => v && onSource(v as Source)} className="mt-2.5 w-full bg-card">
          <ToggleGroupItem value="course" data-source="course" className="flex-1 data-[state=on]:font-semibold">
            <GraduationCap />Course tables
          </ToggleGroupItem>
          <ToggleGroupItem value="import" data-source="import" disabled={!imported} className="flex-1 data-[state=on]:font-semibold"
            title={imported ? undefined : 'Import a CSV file first'}>
            <FileSpreadsheet />Your import
          </ToggleGroupItem>
        </ToggleGroup>

        <input ref={input} id="csv-input" type="file" accept=".csv,text/csv" multiple hidden
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void importFiles(files); }} />
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Button id="import-csv" variant="outline" size="sm" onClick={() => input.current?.click()} className="group bg-card hover:border-primary hover:text-primary">
            <Upload className="transition-transform group-hover:-translate-y-0.5" />{imported ? 'Replace import…' : 'Import CSV…'}
          </Button>
          <span className="text-xs text-muted-foreground">or drop .csv files on the page</span>
        </div>

        <div id="import-status" className="mt-2 text-[12.5px] text-muted-foreground">
          {imported ? (
            <>
              <p>
                <span className="font-medium text-foreground">{imported.tables.length} table{imported.tables.length === 1 ? '' : 's'}</span> from{' '}
                {imported.tables.map((t) => t.file).join(', ')}. Kept only while this page is open; importing again replaces it.
              </p>
              {notes.length > 0 && (
                <ul id="import-notes" className="mt-1.5 flex flex-col gap-0.5">
                  {notes.map((n) => <li key={n} className="flex gap-1.5"><Info className="mt-0.5 size-3.5 flex-none text-primary" />{n}</li>)}
                </ul>
              )}
            </>
          ) : (
            <p>
              Use your own tables: choose one or more <code>.csv</code> files. The first line lists the column names and each
              following line is a row. Each file becomes a table named after the file.
            </p>
          )}
        </div>

        {error && (
          <Alert key={errorKey} id="import-error" variant="destructive" className="mt-3 border-nomatch/40 bg-nomatch-soft animate-in fade-in slide-in-from-top-1 duration-300 [&>svg]:animate-[row-shake_0.4s]">
            <TriangleAlert />
            <AlertDescription className="text-[13px] text-nomatch">
              {error}{imported && ' Your previous import is unchanged.'}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      {dragging && (
        <div aria-hidden className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-2 text-primary animate-in zoom-in-95 duration-300 ease-(--ease-spring)">
            <Upload className="size-8" />
            <p className="text-base font-semibold">Drop CSV files to import them</p>
            <p className="text-[13px] text-muted-foreground">Each file becomes one table{imported ? ' and replaces your current import' : ''}.</p>
          </div>
        </div>
      )}
    </Card>
  );
}
