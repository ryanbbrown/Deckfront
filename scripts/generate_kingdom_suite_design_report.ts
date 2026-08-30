import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import rawSmokeManifest from '../src/sim/balance-smoke-suite-manifest.json' with { type: 'json' };
import { BALANCE_SUITE_MANIFEST } from '../src/sim/balanceSuite';
import type { BalanceSuiteManifest } from '../src/sim/balanceSuite';
import { validateBalanceSmokeSuiteManifest } from '../src/sim/balanceSmokeSuite';
import type { BalanceSmokeSuiteManifest } from '../src/sim/balanceSmokeSuite';

function escape(value: unknown): string {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function percent(value: number): string { return `${(100 * value).toFixed(2)}%`; }
interface RawHtml { html: string }
const raw = (html: string): RawHtml => ({ html });
function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const cell = (value: unknown): string => value && typeof value === 'object' && 'html' in value
    ? String((value as RawHtml).html) : escape(value);
  return `<div class="scroll"><table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function bar(value: number, maximum: number): string {
  return `<span class="bar" aria-label="${value} of ${maximum}"><i style="width:${(100 * value / maximum).toFixed(3)}%"></i></span>`;
}

export function renderKingdomSuiteDesignReport(manifest: BalanceSuiteManifest): string {
  const smoke = validateBalanceSmokeSuiteManifest(rawSmokeManifest as unknown as BalanceSmokeSuiteManifest);
  const candidates = manifest.selection.candidates;
  const maximumTriples = manifest.statistics.tripleTotal;
  const candidateRows = candidates.map((candidate) => [candidate.count, `${candidate.tuningSize}/${candidate.validationSize}`,
    candidate.cardMinimum, candidate.pairMinimum, candidate.validationPairMinimum,
    `${candidate.priorityPairMinimum}/${candidate.validationPriorityPairMinimum}`,
    `${candidate.requiredTripleMinimum}/${candidate.validationRequiredTripleMinimum}`,
    raw(`${candidate.tripleCovered} ${bar(candidate.tripleCovered, maximumTriples)}`), percent(candidate.tripleCoverage),
    candidate.largestOverlap, candidate.overlapP99, candidate.passed ? 'PASS' : candidate.failures.join('; ')]);
  const selected = candidates.find((candidate) => candidate.count === manifest.chosenCount)!;
  const routeRows = Object.entries(selected.routeCounts).map(([label, count]) => [label, count,
    selected.validationRouteCounts[label as keyof typeof selected.validationRouteCounts],
    manifest.thresholds.routes[label as keyof typeof manifest.thresholds.routes].fullMinimum]);
  const overlapRows = Object.entries(manifest.statistics.overlap.histogram).map(([amount, count]) => [amount, count,
    Number(amount) / (20 - Number(amount))]);
  const n = manifest.chosenCount;
  const one = {
    localHours: n * 30.005 / 3600, modalHours: n * 84.479 / 3600,
    reservoirLow: n * 42.6 / 3600, reservoirMean: n * 68.8 / 3600, reservoirHigh: n * 90.9 / 3600,
    productLow: n * 0.010355, productHigh: n * 0.018497,
    reservation: n * 0.281925, ordered: n * 0.37159
  };
  const authoredRows = manifest.kingdoms.filter((kingdom) => kingdom.provenance.kind === 'authored')
    .map((kingdom) => [kingdom.id, kingdom.split, kingdom.provenance.rationaleId, kingdom.provenance.reason]);
  const smokeRows = smoke.selection.candidates.map((candidate) => [candidate.count,
    `${candidate.cardMinimum}–${candidate.cardMaximum}`, `${candidate.pairCovered} of ${candidate.pairTotal}`,
    percent(candidate.pairCoverage), `${candidate.priorityPairCovered} of ${candidate.priorityPairTotal}`,
    `${candidate.requiredTripleCovered} of ${candidate.requiredTripleTotal}`,
    `${candidate.tripleCovered} of ${candidate.tripleTotal}`, percent(candidate.tripleCoverage)]);
  const selectedSmoke = smoke.selection.candidates.find((candidate) => candidate.count === smoke.selectedCount)!;
  const rawPilotRows = manifest.rawFeasibilityPilot.map((candidate) => [candidate.count,
    `${candidate.cardMinimum}–${candidate.cardMaximum}`, `${candidate.pairMinimum}–${candidate.pairMaximum}`,
    candidate.tripleCovered, percent(candidate.tripleCoverage), candidate.maximumOverlap]);
  const randomRows = manifest.randomBaselines.candidates.map((candidate) => [candidate.count,
    candidate.cardExpected, candidate.pairExpected, candidate.tripleExpected,
    candidate.expectedUncoveredPairs, candidate.expectedUncoveredTriples,
    percent(candidate.everyPairOnceSuccessLower), percent(candidate.everyCardFortySuccessLower),
    percent(candidate.everyPairEightSuccessLower), percent(candidate.priorityPairTwelveSuccessLower),
    percent(candidate.requiredTripleFourSuccessLower)]);
  const comparisonRows = candidates.map((candidate) => [candidate.count, candidate.overlapMean,
    manifest.randomBaselines.randomOverlap.expected, candidate.jaccardMean,
    manifest.randomBaselines.randomOverlap.expectedJaccard]);
  const lowerBoundRows = Object.entries(manifest.deterministicLowerBounds).map(([name, count]) => [name, count]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kingdom suite design</title><style>
:root{--ink:#18231f;--muted:#59655f;--paper:#f4f1e8;--panel:#fff;--line:#ccd6d0;--accent:#096b4b;--soft:#e5f1eb;--warn:#9a481c}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif}main{max-width:1450px;margin:auto;padding:34px 24px 70px}h1{font-size:clamp(36px,6vw,64px);line-height:1;margin:0 0 12px}h2{font-size:27px}section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px;margin:20px 0}.callouts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.callouts div{background:var(--soft);border-radius:8px;padding:13px}.callouts strong{display:block;color:var(--accent);font-size:25px}.scroll{overflow:auto;border:1px solid var(--line);border-radius:8px}table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5eae7;vertical-align:top}th{background:#edf3ef;font-size:12px;text-transform:uppercase}.bar{display:inline-block;width:130px;height:8px;background:#e6ebe8;border-radius:4px;margin-left:6px}.bar i{display:block;height:100%;background:var(--accent);border-radius:4px}code{font:13px ui-monospace,monospace}.warning{border-color:var(--warn)}p{max-width:100ch;color:var(--muted)}</style></head><body><main>
<header><h1>Kingdom suite design</h1><p>Version ${escape(manifest.suiteVersion)} · manifest digest <code>${escape(manifest.digest)}</code></p><div class="callouts"><div><strong>${manifest.chosenCount}</strong>kingdoms</div><div><strong>${manifest.statistics.cardCountMinimum}</strong>appearances per card</div><div><strong>${manifest.statistics.pairCovered} / ${manifest.statistics.pairTotal}</strong>pairs, at least ${manifest.statistics.pairCountMinimum} times</div><div><strong>${manifest.statistics.tripleCovered} / ${manifest.statistics.tripleTotal}</strong>triples covered</div></div></header>
<section><h2>Core reason for ${manifest.chosenCount}</h2><p>${manifest.cardPool.variableCount} variable cards need ${manifest.cardPool.variableCount * manifest.thresholds.card.fullMinimum} total pile slots to appear ${manifest.thresholds.card.fullMinimum} times each. At ${manifest.kingdomSize} variable piles per kingdom, that is exactly ${manifest.chosenCount} kingdoms. The deterministic design then uses those slots well: every pair appears at least ${manifest.statistics.pairCountMinimum} times, all ${manifest.interactions.priorityPairs.length} named pairs appear at least ${manifest.thresholds.pair.priorityFullMinimum} times, all ${manifest.interactions.requiredTriples.length} named triples appear at least ${manifest.thresholds.triple.requiredFullMinimum} times, and ${percent(manifest.statistics.tripleCoverage)} of all triples appear at least once.</p><p>The ${manifest.splits.find((split) => split.name === 'tuning')!.size} tuning kingdoms support repeated balance work. The ${manifest.splits.find((split) => split.name === 'validation')!.size} validation kingdoms stay held back until a proposed change is ready to check. This split is a workflow guard, not a claim that ${manifest.thresholds.card.fullMinimum} contexts is the only valid threshold.</p></section>
<section><h2>Why the old suite had 100 rows</h2><p>BB thread <code>thr_ghnwzhzcbh</code> records the decision. Event 64604 proposed 100 because runs were fast enough and asked for low overlap. Event 64751 counted 19 eligible cards and expected about 53 card appearances and 26 pair appearances. Event 64756 accepted it. Plan 20 fixed 80 tuning and 20 validation rows. It did not include a power calculation or a size comparison.</p><p><code>balanced-swaps-v1</code> assigned floor or ceiling card quotas in each split, built rows with seeded quota and pair-pressure scoring, rejected duplicates and overlap above eight, then ran 500 quota-preserving two-row swaps to reduce pair-count squares. Tuning used seed <code>0x51a7c3d9</code>; validation used <code>0xc04f82b1</code> and treated tuning rows as overlap constraints.</p><p>The committed v1 suite covered all 171 pairs and 969 triples from 19 cards. Cards appeared 52–53 times, pairs 24–31 times, triples 7–17 times, and maximum overlap was 8. That dense result does not transfer to 40 cards.</p></section>
<section><h2>Exact random baseline</h2><p>The production space is <strong>40 choose 10 = 847,660,528</strong>, not the approximate <strong>45 choose 10 = 3,190,187,286</strong>. For 40 cards, a named card has probability <code>1/4</code>, a pair <code>3/52</code>, and a triple <code>3/247</code>. Expected uncovered interactions after m rows are <code>N × (1-p)^m</code>. The repeated-coverage union bound is <code>N × Σ(i=0…r-1) choose(m,i) p^i (1-p)^(m-i)</code>.</p>${table(['Rows','Card mean','Pair mean','Triple mean','Expected missing pairs','Expected missing triples','All pairs once ≥','All cards 40× ≥','All pairs 8× ≥','Named pairs 12× ≥','Named triples 4× ≥'], randomRows)}<p>Conservative 95% random bounds are 24 rows for every card once, 163 for every pair once, 998 for every triple once, 236 for every card 40 times, 401 for every pair 8 times, 455 for the 96 priority pairs 12 times, and 1,090 for the 60 required triples 4 times.</p><h3>Deterministic lower bounds</h3>${table(['Bound','Rows'], lowerBoundRows)}</section>
<section><h2>Raw feasibility pilot</h2><p>This fixed-seed pilot used the old unconstrained greedy generator. It checked whether broad triple coverage had headroom before the constrained search. It did not include authored-row balancing, the overlap-six rule, or the final interaction thresholds.</p>${table(['Rows','Card range','Pair range','Covered triples','Triple share','Max overlap'], rawPilotRows)}</section>
<section><h2>Candidate coverage curve and decision</h2>${table(['Rows','Split','Card min','Pair min','Validation pair min','Priority full/validation','Required triple full/validation','Covered triples','Triple share','Max overlap','P99 overlap','Decision'], candidateRows)}<p>Counts below ${manifest.chosenCount} fail the ${manifest.thresholds.card.fullMinimum}-card exposure lower bound. The ${manifest.chosenCount}-row design is the first passing count. The 200-row extension shows diminishing returns: it adds ${manifest.selection.candidates.find((candidate) => candidate.count === 200)!.tripleCovered - selected.tripleCovered} newly covered triples but does not change the first passing point.</p></section>
<section><h2>Thirty-kingdom smoke suite</h2><p>The recommended smoke set uses only tuning kingdoms. Its purpose is process testing, not final balance evidence. It covers all 40 cards, all 96 named pairs, all 60 named triples, and all 14 route labels. It covers ${selectedSmoke.pairCovered} of 780 broad pairs and ${selectedSmoke.tripleCovered} of 9,880 broad triples. The committed IDs and full curve are in <code>balance-smoke-suite-manifest.json</code>.</p>${table(['Rows','Card range','Broad pairs','Pair share','Named pairs','Named triples','Broad triples','Triple share'], smokeRows)}<p>No validation row is needed to meet the smoke requirements, so the selected set preserves the held-back validation corpus.</p></section>
<section><h2>Card mechanics and playable routes</h2><p>A mechanic is a card behavior such as draw, movement, trash, Mana generation, or damage. These checks prevent a mathematically broad suite from omitting a usable economy, attack, or engine route.</p>${table(['Route label','Full rows','Validation rows','Required full'], routeRows)}</section>
<section><h2>Secondary duplicate guard</h2><p>Distinctness only checks that the suite does not spend rows on near-duplicates. The selected suite has no duplicates and no two rows share more than ${manifest.statistics.overlap.maximum} variable cards. Jaccard is overlap divided by the combined unique cards.</p>${table(['Rows','Deterministic mean overlap','Random mean overlap','Deterministic mean Jaccard','Random mean Jaccard'], comparisonRows)}${table(['Shared cards','Row pairs','Jaccard'], overlapRows)}</section>
<section><h2>Anchors and controls</h2>${table(['Suite ID','Split','Rationale','Measurement need'], authoredRows)}</section>
<section class="warning"><h2>Residual blind spots</h2><p>${manifest.residualBlindSpots.uncoveredTripleCount} unprioritized triples remain uncovered. The manifest records their family patterns. All 60 named triples appear at least four times and once in validation. The suite does not guarantee complete four-card or higher-order coverage. Deterministic combinatorial coverage does not prove card balance, causal effects, representative random-population estimates, or strategy-search closure.</p></section>
<section><h2>Conditional future campaign estimate</h2>${table(['Scope','Local 500k pool','Modal product time','Fixed-reservoir time','Measured product cost','Worst reservation','Ordered-space cost'],[
['One pool per kingdom',`${one.localHours.toFixed(2)} h`,`${one.modalHours.toFixed(2)} h`,`${one.reservoirLow.toFixed(2)}–${one.reservoirHigh.toFixed(2)} h; mean ${one.reservoirMean.toFixed(2)} h`,`$${one.productLow.toFixed(2)}–$${one.productHigh.toFixed(2)}`,`$${one.reservation.toFixed(2)}`,`$${one.ordered.toFixed(2)}`],
['Three pools per kingdom',`${(3*one.localHours).toFixed(2)} h`,`${(3*one.modalHours).toFixed(2)} h`,`${(3*one.reservoirLow).toFixed(2)}–${(3*one.reservoirHigh).toFixed(2)} h`,`$${(3*one.productLow).toFixed(2)}–$${(3*one.productHigh).toFixed(2)}`,`$${(3*one.reservation).toFixed(2)}`,`$${(3*one.ordered).toFixed(2)}`]
])}<p>Inputs are 30.005 seconds local and 84.479 seconds Modal for a 500,000-policy pool; 42.6–90.9 seconds, mean 68.8, for fixed-reservoir PSRO; $0.010355–$0.018497 measured product cost; $0.281925 worst reservation; and $0.37159 ordered-space measured cost per pool. The final multiplier, attack work, runtime, cost, and artifact contract remain pending the Kingdom 009 consistency protocol. This estimate does not authorize spending.</p></section>
</main></body></html>\n`;
}

export function generateKingdomSuiteDesignReport(root: string, output?: string): string {
  const target = output ?? path.join(root, '.html', 'kingdom-suite-design.html');
  const html = renderKingdomSuiteDesignReport(BALANCE_SUITE_MANIFEST);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== html) throw new Error(`Kingdom-suite design report is stale: ${target}`);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html);
  }
  return target;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (outputIndex >= 0 && !output) throw new Error('--output needs a file.');
  const target = generateKingdomSuiteDesignReport(process.cwd(), output ? path.resolve(output) : undefined);
  process.stdout.write(`${process.argv.includes('--check') ? 'Verified' : 'Wrote'} ${target}\n`);
}
