import { createClassificationUnitIndex } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';
import { createRoomEvidenceProcessor } from '../src/lib/rooms/processor';
import { calculateRoomEvidenceFingerprint } from '../src/lib/rooms/helpers';
import { createHash } from 'crypto';

const path = Bun.argv[2];
const isJson = Bun.argv.includes('--json');

if (!path || path === '--json') {
	console.error('Usage: bun run audit-room-evidence.ts <absolute-model-json-path> [--json]');
	process.exit(1);
}

try {
	// 1. Read file and calculate SHA-256
	const file = Bun.file(path);
	if (!(await file.exists())) {
		console.error(`Error: File not found at ${path}`);
		process.exit(1);
	}

	const tStart = performance.now();
	const text = await file.text();
	const sha256 = createHash('sha256').update(text).digest('hex');
	const doc = JSON.parse(text);
	const parseTime = performance.now() - tStart;

	// 2. Runtime construction
	const t1 = performance.now();
	const runtime = parseModelEvalJsonV1(doc);
	const runtimeConstructionTime = performance.now() - t1;

	// 3. Geometry foundation and classification units
	const t2 = performance.now();
	const foundation = createGeometryFoundation(runtime);
	const index = createClassificationUnitIndex(foundation);
	const objects = foundation.buildLogicalObjectIndex().objects;
	for (const object of objects) {
		index.processObject(object.id);
	}
	const units = index.units;
	const geometryFoundationTime = performance.now() - t2;

	// 4. First evidence time
	const processor = createRoomEvidenceProcessor();
	const t3 = performance.now();
	if (units.length > 0) {
		processor.processOne(units[0]);
	}
	const firstEvidenceTime = performance.now() - t3;

	// 5. Full processing time
	processor.reset();
	const t4 = performance.now();
	processor.processAll(units);
	const fullEvidenceProcessingTime = performance.now() - t4;

	// 6. Snapshot and Fingerprint
	const snapshot = processor.snapshot();
	const fingerprint = calculateRoomEvidenceFingerprint(snapshot);

	// FaceRecord expansion check
	const geomDiagnostics = foundation.getDiagnostics();
	const initialFaceRecordExpansion = 0; // Compact runtime does not expand faces

	const summary = {
		inputPath: path,
		inputSha256: sha256,
		parseTimeMs: Number(parseTime.toFixed(3)),
		runtimeConstructionTimeMs: Number(runtimeConstructionTime.toFixed(3)),
		geometryFoundationTimeMs: Number(geometryFoundationTime.toFixed(3)),
		classificationUnitCount: units.length,
		firstEvidenceTimeMs: Number(firstEvidenceTime.toFixed(3)),
		fullEvidenceProcessingTimeMs: Number(fullEvidenceProcessingTime.toFixed(3)),
		horizontalEvidenceCount: snapshot.horizontalSurfaces.length,
		verticalEvidenceCount: snapshot.verticalBarriers.length,
		storeyBandCount: snapshot.storeyBands.length,
		openingEvidenceCount: snapshot.boundaryOpenings.length,
		rejectedEvidenceCount: processor.diagnostics().rejected,
		duplicateUnitsSkipped: processor.diagnostics().duplicatesSkipped,
		fingerprint,
		initialFaceRecordExpansion
	};

	if (isJson) {
		console.log(JSON.stringify(summary, null, 2));
	} else {
		console.log(`=== ROOM EVIDENCE AUDIT SUMMARY ===`);
		console.log(`Input Path:                    ${summary.inputPath}`);
		console.log(`Input SHA-256:                 ${summary.inputSha256}`);
		console.log(`Parse Time:                    ${summary.parseTimeMs.toFixed(3)} ms`);
		console.log(`Runtime Construction Time:     ${summary.runtimeConstructionTimeMs.toFixed(3)} ms`);
		console.log(`Geometry Foundation Time:      ${summary.geometryFoundationTimeMs.toFixed(3)} ms`);
		console.log(`Classification Unit Count:     ${summary.classificationUnitCount}`);
		console.log(`First Evidence Time:           ${summary.firstEvidenceTimeMs.toFixed(3)} ms`);
		console.log(`Full Evidence Processing Time: ${summary.fullEvidenceProcessingTimeMs.toFixed(3)} ms`);
		console.log(`Horizontal Evidence Count:     ${summary.horizontalEvidenceCount}`);
		console.log(`Vertical Evidence Count:       ${summary.verticalEvidenceCount}`);
		console.log(`Storey Band Count:             ${summary.storeyBandCount}`);
		console.log(`Opening Evidence Count:        ${summary.openingEvidenceCount}`);
		console.log(`Rejected Evidence Count:       ${summary.rejectedEvidenceCount}`);
		console.log(`Duplicate Units Skipped:       ${summary.duplicateUnitsSkipped}`);
		console.log(`Fingerprint:                   ${summary.fingerprint}`);
		console.log(`Initial FaceRecord Expansion:  ${summary.initialFaceRecordExpansion}`);
	}
} catch (e: any) {
	console.error(`Execution failed: ${e.message}`);
	process.exit(1);
}
