import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  renderCardBalanceSmokeReport
} from '../../scripts/generate_card_balance_smoke_report';
import type { CardBalanceSmokeComparison } from '../../scripts/generate_card_balance_smoke_report';

const ROOT = path.resolve(import.meta.dirname, '../..');

function currentReport(): CardBalanceSmokeComparison {
  return JSON.parse(fs.readFileSync(path.join(ROOT, '.html/card-balance-smoke-84.json'), 'utf8')) as CardBalanceSmokeComparison;
}

describe('card balance smoke report', () => {
  it('shows each kingdom market, equilibrium plans, archetype shares, and damage shares', () => {
    const html = renderCardBalanceSmokeReport(currentReport());
    expect(html).toContain('<h2>Kingdom explorer</h2>');

    const start = html.indexOf('<section id="balance-tuning-010">');
    const end = html.indexOf('<section id="balance-tuning-013">');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const kingdom = html.slice(start, end);

    expect(kingdom).toContain('<h3>Available cards by type</h3>');
    expect(kingdom.indexOf('<h4>Treasure</h4>')).toBeLessThan(kingdom.indexOf('<h4>Mage</h4>'));
    expect(kingdom.indexOf('<h4>Mage</h4>')).toBeLessThan(kingdom.indexOf('<h4>Melee</h4>'));
    expect(kingdom.indexOf('<h4>Melee</h4>')).toBeLessThan(kingdom.indexOf('<h4>Ranged</h4>'));
    expect(kingdom).toContain('<strong>Repelling Shot</strong><span>4</span>');
    expect(kingdom).toContain('<strong>Focus</strong><span>1</span><small>always available</small>');

    expect(kingdom).toContain('<h3>Equilibrium strategies</h3>');
    expect(kingdom).toContain('<td>Primary</td><td>46.51%</td><td>Melee</td>');
    expect(kingdom).toContain('Precision Shot ×1 → Cull ×1 → Focus ×1 → Step ×3 → Jab ×3');
    expect(kingdom).toContain('<td>Ranged</td><td>40.70%</td>');
    expect(kingdom).toContain('<td>Ranged</td><td>13.8322</td><td>41.61%</td>');
  });
});
