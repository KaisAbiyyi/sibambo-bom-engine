import { describe, expect, test } from 'bun:test';
import type { Bome2RuntimeScene } from '../formats/bome2';
import { createGeometryFoundation } from '../geometry';
import {
	buildClassificationUnits,
	buildClassificationUnitHighlight,
	buildAnnotationReviewQueue,
	classificationUnitFingerprint,
	createClassificationUnitIndex,
	createGroundTruthDocument,
	evaluateTier1Baseline,
	aggregateLegacySurfacePredictions,
	validateGroundTruthDocument,
	validateSplitDatasets,
	type Tier1AnnotationDocument
} from './index';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('Tier-1 classification units and ground truth', () => {
	test('uses deterministic cluster-level units without triangle fragmentation', () => {
		const first = buildClassificationUnits(createGeometryFoundation(fixture()));
		const second = buildClassificationUnits(createGeometryFoundation(fixture()));
		expect(first.units.map((unit) => unit.id)).toEqual(second.units.map((unit) => unit.id));
		expect(first.units).toHaveLength(2);
		expect(first.units.every((unit) => unit.surfaceClusterIds.length === 1)).toBe(true);
		expect(first.units.every((unit) => unit.sourcePrimitiveIds.length >= 1)).toBe(true);
		expect(first.units.every((unit) => !('surfaceRole' in unit))).toBe(true);
	});

	test('keeps wall/floor junctions, material boundaries, and repeated instances separately selectable', () => {
		const result = buildClassificationUnits(createGeometryFoundation(fixture({ repeated: true, materialBoundary: true })));
		expect(result.units).toHaveLength(4);
		expect(new Set(result.units.map((unit) => unit.logicalObjectId)).size).toBe(2);
		expect(result.units.every((unit) => unit.groupingReasons.some((reason) => reason.includes('surface cluster')))).toBe(true);
		expect(result.units.map((unit) => unit.instancePath)).toContain('node:root/node:a');
		expect(result.units.map((unit) => unit.instancePath)).toContain('node:root/node:b');
	});

	test('merges adjacent compatible coplanar clusters without crossing a material or orientation boundary', () => {
		const foundation = createGeometryFoundation(fixture({ nearCoplanarPair: true }));
		const object = foundation.buildLogicalObjectIndex().objects[0];
		expect(foundation.buildSurfaceClusters(object.id)).toHaveLength(2);
		const units = buildClassificationUnits(foundation).units;
		expect(units).toHaveLength(1);
		expect(units[0].surfaceClusterIds).toHaveLength(2);
		expect(units[0].groupingReasons).toContain('grouped because coplanar and connected');
	});

	test('accepts only verified annotations for baseline metrics and rejects stale unit references', () => {
		const units = buildClassificationUnits(createGeometryFoundation(fixture())).units;
		const document = createGroundTruthDocument({
			modelId: 'fixture-model', sourceExportHash: 'sha256:fixture', split: 'train', annotations: [
				{ classificationUnitId: units[0].id, logicalObjectId: units[0].logicalObjectId, surfaceClusterIds: units[0].surfaceClusterIds, expectedSurfaceRole: 'floor', status: 'verified', annotationConfidence: 'high', evidenceNote: 'visible slab', sourceLabelReliability: 'absent', screenshotReferences: [], annotatedAt: '2026-07-13T00:00:00.000Z', reviewer: 'reviewer', split: 'train' },
				{ classificationUnitId: units[1].id, logicalObjectId: units[1].logicalObjectId, surfaceClusterIds: units[1].surfaceClusterIds, expectedSurfaceRole: 'unknown', status: 'ambiguous', annotationConfidence: 'low', evidenceNote: 'mixed evidence', sourceLabelReliability: 'ambiguous', screenshotReferences: [], annotatedAt: '2026-07-13T00:00:00.000Z', reviewer: 'reviewer', split: 'train' }
			]
		});
		expect(validateGroundTruthDocument(document, { sourceExportHash: 'sha256:fixture', units }).valid).toBe(true);
		const baseline = evaluateTier1Baseline(document, units, new Map([[units[0].id, 'floor'], [units[1].id, 'wall']]));
		expect(baseline.verifiedCount).toBe(1);
		expect(baseline.support.floor).toBe(1);
		expect(baseline.support.unknown).toBe(0);
		const stale = structuredClone(document);
		stale.annotations[0].classificationUnitId = 'unit:missing';
		expect(validateGroundTruthDocument(stale, { sourceExportHash: 'sha256:fixture', units }).errors).toContain('Unknown classification unit: unit:missing');
		expect(validateGroundTruthDocument(document, { sourceExportHash: 'sha256:changed', units }).errors).toContain('Source export hash mismatch.');
	});

	test('aggregates legacy face predictions by area and leaves mixed units unknown for measurement', () => {
		const units = buildClassificationUnits(createGeometryFoundation(fixture())).units;
		const mixedUnit = { ...units[1], sourcePrimitiveIds: [units[1].sourcePrimitiveIds[0], 'synthetic-conflict'] };
		const result = aggregateLegacySurfacePredictions([units[0], mixedUnit], new Map([
			[units[0].sourcePrimitiveIds[0], { surfaceRole: 'floor', areaM2: 8 }],
			[units[1].sourcePrimitiveIds[0], { surfaceRole: 'wall', areaM2: 1 }],
			['synthetic-conflict', { surfaceRole: 'roof', areaM2: 1 }]
		]));
		expect(result.predictions.get(units[0].id)).toBe('floor');
		expect(result.predictions.get(units[1].id)).toBe('unknown');
		expect(result.ambiguousUnitIds).toContain(units[1].id);
	});

	test('keeps repeated definition families and units in one deterministic dataset split', () => {
		const unit = buildClassificationUnits(createGeometryFoundation(fixture())).units[0];
		const train = createGroundTruthDocument({ modelId: 'fixture-model', sourceExportHash: 'sha256:fixture', split: 'train', annotations: [{ classificationUnitId: unit.id, logicalObjectId: unit.logicalObjectId, surfaceClusterIds: unit.surfaceClusterIds, expectedSurfaceRole: 'floor', status: 'verified', annotationConfidence: 'high', evidenceNote: '', sourceLabelReliability: 'absent', screenshotReferences: [], annotatedAt: '2026-07-13T00:00:00.000Z', reviewer: 'reviewer', split: 'train' }] });
		const holdout = createGroundTruthDocument({ modelId: 'fixture-model', sourceExportHash: 'sha256:fixture', split: 'holdout', annotations: [] });
		expect(validateSplitDatasets(train, holdout).errors).toContain('Model family leakage: fixture-model.');
	});

	test('builds a selection-only highlight for exact source primitive ranges', () => {
		const scene = fixture();
		const unit = buildClassificationUnits(createGeometryFoundation(scene)).units[0];
		const highlight = buildClassificationUnitHighlight(scene, unit);
		expect(highlight?.getAttribute('position').count).toBe(3);
		expect(highlight?.boundingBox?.max.x).toBeCloseTo(1, 6);
	});

	test('builds units lazily per logical object with traversal-order independent fingerprints', () => {
		const foundation = createGeometryFoundation(fixture({ repeated: true }));
		const eager = buildClassificationUnits(foundation).units;
		const incremental = createClassificationUnitIndex(createGeometryFoundation(fixture({ repeated: true })));
		const ids = incremental.foundation.buildLogicalObjectIndex().objects.map((object) => object.id);
		incremental.processObject(ids[1]);
		expect(incremental.progress.processedLogicalObjects).toBe(0);
		incremental.processNext();
		incremental.processAll();
		expect(classificationUnitFingerprint(incremental.units)).toBe(classificationUnitFingerprint(eager));
		expect(incremental.counters.globalUnitPairScans).toBe(0);
		expect(incremental.counters.unitAdjacencyComparisons).toBeLessThan(4);
	});

	test('builds deterministic annotation review queues without classifier-prefilled roles', () => {
		const units = buildClassificationUnits(createGeometryFoundation(fixture({ repeated: true }))).units;
		const records = new Map([[units[0].id, { classificationUnitId: units[0].id, status: 'proposed', annotationConfidence: 'high' } as Tier1AnnotationDocument['annotations'][number]]]);
		const unreviewed = buildAnnotationReviewQueue(units, records, { status: 'unreviewed' }, 'unit-id');
		expect(unreviewed.map((unit) => unit.id)).toEqual(units.slice(1).map((unit) => unit.id));
		expect(buildAnnotationReviewQueue(units, records, { sourcePresence: 'present' }, 'area-desc').map((unit) => unit.id)).toEqual(buildAnnotationReviewQueue(units, records, { sourcePresence: 'present' }, 'area-desc').map((unit) => unit.id));
	});
});

function fixture(options: { repeated?: boolean; materialBoundary?: boolean; nearCoplanarPair?: boolean } = {}): Bome2RuntimeScene {
	const strings = ['root', 'panel', 'node:root', 'node:a', 'node:b', 'Root', 'Panel', 'root', 'component_definition', 'mesh', 'face:floor', 'face:wall', 'pid', 'floor', 'wall', 'material:0', 'Material 0', '#808080', 'material:1', 'Material 1', '#cc8844', 'tag', 'Layer0'];
	const faces = [
		{ id: 10, source_persistent_id: 12, outer_start: 0, outer_count: 3, holes: [], triangle_start: 0, triangle_count: 3, material: 0, back_material: -1, tag: 0, surface_hint: 13, area_m2: 0.5 },
		{ id: 11, source_persistent_id: 12, outer_start: 3, outer_count: 3, holes: [], triangle_start: 3, triangle_count: 3, material: options.materialBoundary ? 1 : 0, back_material: -1, tag: 0, surface_hint: 14, area_m2: 0.5 }
	];
	const positions = options.nearCoplanarPair
		? [0, 0, 0, 1, 0, 0, 0, 1, 0, 0.002, 1, 0, 1.002, 0, 0, 1.002, 1, 0]
		: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
	const loops = options.nearCoplanarPair ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 0, 2, 3];
	const triangles = options.nearCoplanarPair ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 0, 2, 3];
	const mesh = { id: 9, definition: 1, positions_section: -1, loops_section: -1, triangles_section: -1, vertex_count: positions.length / 3, triangle_count: 2, quantization: { component_type: 'uint16' as const, minimum_m: [0, 0, 0] as [number, number, number], maximum_m: [1.002, 1, 1] as [number, number, number], scale_m: [0.001, 0.001, 0.001] as [number, number, number], measured_max_error_m: 0, error_budget_m: 0.001 }, faces };
	return {
		format: 'bome2_runtime_v2', sections: [], transforms: new Float32Array([I, I, I].flat()),
		manifest: { format: { name: 'BOME2', version: '2.0.0', canonical_version: '3.0.0', layout: 'fixture' }, source: { file_name: -1, model_name: -1, scope: -1, exported_at: -1 }, strings, materials: [{ id: 15, name: 16, display_name: 16, color_rgba: [128, 128, 128, 255], color_hex: 17, opacity: 1, texture: -1 }, { id: 18, name: 19, display_name: 19, color_rgba: [204, 136, 68, 255], color_hex: 20, opacity: 1, texture: -1 }], tags: [{ id: 21, name: 22, visible: true }], transforms: { section: -1, count: 3, component_type: 'float32' }, meshes: [mesh], definitions: [{ id: 0, name: 5, kind: 7, mesh: -1, nodes: options.repeated ? [1, 2] : [1] }, { id: 1, name: 6, kind: 8, mesh: 0, nodes: [] }], nodes: [{ id: 2, name: 5, kind: 1, owner_definition: -1, definition: 0, transform: 0, material: -1, tag: -1, visible: true, source_persistent_id: -1 }, { id: 3, name: 6, kind: 2, owner_definition: 0, definition: 1, transform: 1, material: -1, tag: 0, visible: true, source_persistent_id: -1 }, ...(options.repeated ? [{ id: 4, name: 6, kind: 2, owner_definition: 0, definition: 1, transform: 2, material: -1, tag: 0, visible: true, source_persistent_id: -1 }] : [])], root_node: 0, statistics: {} },
		meshes: [{ manifest: mesh, positions: new Float32Array(positions), loops: new Uint32Array(loops), triangles: new Uint32Array(triangles) }]
	};
}
