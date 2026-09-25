// Drives the built app (dist/index.html) in Chromium and checks that what the animation
// shows matches the engine: final result tables, row-by-row reveal order, and outer-join padding.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
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

// Step through every frame of every preset: the result must grow one row at a time,
// exactly when the narration says a row was added / kept / padded.
for (const { id } of presets) {
  await selectPreset(id);
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
  console.log(`${bad ? 'FAIL' : 'PASS'}  step-through ${id.padEnd(15)} ${max + 1} frames`);
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

console.log(errors.length ? `FAIL  console errors: ${errors.join(' | ')}` : 'PASS  no console errors');
if (errors.length) fails++;
await browser.close();
console.log(fails ? `\n${fails} check(s) failed` : '\nAll UI checks passed');
process.exit(fails ? 1 : 0);
