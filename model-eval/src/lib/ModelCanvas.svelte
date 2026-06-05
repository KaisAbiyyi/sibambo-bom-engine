<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		AmbientLight,
		ArrowHelper,
		BufferGeometry,
		CanvasTexture,
		Color,
		CylinderGeometry,
		DirectionalLight,
		DoubleSide,
		EdgesGeometry,
		Float32BufferAttribute,
		Group,
		LineBasicMaterial,
		LineSegments,
		Mesh,
		MeshStandardMaterial,
		Object3D,
		PerspectiveCamera,
		PlaneGeometry,
		Scene,
		SphereGeometry,
		Sprite,
		SpriteMaterial,
		Vector3,
		WebGLRenderer
	} from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import type { AnalysisKind, AnalysisResult, FaceRecord, OverlayMarker, ParsedBuildingModel, PartKey, SpaceZone } from './model';
	import { PART_META } from './model';

	let {
		model = null,
		activeAnalysis = 'lighting',
		result = null,
		spaces = [],
		visiblePartKeys = []
	}: {
		model: ParsedBuildingModel | null;
		activeAnalysis: AnalysisKind;
		result: AnalysisResult | null;
		spaces: SpaceZone[];
		visiblePartKeys: PartKey[];
	} = $props();

	type PartRuntime = {
		key: PartKey;
		mesh: Mesh;
		edges: LineSegments;
		material: MeshStandardMaterial;
		edgeMaterial: LineBasicMaterial;
		baseY: number;
		topY: number;
		movesWithWallTop: boolean;
		stretchesWithWall: boolean;
	};

	let stageEl: HTMLDivElement;
	let canvasHost: HTMLDivElement;
	let renderer: WebGLRenderer | null = null;
	let scene: Scene | null = null;
	let camera: PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let root = new Group();
	let overlayRoot = new Group();
	let ground: Mesh | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let raf = 0;
	let mounted = false;
	let currentModel: ParsedBuildingModel | null = null;
	let runtimes: PartRuntime[] = [];
	let overlayObjects: Array<Mesh | ArrowHelper | Sprite | Group> = [];

	function init() {
		renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
		renderer.setClearColor(new Color('#eef2f0'));
		canvasHost.appendChild(renderer.domElement);

		scene = new Scene();
		scene.background = new Color('#eef2f0');
		camera = new PerspectiveCamera(42, 1, 0.05, 2000);
		camera.position.set(12, 9, 14);

		scene.add(new AmbientLight('#f8fbff', 2.2));
		const sun = new DirectionalLight('#fff2df', 2.4);
		sun.position.set(10, 14, 8);
		scene.add(sun);
		const fill = new DirectionalLight('#8fc7d8', 1.2);
		fill.position.set(-8, 6, -10);
		scene.add(fill);

		root = new Group();
		overlayRoot = new Group();
		scene.add(root);
		scene.add(overlayRoot);

		ground = new Mesh(
			new PlaneGeometry(1, 1),
			new MeshStandardMaterial({ color: '#d9ded8', roughness: 0.94, metalness: 0 })
		);
		ground.rotation.x = -Math.PI / 2;
		scene.add(ground);

		controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;
		controls.minPolarAngle = Math.PI * 0.12;
		controls.maxPolarAngle = Math.PI * 0.88;

		resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(stageEl);
		resize();
		buildModel();
		animate();
	}

	function animate() {
		raf = window.requestAnimationFrame(animate);
		controls?.update();
		renderer?.render(scene!, camera!);
	}

	function resize() {
		if (!renderer || !camera || !stageEl) return;
		const width = Math.max(stageEl.clientWidth, 1);
		const height = Math.max(stageEl.clientHeight, 1);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	}

	function clearModel() {
		runtimes.forEach((runtime) => {
			root.remove(runtime.mesh);
			root.remove(runtime.edges);
			runtime.mesh.geometry.dispose();
			runtime.edges.geometry.dispose();
			runtime.material.dispose();
			runtime.edgeMaterial.dispose();
		});
		runtimes = [];
		clearOverlays();
		currentModel = null;
	}

	function clearOverlays() {
		overlayObjects.forEach((object) => {
			overlayRoot.remove(object);
			object.traverse((child: Object3D) => {
				if (child instanceof Mesh) {
					child.geometry.dispose();
					const materials = Array.isArray(child.material) ? child.material : [child.material];
					materials.forEach((material) => material.dispose());
				}
				if (child instanceof Sprite) {
					child.material.map?.dispose();
					child.material.dispose();
				}
			});
		});
		overlayObjects = [];
	}

	function buildModel() {
		if (!mounted || !model || currentModel === model) return;
		clearModel();
		currentModel = model;

		const wallGuide = modelWallGuide(model);
		const grouped = new Map<string, { key: PartKey; movesWithWallTop: boolean; stretchesWithWall: boolean; faces: FaceRecord[] }>();
		model.faces.forEach((face) => {
			const stretchesWithWall = faceStretchesWithWall(face, wallGuide);
			const movesWithWallTop = !stretchesWithWall && faceMovesWithWallTop(face, wallGuide);
			const groupKey = `${face.partKey}:${stretchesWithWall ? 'stretch' : movesWithWallTop ? 'top' : 'base'}`;
			const group = grouped.get(groupKey) || { key: face.partKey, movesWithWallTop, stretchesWithWall, faces: [] };
			group.faces.push(face);
			grouped.set(groupKey, group);
		});

		grouped.forEach(({ key, movesWithWallTop, stretchesWithWall, faces }) => {
			const geometry = geometryFromFaces(faces);
			const material = makeSurfaceMaterial(key);
			const mesh = new Mesh(geometry, material);
			mesh.name = key;
			mesh.frustumCulled = true;
			const edgeGeometry = new EdgesGeometry(geometry, key === 'roof' ? 34 : 42);
			const edgeMaterial = new LineBasicMaterial({
				color: '#27333a',
				transparent: true,
				opacity: key === 'floor' || key === 'ceiling' ? 0.08 : 0.2
			});
			const edges = new LineSegments(edgeGeometry, edgeMaterial);
			edges.frustumCulled = true;
			root.add(mesh);
			root.add(edges);
			runtimes.push({
				key,
				mesh,
				edges,
				material,
				edgeMaterial,
				baseY: Math.min(...faces.map((face) => face.bounds.min.y)),
				topY: Math.max(...faces.map((face) => face.bounds.max.y)),
				movesWithWallTop,
				stretchesWithWall
			});
		});

		fitGround();
		fitCamera();
		applyEditTransform();
		refreshSurfaceMaterials();
		buildOverlays();
	}

	function geometryFromFaces(faces: FaceRecord[]) {
		const positions: number[] = [];
		faces.forEach((face) => {
			if (face.vertices.length < 3) return;
			const first = face.vertices[0];
			for (let index = 1; index < face.vertices.length - 1; index += 1) {
				const second = face.vertices[index];
				const third = face.vertices[index + 1];
				positions.push(first.x, first.y, first.z);
				positions.push(second.x, second.y, second.z);
				positions.push(third.x, third.y, third.z);
			}
		});
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
		geometry.computeVertexNormals();
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
		return geometry;
	}

	function makeSurfaceMaterial(key: PartKey) {
		const visual = partVisual(key);
		return new MeshStandardMaterial({
			color: visual.color,
			roughness: 0.88,
			metalness: 0.02,
			transparent: visual.opacity < 1,
			opacity: visual.opacity,
			side: DoubleSide,
			depthWrite: visual.opacity > 0.35
		});
	}

	function partVisual(key: PartKey) {
		const base = PART_META[key]?.color || PART_META.other.color;
		const kind = result?.kind || activeAnalysis;
		let color = base;
		let opacity = 0.92;

		if (result) {
			opacity = 0.34;
			if (kind === 'lighting' && (key === 'floor' || key === 'ceiling')) {
				color = '#f4c542';
				opacity = 0.86;
			}
			if ((kind === 'ac' || kind === 'thermal') && (key === 'roof' || key === 'walls')) {
				color = kind === 'ac' ? '#38bdf8' : '#ef7c45';
				opacity = 0.86;
			}
			if (kind === 'ottv' && key === 'walls') {
				color = '#ef4444';
				opacity = 0.86;
			}
			if (kind === 'people' && key === 'floor') {
				color = '#22c55e';
				opacity = 0.84;
			}
			if (kind === 'wind' && key === 'walls') {
				color = '#38bdf8';
				opacity = 0.78;
			}
		}

		return { color, opacity };
	}

	function refreshSurfaceMaterials() {
		const visible = new Set(visiblePartKeys.length ? visiblePartKeys : model?.partStats.map((part) => part.key));
		runtimes.forEach((runtime) => {
			const visual = partVisual(runtime.key);
			const isVisible = visible.has(runtime.key);
			runtime.mesh.visible = isVisible;
			runtime.edges.visible = isVisible && (runtime.key !== 'floor' || Boolean(result));
			runtime.material.color.set(visual.color);
			runtime.material.opacity = visual.opacity;
			runtime.material.transparent = visual.opacity < 1;
			runtime.material.depthWrite = visual.opacity > 0.35;
			runtime.material.needsUpdate = true;
			runtime.edgeMaterial.opacity = result ? 0.28 : runtime.key === 'floor' || runtime.key === 'ceiling' ? 0.08 : 0.2;
		});
	}

	function averageSpaceHeight(rows: SpaceZone[], key: 'heightM' | 'detectedHeightM') {
		if (!rows.length) return 1;
		return rows.reduce((sum, space) => sum + Math.max(space[key] || 0, 0), 0) / rows.length;
	}

	function totalSpaceArea(rows: SpaceZone[], key: 'areaM2' | 'detectedAreaM2') {
		return rows.reduce((sum, space) => sum + Math.max(space[key] || 0, 0), 0);
	}

	function modelWallGuide(sourceModel: ParsedBuildingModel) {
		const wallFaces = sourceModel.faces.filter((face) => face.partKey === 'walls');
		if (!wallFaces.length) return null;
		const baseY = Math.min(...wallFaces.map((face) => face.bounds.min.y));
		const topY = Math.max(...wallFaces.map((face) => face.bounds.max.y));
		const wallHeight = averageSpaceHeight(sourceModel.spaces, 'detectedHeightM') || averageSpaceHeight(sourceModel.spaces, 'heightM');
		return { baseY, detectedTopY: baseY + wallHeight, topY };
	}

	function faceStretchesWithWall(face: FaceRecord, wallGuide: { baseY: number; detectedTopY: number; topY: number } | null) {
		if (!wallGuide || ['walls', 'foundation', 'floor', 'roof', 'ceiling', 'furniture'].includes(face.partKey)) return false;
		const wallHeight = wallGuide.detectedTopY - wallGuide.baseY;
		const reachesTop = face.bounds.max.y >= wallGuide.detectedTopY - 0.45;
		return reachesTop && face.bounds.size.y >= Math.max(0.8, wallHeight * 0.2);
	}

	function faceMovesWithWallTop(face: FaceRecord, wallGuide: { baseY: number; detectedTopY: number; topY: number } | null) {
		if (!wallGuide || face.partKey === 'walls' || face.partKey === 'foundation') return false;
		const startsAboveWall = face.bounds.min.y >= wallGuide.detectedTopY - 0.35;
		const sitsOnWallTop = face.bounds.max.y >= wallGuide.detectedTopY - 0.2 && face.bounds.min.y >= wallGuide.detectedTopY - 1;
		return startsAboveWall || sitsOnWallTop;
	}

	function scalesWithArea(key: PartKey) {
		return key === 'floor' || key === 'walls' || key === 'ceiling' || key === 'openings';
	}

	function setRuntimeTransform(runtime: PartRuntime, scale: [number, number, number], position: [number, number, number]) {
		runtime.mesh.scale.set(...scale);
		runtime.edges.scale.set(...scale);
		runtime.mesh.position.set(...position);
		runtime.edges.position.set(...position);
	}

	function applyEditTransform() {
		if (!model) return;
		const activeSpaces = spaces.length ? spaces : model.spaces;
		const detectedArea = totalSpaceArea(model.spaces, 'detectedAreaM2') || totalSpaceArea(model.spaces, 'areaM2') || 1;
		const editedArea = totalSpaceArea(activeSpaces, 'areaM2') || detectedArea;
		const detectedHeight = averageSpaceHeight(model.spaces, 'detectedHeightM') || averageSpaceHeight(model.spaces, 'heightM') || 1;
		const editedHeight = averageSpaceHeight(activeSpaces, 'heightM') || detectedHeight;
		const areaScale = clamp(Math.sqrt(editedArea / detectedArea), 0.35, 2.5);
		const wallGuide = modelWallGuide(model);
		const targetWallTopY = wallGuide ? wallGuide.baseY + editedHeight : model.bounds.min.y + editedHeight;
		const wallTopLift = wallGuide ? targetWallTopY - wallGuide.topY : 0;
		const center = model.bounds.center;

		root.scale.set(1, 1, 1);
		root.position.set(0, 0, 0);
		runtimes.forEach((runtime) => {
			const xzScale = scalesWithArea(runtime.key) ? areaScale : 1;
			const shouldStretchY = runtime.key === 'walls' || runtime.stretchesWithWall;
			const yScale = shouldStretchY ? clamp((targetWallTopY - runtime.baseY) / Math.max(runtime.topY - runtime.baseY, 0.001), 0.35, 2.5) : 1;
			const x = center.x * (1 - xzScale);
			const y = shouldStretchY ? runtime.baseY * (1 - yScale) : runtime.movesWithWallTop ? wallTopLift : 0;
			const z = center.z * (1 - xzScale);
			setRuntimeTransform(runtime, [xzScale, yScale, xzScale], [x, y, z]);
		});
	}

	function clamp(value: number, min: number, max: number) {
		return Math.min(Math.max(value, min), max);
	}

	function fitGround() {
		if (!ground || !model) return;
		const size = model.bounds.size;
		const footprint = Math.max(size.x, size.z, 8);
		ground.geometry.dispose();
		ground.geometry = new PlaneGeometry(footprint * 1.28, footprint * 1.28);
		ground.position.set(model.bounds.center.x, model.bounds.min.y - 0.05, model.bounds.center.z);
	}

	function fitCamera() {
		if (!camera || !controls || !model) return;
		const size = model.bounds.size;
		const center = model.bounds.center;
		const span = Math.max(size.x, size.y, size.z, 6);
		const distance = span * 1.35;
		camera.position.set(center.x + distance, center.y + distance * 0.72, center.z + distance);
		camera.near = 0.05;
		camera.far = Math.max(distance * 8, 800);
		camera.lookAt(center.x, center.y, center.z);
		camera.updateProjectionMatrix();
		controls.target.set(center.x, center.y, center.z);
		controls.minDistance = Math.max(span * 0.18, 1.5);
		controls.maxDistance = span * 5;
		controls.update();
	}

	function buildOverlays() {
		clearOverlays();
		if (!model || !result) return;
		result.markers.forEach((marker) => {
			const object = objectFromMarker(marker);
			overlayRoot.add(object);
			overlayObjects.push(object);
		});
	}

	function objectFromMarker(marker: OverlayMarker) {
		const group = new Group();
		const span = Math.max(model?.bounds.size.x || 8, model?.bounds.size.z || 8, 8);
		const point = new Vector3(marker.position.x, marker.position.y, marker.position.z);
		const color = new Color(marker.color);

		if (marker.type === 'arrow') {
			const direction = new Vector3(marker.direction?.x || 1, marker.direction?.y || 0, marker.direction?.z || 0).normalize();
			const length = Math.max(span * 0.36, 2);
			const arrow = new ArrowHelper(direction, point, length, color, length * 0.22, length * 0.09);
			group.add(arrow);
			group.add(makeLabel(marker.label, marker.color, point.clone().add(direction.clone().multiplyScalar(length * 0.55)).add(new Vector3(0, span * 0.04, 0))));
			return group;
		}

		if (marker.type === 'zone') {
			const radius = Math.max(Math.sqrt(Math.max(marker.value || 12, 4) / Math.PI) * 0.18, 0.35);
			const disk = new Mesh(
				new CylinderGeometry(radius, radius, 0.08, 40),
				new MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.82, metalness: 0 })
			);
			disk.position.copy(point);
			group.add(disk);
			group.add(makeLabel(marker.label, marker.color, point.clone().add(new Vector3(0, span * 0.035, 0))));
			return group;
		}

		const sphere = new Mesh(
			new SphereGeometry(Math.max(span * 0.018, 0.16), 18, 14),
			new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.35 })
		);
		sphere.position.copy(point);
		group.add(sphere);
		group.add(makeLabel(marker.label, marker.color, point.clone().add(new Vector3(0, span * 0.04, 0))));
		return group;
	}

	function makeLabel(text: string, color: string, position: Vector3) {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 160;
		const ctx = canvas.getContext('2d')!;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = 'rgba(10, 15, 18, 0.82)';
		roundRect(ctx, 20, 28, 472, 88, 18);
		ctx.fill();
		ctx.strokeStyle = color;
		ctx.lineWidth = 5;
		roundRect(ctx, 20, 28, 472, 88, 18);
		ctx.stroke();
		ctx.fillStyle = '#f8fafc';
		ctx.font = '600 34px Inter, Arial, sans-serif';
		ctx.fillText(text.slice(0, 24), 44, 83);
		const texture = new CanvasTexture(canvas);
		const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
		const scale = Math.max(model?.bounds.size.x || 8, model?.bounds.size.z || 8, 8) * 0.18;
		sprite.scale.set(scale * 2.9, scale * 0.9, 1);
		sprite.position.copy(position);
		sprite.renderOrder = 100;
		return sprite;
	}

	function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.arcTo(x + width, y, x + width, y + height, radius);
		ctx.arcTo(x + width, y + height, x, y + height, radius);
		ctx.arcTo(x, y + height, x, y, radius);
		ctx.arcTo(x, y, x + width, y, radius);
		ctx.closePath();
	}

	onMount(() => {
		mounted = true;
		init();
	});

	onDestroy(() => {
		mounted = false;
		if (raf) window.cancelAnimationFrame(raf);
		resizeObserver?.disconnect();
		controls?.dispose();
		clearModel();
		ground?.geometry.dispose();
		const groundMaterial = ground?.material;
		if (groundMaterial && !Array.isArray(groundMaterial)) groundMaterial.dispose();
		renderer?.dispose();
		renderer?.domElement.remove();
	});

	$effect(() => {
		model;
		if (mounted) buildModel();
	});

	$effect(() => {
		activeAnalysis;
		result;
		visiblePartKeys;
		if (mounted) {
			refreshSurfaceMaterials();
			buildOverlays();
		}
	});

	$effect(() => {
		spaces;
		if (mounted) applyEditTransform();
	});
</script>

<div class="model-stage" bind:this={stageEl}>
	<div class="canvas-host" bind:this={canvasHost}></div>
	{#if !model}
		<div class="empty-state">
			<strong>JSON belum dimuat</strong>
			<span>Upload atau load sample.</span>
		</div>
	{/if}
</div>

<style>
	.model-stage {
		position: relative;
		min-height: 100%;
		background: #eef2f0;
		overflow: hidden;
	}

	.canvas-host,
	.canvas-host :global(canvas) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}

	.empty-state {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		gap: 0.35rem;
		color: #304148;
		text-align: center;
		background:
			linear-gradient(rgba(238, 242, 240, 0.88), rgba(238, 242, 240, 0.88)),
			repeating-linear-gradient(90deg, transparent 0 42px, rgba(48, 65, 72, 0.07) 42px 43px),
			repeating-linear-gradient(0deg, transparent 0 42px, rgba(48, 65, 72, 0.07) 42px 43px);
	}

	.empty-state strong {
		font-size: 1.1rem;
	}

	.empty-state span {
		color: #66777f;
	}
</style>
