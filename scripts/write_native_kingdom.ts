import fs from 'node:fs';
import { nativeKingdomsJson } from '../src/sim/nativeKingdoms';

const file = 'rust/goldfish/kingdoms.json';
const generated = nativeKingdomsJson();
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== generated) {
    throw new Error(`${file} is stale. Run npm run goldfish:native-kingdom-write.`);
  }
  console.log(`${file} is current.`);
} else {
  fs.writeFileSync(file, generated);
}
