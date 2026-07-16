import { describe, expect, test } from 'bun:test';
import { Group, Object3D } from 'three';
import {
	applyBuildingVisibility,
	applyCategoryVisibility,
	componentSelectionState,
	createBuildingVisibility,
	createCategoryVisibility,
	tagCategoryObject,
	tagComponentObject
} from './visibility';

describe('centralized category visibility', () => {
	test('registered category remains visible even when semantic statistics omit it', () => {
		const root = new Group();
		const door = tagCategoryObject(new Object3D(), 'doors');
		root.add(door);
		applyBuildingVisibility(root, createBuildingVisibility(['walls', 'doors'], ['walls', 'doors'], [], []));
		expect(door.visible).toBe(true);
	});
	test('hides parent, child, duplicate, outline, overlay, and fallback objects for disabled category', () => {
		const root = new Group();
		const parent = tagCategoryObject(new Group(), 'walls');
		const child = tagCategoryObject(new Object3D(), 'walls');
		const duplicate = tagCategoryObject(new Object3D(), 'walls');
		const outline = tagCategoryObject(new Object3D(), 'walls');
		const overlay = tagCategoryObject(new Object3D(), 'walls');
		const fallback = tagCategoryObject(new Object3D(), 'walls');
		parent.add(child);
		root.add(parent, duplicate, outline, overlay, fallback);

		applyCategoryVisibility(root, createCategoryVisibility(['walls', 'floor'], ['floor']));

		for (const object of [parent, child, duplicate, outline, overlay, fallback]) {
			expect(object.visible).toBe(false);
		}
	});

	test('empty visible set hides all classified geometry but leaves helpers independent', () => {
		const root = new Group();
		const wall = tagCategoryObject(new Object3D(), 'walls');
		const floor = tagCategoryObject(new Object3D(), 'floor');
		const gridHelper = new Object3D();
		root.add(wall, floor, gridHelper);

		applyCategoryVisibility(root, createCategoryVisibility(['walls', 'floor'], []));

		expect(wall.visible).toBe(false);
		expect(floor.visible).toBe(false);
		expect(gridHelper.visible).toBe(true);
	});
});

describe('component visibility hierarchy', () => {
	test('hiding one logical component hides all child meshes and related render objects', () => {
		const root = new Group();
		const wallA = tagComponentObject(tagCategoryObject(new Group(), 'walls'), 'wall:a');
		const mesh = tagComponentObject(tagCategoryObject(new Object3D(), 'walls'), 'wall:a');
		const outline = tagComponentObject(tagCategoryObject(new Object3D(), 'walls'), 'wall:a');
		const wallB = tagComponentObject(tagCategoryObject(new Object3D(), 'walls'), 'wall:b');
		wallA.add(mesh, outline);
		root.add(wallA, wallB);

		applyBuildingVisibility(root, createBuildingVisibility(['walls'], ['walls'], ['wall:a', 'wall:b'], ['wall:b']));

		expect(wallA.visible).toBe(false);
		expect(mesh.visible).toBe(false);
		expect(outline.visible).toBe(false);
		expect(wallB.visible).toBe(true);
	});

	test('category parent reports checked, unchecked, and indeterminate from child state', () => {
		expect(componentSelectionState(['a', 'b'], ['a', 'b'])).toEqual({ checked: true, indeterminate: false });
		expect(componentSelectionState(['a', 'b'], [])).toEqual({ checked: false, indeterminate: false });
		expect(componentSelectionState(['a', 'b'], ['a'])).toEqual({ checked: false, indeterminate: true });
	});
});
