// Drives the built app (dist/index.html) in Chromium and checks that what the animation
// shows matches the engine: final result tables, row-by-row reveal order, and outer-join padding.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const SHOTS = process.env.SHOTS || 'shots';
import { mkdirSync } from 'node:fs';
mkdirSync(SHOTS, { recursive: true });
const exe = process.env.CHROMIUM || undefined;
const url = pathToFileURL(path.resolve('dist/index.html')).href;

const presets = JSON.parse(execFileSync('bun', ['-e', `import {PRESETS} from './src/engine/presets'; console.log(JSON.stringify(PRESETS.map(p=>({id:p.id}))))`]).toString());
const engine = JSON.parse(execFileSync('bun', ['scripts/eval-queries.ts'], { input: JSON.stringify(presets) }).toString());

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);

const visibleOutput = () => page.$$eval('#output tbody tr:not(.hidden-row)', (trs) =>
  trs.map((tr) => Array.from(tr.querySelectorAll('td')).slice(1).map((td) => td.textContent)));
// The preset picker and timeline are Radix widgets (shadcn Select / Slider), not native form controls.
async function selectPreset(id) {
  await page.click('#preset');
  await page.click(`[role=option][data-preset="${id}"]`);
  await page.waitForSelector('[role=listbox]', { state: 'detached' });
}
const scrubMax = async () => Number(await page.getAttribute('#scrub [role=slider]', 'aria-valuemax'));
const fmt = (v) => (v === null ? 'null' : String(v));

let fails = 0;
for (const exp of engine) {
  await selectPreset(exp.id);
  await page.click('#btn-last');
  const got = await visibleOutput();
  const headers = await page.$$eval('#output thead th', (ths) => ths.slice(1).map((t) => t.textContent));
  const want = exp.rows.map((r) => r.map(fmt));
  const ok = JSON.stringify(got) === JSON.stringify(want) && JSON.stringify(headers) === JSON.stringify(exp.cols);
  const narration = await page.textContent('#narration');
  const narrOk = narration.includes(`Final result: ${exp.rows.length} tuple(s)`);
  if (!ok || !narrOk) fails++;
  console.log(`${ok && narrOk ? 'PASS' : 'FAIL'}  final table  ${exp.id.padEnd(15)} ${got.length} rows  ${headers.join(', ')}`);
}

// Step through every frame of the loaded query: the result must grow one row at a time,
// exactly when the narration says a row was added / kept / padded.
async function stepThrough(name) {
  await page.click('#btn-first');
  const max = await scrubMax();
  let bad = 0, prevStage = '', prevCount = 0;
  for (let i = 0; i <= max; i++) {
    if (i > 0) await page.click('#btn-next');
    const st = await page.evaluate(() => ({
      stage: document.getElementById('stage-title').textContent,
      rows: document.querySelectorAll('#output tbody tr:not(.hidden-row)').length,
      narr: document.getElementById('narration').className,
      text: document.getElementById('narration').textContent,
      curL: document.querySelectorAll('#inputs .input-table:nth-of-type(1) tr.cur').length,
    }));
    if (st.stage !== prevStage) { prevStage = st.stage; prevCount = 0; }
    const grew = st.rows - prevCount;
    const addsRow = /joined row added|keep the row|kept, and|combine|becomes \(|copied unchanged/.test(st.text) && !/duplicate/.test(st.text);
    if (!/done|Final result/.test(st.text) && grew !== (addsRow ? 1 : 0)) { bad++; console.log('   mismatch at frame', i, st.text, 'grew', grew); }
    prevCount = st.rows;
  }
  if (bad) fails++;
  console.log(`${bad ? 'FAIL' : 'PASS'}  step-through ${name.padEnd(15)} ${max + 1} frames`);
}
for (const { id } of presets) {
  await selectPreset(id);
  await stepThrough(id);
}

// Screenshots of key moments
async function shotAt(id, frame, name, clip = '#stage') {
  await selectPreset(id);
  await page.click('#btn-first');
  for (let i = 0; i < frame; i++) await page.click('#btn-next');
  await page.waitForTimeout(900);
  await (await page.$(clip)).screenshot({ path: `${SHOTS}/${name}.png` });
}
await page.screenshot({ path: `${SHOTS}/00-initial.png`, fullPage: true });
await shotAt('full-basic', 1, '01-full-pair-match');
await shotAt('full-basic', 4, '02-full-pair-nomatch');
await shotAt('full-basic', 7, '03-full-phase-left');
await shotAt('full-basic', 8, '04-full-pad-left');
await shotAt('full-basic', 10, '05-full-pad-right');
await shotAt('full-basic', 11, '06-full-final');
await shotAt('outer-artists', 31, '07-artists-left-phase');
await shotAt('outer-artists', 32, '08-artists-left-pad');
await shotAt('dangling', 31, '09-dangling-dropped');
await selectPreset('q3-kubrick');
await page.click('#btn-last');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/10-q3-final-page.png`, fullPage: true });

// Custom query + error handling
await page.fill('#query', 'Artists ⟗ Roles ⟗ Movies');
await page.check('#bachchan');
await page.click('#run');
await page.click('#btn-last');
const customRows = (await visibleOutput()).length;
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/11-custom-final.png`, fullPage: true });
console.log(`INFO  custom Artists ⟗ Roles ⟗ Movies → ${customRows} rows; preset box says: ${await page.textContent('#preset')}`);
await page.fill('#query', "π[aName](σ[director = 'Kubrick'](Artists ⋈ Roles ⋈ Movie)");
await page.click('#run');
await page.fill('#query', "σ[year >](Movies)");
await page.click('#run');
const errText = await page.textContent('#error');
console.log('INFO  error message shown:', JSON.stringify(errText));
await (await page.$('.sidebar > :first-child')).screenshot({ path: `${SHOTS}/12-error.png` });

// ---------- Importing CSV files ----------
// The same queries verify_sqlite.py checks against SQLite, now run through the real import and animation.
const FIX = 'scripts/fixtures';
const csvSpec = JSON.parse(readFileSync(`${FIX}/csv-cases.json`, 'utf8'));
const setPaths = (set) => csvSpec.sets[set].map((f) => path.join(FIX, f));
const csvEngine = JSON.parse(execFileSync('bun', ['scripts/eval-queries.ts'], {
  input: JSON.stringify(csvSpec.cases.map((c) => ({ id: c.id, query: c.query, csv: setPaths(c.set) }))),
}).toString());
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const importActive = async () => (await page.getAttribute('[data-source="import"]', 'aria-checked')) === 'true';
const tableNames = () => page.$$eval('#base-tables [data-table]', (els) => els.map((e) => e.dataset.table).join(','));
const runQuery = async (q) => { await page.fill('#query', q); await page.click('#run'); };
const importText = () => page.textContent('#import-error').catch(() => null);

const courseQueryBefore = await page.inputValue('#query');
check(await page.isDisabled('[data-source="import"]'), 'import: "Your import" is disabled until something is imported');

await page.setInputFiles('#csv-input', setPaths('university'));
await page.waitForSelector('#base-tables [data-table="students"]');
check(await importActive(), 'import: switches to the imported tables');
check(await tableNames() === 'students,courses,enrolled', `import: one table per file (${await tableNames()})`);
check(await page.inputValue('#query') === 'students ⋈ enrolled', 'import: starter query joins two tables that share an attribute');
check(await page.evaluate(() => location.hash) === '', 'import: the query is not put in the URL (it cannot be shared)');
check((await page.textContent('#import-notes')).includes('enrolled: 1 duplicate row was removed'), 'import: notes explain removed duplicates');
check(await page.$('#bachchan') === null, 'import: the Bachchan option is hidden for imported tables');
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/16-import.png`, fullPage: true });

for (const set of Object.keys(csvSpec.sets)) {
  // Importing the next set replaces the previous import.
  if (set !== 'university') {
    await page.setInputFiles('#csv-input', setPaths(set));
    await page.waitForSelector(`#base-tables [data-table="${csvSpec.sets[set][0].replace(/\.csv$/, '').replace(/\W+/g, '_')}"]`);
    check(await tableNames() === 'Staff_List,courses', `import: a new import replaces the old one (${await tableNames()})`);
    await runQuery('students ⋈ enrolled');
    check((await page.textContent('#error')).includes('Unknown relation "students". Available: Staff_List, courses'), 'import: the replaced tables are gone');
    check((await page.textContent('#import-notes')).includes('The table is called Staff_List in queries.'), 'import: notes explain renamed tables');
  }
  for (const exp of csvEngine.filter((e) => csvSpec.cases.find((c) => c.id === e.id).set === set)) {
    await runQuery(exp.query);
    await page.click('#btn-last');
    const got = await visibleOutput();
    const headers = await page.$$eval('#output thead th', (ths) => ths.slice(1).map((t) => t.textContent));
    const narration = await page.textContent('#narration');
    const ok = !exp.error && JSON.stringify(got) === JSON.stringify(exp.rows.map((r) => r.map(fmt)))
      && JSON.stringify(headers) === JSON.stringify(exp.cols) && new RegExp(`[Rr]esult: ${exp.rows.length} tuple\\(s\\)`).test(narration);
    check(ok, `final table  ${exp.id.padEnd(15)} ${got.length} rows  ${exp.query}`);
    if (exp.id !== 'csv-bare') await stepThrough(exp.id);
  }
}

// Three-valued logic is narrated: row 6 of students has major = null.
await page.setInputFiles('#csv-input', setPaths('university'));
await page.waitForSelector('#base-tables [data-table="students"]');
await runQuery("σ[¬(major = 'CS')](students)");
await page.click('#btn-first');
for (let i = 0; i < 6; i++) await page.click('#btn-next');
check((await page.textContent('#narration')).includes("Row 6: ¬(null = 'CS') → unknown (it involves null), drop the row"), 'import: σ narrates unknown (null) comparisons');

// Switching sources keeps each side's query and data for the rest of the session.
const importQuery = await page.inputValue('#query');
await page.click('[data-source="course"]');
check(!(await importActive()) && await tableNames() === 'Movies,Artists,Roles,R1,R2', 'switch: back to the course tables');
check(await page.inputValue('#query') === courseQueryBefore, 'switch: the course query is restored');
await page.click('[data-source="import"]');
check(await importActive() && await tableNames() === 'students,courses,enrolled', 'switch: the import is still there');
check(await page.inputValue('#query') === importQuery, 'switch: the import query is restored');
await selectPreset('q2-natural');
await page.click('#btn-last');
check(!(await importActive()) && (await visibleOutput()).length === 6, 'switch: picking a slide example returns to the course tables');
await page.click('[data-source="import"]');
check(await tableNames() === 'students,courses,enrolled', 'switch: the import survives running slide examples');

// Arrow keys on the source switch move focus; they must not also step the animation.
await page.click('#btn-first');
await page.click('#btn-next');
const before = await page.getAttribute('#scrub [role=slider]', 'aria-valuenow');
await page.focus('[data-source="import"]');
await page.keyboard.press('ArrowLeft');
check(await page.getAttribute('#scrub [role=slider]', 'aria-valuenow') === before, 'keyboard: arrows on the source switch do not step the animation');

// A failed import is reported and leaves the current import untouched.
await page.setInputFiles('#csv-input', [{ name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name\n1,Ann\n2,Smith, Jr.\n') }]);
await page.waitForSelector('#import-error');
check((await importText()).includes('Line 3 of "broken.csv" has 3 values, but the header (line 1) names 2 columns.')
  && (await importText()).includes('Your previous import is unchanged.'), 'import error: bad row reported with its line number');
check(await tableNames() === 'students,courses,enrolled' && await importActive(), 'import error: previous import kept');
await (await page.$('.sidebar > :first-child')).screenshot({ path: `${SHOTS}/17-import-error.png` });
await page.setInputFiles('#csv-input', [{ name: 'grades.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\u0003\u0004') }]);
check((await importText()).includes('"grades.xlsx" is not a .csv file'), 'import error: non-CSV files are refused');

// Dropping a file anywhere on the page imports it (instead of the browser navigating away to the file).
const dt = await page.evaluateHandle(() => {
  const d = new DataTransfer();
  d.items.add(new File(['sku,price\nA1,9.5\nB2,12\n'], 'Products.csv', { type: 'text/csv' }));
  return d;
});
await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
check(await page.isVisible('text=Drop CSV files to import them'), 'drop: overlay shown while dragging a file');
await page.waitForTimeout(400); // let the overlay finish fading in
await page.screenshot({ path: `${SHOTS}/18-drop-overlay.png` });
await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
await page.waitForSelector('#base-tables [data-table="Products"]');
check(await tableNames() === 'Products' && !(await page.isVisible('text=Drop CSV files to import them'))
  && await page.$('#import-error') === null && page.url().startsWith('file:'), 'drop: dropped file imported, overlay gone');

// Nothing is stored: reloading forgets the import and starts from the course tables again.
await page.reload();
await page.waitForSelector('#base-tables [data-table="Movies"]');
const storage = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k !== 'ra-theme'));
check(await page.isDisabled('[data-source="import"]') && await tableNames() === 'Movies,Artists,Roles,R1,R2' && storage.length === 0,
  `reload: the import is gone and nothing was stored (${JSON.stringify(storage)})`);

// Mid-animation capture while actually playing (ghost rows in flight)
await selectPreset('left-basic');
await page.click('#btn-first');
await page.click('#btn-play');
await page.waitForTimeout(3150);
await page.screenshot({ path: `${SHOTS}/13-playing.png` });
await page.click('#btn-play');

// Dark mode + narrow screen
await page.emulateMedia({ colorScheme: 'dark' });
await selectPreset('theta');
await page.click('#btn-first');
for (let i = 0; i < 3; i++) await page.click('#btn-next');
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/14-dark-theta.png` });
await page.setViewportSize({ width: 420, height: 900 });
await page.screenshot({ path: `${SHOTS}/15-narrow.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
console.log('INFO  horizontal overflow at 420px:', overflow);
await page.setInputFiles('#csv-input', setPaths('staff'));
await page.waitForSelector('#base-tables [data-table="Staff_List"]');
await page.screenshot({ path: `${SHOTS}/19-narrow-import.png`, fullPage: true });
const importOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(importOverflow <= 0, `narrow: no horizontal overflow at 420px with an import (${importOverflow})`);

console.log(errors.length ? `FAIL  console errors: ${errors.join(' | ')}` : 'PASS  no console errors');
if (errors.length) fails++;
await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nAll UI checks passed');
process.exit(fails ? 1 : 0);
