import fs from 'node:fs';
import { nativeKingdom009Json } from '../src/sim/nativeKingdom009';

const file = 'rust/goldfish/kingdom009.json';
const generated = nativeKingdom009Json();
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== generated) {
    throw new Error(`${file} is stale. Run npm run goldfish:native-kingdom-write.`);
  }
  console.log(`${file} is current.`);
} else {
  fs.writeFileSync(file, generated);
}
