import type { Object3D } from 'three';
import type { PartKey } from '../model';

export type CategoryVisibilityState = ReadonlyMap<PartKey, boolean>;
export type BuildingVisibilityState = {
	categories: CategoryVisibilityState;
	components: ReadonlyMap<string, boolean>;
};

export function createCategoryVisibility(allCategories: Iterable<PartKey>, visibleCategories: Iterable<PartKey>): CategoryVisibilityState {
	const visible = new Set(visibleCategories);
	return new Map([...allCategories].map((key) => [key, visible.has(key)]));
}

export function tagCategoryObject<T extends Object3D>(object: T, category: PartKey): T {
	object.userData.partKey = category;
	return object;
}

export function tagComponentObject<T extends Object3D>(object: T, componentId: string): T {
	object.userData.componentId = componentId;
	return object;
}

export function applyCategoryVisibility(root: Object3D, state: CategoryVisibilityState) {
	root.traverse((object) => {
		const key = object.userData.partKey as PartKey | undefined;
		if (key) object.visible = state.get(key) === true;
	});
}

export function createBuildingVisibility(
	allCategories: Iterable<PartKey>,
	visibleCategories: Iterable<PartKey>,
	allComponentIds: Iterable<string>,
	visibleComponentIds: Iterable<string>
): BuildingVisibilityState {
	const visible = new Set(visibleComponentIds);
	return {
		categories: createCategoryVisibility(allCategories, visibleCategories),
		components: new Map([...allComponentIds].map((id) => [id, visible.has(id)]))
	};
}

export function applyBuildingVisibility(root: Object3D, state: BuildingVisibilityState) {
	root.traverse((object) => {
		const key = object.userData.partKey as PartKey | undefined;
		const componentId = object.userData.componentId as string | undefined;
		if (!key && !componentId) return;
		const categoryVisible = key ? state.categories.get(key) === true : true;
		const componentVisible = componentId ? state.components.get(componentId) === true : true;
		object.visible = categoryVisible && componentVisible;
	});
}

export function componentSelectionState(componentIds: Iterable<string>, visibleComponentIds: Iterable<string>) {
	const ids = [...componentIds];
	const visible = new Set(visibleComponentIds);
	const selected = ids.filter((id) => visible.has(id)).length;
	return { checked: ids.length > 0 && selected === ids.length, indeterminate: selected > 0 && selected < ids.length };
}
