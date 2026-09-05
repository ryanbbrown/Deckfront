import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderCardWording } from '../scripts/generate_card_wording';

describe('card wording review', () => {
  it('matches the current displayed card copy', () => {
    expect(fs.readFileSync('docs/card-wording.md', 'utf8')).toBe(renderCardWording());
  });
});
