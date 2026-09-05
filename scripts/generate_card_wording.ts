import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS } from '../src/game/config';

const CHANGED_WORDING_IDS = new Set(['cascade', 'flurry', 'improvise', 'overload']);

function cell(value: string | undefined): string {
  return value ? value.replaceAll('|', '\\|') : '—';
}

export function renderCardWording(): string {
  const rows = Object.values(CARDS)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((card) => `| ${cell(card.name)}${CHANGED_WORDING_IDS.has(card.id) ? ' \\*\\*' : ''} | **${cell(card.headline)}** | ${cell(card.detail)} |`);
  return `# Card wording

This file is generated from [\`src/game-data/cards.json\`](../src/game-data/cards.json). Edit that file, then run \`npm run cards:wording\`.

\\*\\* Wording changed from the previous version.

| Card | Bold card text | Description |
| --- | --- | --- |
${rows.join('\n')}
`;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const output = path.join(process.cwd(), 'docs', 'card-wording.md');
  const generated = renderCardWording();
  if (process.argv.includes('--check')) {
    const committed = fs.readFileSync(output, 'utf8');
    if (committed !== generated) throw new Error(`Card wording is stale: ${output}`);
    process.stdout.write(`Verified ${output}\n`);
  } else {
    fs.writeFileSync(output, generated);
    process.stdout.write(`Wrote ${output}\n`);
  }
}
