import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  ALWAYS_AVAILABLE_ACTION_IDS, CARDS, VARIABLE_ACTION_IDS
} from '../src/game';
import { balanceSuite } from '../src/sim/balanceSuite';
import {
  buildBalanceReportModel, family, loadArtifactDirectory, selfPlayFor
} from './generate_balance_report';
import { classifyStrategyDamage } from './generate_balance_corpus';

export interface StrategyReportCardInput {
  id: string;
  name: string;
  family: string;
  cost: number;
  text: string;
  alwaysAvailable: boolean;
}

export interface StrategyReportStrategyInput {
  id: string;
  status: 'Lottery' | 'Near 50%' | '40% viable';
  weight: number;
  score: number;
  damageType: string;
  startingBuild: string[];
  acquisitionRates: Record<string, number>;
  buyAgenda?: readonly { cardId: string }[];
  repeatPurchase?: string;
}

export interface StrategyReportKingdomInput {
  id: string;
  availableCardIds: string[];
  strategies: StrategyReportStrategyInput[];
}

export interface StrategyReportInput {
  suiteVersion: string;
  kingdoms: StrategyReportKingdomInput[];
  cards: StrategyReportCardInput[];
}

export interface StrategyTypeMeasure { label: string; share: number; kingdoms: number }
export interface CardSelectionMeasure {
  cardId: string;
  offeredKingdoms: number;
  eligibleKingdoms: number;
  startingRate: number;
  acquisitionRate: number;
  selectionRate: number;
  meanOwnedCopies: number;
}
export interface PairSelectionMeasure {
  firstCardId: string;
  secondCardId: string;
  both: number;
  firstOnly: number;
  secondOnly: number;
  neither: number;
  eligibleKingdoms: number;
}
export type PureStrategyFamily = 'Mage' | 'Melee' | 'Ranged';
export type CompetitiveDepthScope = 'lottery' | 'atLeast48' | 'atLeast45' | 'atLeast40';
export interface CompetitiveDepthMeasure {
  family: PureStrategyFamily;
  counts: Record<CompetitiveDepthScope, number>;
}
export interface CompetitiveDepthFamilyCountMeasure {
  familyCount: 0 | 1 | 2 | 3 | '2 or 3';
  counts: Record<CompetitiveDepthScope, number>;
}
export interface FamilyCardSelectionMeasure {
  cardId: string;
  offeredSelectionRate: number;
  overallSelectionRate: number;
  offeredKingdoms: number;
}
export interface FamilyRelationshipModel {
  family: PureStrategyFamily;
  eligibleKingdoms: number;
  cardIds: string[];
  cards: FamilyCardSelectionMeasure[];
  pairs: PairSelectionMeasure[];
}
export interface StrategyReportModel {
  evidence: {
    suiteVersion: string;
    kingdoms: number;
    variableCardOfferCounts: Record<string, number>;
    alwaysAvailableCardIds: string[];
  };
  cards: StrategyReportCardInput[];
  eligibleKingdoms: number;
  eligibleStrategies: number;
  strategyTypes: StrategyTypeMeasure[];
  cardSelection: CardSelectionMeasure[];
  familyRelationships: FamilyRelationshipModel[];
  competitiveDepth: {
    kingdoms: number;
    families: CompetitiveDepthMeasure[];
    familyCounts: CompetitiveDepthFamilyCountMeasure[];
  };
}

const PURE_FAMILIES: readonly PureStrategyFamily[] = ['Mage', 'Melee', 'Ranged'];

function lotteryStrategies(
  kingdom: StrategyReportKingdomInput, familyName?: PureStrategyFamily
): StrategyReportStrategyInput[] {
  return kingdom.strategies.filter((strategy) => strategy.status === 'Lottery'
    && (familyName === undefined || strategy.damageType === familyName));
}

function normalizedWeights(strategies: readonly StrategyReportStrategyInput[]): number[] {
  if (!strategies.length) return [];
  const total = strategies.reduce((sum, strategy) => sum + strategy.weight, 0);
  return total > 0
    ? strategies.map((strategy) => strategy.weight / total)
    : strategies.map(() => 1 / strategies.length);
}

function startingCopies(strategy: StrategyReportStrategyInput, cardId: string): number {
  return strategy.startingBuild.filter((id) => id === cardId).length;
}
function acquiredCopies(strategy: StrategyReportStrategyInput, cardId: string): number {
  return strategy.acquisitionRates[cardId] ?? 0;
}
function usesCard(strategy: StrategyReportStrategyInput, cardId: string): boolean {
  return startingCopies(strategy, cardId) > 0 || acquiredCopies(strategy, cardId) > 0;
}

function buildStrategyTypes(input: StrategyReportInput): {
  eligibleKingdoms: number; eligibleStrategies: number; strategyTypes: StrategyTypeMeasure[]
} {
  const rows = input.kingdoms.map((kingdom) => {
    const strategies = lotteryStrategies(kingdom);
    return { strategies, weights: normalizedWeights(strategies) };
  }).filter((row) => row.strategies.length > 0);
  const totals = new Map<string, { share: number; kingdoms: number }>();
  for (const row of rows) {
    const present = new Set<string>();
    row.strategies.forEach((strategy, index) => {
      const current = totals.get(strategy.damageType) ?? { share: 0, kingdoms: 0 };
      current.share += row.weights[index]!;
      totals.set(strategy.damageType, current);
      present.add(strategy.damageType);
    });
    for (const label of present) totals.get(label)!.kingdoms += 1;
  }
  return {
    eligibleKingdoms: rows.length,
    eligibleStrategies: rows.reduce((sum, row) => sum + row.strategies.length, 0),
    strategyTypes: [...totals.entries()].map(([label, values]) => ({
      label, share: rows.length ? values.share / rows.length : 0, kingdoms: values.kingdoms
    })).sort((left, right) => right.share - left.share || left.label.localeCompare(right.label))
  };
}

function buildCardSelection(input: StrategyReportInput): CardSelectionMeasure[] {
  return input.cards.map((card): CardSelectionMeasure => {
    const offered = input.kingdoms.filter((kingdom) => kingdom.availableCardIds.includes(card.id));
    const rows = offered.map((kingdom) => {
      const strategies = lotteryStrategies(kingdom);
      return { strategies, weights: normalizedWeights(strategies) };
    }).filter((row) => row.strategies.length > 0);
    let startingRate = 0, acquisitionRate = 0, selectionRate = 0, meanOwnedCopies = 0;
    for (const row of rows) row.strategies.forEach((strategy, index) => {
      const weight = row.weights[index]!;
      const starting = startingCopies(strategy, card.id), acquired = acquiredCopies(strategy, card.id);
      startingRate += weight * Number(starting > 0);
      acquisitionRate += weight * Number(acquired > 0);
      selectionRate += weight * Number(starting > 0 || acquired > 0);
      meanOwnedCopies += weight * (starting + acquired);
    });
    const divisor = rows.length || 1;
    return {
      cardId: card.id, offeredKingdoms: offered.length, eligibleKingdoms: rows.length,
      startingRate: startingRate / divisor, acquisitionRate: acquisitionRate / divisor,
      selectionRate: selectionRate / divisor, meanOwnedCopies: meanOwnedCopies / divisor
    };
  });
}

function buildFamilyRelationships(
  input: StrategyReportInput, familyName: PureStrategyFamily
): FamilyRelationshipModel {
  const cardIds = input.cards.filter((card) => card.family === familyName).map((card) => card.id);
  const familyRows = input.kingdoms.map((kingdom) => {
    const strategies = lotteryStrategies(kingdom, familyName);
    return { kingdom, strategies, weights: normalizedWeights(strategies) };
  }).filter((row) => row.strategies.length > 0);
  const cards = cardIds.map((cardId): FamilyCardSelectionMeasure => {
    const rows = familyRows.filter((row) => row.kingdom.availableCardIds.includes(cardId));
    const selected = rows.reduce((total, row) => total + row.strategies.reduce((sum, strategy, index) =>
      sum + row.weights[index]! * Number(usesCard(strategy, cardId)), 0), 0);
    return {
      cardId,
      offeredSelectionRate: selected / (rows.length || 1),
      overallSelectionRate: selected / (familyRows.length || 1),
      offeredKingdoms: rows.length
    };
  });
  const pairs: PairSelectionMeasure[] = [];
  for (let first = 0; first < cardIds.length; first += 1) {
    for (let second = first + 1; second < cardIds.length; second += 1) {
      const firstCardId = cardIds[first]!, secondCardId = cardIds[second]!;
      const rows = familyRows.filter((row) => row.kingdom.availableCardIds.includes(firstCardId)
        && row.kingdom.availableCardIds.includes(secondCardId));
      let both = 0, firstOnly = 0, secondOnly = 0, neither = 0;
      for (const row of rows) row.strategies.forEach((strategy, index) => {
        const weight = row.weights[index]!;
        const hasFirst = usesCard(strategy, firstCardId), hasSecond = usesCard(strategy, secondCardId);
        if (hasFirst && hasSecond) both += weight;
        else if (hasFirst) firstOnly += weight;
        else if (hasSecond) secondOnly += weight;
        else neither += weight;
      });
      const divisor = rows.length || 1;
      both /= divisor; firstOnly /= divisor; secondOnly /= divisor; neither /= divisor;
      pairs.push({ firstCardId, secondCardId, both, firstOnly, secondOnly, neither,
        eligibleKingdoms: rows.length });
    }
  }
  return { family: familyName, eligibleKingdoms: familyRows.length, cardIds, cards, pairs };
}

export function buildStrategyReportModel(input: StrategyReportInput): StrategyReportModel {
  const depthPredicates: Record<CompetitiveDepthScope, (strategy: StrategyReportStrategyInput) => boolean> = {
    lottery: (strategy) => strategy.status === 'Lottery',
    atLeast48: (strategy) => strategy.status === 'Lottery' || strategy.score >= 0.48,
    atLeast45: (strategy) => strategy.status === 'Lottery' || strategy.score >= 0.45,
    atLeast40: (strategy) => strategy.status === 'Lottery' || strategy.score >= 0.4
  };
  const depthScopes = Object.keys(depthPredicates) as CompetitiveDepthScope[];
  const familySets = Object.fromEntries(depthScopes.map((scope) => [
    scope,
    input.kingdoms.map((kingdom) => new Set(kingdom.strategies
      .filter((strategy) => PURE_FAMILIES.includes(strategy.damageType as PureStrategyFamily)
        && depthPredicates[scope](strategy))
      .map((strategy) => strategy.damageType as PureStrategyFamily)))
  ])) as Record<CompetitiveDepthScope, Set<PureStrategyFamily>[]>;
  const countsFor = (
    predicate: (families: ReadonlySet<PureStrategyFamily>) => boolean
  ): Record<CompetitiveDepthScope, number> => Object.fromEntries(depthScopes
    .map((scope) => [scope, familySets[scope].filter(predicate).length])) as Record<CompetitiveDepthScope, number>;
  const competitiveDepth = {
    kingdoms: input.kingdoms.length,
    families: PURE_FAMILIES.map((familyName): CompetitiveDepthMeasure => ({
      family: familyName, counts: countsFor((families) => families.has(familyName))
    })),
    familyCounts: ([0, 1, 2, 3] as const).map((familyCount): CompetitiveDepthFamilyCountMeasure => ({
      familyCount, counts: countsFor((families) => families.size === familyCount)
    })).concat([{ familyCount: '2 or 3' as const, counts: countsFor((families) => families.size >= 2) }])
  };
  const types = buildStrategyTypes(input);
  const variableCardOfferCounts = Object.fromEntries(input.cards.filter((card) => !card.alwaysAvailable)
    .map((card) => [card.id, input.kingdoms.filter((kingdom) => kingdom.availableCardIds.includes(card.id)).length]));
  return {
    evidence: {
      suiteVersion: input.suiteVersion, kingdoms: input.kingdoms.length, variableCardOfferCounts,
      alwaysAvailableCardIds: input.cards.filter((card) => card.alwaysAvailable).map((card) => card.id)
    },
    cards: input.cards,
    ...types,
    cardSelection: buildCardSelection(input),
    familyRelationships: PURE_FAMILIES.map((familyName) => buildFamilyRelationships(input, familyName)),
    competitiveDepth
  };
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderStrategyReport(model: StrategyReportModel): string {
  const depth = model.competitiveDepth;
  const depthPercent = (count: number) => `${(100 * count / (depth.kingdoms || 1)).toFixed(1)}%`;
  const depthScopes: readonly CompetitiveDepthScope[] = ['lottery', 'atLeast48', 'atLeast45', 'atLeast40'];
  const depthCells = (counts: Record<CompetitiveDepthScope, number>) => depthScopes
    .map((scope) => `<td><strong>${depthPercent(counts[scope])}</strong><small>${counts[scope]} of ${depth.kingdoms}</small></td>`).join('');
  const familyDepthRows = depth.families.map((measure) =>
    `<tr><td><strong>${measure.family}</strong></td>${depthCells(measure.counts)}</tr>`).join('');
  const familyCountRows = depth.familyCounts.map((measure) =>
    `<tr${measure.familyCount === '2 or 3' ? ' class="summary-row"' : ''}><td><strong>${measure.familyCount} ${measure.familyCount === 1 ? 'family' : 'families'}</strong></td>${depthCells(measure.counts)}</tr>`).join('');
  const typeBars = model.strategyTypes.map((type) => `<div class="bar-row"><strong>${escape(type.label)}</strong><div class="bar"><i style="width:${(type.share * 100).toFixed(1)}%"></i></div><span>${(type.share * 100).toFixed(1)}%</span></div>`).join('');
  const cardRows = model.cardSelection.slice().sort((left, right) => right.selectionRate - left.selectionRate
    || model.cards.find((card) => card.id === left.cardId)!.name.localeCompare(model.cards.find((card) => card.id === right.cardId)!.name)).map((measure) => {
    const card = model.cards.find((entry) => entry.id === measure.cardId)!;
    return `<tr><td><strong>${escape(card.name)}</strong><small>${escape(card.family)} · ${card.cost} coins</small></td><td>${measure.offeredKingdoms} kingdoms</td><td><strong>${(measure.selectionRate * 100).toFixed(1)}%</strong><small>${measure.eligibleKingdoms} eligible kingdoms</small></td><td>${(measure.startingRate * 100).toFixed(1)}%</td><td>${(measure.acquisitionRate * 100).toFixed(1)}%</td><td>${measure.meanOwnedCopies.toFixed(2)}</td></tr>`;
  }).join('');
  const familyPanels = model.familyRelationships.map((relationship) => {
    const usageRows = relationship.cards.slice().sort((left, right) =>
      right.offeredSelectionRate - left.offeredSelectionRate).map((measure) => `<tr><td><strong>${escape(model.cards.find((card) => card.id === measure.cardId)!.name)}</strong></td><td><strong>${(measure.offeredSelectionRate * 100).toFixed(1)}%</strong><small>${measure.offeredKingdoms} kingdoms offered this card</small></td><td><strong>${(measure.overallSelectionRate * 100).toFixed(1)}%</strong><small>${relationship.eligibleKingdoms} pure-${relationship.family} kingdoms</small></td></tr>`).join('');
    return `<article class="family-panel" data-family="${relationship.family}"><h3>${relationship.family}</h3><h4>Card usage</h4><div class="table-scroll"><table><thead><tr><th>Card</th><th>Usage when offered</th><th>Overall ${relationship.family} usage</th></tr></thead><tbody>${usageRows}</tbody></table></div><h4 class="combination-heading">Card combinations</h4><div class="matrix-scroll" data-matrix></div><div class="pair-detail"><div><h4 data-pair-title>Select a pair</h4><p data-pair-summary>Select a cell to see the conditional shares.</p></div><div><div class="stack" data-pair-stack></div><div class="legend" data-pair-legend></div></div></div></article>`;
  }).join('');
  const embedded = JSON.stringify(model).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strategy distribution report</title><style>
:root{color-scheme:light;--ink:#17231d;--muted:#5a665f;--paper:#f4f1e9;--panel:#fff;--line:#ced7d1;--accent:#096b4b;--accent-soft:#e3f1eb}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.48 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1500px;margin:auto;padding:32px 26px 72px}h1{font-size:clamp(34px,5vw,58px);line-height:1;margin:0 0 12px}h2{font-size:27px;margin:0 0 8px}h3{font-size:20px;margin:0 0 8px}h4{font-size:16px;margin:0 0 6px}p{max-width:95ch;color:var(--muted)}section{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:22px;margin:22px 0}.evidence{display:flex;gap:10px;flex-wrap:wrap}.evidence div{background:var(--accent-soft);border-radius:9px;padding:12px 15px}.evidence strong{display:block;font-size:24px;color:var(--accent)}.table-scroll,.matrix-scroll{overflow:auto;border:1px solid var(--line);border-radius:9px}table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid #e5eae7;vertical-align:top}th{background:#edf3ef;font-size:12px;text-transform:uppercase;letter-spacing:.035em;white-space:nowrap}tbody tr:last-child td{border-bottom:0}small{display:block;color:var(--muted)}.bar-row{display:grid;grid-template-columns:minmax(130px,220px) 1fr 68px;align-items:center;gap:10px;margin:8px 0}.bar{height:18px;background:#edf0ee;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}.family-grid{display:grid;grid-template-columns:1fr;gap:14px;margin-top:18px}.family-panel{min-width:0;border:1px solid var(--line);border-radius:10px;padding:14px}.matrix{width:auto;table-layout:fixed}.matrix th,.matrix td{padding:3px;text-align:center}.matrix thead th{height:105px;vertical-align:bottom}.matrix thead span{display:block;writing-mode:vertical-rl;transform:rotate(180deg);margin:auto}.matrix tbody th{text-align:right;position:sticky;left:0;z-index:2}.matrix td.empty{background:#f7f8f7}.matrix button{width:94px;min-height:78px;border:1px solid rgba(0,0,0,.08);border-radius:5px;background:#fff;font:10px/1.25 system-ui;cursor:pointer}.matrix button small{margin-top:2px}.matrix button:focus{outline:3px solid #17231d;outline-offset:1px}.cell-stack{display:flex;height:7px;margin-top:5px;border-radius:3px;overflow:hidden;background:#eee}.cell-stack i{display:block;height:100%}.combination-heading{margin-top:18px}.pair-detail{margin-top:13px}.stack{display:flex;height:28px;border-radius:6px;overflow:hidden;background:#eee}.stack span{min-width:1px}.both{background:#087a58}.first{background:#68af98}.second{background:#d99a69}.neither{background:#d9dfdc}.legend{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin-top:8px;font-size:12px}.legend i{display:inline-block;width:10px;height:10px;margin-right:4px}.summary-row td{background:var(--accent-soft);border-top:2px solid var(--accent)}.definitions li{margin:8px 0}@media(max-width:1050px){.family-grid{grid-template-columns:1fr}}@media(max-width:760px){main{padding:20px 10px 48px}section{padding:15px}.bar-row{grid-template-columns:110px 1fr 56px}}
</style></head><body><main><header><h1>Strategy distribution report</h1><p>This report shows optimal-play representation. Metagame shares use equilibrium weights within each kingdom, then give every eligible kingdom equal weight.</p><div class="evidence"><div><strong>${model.evidence.kingdoms}</strong>v2 tuning kingdoms</div><div><strong>40 of 80</strong>offer each variable card</div><div><strong>${model.evidence.alwaysAvailableCardIds.map((id) => escape(model.cards.find((card) => card.id === id)!.name)).join(', ')}</strong>always offered</div></div></header>
<section id="strategy-types"><h2>Strategy types</h2><p>All final-lottery strategies count, including mixed strategies. Shares are metagame-weighted.</p>${typeBars}<p>${model.eligibleStrategies} lottery strategies across ${model.eligibleKingdoms} eligible kingdoms.</p></section>
<section id="competitive-depth"><h2>Competitive depth</h2><p>These tables show how pure-family options expand beyond the optimal lottery. Each family counts at most once per kingdom. Mixed strategies do not count.</p><h3>Kingdoms with each pure family</h3><div class="table-scroll"><table><thead><tr><th>Pure family</th><th>Lottery only</th><th>Add ≥48%</th><th>Add ≥45%</th><th>Add ≥40%</th></tr></thead><tbody>${familyDepthRows}</tbody></table></div><h3>Number of pure families per kingdom</h3><div class="table-scroll"><table><thead><tr><th>Pure families present</th><th>Lottery only</th><th>Add ≥48%</th><th>Add ≥45%</th><th>Add ≥40%</th></tr></thead><tbody>${familyCountRows}</tbody></table></div><p>Each column is cumulative and uses all ${depth.kingdoms} kingdoms as its denominator. “Add ≥45%” includes the lottery plus non-lottery strategies that score at least 45% against it. Zero pure families can mean that only mixed strategies qualify.</p></section>
<section id="family-relationships"><h2>Cards in pure-family play</h2><p>Each family table and heatmap is conditional on exact pure-family lottery play. Mixed strategies are excluded. “Usage when offered” asks whether the card was used when available. “Overall usage” counts unavailable cards as unused across all pure-family kingdoms. Equilibrium weights are normalized within that family, then eligible kingdoms receive equal weight.</p><div class="family-grid">${familyPanels}</div></section>
<section id="card-use"><h2>Cards used by these strategies</h2><p>This table uses all final-lottery strategies, including mixed strategies. Every eligible kingdom has equal weight, with equilibrium strategy weights inside each kingdom. Selection means that a card starts in the deck or was acquired during evaluated games. A purchase plan does not count unless the strategy bought the card.</p><div class="table-scroll"><table><thead><tr><th>Card</th><th>Offered</th><th>Selected</th><th>Starting deck</th><th>Acquired</th><th>Mean copies per strategy</th></tr></thead><tbody>${cardRows}</tbody></table></div></section>
<section class="definitions"><h2>How to read the heatmaps</h2><ul><li><strong>Metagame:</strong> optimal-play representation from equilibrium strategy weights.</li><li><strong>Pair cell:</strong> both, row only, column only, and neither add to 100%. The colored strip shows the same four outcomes.</li><li><strong>Pair detail:</strong> select a cell to see the card names and exact breakdown. The denominator is K eligible kingdoms, not a raw strategy count.</li></ul></section>
<script type="application/json" id="report-data">${embedded}</script><script>
const model=JSON.parse(document.getElementById('report-data').textContent);const byId=new Map(model.cards.map(c=>[c.id,c]));const pct=v=>(v*100).toFixed(1)+'%';const name=id=>byId.get(id).name;const key=(a,b)=>a<b?a+'|'+b:b+'|'+a;function orient(pair,row,col){return pair.firstCardId===row?pair:{...pair,firstCardId:row,secondCardId:col,firstOnly:pair.secondOnly,secondOnly:pair.firstOnly}}function showPair(panel,raw,row,col){const pair=orient(raw,row,col);panel.querySelector('[data-pair-title]').textContent=name(row)+' and '+name(col);panel.querySelector('[data-pair-summary]').textContent='K = '+pair.eligibleKingdoms+' eligible kingdoms. Equal-kingdom conditional metagame shares:';const values=[pair.both,pair.firstOnly,pair.secondOnly,pair.neither],classes=['both','first','second','neither'];panel.querySelector('[data-pair-stack]').innerHTML=values.map((v,i)=>'<span class="'+classes[i]+'" style="width:'+pct(v)+'"></span>').join('');const labels=['Both','Only '+name(row),'Only '+name(col),'Neither'];panel.querySelector('[data-pair-legend]').innerHTML=values.map((v,i)=>'<span><i class="'+classes[i]+'"></i>'+labels[i]+': <strong>'+pct(v)+'</strong></span>').join('')}for(const relationship of model.familyRelationships){const panel=document.querySelector('[data-family="'+relationship.family+'"]'),pairs=new Map(relationship.pairs.map(pair=>[key(pair.firstCardId,pair.secondCardId),pair])),selections=new Map(relationship.cards.map(card=>[card.cardId,card])),ids=relationship.cardIds;let html='<table class="matrix"><thead><tr><th>Card</th>'+ids.map(id=>'<th><span>'+name(id)+'</span></th>').join('')+'</tr></thead><tbody>';for(const [rowIndex,row] of ids.entries()){html+='<tr><th>'+name(row)+'</th>';for(const [colIndex,col] of ids.entries()){if(colIndex>rowIndex){html+='<td class="empty"></td>';continue}if(row===col){const selection=selections.get(row);html+='<td><button disabled style="background:#e5eae7"><strong>'+pct(selection.offeredSelectionRate)+'</strong><br>used when offered</button></td>';continue}const pair=orient(pairs.get(key(row,col)),row,col),values=[pair.both,pair.firstOnly,pair.secondOnly,pair.neither],classes=['both','first','second','neither'];html+='<td><button type="button" data-row="'+row+'" data-col="'+col+'"><strong>Both '+pct(pair.both)+'</strong><small>Row only '+pct(pair.firstOnly)+'<br>Column only '+pct(pair.secondOnly)+'<br>Neither '+pct(pair.neither)+'</small><span class="cell-stack">'+values.map((value,index)=>'<i class="'+classes[index]+'" style="width:'+pct(value)+'"></i>').join('')+'</span></button></td>'}html+='</tr>'}html+='</tbody></table>';panel.querySelector('[data-matrix]').innerHTML=html;for(const button of panel.querySelectorAll('button:not([disabled])'))button.addEventListener('click',()=>showPair(panel,pairs.get(key(button.dataset.row,button.dataset.col)),button.dataset.row,button.dataset.col));const first=relationship.pairs.find(pair=>pair.eligibleKingdoms>0)??relationship.pairs[0];if(first)showPair(panel,first,first.firstCardId,first.secondCardId)}
</script></main></body></html>\n`;
}

export function loadStrategyReportInput(root: string): StrategyReportInput {
  balanceSuite.register();
  const definitions = balanceSuite.manifest.kingdoms.filter((kingdom) => kingdom.split === 'tuning');
  const artifacts = definitions.map((definition) => loadArtifactDirectory(balanceSuite.runDirectory(root, definition.id), definition.id));
  const selfPlay = new Map(artifacts.map((artifact) => [artifact.run.kingdomId, selfPlayFor(artifact)]));
  const reports = buildBalanceReportModel(artifacts, selfPlay, {
    competitiveScore: 0.4, competitiveStatus: '40% viable'
  }).kingdoms;
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const kingdoms: StrategyReportKingdomInput[] = reports.map((kingdom) => {
    const definition = definitionById.get(kingdom.id)!;
    return { id: kingdom.id,
      availableCardIds: [...ALWAYS_AVAILABLE_ACTION_IDS, ...definition.actionPiles.map((pile) => pile.cardId)],
      strategies: kingdom.strategies.map((strategy) => ({ id: strategy.id, status: strategy.status,
        weight: strategy.weight, score: strategy.score, damageType: classifyStrategyDamage(strategy),
        startingBuild: strategy.startingBuild, acquisitionRates: strategy.acquisitionRates,
        buyAgenda: strategy.purchaseSteps.map((step) => ({ cardId: step.cardId })),
        repeatPurchase: strategy.repeatPurchase })) };
  });
  const cards = Object.values(CARDS).filter((card) => card.type === 'action').map((card): StrategyReportCardInput => ({
    id: card.id, name: card.name, family: family(card.id), cost: card.cost,
    text: [card.headline, card.detail].filter(Boolean).join(' '),
    alwaysAvailable: ALWAYS_AVAILABLE_ACTION_IDS.includes(card.id)
  })).sort((left, right) => left.family.localeCompare(right.family) || left.name.localeCompare(right.name));
  return { suiteVersion: balanceSuite.manifest.suiteVersion, kingdoms, cards };
}

export function generateStrategyReport(
  root: string, output = path.join(root, '.html', 'strategy-report.html')
): StrategyReportModel {
  const input = loadStrategyReportInput(root);
  if (input.kingdoms.length !== 80) throw new Error(`Expected 80 tuning kingdoms, found ${input.kingdoms.length}.`);
  const variableCounts = VARIABLE_ACTION_IDS.map((cardId) => input.kingdoms.filter((kingdom) => kingdom.availableCardIds.includes(cardId)).length);
  if (variableCounts.some((count) => count !== 40)) throw new Error('The v2 tuning corpus does not offer every variable card in exactly 40 kingdoms.');
  const model = buildStrategyReportModel(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, renderStrategyReport(model));
  return model;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  try {
    const output = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
    const model = generateStrategyReport(process.cwd(), output);
    process.stdout.write(`Wrote ${output ?? path.join(process.cwd(), '.html', 'strategy-report.html')} from ${model.evidence.kingdoms} v2 tuning kingdoms.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
