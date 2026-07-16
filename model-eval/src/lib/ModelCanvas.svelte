<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		AmbientLight,
		ArrowHelper,
		Box3,
		BufferGeometry,
		CanvasTexture,
		Color,
		CylinderGeometry,
		DirectionalLight,
		DoubleSide,
		EdgesGeometry,
		Float32BufferAttribute,
		Group,
		InstancedMesh,
		LineBasicMaterial,
		LineSegments,
		Mesh,
		MeshStandardMaterial,
		Object3D,
		OrthographicCamera,
		PerspectiveCamera,
		PlaneGeometry,
		RepeatWrapping,
		Raycaster,
		Scene,
		ShapeUtils,
		SphereGeometry,
		Sprite,
		SpriteMaterial,
		Vector2,
		Vector3,
		WebGLRenderer
	} from 'three';
	import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import type { AnalysisKind, AnalysisResult, FaceRecord, OverlayMarker, ParsedBuildingModel, PartKey, SpaceZone } from './model';
	import { PART_META } from './model';
	import { buildRuntimeGeometryGroups, runtimeComponentOverrides, runtimePartOverrides } from './render/build-runtime-scene';
	import { applyBuildingVisibility, createBuildingVisibility, tagCategoryObject, tagComponentObject } from './render/visibility';
	import { EdgeGeometryCache, MaterialStateManager, type ViewMode } from './render/material-state';
	import type { QACameraSpec } from './render/qa-camera';
	import { buildClassificationUnitHighlight } from './annotation/highlight';
	import type { ClassificationUnitRecord } from './annotation';
	import type { RoomCandidate } from './rooms/types';
	import type { RoomCandidateTrace } from './rooms/room-provenance';
	import { getPrismSideVertexCount, getRoomCandidateBounds, resolveRoomCandidateId, resolveDetectedRoomId, type RoomDebugVisibility } from './rooms/debug-selection';
	import type { RoomTopologyGraph } from './rooms/topology';
	import type { RoomSemanticResult } from './rooms/semantics';
	import type { DetectedRoom } from './rooms/detected-room';
	import type { BuildingAnalysisResult } from './rooms/analysis';


	let {
		model = null,
		activeAnalysis = 'lighting',
		result = null,
		spaces = [],
		visiblePartKeys = [],
		visibleComponentIds = [],
		selectedComponentId = null,
		hoveredComponentId = null,
		viewMode = 'solid',
		hoveredRoomId = null,
		selectedRoomId = null,
		qaMode = false,
		qaCamera = null,
		onQaReady = undefined,
		annotationUnit = null,
		roomCandidates = [],
		selectedRoomCandidateId = null,
		onRoomCandidateSelect = undefined,
		roomFocusRequest = 0,
		roomOverlayVisibility = { primary: true, secondary: true, plan: true, prism: true, labels: true },
		selectedRoomCandidateTrace = null,
		showSelectedRoomEvidence = false,
		roomTopology = null,
		roomSemantics = null,
		detectedRooms = null,
		buildingAnalysis = null,
		selectedDetectedRoomId = null,
		onDetectedRoomSelect = undefined
	}: {
		model: ParsedBuildingModel | null;
		activeAnalysis: AnalysisKind;
		result: AnalysisResult | null;
		spaces: SpaceZone[];
		visiblePartKeys: PartKey[];
		visibleComponentIds?: string[];
		selectedComponentId?: string | null;
		hoveredComponentId?: string | null;
		viewMode?: ViewMode;
		hoveredRoomId?: string | null;
		selectedRoomId?: string | null;
		qaMode?: boolean;
		qaCamera?: QACameraSpec | null;
		annotationUnit?: Pick<ClassificationUnitRecord, 'sourceNodeIds' | 'sourcePrimitiveIds'> | null;
		roomCandidates?: RoomCandidate[];
		selectedRoomCandidateId?: string | null;
		onRoomCandidateSelect?: (id: string) => void;
		roomFocusRequest?: number;
		roomOverlayVisibility?: RoomDebugVisibility;
		selectedRoomCandidateTrace?: RoomCandidateTrace | null;
		showSelectedRoomEvidence?: boolean;
		roomTopology?: RoomTopologyGraph | null;
		roomSemantics?: RoomSemanticResult | null;
		detectedRooms?: DetectedRoom[] | null;
		buildingAnalysis?: BuildingAnalysisResult | null;
		selectedDetectedRoomId?: string | null;
		onDetectedRoomSelect?: (id: string) => void;
		onQaReady?: (payload: {
			viewName: string;
			width: number;
			height: number;
			runtimeGroups: number;
			visibleRuntimeGroups: number;
			visibleRuntimeInstances: number;
			renderedBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
		}) => void;
	} = $props();

	type PartRuntime = {
		key: PartKey;
		componentId?: string;
		baseColor?: string;
		textureName?: string;
		mesh: Mesh;
		edges: Object3D;
		edgeGeometry?: BufferGeometry;
		material: MeshStandardMaterial;
		edgeMaterial: LineBasicMaterial;
		materialKey: string;
		baseY: number;
		topY: number;
		movesWithWallTop: boolean;
		stretchesWithWall: boolean;
	};

	let stageEl: HTMLDivElement;
	let canvasHost: HTMLDivElement;
	let renderer: WebGLRenderer | null = null;
	let scene: Scene | null = null;
	let camera: PerspectiveCamera | OrthographicCamera | null = null;
	let controls: OrbitControls | null = null;
	let root = new Group();
	let overlayRoot = new Group();
	let ground: Mesh | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let raf = 0;
	let mounted = false;
	let currentModel: ParsedBuildingModel | null = null;
	let runtimes: PartRuntime[] = [];
	let overlayObjects: Array<Mesh | ArrowHelper | Sprite | Group | LineSegments> = [];
	let evidenceOverlayObjects: Array<Group | LineSegments> = [];
	let roomInteractionObjects: Array<Group> = [];
	const materialState = new MaterialStateManager();
	const edgeCache = new EdgeGeometryCache();
	const roomRaycaster = new Raycaster();
	const pointer = new Vector2();
	let appliedRoomFocusRequest = 0;

	let annotationHighlightMesh: Mesh | null = null;
	const patternTextures = new Map<string, CanvasTexture>();

	function init() {
		renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
		renderer.setClearColor(new Color('#eef2f0'));
		canvasHost.appendChild(renderer.domElement);

		scene = new Scene();
		scene.background = new Color('#eef2f0');
		camera = new PerspectiveCamera(42, 1, 0.05, 2000);
		camera.layers.enable(1);
		camera.layers.enable(2);
		camera.layers.enable(3);
		camera.layers.enable(4);
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
		configureControls();
		renderer.domElement.addEventListener('click', onCanvasClick);

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
		if (camera instanceof PerspectiveCamera) {
			camera.aspect = width / height;
		} else {
			const halfHeight = Math.max(qaCamera?.orthographicHeightM || 1, 0.001) / 2;
			const halfWidth = halfHeight * (width / height);
			camera.left = -halfWidth;
			camera.right = halfWidth;
			camera.top = halfHeight;
			camera.bottom = -halfHeight;
		}
		camera.updateProjectionMatrix();
	}

	function configureControls() {
		if (!controls) return;
		controls.enableDamping = !qaMode;
		controls.enabled = !qaMode;
		controls.dampingFactor = 0.08;
		controls.minPolarAngle = Math.PI * 0.12;
		controls.maxPolarAngle = Math.PI * 0.88;
	}

	function onCanvasClick(event: MouseEvent) {
		if (!renderer || !camera || (roomCandidates.length === 0 && (!detectedRooms || detectedRooms.length === 0))) return;

		const rect = renderer.domElement.getBoundingClientRect();
		pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
		roomRaycaster.setFromCamera(pointer, camera);
		const hit = roomRaycaster.intersectObjects(overlayObjects, true)[0];
		const candidateId = resolveRoomCandidateId(hit?.object);
		if (candidateId) onRoomCandidateSelect?.(candidateId);
		const drId = resolveDetectedRoomId(hit?.object);
		if (drId) onDetectedRoomSelect?.(drId);
	}

	function applyQaCamera() {
		if (!renderer || !scene || !qaMode || !qaCamera) return;
		const distance = Math.max(
			Math.hypot(
				qaCamera.position.x - qaCamera.target.x,
				qaCamera.position.y - qaCamera.target.y,
				qaCamera.position.z - qaCamera.target.z
			),
			1
		);
		const nextCamera = qaCamera.projectionMode === 'orthographic'
			? new OrthographicCamera(-1, 1, 1, -1, 0.01, Math.max(distance * 20, 2000))
			: new PerspectiveCamera(qaCamera.fieldOfViewDegrees || 42, qaCamera.aspectRatio, 0.01, Math.max(distance * 20, 2000));
		nextCamera.position.set(qaCamera.position.x, qaCamera.position.y, qaCamera.position.z);
		nextCamera.up.set(qaCamera.up.x, qaCamera.up.y, qaCamera.up.z).normalize();
		nextCamera.lookAt(qaCamera.target.x, qaCamera.target.y, qaCamera.target.z);
		camera = nextCamera;
		controls?.dispose();
		controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(qaCamera.target.x, qaCamera.target.y, qaCamera.target.z);
		configureControls();
		scene.background = new Color(qaCamera.backgroundColor);
		if (ground) ground.visible = false;
		resize();
		camera.updateMatrixWorld(true);
		signalQaReady();
	}

	function signalQaReady() {
		if (!qaMode || !qaCamera || !model || !onQaReady) return;
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				if (!renderer || !camera || !stageEl) return;
				renderer.render(scene!, camera);
				root.updateMatrixWorld(true);
				const visibleRuntimes = runtimes.filter((runtime) => runtime.mesh.visible);
				const renderedBounds = visibleRuntimes.reduce((bounds, runtime) => bounds.expandByObject(runtime.mesh), new Box3());
				onQaReady({
					viewName: qaCamera.viewName,
					width: stageEl.clientWidth,
					height: stageEl.clientHeight,
					runtimeGroups: runtimes.length,
					visibleRuntimeGroups: visibleRuntimes.length,
					visibleRuntimeInstances: visibleRuntimes.reduce(
						(sum, runtime) => sum + (runtime.mesh instanceof InstancedMesh ? runtime.mesh.count : 1),
						0
					),
					renderedBounds: renderedBounds.isEmpty()
						? null
						: {
								min: { x: renderedBounds.min.x, y: renderedBounds.min.y, z: renderedBounds.min.z },
								max: { x: renderedBounds.max.x, y: renderedBounds.max.y, z: renderedBounds.max.z }
							}
				});
			});
		});
	}

	function clearModel() {
		clearAnnotationHighlight();
		materialState.dispose();
		edgeCache.dispose();
		runtimes.forEach((runtime) => {
			root.remove(runtime.mesh);
			root.remove(runtime.edges);
			runtime.mesh.geometry.dispose();
			runtime.material.dispose();
			runtime.edgeMaterial.dispose();
		});
		runtimes = [];
		clearOverlays();
		clearEvidenceOverlays();
		clearRoomInteractionOverlays();
		currentModel = null;
	}

	function clearOverlays() {
		disposeOverlayObjects(overlayObjects);
		overlayObjects = [];
	}

	function clearEvidenceOverlays() {
		disposeOverlayObjects(evidenceOverlayObjects);
		evidenceOverlayObjects = [];
	}

	function clearRoomInteractionOverlays() {
		disposeOverlayObjects(roomInteractionObjects);
		roomInteractionObjects = [];
	}

	function disposeOverlayObjects(objects: Array<Mesh | ArrowHelper | Sprite | Group | LineSegments>) {
		objects.forEach((object) => {
			overlayRoot.remove(object);
			object.traverse((child: Object3D) => {
				if (child instanceof Mesh) {
					child.geometry.dispose();
					const materials = Array.isArray(child.material) ? child.material : [child.material];
					materials.forEach((material) => material.dispose());
				}
				if (child instanceof LineSegments) {
					child.geometry.dispose();
					(child.material as LineBasicMaterial).dispose();
				}
				if (child instanceof Sprite) {
					child.material.map?.dispose();
					child.material.dispose();
				}
			});
		});
	}

	function clearAnnotationHighlight() {
		if (!annotationHighlightMesh) return;
		root.remove(annotationHighlightMesh);
		annotationHighlightMesh.geometry.dispose();
		(annotationHighlightMesh.material as MeshStandardMaterial).dispose();
		annotationHighlightMesh = null;
	}

	function rebuildAnnotationHighlight() {
		clearAnnotationHighlight();
		if (!annotationUnit || !model?.runtimeScene) return;
		const geometry = buildClassificationUnitHighlight(model.runtimeScene, annotationUnit);
		if (!geometry) return;
		const material = new MeshStandardMaterial({ color: '#f97316', emissive: '#7c2d12', emissiveIntensity: 0.55, transparent: true, opacity: 0.92, side: DoubleSide, depthWrite: false });
		annotationHighlightMesh = new Mesh(geometry, material);
		annotationHighlightMesh.renderOrder = 20;
		root.add(annotationHighlightMesh);
	}

	function buildModel() {
		if (!mounted || !model || currentModel === model) return;
		clearModel();
		currentModel = model;

		const wallGuide = modelWallGuide(model);
		if (model.runtimeScene) {
			buildIndexedRuntimeModel(model, wallGuide);
			fitGround();
			fitCamera();
			applyEditTransform();
			refreshSurfaceMaterials();
			rebuildAnnotationHighlight();
			buildOverlays();
			return;
		}
		const grouped = new Map<
			string,
			{ key: PartKey; baseColor?: string; textureName?: string; movesWithWallTop: boolean; stretchesWithWall: boolean; faces: FaceRecord[] }
		>();
		model.faces.forEach((face) => {
			const stretchesWithWall = faceStretchesWithWall(face, wallGuide);
			const movesWithWallTop = !stretchesWithWall && faceMovesWithWallTop(face, wallGuide);
			const textureName = texturePatternName(face);
			const groupKey = `${face.partKey}:${face.color || 'default'}:${textureName || 'flat'}:${stretchesWithWall ? 'stretch' : movesWithWallTop ? 'top' : 'base'}`;
			const group = grouped.get(groupKey) || {
				key: face.partKey,
				baseColor: face.color,
				textureName,
				movesWithWallTop,
				stretchesWithWall,
				faces: []
			};
			group.faces.push(face);
			grouped.set(groupKey, group);
		});

		grouped.forEach(({ key, baseColor, textureName, movesWithWallTop, stretchesWithWall, faces }, groupId) => {
			const geometry = geometryFromFaces(faces);
			const material = makeSurfaceMaterial(key, baseColor, textureName);
			const materialKey = `legacy:${groupId}`;
			materialState.register(materialKey, material, key);
			const mesh = new Mesh(geometry, material);
			tagCategoryObject(mesh, key);
			mesh.name = key;
			mesh.frustumCulled = true;
			const edgeGeometry = edgeCache.get(materialKey, geometry, key === 'roof' ? 34 : 42);
			const edgeMaterial = new LineBasicMaterial({
				color: '#27333a',
				transparent: true,
				opacity: defaultEdgeVisible(key) ? 0.2 : 0.08
			});
			const edges = new LineSegments(edgeGeometry, edgeMaterial);
			tagCategoryObject(edges, key);
			edges.frustumCulled = true;
			edges.visible = defaultEdgeVisible(key);
			edges.layers.set(1);
			root.add(mesh);
			root.add(edges);
			runtimes.push({
				key,
				baseColor,
				textureName,
				mesh,
				edges,
				edgeGeometry,
				material,
				edgeMaterial,
				materialKey,
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

	function buildIndexedRuntimeModel(sourceModel: ParsedBuildingModel, wallGuide: ReturnType<typeof modelWallGuide>) {
		if (!sourceModel.runtimeScene) return;
		const groups = buildRuntimeGeometryGroups(
			sourceModel.runtimeScene,
			runtimePartOverrides(sourceModel.faces),
			runtimeComponentOverrides(sourceModel.componentIndex?.bindings || [])
		);
		groups.forEach((group, groupIndex) => {
			const material = makeSurfaceMaterial(group.key, group.baseColor, group.textureName);
			const materialKey = `runtime:${group.sourceMeshIndex}:${group.definitionIndex}:${group.componentId || group.key}:${groupIndex}`;
			materialState.register(materialKey, material, group.key);
			const mesh = new InstancedMesh(group.geometry, material, group.matrices.length);
			tagCategoryObject(mesh, group.key);
			if (group.componentId) tagComponentObject(mesh, group.componentId);
			group.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingBox();
			mesh.computeBoundingSphere();
			mesh.name = `${group.key}:bome2:${group.sourceMeshIndex}`;
			mesh.frustumCulled = true;

			const edges = new Group();
			tagCategoryObject(edges, group.key);
			if (group.componentId) tagComponentObject(edges, group.componentId);
			edges.name = `${mesh.name}:cached-edges`;
			edges.layers.set(1);
			const edgeMaterial = new LineBasicMaterial({
				color: '#27333a',
				transparent: true,
				opacity: 0
			});
			const edgeGeometry = edgeCache.get(materialKey, group.geometry, group.key === 'roof' ? 34 : 42);
			for (const matrix of group.matrices) {
				const lines = new LineSegments(edgeGeometry, edgeMaterial);
				lines.matrix.copy(matrix);
				lines.matrixAutoUpdate = false;
				lines.layers.set(1);
				edges.add(lines);
			}
			root.add(mesh);
			root.add(edges);

			const relatedFaces = sourceModel.faces.filter((face) => face.partKey === group.key);
			const stretchesWithWall = relatedFaces.some((face) => faceStretchesWithWall(face, wallGuide));
			const movesWithWallTop = !stretchesWithWall && relatedFaces.some((face) => faceMovesWithWallTop(face, wallGuide));
			runtimes.push({
				key: group.key,
				componentId: group.componentId,
				baseColor: group.baseColor,
				textureName: group.textureName,
				mesh,
				edges,
				material,
				edgeMaterial,
				materialKey,
				baseY: group.baseY,
				topY: group.topY,
				movesWithWallTop,
				stretchesWithWall
			});
		});
	}

	function geometryFromFaces(faces: FaceRecord[]) {
		const positions: number[] = [];
		const uvs: number[] = [];
		faces.forEach((face) => {
			if (face.vertices.length < 3) return;
			if (!face.holes.length && face.vertices.length === 3) {
				face.vertices.forEach((source) => {
					positions.push(source.x, source.y, source.z);
					const uv = faceUv(source, face);
					uvs.push(uv.x, uv.y);
				});
				return;
			}
			const { contour, holes, points } = projectFaceTo2d(face);
			const triangles = ShapeUtils.triangulateShape(contour, holes);
			triangles.forEach((triangle) => {
				triangle.forEach((index) => {
					const source = points[index];
					if (source) {
						positions.push(source.x, source.y, source.z);
						const uv = faceUv(source, face);
						uvs.push(uv.x, uv.y);
					}
				});
			});
		});
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
		geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
		geometry.computeVertexNormals();
		geometry.computeBoundingBox();
		geometry.computeBoundingSphere();
		return geometry;
	}

	function faceUv(point: FaceRecord['vertices'][number], face: FaceRecord) {
		const normal = faceNormal(face.vertices);
		const x = Math.abs(normal.x);
		const y = Math.abs(normal.y);
		const z = Math.abs(normal.z);
		const scale = textureUvScale(texturePatternName(face));
		if (y >= x && y >= z) return { x: point.x * scale, y: point.z * scale };
		if (x >= z) return { x: point.z * scale, y: point.y * scale };
		return { x: point.x * scale, y: point.y * scale };
	}

	function faceNormal(vertices: FaceRecord['vertices']) {
		const normal = new Vector3();
		for (let index = 0; index < vertices.length; index += 1) {
			const current = vertices[index];
			const next = vertices[(index + 1) % vertices.length];
			normal.x += (current.y - next.y) * (current.z + next.z);
			normal.y += (current.z - next.z) * (current.x + next.x);
			normal.z += (current.x - next.x) * (current.y + next.y);
		}
		return normal.normalize();
	}

	function projectFaceTo2d(face: FaceRecord) {
		const normal = faceNormal(face.vertices);
		const axis =
			Math.abs(normal.x) >= Math.abs(normal.y) && Math.abs(normal.x) >= Math.abs(normal.z)
				? 'x'
				: Math.abs(normal.y) >= Math.abs(normal.z)
					? 'y'
					: 'z';
		const points: FaceRecord['vertices'] = [];
		const project = (source: FaceRecord['vertices'][number]) => {
			const point =
				axis === 'x' ? new Vector2(source.z, source.y) : axis === 'y' ? new Vector2(source.x, source.z) : new Vector2(source.x, source.y);
			points.push(source);
			return point;
		};
		const contour = face.vertices.map(project);
		const holes = face.holes.map((loop) => loop.map(project));
		return {
			contour,
			holes,
			points
		};
	}

	function texturePatternName(face: FaceRecord) {
		const name = `${face.textureName || ''} ${face.name || ''}`.toLowerCase();
		if (name.match(/shingle|roofing/) || face.partKey === 'roof') return 'roof-shingles';
		if (name.match(/siding|cladding|weatherboard|lap/)) return 'wall-siding';
		if (name.match(/brick|masonry|paver|paving/)) return 'brick';
		if (name.match(/concrete|cement|plaster/)) return 'concrete';
		return undefined;
	}

	function textureUvScale(textureName?: string) {
		if (textureName === 'roof-shingles') return 1.25;
		if (textureName === 'wall-siding') return 0.95;
		if (textureName === 'brick') return 2.1;
		return 1;
	}

	function proceduralTexture(textureName: string | undefined, key: PartKey) {
		if (!textureName) return null;
		const cacheKey = `${key}:${textureName}`;
		const cached = patternTextures.get(cacheKey);
		if (cached) return cached;

		const canvas = document.createElement('canvas');
		canvas.width = 256;
		canvas.height = 256;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;

		drawPattern(ctx, textureName, key);
		const texture = new CanvasTexture(canvas);
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
		texture.anisotropy = 8;
		patternTextures.set(cacheKey, texture);
		return texture;
	}

	function drawPattern(ctx: CanvasRenderingContext2D, textureName: string, key: PartKey) {
		ctx.clearRect(0, 0, 256, 256);
		if (textureName === 'roof-shingles') {
			ctx.fillStyle = '#5a5750';
			ctx.fillRect(0, 0, 256, 256);
			for (let y = 0; y < 270; y += 18) {
				ctx.strokeStyle = y % 36 === 0 ? '#222323' : '#343536';
				ctx.lineWidth = 1.2;
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(256, y);
				ctx.stroke();
				const offset = (Math.floor(y / 18) % 2) * 11;
				for (let x = -22; x < 278; x += 22) {
					ctx.beginPath();
					ctx.arc(x + offset + 11, y, 11, 0, Math.PI);
					ctx.stroke();
				}
			}
			return;
		}

		if (textureName === 'wall-siding') {
			ctx.fillStyle = '#eff1ee';
			ctx.fillRect(0, 0, 256, 256);
			for (let y = 8; y < 256; y += 16) {
				ctx.strokeStyle = '#b6bdbb';
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(256, y);
				ctx.stroke();
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(0, y + 2);
				ctx.lineTo(256, y + 2);
				ctx.stroke();
			}
			return;
		}

		if (textureName === 'brick') {
			ctx.fillStyle = key === 'floor' || key === 'foundation' ? '#ad9697' : '#77503c';
			ctx.fillRect(0, 0, 256, 256);
			ctx.strokeStyle = key === 'floor' || key === 'foundation' ? '#806e70' : '#33241f';
			ctx.lineWidth = 2;
			for (let y = 0; y <= 256; y += 22) {
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(256, y);
				ctx.stroke();
				const offset = (Math.floor(y / 22) % 2) * 22;
				for (let x = -offset; x <= 256; x += 44) {
					ctx.beginPath();
					ctx.moveTo(x, y);
					ctx.lineTo(x, y + 22);
					ctx.stroke();
				}
			}
			return;
		}

		ctx.fillStyle = '#d8d8d4';
		ctx.fillRect(0, 0, 256, 256);
		for (let index = 0; index < 900; index += 1) {
			const x = (index * 47) % 256;
			const y = (index * 89) % 256;
			const value = 184 + ((index * 17) % 34);
			ctx.fillStyle = `rgb(${value}, ${value}, ${value - 2})`;
			ctx.fillRect(x, y, 1, 1);
		}
	}

	function makeSurfaceMaterial(key: PartKey, baseColor?: string, textureName?: string) {
		const visual = partVisual(key, baseColor);
		return new MeshStandardMaterial({
			color: textureName ? '#ffffff' : visual.color,
			map: proceduralTexture(textureName, key),
			roughness: 0.88,
			metalness: 0.02,
			transparent: visual.opacity < 1,
			opacity: visual.opacity,
			side: DoubleSide,
			depthWrite: visual.opacity > 0.35
		});
	}

	function partVisual(key: PartKey, baseColor?: string) {
		const base = baseColor || PART_META[key]?.color || PART_META.other.color;
		const kind = result?.kind || activeAnalysis;
		let color = base;
		let opacity = 1;

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

	function defaultEdgeVisible(key: PartKey) {
		return !['walls', 'floor', 'ceiling', 'roof'].includes(key);
	}

	function refreshSurfaceMaterials() {
		const visibility = createBuildingVisibility(
			Object.keys(PART_META) as PartKey[],
			visiblePartKeys,
			model?.componentIndex?.all.map((component) => component.id) || [],
			visibleComponentIds
		);
		applyBuildingVisibility(root, visibility);
		runtimes.forEach((runtime) => {
			const visual = partVisual(runtime.key, runtime.baseColor);
			const isVisible = visibility.categories.get(runtime.key) === true && (!runtime.componentId || visibility.components.get(runtime.componentId) === true);
			const selected = Boolean(runtime.componentId && runtime.componentId === selectedComponentId);
			const hovered = Boolean(runtime.componentId && runtime.componentId === hoveredComponentId);
			runtime.mesh.visible = isVisible;
			runtime.edges.visible = isVisible && (selected || hovered || Boolean(result) || defaultEdgeVisible(runtime.key));
			runtime.material.color.set(selected ? '#f59e0b' : hovered ? '#22b8a7' : !result && runtime.textureName ? '#ffffff' : visual.color);
			runtime.material.map = result || selected || hovered ? null : proceduralTexture(runtime.textureName, runtime.key);
			const opacity = annotationUnit ? Math.min(visual.opacity, 0.12) : visual.opacity;
			runtime.material.opacity = opacity;
			runtime.material.transparent = opacity < 1;
			runtime.material.depthWrite = opacity > 0.35;
			runtime.material.needsUpdate = true;
			materialState.applyMode(viewMode);
			runtime.mesh.material = materialState.materialFor(runtime.materialKey, viewMode, selected || hovered);
			runtime.edges.visible = isVisible && (viewMode !== 'solid' || selected || hovered || Boolean(result) || defaultEdgeVisible(runtime.key));
			runtime.edgeMaterial.opacity = selected ? 0.9 : hovered ? 0.65 : viewMode === 'xray' ? 0.55 : viewMode === 'wireframe' ? 0.32 : result ? 0.28 : defaultEdgeVisible(runtime.key) ? 0.2 : 0.08;
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
		return key === 'floor' || key === 'walls' || key === 'ceiling' || key === 'doors' || key === 'windows' || key === 'openings';
	}

	function setRuntimeTransform(runtime: PartRuntime, scale: [number, number, number], position: [number, number, number]) {
		runtime.mesh.scale.set(...scale);
		runtime.edges.scale.set(...scale);
		runtime.mesh.position.set(...position);
		runtime.edges.position.set(...position);
	}

	function applyEditTransform() {
		root.scale.set(1, 1, 1);
		root.position.set(0, 0, 0);
		runtimes.forEach((runtime) => {
			setRuntimeTransform(runtime, [1, 1, 1], [0, 0, 0]);
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
		if (qaMode && qaCamera) {
			applyQaCamera();
			return;
		}
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

	function focusRoomCandidate(candidate: RoomCandidate) {
		if (!camera || !controls) return;
		const bounds = getRoomCandidateBounds(candidate);
		const box = new Box3(
			new Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
			new Vector3(bounds.max.x, bounds.max.y, bounds.max.z)
		);
		const target = box.getCenter(new Vector3());
		const size = box.getSize(new Vector3());
		const span = Math.max(size.x, size.y, size.z, 0.6);
		const direction = camera.position.clone().sub(controls.target);
		if (direction.lengthSq() < 0.0001) direction.set(1, 0.7, 1);
		camera.position.copy(target).add(direction.normalize().multiplyScalar(Math.max(span * 2, 2.2)));
		camera.lookAt(target);
		camera.updateProjectionMatrix();
		controls.target.copy(target);
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

	function buildRoomInteractionOverlay() {
		clearRoomInteractionOverlays();
		const activeId = selectedRoomId || hoveredRoomId;
		const room = spaces.find((space) => space.id === activeId);
		if (!room) return;
		const footprint = room.footprint?.length && room.footprint.length >= 3 ? room.footprint : fallbackRoomFootprint(room);
		const shape = footprint.map((point) => new Vector2(point.x, point.z));
		const triangles = ShapeUtils.triangulateShape(shape, []);
		const height = room.detectedHeightM > 0.2 ? room.detectedHeightM : room.heightM;
		const baseY = room.center.y - Math.max(height, 0) / 2 + 0.012;
		const selected = selectedRoomId === room.id;
		const color = new Color(selected ? '#f59e0b' : '#14b8a6');
		const group = new Group();
		group.name = `room-interaction:${room.id}`;
		group.userData.roomId = room.id;
		group.renderOrder = 30;

		const floorGeometry = new BufferGeometry();
		floorGeometry.setAttribute('position', new Float32BufferAttribute(triangulatedPositions(triangles, shape, baseY), 3));
		floorGeometry.computeVertexNormals();
		const floor = new Mesh(floorGeometry, roomSurfaceMaterial(color, selected ? 0.48 : 0.36));
		floor.layers.set(2);
		floor.renderOrder = 30;
		group.add(floor);

		const edgeGeometry = new BufferGeometry();
		edgeGeometry.setAttribute('position', new Float32BufferAttribute(roomBoundaryPositions(footprint, baseY + 0.015), 3));
		const edges = new LineSegments(edgeGeometry, new LineBasicMaterial({ color, transparent: true, opacity: 1, depthTest: true }));
		edges.layers.set(2);
		edges.renderOrder = 31;
		group.add(edges);

		if (height > 0.2) {
			const prismGeometry = new BufferGeometry();
			prismGeometry.setAttribute('position', new Float32BufferAttribute(roomPrismSidePositions(footprint, baseY, baseY + height), 3));
			prismGeometry.computeVertexNormals();
			const prism = new Mesh(prismGeometry, roomSurfaceMaterial(color, selected ? 0.22 : 0.14));
			prism.layers.set(2);
			prism.renderOrder = 29;
			group.add(prism);
		}

		overlayRoot.add(group);
		roomInteractionObjects.push(group);
	}

	function fallbackRoomFootprint(room: SpaceZone) {
		const half = Math.sqrt(Math.max(room.areaM2, 0.25)) / 2;
		return [
			{ x: room.center.x - half, z: room.center.z - half },
			{ x: room.center.x + half, z: room.center.z - half },
			{ x: room.center.x + half, z: room.center.z + half },
			{ x: room.center.x - half, z: room.center.z + half }
		];
	}

	// Status colour palette for room candidates
	const ROOM_STATUS_COLOR: Record<string, string> = {
		primary: '#22d3ee',
		secondary: '#a78bfa',
		ambiguous: '#f59e0b'
	};

	function buildRoomDebugOverlays() {
		if (!model || roomCandidates.length === 0) return;

		const span = Math.max(
			model.bounds.size.x || 8,
			model.bounds.size.y || 8,
			model.bounds.size.z || 8,
			8
		);

		for (const candidate of roomCandidates) {
			const polygon = candidate.planPolygon;
			if (!polygon || polygon.length < 3) continue;

			const dr = detectedRooms?.find((r) => r.evidence.sourceLoopId === candidate.loopCandidateId);
			const sem = dr && roomSemantics ? roomSemantics.inferences.find((s) => s.roomId === dr.id) : null;
			const roomAnalysis = dr && buildingAnalysis ? buildingAnalysis.rooms.find((ra) => ra.roomId === dr.id) : null;
			let hex = ROOM_STATUS_COLOR[candidate.status] ?? '#22d3ee';
			if (roomOverlayVisibility?.analysisOverlay === 'thermal' && roomAnalysis) {
				const status = roomAnalysis.thermalComfort.status;
				if (status === 'comfortable') hex = '#22c55e';
				else if (status === 'warm') hex = '#f97316';
				else if (status === 'cool') hex = '#3b82f6';
				else hex = '#64748b';
			} else if (roomOverlayVisibility?.analysisOverlay === 'flow' && roomAnalysis) {
				const score = roomAnalysis.humanFlow.movementScore.value ?? 50;
				if (roomAnalysis.humanFlow.isIsolated) hex = '#ef4444';
				else if (score >= 75) hex = '#10b981';
				else if (score >= 40) hex = '#eab308';
				else hex = '#f97316';
			}
			const color = new Color(hex);
			const selected = candidate.id === selectedRoomCandidateId || (dr && dr.id === selectedDetectedRoomId);

			const shape2D = polygon.map((p) => new Vector2(p.x, p.z));
			let tris: number[][];
			try {
				tris = ShapeUtils.triangulateShape(shape2D, []);
			} catch {
				continue;
			}

			const floorY = candidate.lowerElevation;
			const ceilY = candidate.upperElevation;
			if (roomOverlayVisibility.plan) {
				const planGroup = createRoomOverlayGroup(candidate.id, 'plan');
				const floorPositions = triangulatedPositions(tris, shape2D, floorY);
				const floorGeo = new BufferGeometry();
				floorGeo.setAttribute('position', new Float32BufferAttribute(floorPositions, 3));
				floorGeo.computeVertexNormals();
				const floorMesh = new Mesh(floorGeo, roomSurfaceMaterial(color, selected ? 0.42 : 0.18));
				floorMesh.userData.roomCandidateId = candidate.id;
				if (dr) floorMesh.userData.detectedRoomId = dr.id;
				floorMesh.renderOrder = 10;
				planGroup.add(floorMesh);

				const ceilPositions = triangulatedPositions(tris, shape2D, ceilY);
				const ceilGeo = new BufferGeometry();
				ceilGeo.setAttribute('position', new Float32BufferAttribute(ceilPositions, 3));
				ceilGeo.computeVertexNormals();
				const ceilMesh = new Mesh(ceilGeo, roomSurfaceMaterial(color, selected ? 0.26 : 0.10));
				ceilMesh.userData.roomCandidateId = candidate.id;
				if (dr) ceilMesh.userData.detectedRoomId = dr.id;
				ceilMesh.renderOrder = 10;
				planGroup.add(ceilMesh);

				const edgeGeo = new BufferGeometry();
				edgeGeo.setAttribute('position', new Float32BufferAttribute(roomBoundaryPositions(polygon, floorY), 3));
				const wire = new LineSegments(edgeGeo, new LineBasicMaterial({ color: selected ? color.clone().lerp(new Color('#ffffff'), 0.36) : color, linewidth: 1 }));
				wire.userData.roomCandidateId = candidate.id;
				if (dr) wire.userData.detectedRoomId = dr.id;
				wire.renderOrder = 11;
				planGroup.add(wire);
				overlayRoot.add(planGroup);
				overlayObjects.push(planGroup);
			}

			if (roomOverlayVisibility.prism) {
				const prismGroup = createRoomOverlayGroup(candidate.id, 'prism');
				const prismGeo = new BufferGeometry();
				const prismPositions = roomPrismSidePositions(polygon, floorY, ceilY);
				if (prismPositions.length !== getPrismSideVertexCount(polygon) * 3) continue;
				prismGeo.setAttribute('position', new Float32BufferAttribute(prismPositions, 3));
				prismGeo.computeVertexNormals();
				const prism = new Mesh(prismGeo, roomSurfaceMaterial(color, selected ? 0.28 : 0.12));
				prism.userData.roomCandidateId = candidate.id;
				if (dr) prism.userData.detectedRoomId = dr.id;
				prism.renderOrder = 9;
				prismGroup.add(prism);
				overlayRoot.add(prismGroup);
				overlayObjects.push(prismGroup);
			}

			if (!roomOverlayVisibility.labels) continue;
			const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
			const cz = polygon.reduce((s, p) => s + p.z, 0) / polygon.length;
			const midY = (floorY + ceilY) / 2;
			const shortId = candidate.id.slice(-8);
			const labelText = sem
				? `[${sem.primaryFunction.toUpperCase()}] ${candidate.planArea.toFixed(1)}m² (${Math.round(sem.confidence * 100)}%)`
				: `${candidate.status[0].toUpperCase()} ${candidate.planArea.toFixed(1)}m² h${candidate.clearHeight.toFixed(2)}`;
			const labelPos = new Vector3(cx, midY + span * 0.015, cz);
			const lbl = makeRoomLabel(labelText, shortId, hex, labelPos, span, selected);
			lbl.userData.roomCandidateId = candidate.id;
			if (dr) lbl.userData.detectedRoomId = dr.id;
			const labelGroup = createRoomOverlayGroup(candidate.id, 'label');
			labelGroup.add(lbl);
			overlayRoot.add(labelGroup);
			overlayObjects.push(labelGroup);
		}
	}

	function buildTopologyOverlays() {
		if (!model || !roomTopology || roomOverlayVisibility.topology === false) return;

		const activeDetectedRoomId = selectedDetectedRoomId || (
			selectedRoomCandidateId && detectedRooms
				? detectedRooms.find((r) => r.evidence.sourceLoopId === roomCandidates.find((c) => c.id === selectedRoomCandidateId)?.loopCandidateId)?.id
				: null
		);

		const candidateMap = new Map<string, RoomCandidate>();
		if (detectedRooms && roomCandidates.length > 0) {
			for (const dr of detectedRooms) {
				const cand = roomCandidates.find((c) => c.loopCandidateId === dr.evidence.sourceLoopId);
				if (cand) candidateMap.set(dr.id, cand);
			}
		}

		for (const sb of roomTopology.sharedBoundaries) {
			const isConnectedToActive = activeDetectedRoomId && (sb.roomAId === activeDetectedRoomId || sb.roomBId === activeDetectedRoomId);
			if (activeDetectedRoomId && !isConnectedToActive) continue;

			const candA = candidateMap.get(sb.roomAId);
			const candB = candidateMap.get(sb.roomBId);
			const floorY = Math.min(candA?.lowerElevation ?? 0, candB?.lowerElevation ?? 0) + 0.05;
			const ceilY = Math.min(candA?.upperElevation ?? 3, candB?.upperElevation ?? 3) - 0.05;

			const start = sb.segment.start;
			const end = sb.segment.end;
			const wallGroup = createRoomOverlayGroup(sb.id, 'topology');
			const pos = [
				start.x, floorY, start.z,
				end.x, floorY, end.z,
				end.x, ceilY, end.z,
				start.x, floorY, start.z,
				end.x, ceilY, end.z,
				start.x, ceilY, start.z
			];
			const geo = new BufferGeometry();
			geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
			geo.computeVertexNormals();
			const mesh = new Mesh(
				geo,
				new MeshStandardMaterial({
					color: new Color(isConnectedToActive ? '#d946ef' : '#a855f7'),
					transparent: true,
					opacity: isConnectedToActive ? 0.65 : 0.2,
					side: DoubleSide
				})
			);
			mesh.renderOrder = 14;
			wallGroup.add(mesh);
			overlayRoot.add(wallGroup);
			overlayObjects.push(wallGroup);
		}

		for (const conn of roomTopology.connections) {
			const isConnectedToActive = activeDetectedRoomId && (conn.fromRoomId === activeDetectedRoomId || conn.toRoomId === activeDetectedRoomId);
			if (activeDetectedRoomId && !isConnectedToActive) continue;

			if (conn.evidence.segment) {
				const cand = candidateMap.get(conn.fromRoomId) || candidateMap.get(conn.toRoomId);
				const floorY = (cand?.lowerElevation ?? 0) + 0.08;
				const topY = floorY + (conn.headElevation ?? (conn.type === 'vertical_connection' ? 3.0 : 2.1));

				const start = conn.evidence.segment.start;
				const end = conn.evidence.segment.end;
				const connGroup = createRoomOverlayGroup(conn.id, 'topology');
				const pos = [
					start.x, floorY, start.z,
					end.x, floorY, end.z,
					end.x, topY, end.z,
					start.x, floorY, start.z,
					end.x, topY, end.z,
					start.x, topY, start.z
				];
				const geo = new BufferGeometry();
				geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
				geo.computeVertexNormals();
				const mesh = new Mesh(
					geo,
					new MeshStandardMaterial({
						color: new Color(conn.type === 'vertical_connection' ? '#f59e0b' : '#10b981'),
						transparent: true,
						opacity: isConnectedToActive ? 0.75 : 0.3,
						side: DoubleSide
					})
				);
				mesh.renderOrder = 15;
				connGroup.add(mesh);
				overlayRoot.add(connGroup);
				overlayObjects.push(connGroup);
			}
		}

		for (const ext of roomTopology.exteriorConnections) {
			const isConnectedToActive = activeDetectedRoomId && ext.roomId === activeDetectedRoomId;
			if (activeDetectedRoomId && !isConnectedToActive) continue;

			if (ext.boundarySegment) {
				const cand = candidateMap.get(ext.roomId);
				const floorY = (cand?.lowerElevation ?? 0) + (ext.sillElevation ?? (ext.type === 'window' ? 0.9 : 0.05));
				const topY = (cand?.lowerElevation ?? 0) + (ext.headElevation ?? 2.1);

				const start = ext.boundarySegment.start;
				const end = ext.boundarySegment.end;
				const extGroup = createRoomOverlayGroup(ext.id, 'topology');
				const pos = [
					start.x, floorY, start.z,
					end.x, floorY, end.z,
					end.x, topY, end.z,
					start.x, floorY, start.z,
					end.x, topY, end.z,
					start.x, topY, start.z
				];
				const geo = new BufferGeometry();
				geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
				geo.computeVertexNormals();
				const mesh = new Mesh(
					geo,
					new MeshStandardMaterial({
						color: new Color(ext.type === 'window' ? '#06b6d4' : '#10b981'),
						transparent: true,
						opacity: isConnectedToActive ? 0.75 : 0.3,
						side: DoubleSide
					})
				);
				mesh.renderOrder = 15;
				extGroup.add(mesh);
				overlayRoot.add(extGroup);
				overlayObjects.push(extGroup);
			}
		}
	}

	function buildSelectedEvidenceOverlays() {
		clearEvidenceOverlays();
		if (!model || !showSelectedRoomEvidence || !selectedRoomCandidateTrace) return;
		const trace = selectedRoomCandidateTrace;
		const addGeometry = (kind: 'evidence-loop' | 'evidence-lower' | 'evidence-upper', geometry: RoomCandidateTrace['loop']['geometry'], elevation: number, color: string) => {
			const polygon = geometry.polygon.length >= 3 ? geometry.polygon : [
				{ x: geometry.bounds.min.x, z: geometry.bounds.min.z }, { x: geometry.bounds.max.x, z: geometry.bounds.min.z },
				{ x: geometry.bounds.max.x, z: geometry.bounds.max.z }, { x: geometry.bounds.min.x, z: geometry.bounds.max.z }
			];
			const group = new Group();
			group.userData.roomCandidateId = trace.candidate.id;
			group.userData.roomOverlayKind = kind;
			const line = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: geometry.approximate ? '#f59e0b' : color }));
			line.geometry.setAttribute('position', new Float32BufferAttribute(roomBoundaryPositions(polygon, elevation), 3));
			line.userData.roomCandidateId = trace.candidate.id;
			line.userData.roomOverlayKind = kind;
			group.add(line);
			overlayRoot.add(group);
			evidenceOverlayObjects.push(group);
		};
		addGeometry('evidence-loop', trace.loop.geometry, trace.candidate.lowerElevation, '#f8fafc');
		if (trace.upperEvidence) addGeometry('evidence-upper', trace.upperEvidence.geometry, trace.upperEvidence.elevation, '#fb7185');
	}

	function buildAnalysisOverlays() {
		if (!model || !buildingAnalysis || !roomOverlayVisibility?.analysisOverlay || roomOverlayVisibility.analysisOverlay === 'none') return;

		const mode = roomOverlayVisibility.analysisOverlay;
		const activeDetectedRoomId = selectedDetectedRoomId || (
			selectedRoomCandidateId && detectedRooms
				? detectedRooms.find((r) => r.evidence.sourceLoopId === roomCandidates.find((c) => c.id === selectedRoomCandidateId)?.loopCandidateId)?.id
				: null
		);

		if (mode === 'ventilation') {
			for (const roomRes of buildingAnalysis.rooms) {
				if (activeDetectedRoomId && roomRes.roomId !== activeDetectedRoomId) continue;
				const dr = detectedRooms?.find((r) => r.id === roomRes.roomId);
				if (!dr) continue;

				const center = new Vector3(dr.centroid.x, dr.centroid.y, dr.centroid.z);
				if (roomTopology) {
					const extConns = roomTopology.exteriorConnections.filter((ec) => ec.roomId === dr.id);
					for (const ec of extConns) {
						if (!ec.boundarySegment) continue;
						const start = ec.boundarySegment.start;
						const end = ec.boundarySegment.end;
						const midX = (start.x + end.x) / 2;
						const midZ = (start.z + end.z) / 2;
						const midY = ((ec.sillElevation ?? 0.9) + (ec.headElevation ?? 2.1)) / 2;
						const origin = new Vector3(midX, midY, midZ);
						const dir = center.clone().sub(origin).normalize();
						const dist = Math.min(origin.distanceTo(center) * 0.8, 2.5);
						const arrow = new ArrowHelper(dir, origin, dist, 0x06b6d4, 0.4, 0.25);
						const group = createRoomOverlayGroup(dr.id, 'analysis_vent');
						group.add(arrow);
						overlayRoot.add(group);
						overlayObjects.push(group);
					}
				}
			}
		} else if (mode === 'lighting') {
			const sphereGeo = new SphereGeometry(0.12, 16, 16);
			for (const roomRes of buildingAnalysis.rooms) {
				if (activeDetectedRoomId && roomRes.roomId !== activeDetectedRoomId) continue;
				const dr = detectedRooms?.find((r) => r.id === roomRes.roomId);
				if (!dr) continue;

				const positions = roomRes.artificialLighting.proposedPositions;
				for (const pos of positions) {
					const mat = new MeshStandardMaterial({
						color: pos.isValidInsidePolygon ? 0xfacc15 : 0xef4444,
						emissive: pos.isValidInsidePolygon ? 0xeab308 : 0xdc2626,
						emissiveIntensity: 0.6
					});
					const sphere = new Mesh(sphereGeo, mat);
					sphere.position.set(pos.position.x, pos.position.y, pos.position.z);
					const group = createRoomOverlayGroup(dr.id, 'analysis_light');
					group.add(sphere);
					overlayRoot.add(group);
					overlayObjects.push(group);
				}
			}
		} else if (mode === 'flow') {
			if (!roomTopology) return;
			const lineMat = new LineBasicMaterial({ color: 0x10b981, linewidth: 2 });
			for (const conn of roomTopology.connections) {
				if (!conn.traversable) continue;
				if (activeDetectedRoomId && conn.fromRoomId !== activeDetectedRoomId && conn.toRoomId !== activeDetectedRoomId) continue;
				const drFrom = detectedRooms?.find((r) => r.id === conn.fromRoomId);
				const drTo = detectedRooms?.find((r) => r.id === conn.toRoomId);
				if (!drFrom || !drTo) continue;

				const pFrom = new Vector3(drFrom.centroid.x, drFrom.centroid.y, drFrom.centroid.z);
				const pTo = new Vector3(drTo.centroid.x, drTo.centroid.y, drTo.centroid.z);
				const geo = new BufferGeometry().setFromPoints([pFrom, pTo]);
				const line = new LineSegments(geo, lineMat);
				const group = createRoomOverlayGroup(conn.fromRoomId, 'analysis_flow');
				group.add(line);
				overlayRoot.add(group);
				overlayObjects.push(group);
			}
		}
	}

	function createRoomOverlayGroup(id: string, kind: string) {
		const group = new Group();
		group.userData.roomCandidateId = id;
		group.userData.roomOverlayKind = kind;
		return group;
	}

	function roomSurfaceMaterial(color: Color, opacity: number) {
		return new MeshStandardMaterial({ color, transparent: true, opacity, side: DoubleSide, depthWrite: false, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
	}

	function triangulatedPositions(tris: number[][], shape: Vector2[], elevation: number) {
		const positions: number[] = [];
		for (const [ia, ib, ic] of tris) {
			const a = shape[ia], b = shape[ib], c = shape[ic];
			positions.push(a.x, elevation, a.y, b.x, elevation, b.y, c.x, elevation, c.y);
		}
		return positions;
	}

	function roomBoundaryPositions(polygon: RoomCandidate['planPolygon'], elevation: number) {
		const positions: number[] = [];
		for (let index = 0; index < polygon.length; index += 1) {
			const a = polygon[index], b = polygon[(index + 1) % polygon.length];
			positions.push(a.x, elevation + 0.01, a.z, b.x, elevation + 0.01, b.z);
		}
		return positions;
	}

	function roomPrismSidePositions(polygon: RoomCandidate['planPolygon'], lowerElevation: number, upperElevation: number) {
		const positions: number[] = [];
		for (let index = 0; index < polygon.length; index += 1) {
			const a = polygon[index], b = polygon[(index + 1) % polygon.length];
			positions.push(
				a.x, lowerElevation, a.z, b.x, lowerElevation, b.z, b.x, upperElevation, b.z,
				a.x, lowerElevation, a.z, b.x, upperElevation, b.z, a.x, upperElevation, a.z
			);
		}
		return positions;
	}

	function makeRoomLabel(line1: string, line2: string, color: string, position: Vector3, span: number, selected = false) {
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 176;
		const ctx = canvas.getContext('2d')!;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = selected ? 'rgba(16, 30, 40, 0.96)' : 'rgba(10, 15, 20, 0.80)';
		roundRect(ctx, 16, 20, 480, 140, 16);
		ctx.fill();
		ctx.strokeStyle = color;
		ctx.lineWidth = selected ? 7 : 4;
		roundRect(ctx, 16, 20, 480, 140, 16);
		ctx.stroke();
		ctx.fillStyle = '#e2e8f0';
		ctx.font = '600 34px Inter, Arial, sans-serif';
		ctx.fillText(line1.slice(0, 28), 36, 76);
		ctx.fillStyle = color;
		ctx.font = '400 28px Inter, Arial, sans-serif';
		ctx.fillText(line2, 36, 128);
		const texture = new CanvasTexture(canvas);
		const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
		const scale = Math.max(span * 0.14, 1.5);
		sprite.scale.set(scale * 2.8, scale * 0.95, 1);
		sprite.position.copy(position);
		sprite.renderOrder = 100;
		return sprite;
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
		renderer?.domElement.removeEventListener('click', onCanvasClick);
		clearModel();
		patternTextures.forEach((texture) => texture.dispose());
		patternTextures.clear();
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
		visibleComponentIds;
		selectedComponentId;
		hoveredComponentId;
		viewMode;
		hoveredRoomId;
		selectedRoomId;
		annotationUnit;
		roomCandidates;
		selectedRoomCandidateId;
		selectedDetectedRoomId;
		roomOverlayVisibility;
		selectedRoomCandidateTrace;
		showSelectedRoomEvidence;
		roomTopology;
		roomSemantics;
		buildingAnalysis;
		if (mounted) {
			refreshSurfaceMaterials();
			buildRoomInteractionOverlay();
			rebuildAnnotationHighlight();
			buildOverlays();
			buildRoomDebugOverlays();
			buildTopologyOverlays();
			buildSelectedEvidenceOverlays();
			buildAnalysisOverlays();
		}
	});

	$effect(() => {
		roomFocusRequest;
		selectedRoomCandidateId;
		selectedDetectedRoomId;
		roomCandidates;
		if (!mounted || roomFocusRequest === appliedRoomFocusRequest) return;
		appliedRoomFocusRequest = roomFocusRequest;
		let candidate = roomCandidates.find((item) => item.id === selectedRoomCandidateId);
		if (!candidate && selectedDetectedRoomId && detectedRooms) {
			const dr = detectedRooms.find((r) => r.id === selectedDetectedRoomId);
			if (dr) candidate = roomCandidates.find((c) => c.loopCandidateId === dr.evidence.sourceLoopId);
		}
		if (candidate) focusRoomCandidate(candidate);
	});

	$effect(() => {
		qaMode;
		qaCamera;
		if (mounted) {
			if (ground) ground.visible = !qaMode;
			if (qaMode && qaCamera) applyQaCamera();
		}
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
