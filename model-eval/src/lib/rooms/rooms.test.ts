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
	QUANTIZATION_STEP
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
});
