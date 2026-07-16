import { type BufferGeometry, DoubleSide, EdgesGeometry, type Material, MeshStandardMaterial } from 'three';
import type { PartKey } from '../model';

export type ViewMode = 'solid' | 'xray' | 'wireframe';

type MaterialRecord = { original: Material; category: PartKey };

export class MaterialStateManager {
	viewMode: ViewMode = 'solid';
	readonly originalMaterials = new Map<string, MaterialRecord>();
	readonly derivedMaterials = new Map<string, Material>();

	register(id: string, material: Material, category: PartKey) {
		this.originalMaterials.set(id, { original: material, category });
	}

	applyMode(mode: ViewMode) { this.viewMode = mode; }

	materialFor(id: string, mode: ViewMode = this.viewMode, highlight = false): Material {
		const record = this.originalMaterials.get(id);
		if (!record) throw new Error(`Material ${id} is not registered.`);
		if (mode === 'solid' && !highlight) return record.original;
		const cacheKey = `${id}:${mode}:${highlight ? 'highlight' : 'default'}`;
		const cached = this.derivedMaterials.get(cacheKey);
		const material = cached || record.original.clone();
		if (cached) material.copy(record.original);
		if (material instanceof MeshStandardMaterial) {
			material.side = DoubleSide;
			if (mode === 'xray') {
				material.transparent = true;
				material.depthWrite = false;
				material.depthTest = true;
				material.opacity = highlight ? 0.72 : categoryOpacity(record.category);
			}
			if (mode === 'wireframe') {
				material.wireframe = true;
				material.transparent = false;
				material.depthWrite = true;
			}
			if (highlight) {
				material.emissive.set('#2dd4bf');
				material.emissiveIntensity = 0.55;
			}
		}
		if (!cached) this.derivedMaterials.set(cacheKey, material);
		return material;
	}

	restoreOriginal() { this.viewMode = 'solid'; }

	dispose() {
		for (const material of this.derivedMaterials.values()) material.dispose();
		this.derivedMaterials.clear();
		this.originalMaterials.clear();
	}
}

function categoryOpacity(category: PartKey) {
	if (category === 'doors' || category === 'windows' || category === 'openings') return 0.42;
	if (category === 'furniture' || category === 'structure') return 0.34;
	if (category === 'roof' || category === 'walls') return 0.2;
	return 0.27;
}

export class EdgeGeometryCache {
	private readonly cache = new Map<string, EdgesGeometry>();

	get(id: string, geometry: BufferGeometry, thresholdAngle = 35) {
		const cached = this.cache.get(id);
		if (cached) return cached;
		const edges = new EdgesGeometry(geometry, thresholdAngle);
		this.cache.set(id, edges);
		return edges;
	}

	dispose() {
		for (const geometry of this.cache.values()) geometry.dispose();
		this.cache.clear();
	}

	get size() { return this.cache.size; }
}
