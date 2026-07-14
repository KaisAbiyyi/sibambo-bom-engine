import { createClassificationUnitIndex } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';

const path = Bun.argv[2];
if (!path) throw new Error('Usage: bun run scripts/profile-first-unit.ts <model-eval-json-path>');

const filename = path.split(/[/\\]/).pop() || 'model';

console.log(`=== Profiling Startup to First Unit: ${filename} ===`);

let t0 = performance.now();
const text = await Bun.file(path).text();
const loadDuration = performance.now() - t0;
console.log(`1. Compact file load: ${loadDuration.toFixed(3)} ms`);

t0 = performance.now();
const document = JSON.parse(text);
const parseDuration = performance.now() - t0;
console.log(`2. JSON.parse: ${parseDuration.toFixed(3)} ms`);

t0 = performance.now();
const runtime = parseModelEvalJsonV1(document);
const runtimeDuration = performance.now() - t0;
console.log(`3. Compact runtime construction: ${runtimeDuration.toFixed(3)} ms`);

t0 = performance.now();
const foundation = createGeometryFoundation(runtime);
const foundationDuration = performance.now() - t0;
console.log(`4. Instance graph readiness: ${foundationDuration.toFixed(3)} ms`);

t0 = performance.now();
const objects = foundation.buildLogicalObjectIndex().objects;
const logicalObjectDuration = performance.now() - t0;
console.log(`5. First logical-object discovery (index build): ${logicalObjectDuration.toFixed(3)} ms`);

t0 = performance.now();
const index = createClassificationUnitIndex(foundation, filename);
const indexInitDuration = performance.now() - t0;
console.log(`6. Index Initialization: ${indexInitDuration.toFixed(3)} ms`);

t0 = performance.now();
// Expose the first unit sequence: process logical objects until we find a unit
let firstUnit: any = null;
let objectsProcessed = 0;
while (!index.complete && !index.progress.cancelled) {
	const progress = index.processNext();
	objectsProcessed++;
	if (progress.addedUnits && progress.addedUnits.length > 0) {
		firstUnit = progress.addedUnits[0];
		break;
	}
}
const firstUnitDuration = performance.now() - t0;
console.log(`7. Process objects until first unit found: ${firstUnitDuration.toFixed(3)} ms (processed ${objectsProcessed} objects)`);
if (firstUnit) {
	console.log(`   First Selectable Unit ID: ${firstUnit.id}`);
} else {
	console.log(`   No units found!`);
}

const totalToFirstUnit = loadDuration + parseDuration + runtimeDuration + foundationDuration + logicalObjectDuration + indexInitDuration + firstUnitDuration;
console.log(`=== Total Time to First Unit Selectable: ${totalToFirstUnit.toFixed(3)} ms ===\n`);
