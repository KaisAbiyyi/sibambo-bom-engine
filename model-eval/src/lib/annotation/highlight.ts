import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import type { Bome2RuntimeScene } from '../formats/bome2';
import type { ModelEvalRuntimeScene } from '../formats/model-eval-json';
import { buildInstanceGraph } from '../geometry';
import type { ClassificationUnitRecord } from './index';

/** Builds only selected unit triangles. Normal compact rendering remains indexed and shared. */
export function buildClassificationUnitHighlight(scene: Bome2RuntimeScene | ModelEvalRuntimeScene, unit: Pick<ClassificationUnitRecord, 'sourceNodeIds' | 'sourcePrimitiveIds'>) {
	const node = buildInstanceGraph(scene).byNodeId.get(unit.sourceNodeIds[0]);
	if (!node || node.meshId === null) return null;
	const mesh = scene.meshes[node.meshId];
	if (!mesh) return null;
	const faceIndexes = new Set(unit.sourcePrimitiveIds.map(faceIndex));
	const matrix = new Matrix4().fromArray(node.worldTransform);
	const points: number[] = [];
	for (const faceIndex of faceIndexes) {
		const face = mesh.manifest.faces[faceIndex];
		if (!face) continue;
		for (let offset = face.triangle_start; offset < face.triangle_start + face.triangle_count; offset += 1) {
			const index = mesh.triangles[offset] * 3;
			const point = new Vector3(mesh.positions[index], mesh.positions[index + 2], -mesh.positions[index + 1]).applyMatrix4(matrix);
			points.push(point.x, point.y, point.z);
		}
	}
	if (!points.length) return null;
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	return geometry;
}

function faceIndex(primitiveId: string) {
	const value = Number(primitiveId.slice(primitiveId.lastIndexOf(':') + 1));
	return Number.isInteger(value) && value >= 0 ? value : -1;
}
