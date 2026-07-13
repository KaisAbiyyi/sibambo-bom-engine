import { describe, expect, test } from 'bun:test';
import type { Bome2RuntimeScene } from '../formats/bome2';
import {
	buildInstanceGraph,
	createGeometryFoundation,
	GEOMETRY_TOLERANCES,
	toThreeWorldMatrix
} from './index';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = (x: number, y = 0, z = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scale = (x: number, y: number, z: number) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const rotateX90 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const rotateY90 = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
const rotateMultipleAxes = [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
const mirrorX = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('world geometry foundation', () => {
	test('composes nested transforms as parentWorld multiplied by local and maps SketchUp axes once', () => {
		const graph = buildInstanceGraph(scene([translate(10, 0, 0), translate(2, 0, 3)]));
		const panel = graph.nodes.find((node) => node.meshId === 0)!;
		expect(panel.worldTransform[12]).toBeCloseTo(12, 6);
		expect(panel.worldTransform[13]).toBeCloseTo(3, 6);
		expect(panel.worldTransform[14]).toBeCloseTo(0, 6);
		expect(toThreeWorldMatrix(translate(0, 2, 0))[14]).toBeCloseTo(-2, 6);
	});

	test('keeps definition-local mesh shared while each instance receives independent world geometry', () => {
		const foundation = createGeometryFoundation(scene([I, translate(1), translate(5)]));
		const graph = foundation.instanceGraph;
		const panels = graph.nodes.filter((node) => node.meshId === 0);
		expect(panels).toHaveLength(2);
		expect(foundation.getWorldGeometry(panels[0].nodeId).worldBounds.min.x).toBeCloseTo(1, 6);
		expect(foundation.getWorldGeometry(panels[1].nodeId).worldBounds.min.x).toBeCloseTo(5, 6);
		expect(foundation.retainedGeometryBytes().definitionLocalBytes).toBe(36 + 12 + 12);
	});

	test('recomputes transformed areas and normals for rotation, mirrored, and non-uniform scale', () => {
		const rotated = createGeometryFoundation(scene([I, rotateX90]));
		const rotatedRecord = rotated.getWorldGeometry(rotated.instanceGraph.nodes.find((node) => node.meshId === 0)!.nodeId);
		expect(rotatedRecord.verticalAreaRatio).toBeCloseTo(1, 6);
		expect(rotatedRecord.worldAreaM2).toBeCloseTo(0.5, 6);

		const mirrored = createGeometryFoundation(scene([I, mirrorX]));
		const mirroredRecord = mirrored.getWorldGeometry(mirrored.instanceGraph.nodes.find((node) => node.meshId === 0)!.nodeId);
		expect(mirroredRecord.orientationDistribution.downwardAreaM2).toBeCloseTo(0.5, 6);

		const stretched = createGeometryFoundation(scene([I, scale(2, 3, 1)]));
		const stretchedRecord = stretched.getWorldGeometry(stretched.instanceGraph.nodes.find((node) => node.meshId === 0)!.nodeId);
		expect(stretchedRecord.worldAreaM2).toBeCloseTo(3, 6);
	});

	test('covers untransformed vertical, Y rotation, multi-axis rotation, horizontal slab, and sloped orientation facts', () => {
		const vertical = createGeometryFoundation(scene([I, I], { shape: 'vertical' }));
		expect(vertical.getWorldGeometry(vertical.instanceGraph.nodes.find((node) => node.meshId === 0)!.nodeId).verticalAreaRatio).toBeCloseTo(1, 6);
		const yRotated = createGeometryFoundation(scene([I, rotateY90]));
		expect(yRotated.getWorldGeometry(yRotated.instanceGraph.nodes.find((node) => node.meshId === 0)!.nodeId).verticalAreaRatio).toBeCloseTo(1, 6);
		const multiAxis = createGeometryFoundation(scene([I, rotateMultipleAxes]));
		expect(multiAxis.getWorldGeometry(multiAxis.instanceGraph.nodes.find((node) => node.meshId === 0)!.nodeId).worldAreaM2).toBeCloseTo(0.5, 6);
		const slab = createGeometryFoundation(scene([I, I]));
		expect(slab.getWorldGeometry(slab.instanceGraph.nodes.find((node) => node.meshId === 0)!.nodeId).orientationDistribution.upwardAreaM2).toBeCloseTo(0.5, 6);
		const slope = createGeometryFoundation(scene([I, I], { shape: 'sloped' }));
		expect(slope.getWorldGeometry(slope.instanceGraph.nodes.find((node) => node.meshId === 0)!.nodeId).slopedAreaRatio).toBeCloseTo(1, 6);
	});

	test('builds deterministic logical objects and separates disconnected root loose geometry', () => {
		const foundation = createGeometryFoundation(scene([I], { rootMesh: true, disconnected: true }));
		const objects = foundation.buildLogicalObjectIndex().objects;
		expect(objects).toHaveLength(2);
		expect(objects.map((object) => object.id)).toEqual([...objects.map((object) => object.id)].sort());
		expect(objects.every((object) => object.faceOrPrimitiveIds.length === 1)).toBe(true);
	});

	test('clusters coplanar connected primitives but splits sharp edges, disconnected faces, and material boundaries', () => {
		const coplanar = createGeometryFoundation(scene([I, I], { twoFaces: 'coplanar' }));
		const coplanarObject = coplanar.buildLogicalObjectIndex().objects[0];
		expect(coplanar.buildSurfaceClusters(coplanarObject.id)).toHaveLength(1);

		const sharp = createGeometryFoundation(scene([I, I], { twoFaces: 'sharp' }));
		const sharpObject = sharp.buildLogicalObjectIndex().objects[0];
		expect(sharp.buildSurfaceClusters(sharpObject.id)).toHaveLength(2);

		const material = createGeometryFoundation(scene([I, I], { twoFaces: 'material' }));
		const materialObject = material.buildLogicalObjectIndex().objects[0];
		expect(material.buildSurfaceClusters(materialObject.id)).toHaveLength(2);
	});

	test('uses quantization-aware edge tolerance at its documented boundary', () => {
		const close = createGeometryFoundation(scene([I, I], { twoFaces: 'near', offset: GEOMETRY_TOLERANCES.positionM * 0.5 }));
		const closeObject = close.buildLogicalObjectIndex().objects[0];
		expect(close.buildSurfaceClusters(closeObject.id)).toHaveLength(1);
		const apart = createGeometryFoundation(scene([I, I], { twoFaces: 'near', offset: GEOMETRY_TOLERANCES.positionM * 2 }));
		const apartObject = apart.buildLogicalObjectIndex().objects[0];
		expect(apart.buildSurfaceClusters(apartObject.id)).toHaveLength(2);
	});

	test('exposes geometry facts only and avoids furniture-like repeated level bands', () => {
		const foundation = createGeometryFoundation(scene([I, translate(0, 0, 0.4), translate(0, 0, 0.8)]));
		const object = foundation.buildLogicalObjectIndex().objects[0];
		const evidence = foundation.extractGeometryEvidence(object.id);
		expect(evidence).not.toHaveProperty('category');
		expect(evidence).not.toHaveProperty('confidence');
		expect(evidence.orientation.horizontalAreaRatio).toBeGreaterThan(0.99);
		expect(foundation.modelContext.levelBands).toHaveLength(0);
	});
});

type Variant = { rootMesh?: boolean; disconnected?: boolean; twoFaces?: 'coplanar' | 'sharp' | 'material' | 'near'; shape?: 'vertical' | 'sloped'; offset?: number };

function scene(transforms: number[][], variant: Variant = {}): Bome2RuntimeScene {
	const positions = variant.shape === 'vertical'
		? [0, 0, 0, 1, 0, 0, 0, 0, 1]
		: variant.shape === 'sloped'
			? [0, 0, 0, 1, 0, 0, 0, 1, 1]
		: variant.disconnected
		? [0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0]
		: variant.twoFaces === 'sharp'
			? [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]
			: variant.twoFaces
				? [0, 0, 0, 1, 0, 0, 0, 1, 0, variant.offset || 0, 1, 0, 1 + (variant.offset || 0), 0, 0, 1, 1, 0]
				: [0, 0, 0, 1, 0, 0, 0, 1, 0];
	const faces = variant.disconnected
		? [face(10, 0, 3, 0, 3), face(11, 3, 3, 3, 3)]
		: variant.twoFaces === 'sharp'
			? [face(10, 0, 3, 0, 3), face(11, 0, 3, 3, 3, 1)]
			: variant.twoFaces
				? [face(10, 0, 3, 0, 3), face(11, 3, 3, 3, 3, variant.twoFaces === 'material' ? 1 : 0)]
				: [face(10, 0, 3, 0, 3)];
	const triangles = variant.disconnected ? [0, 1, 2, 3, 4, 5] : variant.twoFaces === 'sharp' ? [0, 1, 2, 0, 2, 3] : variant.twoFaces ? [0, 1, 2, 3, 4, 5] : [0, 1, 2];
	const loops = variant.disconnected ? [0, 1, 2, 3, 4, 5] : variant.twoFaces === 'sharp' ? [0, 1, 2, 0, 2, 3] : variant.twoFaces ? [0, 1, 2, 3, 4, 5] : [0, 1, 2];
	const strings = ['definition:root', 'definition:panel', 'node:root', 'node:a', 'node:b', 'Root', 'Panel', 'root', 'component_definition', 'mesh:panel', 'face:a', 'face:b', '1', 'floor', 'material:0', 'Material 0', '#808080', 'material:1', 'Material 1', '#AA5522', 'tag:0', 'Untagged'];
	const rootNodes = variant.rootMesh ? [] : transforms.slice(1).map((_, index) => index + 1);
	const meshManifest = { id: 9, definition: variant.rootMesh ? 0 : 1, positions_section: -1, loops_section: -1, triangles_section: -1, vertex_count: positions.length / 3, triangle_count: triangles.length / 3, quantization: { component_type: 'uint16' as const, minimum_m: [0, 0, 0] as [number, number, number], maximum_m: [5, 2, 1] as [number, number, number], scale_m: [0.001, 0.001, 0.001] as [number, number, number], measured_max_error_m: 0, error_budget_m: 0.001 }, faces };
	return {
		format: 'bome2_runtime_v2', sections: [], transforms: new Float32Array(transforms.flat()),
		manifest: {
			format: { name: 'BOME2', version: '2.0.0', canonical_version: '3.0.0', layout: 'fixture' }, source: { file_name: -1, model_name: -1, scope: -1, exported_at: -1 }, strings,
			materials: [{ id: 14, name: 15, display_name: 15, color_rgba: [128, 128, 128, 255], color_hex: 16, opacity: 1, texture: -1 }, { id: 17, name: 18, display_name: 18, color_rgba: [170, 85, 34, 255], color_hex: 19, opacity: 1, texture: -1 }], tags: [{ id: 20, name: 21, visible: true }],
			transforms: { section: -1, count: transforms.length, component_type: 'float32' }, meshes: [meshManifest],
			definitions: variant.rootMesh ? [{ id: 0, name: 5, kind: 7, mesh: 0, nodes: [] }] : [{ id: 0, name: 5, kind: 7, mesh: -1, nodes: rootNodes }, { id: 1, name: 6, kind: 8, mesh: 0, nodes: [] }],
			nodes: [
				{ id: 2, name: 5, kind: 1, owner_definition: -1, definition: 0, transform: 0, material: -1, tag: -1, visible: true, source_persistent_id: -1 },
				...(variant.rootMesh ? [] : transforms.slice(1).map((_, index) => ({ id: 3 + index, name: 6, kind: 2, owner_definition: 0, definition: 1, transform: index + 1, material: -1, tag: 0, visible: true, source_persistent_id: -1 })))
			], root_node: 0, statistics: {}
		}, meshes: [{ manifest: meshManifest, positions: new Float32Array(positions), loops: new Uint32Array(loops), triangles: new Uint32Array(triangles) }]
	};
}

function face(id: number, outerStart: number, outerCount: number, triangleStart: number, triangleCount: number, material = 0) {
	return { id, source_persistent_id: 12, outer_start: outerStart, outer_count: outerCount, holes: [], triangle_start: triangleStart, triangle_count: triangleCount, material, back_material: -1, tag: 0, surface_hint: 13, area_m2: 0.5 };
}
