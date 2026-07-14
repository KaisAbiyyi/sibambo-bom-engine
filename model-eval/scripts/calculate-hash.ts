import { createClassificationUnitIndex, classificationUnitFingerprint } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';
import { createHash } from 'crypto';

const path = Bun.argv[2];
if (!path) throw new Error('Usage: bun run calculate-hash.ts <path>');

const text = await Bun.file(path).text();
const document = JSON.parse(text);
const runtime = parseModelEvalJsonV1(document);
const foundation = createGeometryFoundation(runtime);
const index = createClassificationUnitIndex(foundation);

const objects = foundation.buildLogicalObjectIndex().objects;
for (const object of objects) {
	index.processObject(object.id);
}

const units = index.units;
const fingerprint = classificationUnitFingerprint(units);
const hash = createHash('sha256').update(fingerprint).digest('hex');

console.log(`Units count: ${units.length}`);
console.log(`Fingerprint hash: ${hash}`);
