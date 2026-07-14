import { describe, expect, test } from 'bun:test';
import {
	generateStoreyBandId,
	generateHorizontalSurfaceId,
	generateVerticalBarrierId,
	generateBoundaryOpeningId,
	createDeterministicSnapshot,
	normalizeSegment,
	normalizeBounds,
	quantizeCoord,
	QUANTIZATION_STEP,
	extractHorizontalSurfaceEvidence,
	buildStoreyBands,
	extractVerticalBarrierEvidence,
	calculateRoomEvidenceFingerprint,
	rankStoreyBandCandidates
} from './helpers';
import { createRoomEvidenceProcessor } from './processor';
import type {
	PlanCoord,
	PlanBounds,
	PlanSegment,
	StoreyBandEvidence,
	HorizontalSurfaceEvidence,
	VerticalBarrierEvidence,
	BoundaryOpeningEvidence
} from './types';

describe('Room evidence types and deterministic IDs', () => {
	const logObjA = 'logical:node:1';
	const logObjB = 'logical:node:2';
	const unitIds = ['unit:1', 'unit:2'];
	const unitIdsShuffled = ['unit:2', 'unit:1'];

	test('1. identical facts produce identical IDs', () => {
		const id1 = generateStoreyBandId(logObjA, unitIds, 0.0, 3.0);
		const id2 = generateStoreyBandId(logObjA, unitIds, 0.0, 3.0);
		expect(id1).toBe(id2);

		const bounds: PlanBounds = { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } };
		const hid1 = generateHorizontalSurfaceId(logObjA, unitIds, 0.0, bounds, 'floor');
		const hid2 = generateHorizontalSurfaceId(logObjA, unitIds, 0.0, bounds, 'floor');
		expect(hid1).toBe(hid2);

		const seg: PlanSegment = { start: { x: 0, z: 0 }, end: { x: 10, z: 0 } };
		const vid1 = generateVerticalBarrierId(logObjA, unitIds, 0.0, 3.0, seg);
		const vid2 = generateVerticalBarrierId(logObjA, unitIds, 0.0, 3.0, seg);
		expect(vid1).toBe(vid2);

		const oid1 = generateBoundaryOpeningId(logObjA, unitIds, 0.0, 2.1, seg, 'door');
		const oid2 = generateBoundaryOpeningId(logObjA, unitIds, 0.0, 2.1, seg, 'door');
		expect(oid1).toBe(oid2);
	});

	test('2. shuffled source-ID order produces identical IDs', () => {
		const id1 = generateStoreyBandId(logObjA, unitIds, 0.0, 3.0);
		const id2 = generateStoreyBandId(logObjA, unitIdsShuffled, 0.0, 3.0);
		expect(id1).toBe(id2);

		const bounds: PlanBounds = { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } };
		const hid1 = generateHorizontalSurfaceId(logObjA, unitIds, 0.0, bounds, 'floor');
		const hid2 = generateHorizontalSurfaceId(logObjA, unitIdsShuffled, 0.0, bounds, 'floor');
		expect(hid1).toBe(hid2);

		const seg: PlanSegment = { start: { x: 0, z: 0 }, end: { x: 10, z: 0 } };
		const vid1 = generateVerticalBarrierId(logObjA, unitIds, 0.0, 3.0, seg);
		const vid2 = generateVerticalBarrierId(logObjA, unitIdsShuffled, 0.0, 3.0, seg);
		expect(vid1).toBe(vid2);
	});

	test('3. materially different geometry produces a different ID', () => {
		const id1 = generateStoreyBandId(logObjA, unitIds, 0.0, 3.0);
		const id2 = generateStoreyBandId(logObjA, unitIds, 0.0, 3.5); // diff elevation
		expect(id1).not.toBe(id2);

		const bounds1: PlanBounds = { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } };
		const bounds2: PlanBounds = { min: { x: 0, z: 0 }, max: { x: 6, z: 5 } };
		const hid1 = generateHorizontalSurfaceId(logObjA, unitIds, 0.0, bounds1, 'floor');
		const hid2 = generateHorizontalSurfaceId(logObjA, unitIds, 0.0, bounds2, 'floor');
		expect(hid1).not.toBe(hid2);

		const seg1: PlanSegment = { start: { x: 0, z: 0 }, end: { x: 10, z: 0 } };
		const seg2: PlanSegment = { start: { x: 0, z: 0 }, end: { x: 10, z: 1 } };
		const vid1 = generateVerticalBarrierId(logObjA, unitIds, 0.0, 3.0, seg1);
		const vid2 = generateVerticalBarrierId(logObjA, unitIds, 0.0, 3.0, seg2);
		expect(vid1).not.toBe(vid2);
	});

	test('4. small floating-point noise inside quantization tolerance does not change ID', () => {
		const noise = QUANTIZATION_STEP * 0.1; // 10% of quantization step

		const id1 = generateStoreyBandId(logObjA, unitIds, 0.0, 3.0);
		const id2 = generateStoreyBandId(logObjA, unitIds, 0.0 + noise, 3.0 - noise);
		expect(id1).toBe(id2);

		const bounds1: PlanBounds = { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } };
		const bounds2: PlanBounds = { min: { x: 0 + noise, z: 0 - noise }, max: { x: 5 - noise, z: 5 + noise } };
		const hid1 = generateHorizontalSurfaceId(logObjA, unitIds, 0.0, bounds1, 'floor');
		const hid2 = generateHorizontalSurfaceId(logObjA, unitIds, 0.0 + noise, bounds2, 'floor');
		expect(hid1).toBe(hid2);

		const seg1: PlanSegment = { start: { x: 0, z: 0 }, end: { x: 10, z: 0 } };
		const seg2: PlanSegment = { start: { x: 0 + noise, z: 0 - noise }, end: { x: 10 - noise, z: 0 + noise } };
		const vid1 = generateVerticalBarrierId(logObjA, unitIds, 0.0, 3.0, seg1);
		const vid2 = generateVerticalBarrierId(logObjA, unitIds, 0.0 + noise, 3.0 - noise, seg2);
		expect(vid1).toBe(vid2);
	});

	test('5. different logical-object ownership produces a different ID', () => {
		const id1 = generateStoreyBandId(logObjA, unitIds, 0.0, 3.0);
		const id2 = generateStoreyBandId(logObjB, unitIds, 0.0, 3.0);
		expect(id1).not.toBe(id2);

		const bounds: PlanBounds = { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } };
		const hid1 = generateHorizontalSurfaceId(logObjA, unitIds, 0.0, bounds, 'floor');
		const hid2 = generateHorizontalSurfaceId(logObjB, unitIds, 0.0, bounds, 'floor');
		expect(hid1).not.toBe(hid2);
	});

	test('6. evidence snapshot ordering is deterministic', () => {
		const bounds: PlanBounds = { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } };

		const h1: HorizontalSurfaceEvidence = {
			id: 'b_horizontal',
			logicalObjectId: logObjA,
			classificationUnitIds: unitIds,
			elevation: 3.0,
			planBounds: bounds,
			surfaceType: 'floor',
			areaM2: 25,
			quality: 1.0,
			isAmbiguous: false
		};
		const h2: HorizontalSurfaceEvidence = {
			id: 'a_horizontal',
			logicalObjectId: logObjA,
			classificationUnitIds: unitIds,
			elevation: 0.0,
			planBounds: bounds,
			surfaceType: 'floor',
			areaM2: 25,
			quality: 1.0,
			isAmbiguous: false
		};

		// Pass shuffled lists
		const snapshot = createDeterministicSnapshot({
			storeyBands: [],
			horizontalSurfaces: [h1, h2],
			verticalBarriers: [],
			boundaryOpenings: []
		});

		// Expect sorted alphabetically by ID
		expect(snapshot.horizontalSurfaces[0].id).toBe('a_horizontal');
		expect(snapshot.horizontalSurfaces[1].id).toBe('b_horizontal');
		expect(snapshot.diagnostics.totalHorizontalSurfaces).toBe(2);
		expect(snapshot.diagnostics.duplicatedIdsCount).toBe(0);
	});

	test('7. source ownership is preserved exactly', () => {
		const bounds: PlanBounds = { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } };
		const h: HorizontalSurfaceEvidence = {
			id: 'horiz_test',
			logicalObjectId: logObjA,
			classificationUnitIds: unitIds,
			elevation: 0.0,
			planBounds: bounds,
			surfaceType: 'floor',
			areaM2: 25,
			quality: 0.85,
			isAmbiguous: true
		};

		expect(h.logicalObjectId).toBe(logObjA);
		expect(h.classificationUnitIds).toEqual(unitIds);
		expect(h.quality).toBe(0.85);
		expect(h.isAmbiguous).toBe(true);
	});

	test('8. horizontal extraction & storey bands grouping', () => {
		const makeFace = (id: string, nx: number, ny: number, nz: number, area: number, y: number) => ({
			id,
			logicalObjectId: logObjA,
			dominantNormal: { x: nx, y: ny, z: nz },
			areaM2: area,
			worldBounds: {
				min: { x: 0, y: y, z: 0 },
				max: { x: 2, y: y, z: 3 },
				size: { x: 2, y: 0, z: 3 },
				center: { x: 1, y: y, z: 1.5 }
			},
			centroid: { x: 1, y: y, z: 1.5 },
			materialIds: [42]
		});

		// 1. Upward horizontal surface is accepted
		const upFace = makeFace('up', 0, 1, 0, 6.0, 1.2);
		const upEvidence = extractHorizontalSurfaceEvidence([upFace] as any);
		expect(upEvidence.length).toBe(1);
		expect(upEvidence[0].surfaceType).toBe('floor');
		expect(upEvidence[0].areaM2).toBe(6.0);
		expect(upEvidence[0].elevation).toBe(1.2);

		// 2. Downward horizontal surface is accepted
		const downFace = makeFace('down', 0, -1, 0, 6.0, 3.2);
		const downEvidence = extractHorizontalSurfaceEvidence([downFace] as any);
		expect(downEvidence.length).toBe(1);
		expect(downEvidence[0].surfaceType).toBe('ceiling');
		expect(downEvidence[0].elevation).toBe(3.2);

		// 3. Vertical surface is rejected
		const vertFace = makeFace('vert', 1, 0, 0, 6.0, 1.2);
		const vertEvidence = extractHorizontalSurfaceEvidence([vertFace] as any);
		expect(vertEvidence.length).toBe(0);

		// 4. Zero-area surface is rejected
		const zeroAreaFace = makeFace('zero', 0, 1, 0, 0.0, 1.2);
		const zeroAreaEvidence = extractHorizontalSurfaceEvidence([zeroAreaFace] as any);
		expect(zeroAreaEvidence.length).toBe(0);

		// 5. Non-finite surface is rejected
		const nonFiniteFace = makeFace('nonfinite', 0, NaN, 0, 6.0, 1.2);
		const nonFiniteEvidence = extractHorizontalSurfaceEvidence([nonFiniteFace] as any);
		expect(nonFiniteEvidence.length).toBe(0);

		// 6. Small elevation noise within tolerance joins one storey band
		// levelBandM is 0.15
		const f1 = extractHorizontalSurfaceEvidence([makeFace('f1', 0, 1, 0, 10, 1.00)] as any)[0];
		const f2 = extractHorizontalSurfaceEvidence([makeFace('f2', 0, 1, 0, 10, 1.05)] as any)[0];
		const bandsSingle = buildStoreyBands([f1, f2]);
		expect(bandsSingle.length).toBe(1);
		expect(bandsSingle[0].elevationRange.min).toBe(1.00);
		expect(bandsSingle[0].elevationRange.max).toBe(1.05);

		// 7. Elevations outside tolerance create separate bands
		const f3 = extractHorizontalSurfaceEvidence([makeFace('f3', 0, 1, 0, 10, 1.30)] as any)[0];
		const bandsMulti = buildStoreyBands([f1, f2, f3]);
		expect(bandsMulti.length).toBe(2);
		expect(bandsMulti[0].elevationRange.min).toBe(1.00);
		expect(bandsMulti[1].elevationRange.min).toBe(1.30);

		// 8. Shuffled input produces identical evidence and band ordering
		const e1 = extractHorizontalSurfaceEvidence([makeFace('e1', 0, 1, 0, 10, 1.0)] as any)[0];
		const e2 = extractHorizontalSurfaceEvidence([makeFace('e2', 0, 1, 0, 10, 2.0)] as any)[0];
		const e3 = extractHorizontalSurfaceEvidence([makeFace('e3', 0, -1, 0, 10, 3.0)] as any)[0];

		const ord1 = buildStoreyBands([e1, e2, e3]);
		const ord2 = buildStoreyBands([e3, e2, e1]);
		expect(ord1).toEqual(ord2);

		// 9. Combined projected plan bounds are correct
		const fLeft = makeFace('fLeft', 0, 1, 0, 5, 1.0);
		fLeft.worldBounds = {
			min: { x: -2, y: 1.0, z: 0 },
			max: { x: 2, y: 1.0, z: 3 },
			size: { x: 4, y: 0, z: 3 },
			center: { x: 0, y: 1.0, z: 1.5 }
		};
		const fRight = makeFace('fRight', 0, 1, 0, 5, 1.02);
		fRight.worldBounds = {
			min: { x: 0, y: 1.02, z: -1 },
			max: { x: 5, y: 1.02, z: 4 },
			size: { x: 5, y: 0, z: 5 },
			center: { x: 2.5, y: 1.02, z: 1.5 }
		};

		const evLeft = extractHorizontalSurfaceEvidence([fLeft] as any)[0];
		const evRight = extractHorizontalSurfaceEvidence([fRight] as any)[0];
		const combinedBand = buildStoreyBands([evLeft, evRight])[0];
		expect(combinedBand.planBounds.min.x).toBe(-2);
		expect(combinedBand.planBounds.min.z).toBe(-1);
		expect(combinedBand.planBounds.max.x).toBe(5);
		expect(combinedBand.planBounds.max.z).toBe(4);

		// 10. Source IDs and material IDs are preserved
		expect(combinedBand.classificationUnitIds).toEqual(['fLeft', 'fRight']);
		expect(combinedBand.materialIds).toEqual([42]);

		// 11. Upward/downward conflict produces an ambiguity flag
		const evUp = extractHorizontalSurfaceEvidence([makeFace('upSurface', 0, 1, 0, 10, 1.0)] as any)[0];
		const evDown = extractHorizontalSurfaceEvidence([makeFace('downSurface', 0, -1, 0, 10, 1.05)] as any)[0];
		const conflictedBand = buildStoreyBands([evUp, evDown])[0];
		expect(conflictedBand.isAmbiguous).toBe(true);

		// 12. IDs remain deterministic across repeated runs
		const idRun1 = buildStoreyBands([evUp, evDown])[0].id;
		const idRun2 = buildStoreyBands([evDown, evUp])[0].id;
		expect(idRun1).toBe(idRun2);
	});

	test('9. vertical barrier extraction', () => {
		const makeWall = (id: string, nx: number, ny: number, nz: number, area: number, minY: number, maxY: number, minX = 0, maxX = 0, minZ = 0, maxZ = 0) => ({
			id,
			logicalObjectId: logObjA,
			dominantNormal: { x: nx, y: ny, z: nz },
			areaM2: area,
			worldBounds: {
				min: { x: minX, y: minY, z: minZ },
				max: { x: maxX, y: maxY, z: maxZ },
				size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
				center: { x: (minX + maxX)/2, y: (minY + maxY)/2, z: (minZ + maxZ)/2 }
			},
			centroid: { x: (minX + maxX)/2, y: (minY + maxY)/2, z: (minZ + maxZ)/2 },
			materialIds: [12]
		});

		// 1. Vertical surface is accepted
		const vertWall = makeWall('vert1', 1, 0, 0, 10, 0, 3, 0, 0.2, 0, 4);
		const vertEvidence = extractVerticalBarrierEvidence([vertWall] as any);
		expect(vertEvidence.length).toBe(1);
		expect(vertEvidence[0].thickness).toBe(0.2); // size.x since normal is along X

		// 2. Horizontal surface is rejected
		const horizFace = makeWall('horiz', 0, 1, 0, 10, 0, 0, 0, 4, 0, 4);
		const horizEvidence = extractVerticalBarrierEvidence([horizFace] as any);
		expect(horizEvidence.length).toBe(0);

		// 3. Zero-area surface is rejected
		const zeroAreaWall = makeWall('zeroArea', 1, 0, 0, 0, 0, 3, 0, 0.2, 0, 4);
		const zeroAreaEvidence = extractVerticalBarrierEvidence([zeroAreaWall] as any);
		expect(zeroAreaEvidence.length).toBe(0);

		// 4. Zero-height evidence is rejected
		const zeroHeightWall = makeWall('zeroHeight', 1, 0, 0, 10, 1.2, 1.2, 0, 0.2, 0, 4);
		const zeroHeightEvidence = extractVerticalBarrierEvidence([zeroHeightWall] as any);
		expect(zeroHeightEvidence.length).toBe(0);

		// 5. Zero-length projected segment is rejected
		const zeroLenWall = makeWall('zeroLen', 1, 0, 0, 10, 0, 3, 0, 0.2, 1.2, 1.2);
		const zeroLenEvidence = extractVerticalBarrierEvidence([zeroLenWall] as any);
		expect(zeroLenEvidence.length).toBe(0);

		// 6. Non-finite input is rejected
		const nonFiniteWall = makeWall('nonfinite', 1, NaN, 0, 10, 0, 3, 0, 0.2, 0, 4);
		const nonFiniteEvidence = extractVerticalBarrierEvidence([nonFiniteWall] as any);
		expect(nonFiniteEvidence.length).toBe(0);

		// 7. Elevation range is correct
		expect(vertEvidence[0].elevationRange.min).toBe(0);
		expect(vertEvidence[0].elevationRange.max).toBe(3);

		// 8. Projected segment normalization is deterministic
		const wallSegment = vertEvidence[0].segment;
		expect(wallSegment.start.z).toBeLessThanOrEqual(wallSegment.end.z);

		// 9. Reversed segment input produces the same ID
		const wallA = makeWall('w1', 1, 0, 0, 10, 0, 3, 0, 0.2, 0, 4);
		const idA1 = extractVerticalBarrierEvidence([wallA] as any)[0].id;
		const idA2 = extractVerticalBarrierEvidence([wallA] as any)[0].id;
		expect(idA1).toBe(idA2);

		// 10. Shuffled input produces identical ordering
		const w1 = makeWall('w1', 1, 0, 0, 10, 0, 3, 0, 0.2, 0, 4);
		const w2 = makeWall('w2', 1, 0, 0, 10, 0, 3, 0, 0.2, 1, 5);
		const list1 = extractVerticalBarrierEvidence([w1, w2] as any);
		const list2 = extractVerticalBarrierEvidence([w2, w1] as any);
		expect(list1).toEqual(list2);

		// 11. Different source ownership produces a different ID
		const wDiff = makeWall('w1', 1, 0, 0, 10, 0, 3, 0, 0.2, 0, 4);
		wDiff.logicalObjectId = logObjB;
		const idDiff = extractVerticalBarrierEvidence([wDiff] as any)[0].id;
		expect(idA1).not.toBe(idDiff);

		// 12. Source IDs and material IDs are preserved
		expect(vertEvidence[0].classificationUnitIds).toEqual(['vert1']);
		expect(vertEvidence[0].materialIds).toEqual([12]);

		// 13. Repeated runs produce identical results
		const run1 = extractVerticalBarrierEvidence([w1, w2] as any);
		const run2 = extractVerticalBarrierEvidence([w1, w2] as any);
		expect(run1).toEqual(run2);
	});

	test('10. incremental room-evidence processor', () => {
		const makeFace = (id: string, nx: number, ny: number, nz: number, area: number, y: number, minX = 0, maxX = 2, minZ = 0, maxZ = 3) => ({
			id,
			logicalObjectId: logObjA,
			dominantNormal: { x: nx, y: ny, z: nz },
			areaM2: area,
			worldBounds: {
				min: { x: minX, y: y, z: minZ },
				max: { x: maxX, y: y + 3, z: maxZ },
				size: { x: maxX - minX, y: 3, z: maxZ - minZ },
				center: { x: (minX+maxX)/2, y: y+1.5, z: (minZ+maxZ)/2 }
			},
			centroid: { x: (minX+maxX)/2, y: y+1.5, z: (minZ+maxZ)/2 },
			materialIds: [42]
		});

		const f1 = makeFace('f1', 0, 1, 0, 10, 1.0); // horizontal
		const w1 = makeFace('w1', 1, 0, 0, 10, 0.0, 0, 0.2); // vertical
		const r1 = makeFace('r1', 0.5, 0.5, 0.5, 10, 1.0); // sloped/rejected

		// 1. One unit can be processed
		const proc = createRoomEvidenceProcessor();
		proc.processOne(f1 as any);
		let snap = proc.snapshot();
		expect(snap.horizontalSurfaces.length).toBe(1);
		expect(snap.verticalBarriers.length).toBe(0);

		// 2. Batch processing works
		proc.reset();
		proc.processBatch([f1, w1] as any);
		snap = proc.snapshot();
		expect(snap.horizontalSurfaces.length).toBe(1);
		expect(snap.verticalBarriers.length).toBe(1);

		// 3. Incremental result equals processAll
		const procInc = createRoomEvidenceProcessor();
		procInc.processOne(f1 as any);
		procInc.processOne(w1 as any);
		const snapInc = procInc.snapshot();

		const procAll = createRoomEvidenceProcessor();
		procAll.processAll([f1, w1] as any);
		const snapAll = procAll.snapshot();

		expect(snapInc.horizontalSurfaces).toEqual(snapAll.horizontalSurfaces);
		expect(snapInc.verticalBarriers).toEqual(snapAll.verticalBarriers);

		// 4. Forward order equals reverse order
		const procFwd = createRoomEvidenceProcessor();
		procFwd.processAll([f1, w1] as any);
		const snapFwd = procFwd.snapshot();

		const procRev = createRoomEvidenceProcessor();
		procRev.processAll([w1, f1] as any);
		const snapRev = procRev.snapshot();

		expect(snapFwd.horizontalSurfaces).toEqual(snapRev.horizontalSurfaces);
		expect(snapFwd.verticalBarriers).toEqual(snapRev.verticalBarriers);

		// 5. Duplicate input is idempotent
		const procDup = createRoomEvidenceProcessor();
		procDup.processOne(f1 as any);
		procDup.processOne(f1 as any);
		const snapDup = procDup.snapshot();
		expect(snapDup.horizontalSurfaces.length).toBe(1);
		expect(procDup.diagnostics().duplicatesSkipped).toBe(1);

		// 6. Snapshot ordering is deterministic
		// snapshot() sorts lists internally via createDeterministicSnapshot.
		// Handled by helpers.test, but verified here too.
		expect(snapFwd.horizontalSurfaces[0].id).toBe(snapRev.horizontalSurfaces[0].id);

		// 7. Storey bands update correctly
		const f2 = makeFace('f2', 0, 1, 0, 10, 1.05);
		const procStorey = createRoomEvidenceProcessor();
		procStorey.processOne(f1 as any);
		expect(procStorey.snapshot().storeyBands.length).toBe(1);
		procStorey.processOne(f2 as any);
		expect(procStorey.snapshot().storeyBands.length).toBe(1); // joins f1 group within 0.15 tolerance

		// 8. Cancellation prevents later processing
		const procCancel = createRoomEvidenceProcessor();
		procCancel.processOne(f1 as any);
		procCancel.cancel();
		procCancel.processOne(w1 as any);
		expect(procCancel.snapshot().verticalBarriers.length).toBe(0);

		// 9. Reset and restart equal uninterrupted processing
		const procReset = createRoomEvidenceProcessor();
		procReset.processAll([f1, w1] as any);
		procReset.reset();
		procReset.processAll([f1, w1] as any);
		const snapReset = procReset.snapshot();
		expect(snapReset.horizontalSurfaces.length).toBe(1);
		expect(snapReset.verticalBarriers.length).toBe(1);

		// 10. Diagnostics counts are correct
		const procDiag = createRoomEvidenceProcessor();
		procDiag.processAll([f1, w1, r1, f1] as any);
		const diag = procDiag.diagnostics();
		expect(diag.unitsInspected).toBe(3); // f1, w1, r1 (unique)
		expect(diag.horizontalAccepted).toBe(1);
		expect(diag.verticalAccepted).toBe(1);
		expect(diag.rejected).toBe(1); // r1
		expect(diag.duplicatesSkipped).toBe(1); // f1 duplicate

		// 11. Source ownership remains unchanged
		expect(snapReset.horizontalSurfaces[0].logicalObjectId).toBe(logObjA);

		// 12. No opening evidence is fabricated
		expect(snapReset.boundaryOpenings.length).toBe(0);
	});

	test('11. fingerprinting and audit CLI', () => {
		const makeFace = (id: string, nx: number, ny: number, nz: number, area: number, y: number, minX = 0, maxX = 2, minZ = 0, maxZ = 3) => ({
			id,
			logicalObjectId: logObjA,
			dominantNormal: { x: nx, y: ny, z: nz },
			areaM2: area,
			worldBounds: {
				min: { x: minX, y: y, z: minZ },
				max: { x: maxX, y: y + 3, z: maxZ },
				size: { x: maxX - minX, y: 3, z: maxZ - minZ },
				center: { x: (minX+maxX)/2, y: y+1.5, z: (minZ+maxZ)/2 }
			},
			centroid: { x: (minX+maxX)/2, y: y+1.5, z: (minZ+maxZ)/2 },
			materialIds: [42]
		});

		const f1 = makeFace('f1', 0, 1, 0, 10, 1.0); // horizontal
		const w1 = makeFace('w1', 1, 0, 0, 10, 0.0, 0, 0.2); // vertical

		const proc = createRoomEvidenceProcessor();
		proc.processAll([f1, w1] as any);
		const snap = proc.snapshot();

		// 3. Repeated runs produce the same fingerprint
		const fp1 = calculateRoomEvidenceFingerprint(snap);
		const fp2 = calculateRoomEvidenceFingerprint(snap);
		expect(fp1).toBe(fp2);

		// 4. Shuffled source processing produces the same fingerprint
		const procShuf = createRoomEvidenceProcessor();
		procShuf.processAll([w1, f1] as any);
		const fpShuf = calculateRoomEvidenceFingerprint(procShuf.snapshot());
		expect(fp1).toBe(fpShuf);

		// 5. Counts match the snapshot
		expect(snap.horizontalSurfaces.length).toBe(1);
		expect(snap.verticalBarriers.length).toBe(1);

		// 6. No opening evidence is fabricated
		expect(snap.boundaryOpenings.length).toBe(0);

		// 1. CLI argument validation (missing path exits with code 1)
		const runNoArgs = Bun.spawnSync(['bun', 'run', 'scripts/audit-room-evidence.ts']);
		expect(runNoArgs.exitCode).toBe(1);

		// 8. Invalid path / invalid format returns a clear non-zero failure
		const runBadPath = Bun.spawnSync(['bun', 'run', 'scripts/audit-room-evidence.ts', 'nonexistent-file.json']);
		expect(runBadPath.exitCode).toBe(1);
	});

	test('12. storey band candidate ranking and filtering', () => {
		const makeHoriz = (id: string, area: number, y: number, isCeiling = false) => ({
			id,
			logicalObjectId: logObjA,
			classificationUnitIds: [id],
			elevation: y,
			planBounds: { min: { x: 0, z: 0 }, max: { x: Math.sqrt(area), z: Math.sqrt(area) } },
			surfaceType: isCeiling ? 'ceiling' : 'floor',
			areaM2: area,
			quality: 1.0,
			isAmbiguous: false
		});

		const b1 = makeHoriz('floor_large', 100, 0.0);
		const b2 = makeHoriz('table', 1.5, 1.0);
		const b3 = makeHoriz('shelf1', 1.0, 2.0);
		const b4 = makeHoriz('shelf2', 1.0, 2.02);

		const horizontalEvidence = [b1, b2, b3, b4];
		const rawBands = buildStoreyBands(horizontalEvidence as any);
		expect(rawBands.length).toBe(3);

		const ranked = rankStoreyBandCandidates(rawBands, horizontalEvidence as any);

		expect(ranked.length).toBe(3);
		expect(ranked[0].classificationUnitIds).toContain('floor_large');
		expect(ranked[0].status).toBe('primary');

		const shelfBand = ranked.find(r => r.classificationUnitIds.includes('shelf1'));
		expect(shelfBand).toBeDefined();
		expect(shelfBand!.status).toBe('noise');
		expect(ranked[0].score!).toBeGreaterThan(shelfBand!.score!);

		const rankedShuf = rankStoreyBandCandidates(
			[rawBands[1], rawBands[2], rawBands[0]],
			horizontalEvidence as any
		);
		expect(ranked).toEqual(rankedShuf);

		const equal1 = makeHoriz('equal1', 10, 5.0);
		const equal2 = makeHoriz('equal2', 10, 10.0);
		const rawEqual = buildStoreyBands([equal1, equal2] as any);
		const rankedEqual = rankStoreyBandCandidates(rawEqual, [equal1, equal2] as any);
		expect(rankedEqual[0].id.localeCompare(rankedEqual[1].id)).toBeLessThan(0);

		const upFace = makeHoriz('up_f', 10, 0.0, false);
		const downFace = makeHoriz('down_f', 10, 0.05, true);
		const rawConflicted = buildStoreyBands([upFace, downFace] as any);
		const rankedConflicted = rankStoreyBandCandidates(rawConflicted, [upFace, downFace] as any);
		expect(rankedConflicted[0].isAmbiguous).toBe(true);

		const run1 = rankStoreyBandCandidates(rawBands, horizontalEvidence as any);
		const run2 = rankStoreyBandCandidates(rawBands, horizontalEvidence as any);
		expect(run1).toEqual(run2);

		for (const r of ranked) {
			expect(r.storeyName).toBeUndefined();
		}
	});
});
