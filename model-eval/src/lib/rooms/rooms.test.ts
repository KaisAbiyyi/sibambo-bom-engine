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
	buildStoreyBands
} from './helpers';
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
});
