import { describe, expect, test } from 'bun:test';
import { BoxGeometry, DoubleSide, MeshStandardMaterial } from 'three';
import { EdgeGeometryCache, MaterialStateManager } from './material-state';

describe('material state manager', () => {
	test('restores original and caches derived view materials', () => {
		const original = new MeshStandardMaterial({ color: '#884422', opacity: 1 });
		const manager = new MaterialStateManager();
		manager.register('wall:1', original, 'walls');
		expect(manager.materialFor('wall:1', 'solid')).toBe(original);
		const first = manager.materialFor('wall:1', 'xray') as MeshStandardMaterial;
		const second = manager.materialFor('wall:1', 'xray');
		expect(second).toBe(first);
		expect(first.transparent).toBe(true);
		expect(first.depthWrite).toBe(false);
		expect(first.side).toBe(DoubleSide);
		expect(original.transparent).toBe(false);
		expect(manager.materialFor('wall:1', 'solid')).toBe(original);
	});

	test('wireframe is cached and derived materials are disposed', () => {
		const original = new MeshStandardMaterial();
		const manager = new MaterialStateManager();
		manager.register('door:1', original, 'doors');
		const wire = manager.materialFor('door:1', 'wireframe') as MeshStandardMaterial;
		expect(wire.wireframe).toBe(true);
		let disposed = false;
		wire.addEventListener('dispose', () => { disposed = true; });
		manager.dispose();
		expect(disposed).toBe(true);
		expect(original.wireframe).toBe(false);
	});

	test('caches and disposes edge geometry per source mesh', () => {
		const source = new BoxGeometry(1, 1, 1);
		const cache = new EdgeGeometryCache();
		const first = cache.get('mesh:1', source);
		expect(cache.get('mesh:1', source)).toBe(first);
		let disposed = false;
		first.addEventListener('dispose', () => { disposed = true; });
		cache.dispose();
		expect(disposed).toBe(true);
		source.dispose();
	});
});
