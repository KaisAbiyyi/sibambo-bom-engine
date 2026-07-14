import { describe, expect, test } from 'bun:test';
import { createClassificationUnitIndex, classificationUnitFingerprint } from './index';
import { parseModelEvalJsonV1 } from '../formats/model-eval-json';
import { createGeometryFoundation } from '../geometry';
import * as fs from 'fs';
import * as path from 'path';

const HOUSE2_PATH = path.resolve(import.meta.dirname, '../../../../skps/model-eval-exports/house2_model-eval.json');

function loadHouse2Scene() {
	const text = fs.readFileSync(HOUSE2_PATH, 'utf-8');
	const doc = JSON.parse(text);
	return parseModelEvalJsonV1(doc);
}

describe('semantic invariants', () => {
	test('incremental equals full', () => {
		const scene = loadHouse2Scene();

		// Full processing
		const foundationFull = createGeometryFoundation(scene);
		const indexFull = createClassificationUnitIndex(foundationFull);
		const unitsFull = indexFull.processAll();
		const fingerprintFull = classificationUnitFingerprint(unitsFull);

		// Incremental processing
		const foundationInc = createGeometryFoundation(scene);
		const indexInc = createClassificationUnitIndex(foundationInc);
		while (!indexInc.complete) {
			indexInc.processNext();
		}
		const fingerprintInc = classificationUnitFingerprint(indexInc.units);

		expect(fingerprintInc).toBe(fingerprintFull);
	});

	test('forward processing equals reverse processing', () => {
		const scene = loadHouse2Scene();

		// Forward processing
		const foundationFwd = createGeometryFoundation(scene);
		const indexFwd = createClassificationUnitIndex(foundationFwd);
		const unitsFwd = indexFwd.processAll();
		const fingerprintFwd = classificationUnitFingerprint(unitsFwd);

		// Reverse processing
		const foundationRev = createGeometryFoundation(scene);
		const indexRev = createClassificationUnitIndex(foundationRev);
		const reversedObjects = [...(indexRev as any).objects].reverse();
		for (const obj of reversedObjects) {
			indexRev.processObject(obj.id);
		}
		const fingerprintRev = classificationUnitFingerprint(indexRev.units);

		expect(fingerprintRev).toBe(fingerprintFwd);
	});

	test('cold cache equals warm cache', () => {
		const scene = loadHouse2Scene();
		const foundation = createGeometryFoundation(scene);

		// Run once to warm caches
		const indexCold = createClassificationUnitIndex(foundation);
		const unitsCold = indexCold.processAll();
		const fingerprintCold = classificationUnitFingerprint(unitsCold);

		// Run again with same warmed foundation
		const indexWarm = createClassificationUnitIndex(foundation);
		const unitsWarm = indexWarm.processAll();
		const fingerprintWarm = classificationUnitFingerprint(unitsWarm);

		expect(fingerprintWarm).toBe(fingerprintCold);
	});

	test('lazy equals eager', () => {
		const scene = loadHouse2Scene();

		// Lazy (default)
		const foundationLazy = createGeometryFoundation(scene);
		const indexLazy = createClassificationUnitIndex(foundationLazy);
		const fingerprintLazy = classificationUnitFingerprint(indexLazy.processAll());

		// Eager (manually force evaluation of all nodes and logical objects upfront)
		const foundationEager = createGeometryFoundation(scene);
		const objects = foundationEager.buildLogicalObjectIndex().objects;
		for (const obj of objects) {
			// Trigger all lazy getters
			const centroid = obj.centroid;
			const bounds = obj.worldBounds;
			const totalArea = obj.totalAreaM2;
			const materialIds = obj.materialIds;
		}
		const indexEager = createClassificationUnitIndex(foundationEager);
		const fingerprintEager = classificationUnitFingerprint(indexEager.processAll());

		expect(fingerprintEager).toBe(fingerprintLazy);
	});

	test('cancellation followed by restart yields the same final result', () => {
		const scene = loadHouse2Scene();

		// Standard full run
		const foundationFull = createGeometryFoundation(scene);
		const indexFull = createClassificationUnitIndex(foundationFull);
		const fingerprintFull = classificationUnitFingerprint(indexFull.processAll());

		// Cancel/resume run
		const foundationCancel = createGeometryFoundation(scene);
		const indexCancel = createClassificationUnitIndex(foundationCancel);

		// Process halfway
		const halfCount = Math.floor((indexCancel as any).objects.length / 2);
		for (let i = 0; i < halfCount; i++) {
			indexCancel.processNext();
		}

		// Cancel
		indexCancel.cancel();
		expect(indexCancel.progress.cancelled).toBe(true);

		// Resume and complete
		indexCancel.resume();
		expect(indexCancel.progress.cancelled).toBe(false);
		while (!indexCancel.complete) {
			indexCancel.processNext();
		}

		const fingerprintCancel = classificationUnitFingerprint(indexCancel.units);
		expect(fingerprintCancel).toBe(fingerprintFull);
	});
});
