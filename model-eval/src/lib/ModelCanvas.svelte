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
	import { buildRuntimeGeometryGroups, runtimePartOverrides } from './render/build-runtime-scene';
	import type { QACameraSpec } from './render/qa-camera';
	import { buildClassificationUnitHighlight } from './annotation/highlight';
	import type { ClassificationUnitRecord } from './annotation';
	import type { RoomCandidate } from './rooms/types';
	import { getRoomCandidateBounds, resolveRoomCandidateId } from './rooms/debug-selection';


	let {
		model = null,
		activeAnalysis = 'lighting',
		result = null,
		spaces = [],
		visiblePartKeys = [],
		qaMode = false,
		qaCamera = null,
		onQaReady = undefined,
		annotationUnit = null,
		roomCandidates = [],
		selectedRoomCandidateId = null,
		onRoomCandidateSelect = undefined,
		roomFocusRequest = 0
	}: {
		model: ParsedBuildingModel | null;
		activeAnalysis: AnalysisKind;
		result: AnalysisResult | null;
		spaces: SpaceZone[];
		visiblePartKeys: PartKey[];
		qaMode?: boolean;
		qaCamera?: QACameraSpec | null;
		annotationUnit?: Pick<ClassificationUnitRecord, 'sourceNodeIds' | 'sourcePrimitiveIds'> | null;
		roomCandidates?: RoomCandidate[];
		selectedRoomCandidateId?: string | null;
		onRoomCandidateSelect?: (id: string) => void;
		roomFocusRequest?: number;
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
		baseColor?: string;
		textureName?: string;
		mesh: Mesh;
		edges: Object3D;
		edgeGeometry?: BufferGeometry;
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
		if (!renderer || !camera || roomCandidates.length === 0) return;

		const rect = renderer.domElement.getBoundingClientRect();
		pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
		roomRaycaster.setFromCamera(pointer, camera);
		const hit = roomRaycaster.intersectObjects(overlayObjects, true)[0];
		const candidateId = resolveRoomCandidateId(hit?.object);
		if (candidateId) onRoomCandidateSelect?.(candidateId);
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
		runtimes.forEach((runtime) => {
			root.remove(runtime.mesh);
			root.remove(runtime.edges);
			runtime.mesh.geometry.dispose();
			runtime.edgeGeometry?.dispose();
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
		overlayObjects = [];
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

		grouped.forEach(({ key, baseColor, textureName, movesWithWallTop, stretchesWithWall, faces }) => {
			const geometry = geometryFromFaces(faces);
			const material = makeSurfaceMaterial(key, baseColor, textureName);
			const mesh = new Mesh(geometry, material);
			mesh.name = key;
			mesh.frustumCulled = true;
			const edgeGeometry = new EdgesGeometry(geometry, key === 'roof' ? 34 : 42);
			const edgeMaterial = new LineBasicMaterial({
				color: '#27333a',
				transparent: true,
				opacity: defaultEdgeVisible(key) ? 0.2 : 0.08
			});
			const edges = new LineSegments(edgeGeometry, edgeMaterial);
			edges.frustumCulled = true;
			edges.visible = defaultEdgeVisible(key);
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
		const groups = buildRuntimeGeometryGroups(sourceModel.runtimeScene, runtimePartOverrides(sourceModel.faces));
		groups.forEach((group) => {
			const material = makeSurfaceMaterial(group.key, group.baseColor, group.textureName);
			const mesh = new InstancedMesh(group.geometry, material, group.matrices.length);
			group.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingBox();
			mesh.computeBoundingSphere();
			mesh.name = `${group.key}:bome2:${group.sourceMeshIndex}`;
			mesh.frustumCulled = true;

			const edges = new Group();
			edges.name = `${mesh.name}:edges-omitted-for-instancing`;
			const edgeMaterial = new LineBasicMaterial({
				color: '#27333a',
				transparent: true,
				opacity: 0
			});
			root.add(mesh);
			root.add(edges);

			const relatedFaces = sourceModel.faces.filter((face) => face.partKey === group.key);
			const stretchesWithWall = relatedFaces.some((face) => faceStretchesWithWall(face, wallGuide));
			const movesWithWallTop = !stretchesWithWall && relatedFaces.some((face) => faceMovesWithWallTop(face, wallGuide));
			runtimes.push({
				key: group.key,
				baseColor: group.baseColor,
				textureName: group.textureName,
				mesh,
				edges,
				material,
				edgeMaterial,
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
		const visible = new Set(visiblePartKeys.length ? visiblePartKeys : model?.partStats.map((part) => part.key));
		runtimes.forEach((runtime) => {
			const visual = partVisual(runtime.key, runtime.baseColor);
			const isVisible = visible.has(runtime.key);
			runtime.mesh.visible = isVisible;
			runtime.edges.visible = isVisible && (Boolean(result) || defaultEdgeVisible(runtime.key));
			runtime.material.color.set(!result && runtime.textureName ? '#ffffff' : visual.color);
			runtime.material.map = result ? null : proceduralTexture(runtime.textureName, runtime.key);
			const opacity = annotationUnit ? Math.min(visual.opacity, 0.12) : visual.opacity;
			runtime.material.opacity = opacity;
			runtime.material.transparent = opacity < 1;
			runtime.material.depthWrite = opacity > 0.35;
			runtime.material.needsUpdate = true;
			runtime.edgeMaterial.opacity = result ? 0.28 : defaultEdgeVisible(runtime.key) ? 0.2 : 0.08;
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

	// Status colour palette for room candidates
	const ROOM_STATUS_COLOR: Record<string, string> = {
		primary: '#22d3ee',
		secondary: '#a78bfa',
		ambiguous: '#f59e0b'
	};

	function buildRoomDebugOverlays() {
		// Remove previous room overlays (tracked in a separate array so they don't
		// conflict with the analysis-result overlays).
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

			const hex = ROOM_STATUS_COLOR[candidate.status] ?? '#22d3ee';
			const color = new Color(hex);
			const selected = candidate.id === selectedRoomCandidateId;
			const candidateGroup = new Group();
			candidateGroup.userData.roomCandidateId = candidate.id;

			// ------------------------------------------------------------------
			// Floor cap (at lowerElevation)
			// ------------------------------------------------------------------
			const shape2D = polygon.map((p) => new Vector2(p.x, p.z));
			let tris: number[][];
			try {
				tris = ShapeUtils.triangulateShape(shape2D, []);
			} catch {
				continue;
			}

			const floorY = candidate.lowerElevation;
			const ceilY = candidate.upperElevation;

			// Build floor face geometry
			const floorGeo = new BufferGeometry();
			const positions: number[] = [];
			for (const tri of tris) {
				const [ia, ib, ic] = tri;
				const pa = shape2D[ia], pb = shape2D[ib], pc = shape2D[ic];
				positions.push(pa.x, floorY, pa.y, pb.x, floorY, pb.y, pc.x, floorY, pc.y);
			}
			floorGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
			floorGeo.computeVertexNormals();

			const floorMat = new MeshStandardMaterial({
				color,
				transparent: true,
				opacity: selected ? 0.42 : 0.18,
				side: DoubleSide,
				depthWrite: false,
				roughness: 0.8,
				metalness: 0
			});
			const floorMesh = new Mesh(floorGeo, floorMat);
			floorMesh.userData.roomCandidateId = candidate.id;
			floorMesh.renderOrder = 10;
			candidateGroup.add(floorMesh);

			// ------------------------------------------------------------------
			// Ceiling cap (at upperElevation)
			// ------------------------------------------------------------------
			const ceilGeo = new BufferGeometry();
			const ceilPositions: number[] = [];
			for (const tri of tris) {
				const [ia, ib, ic] = tri;
				const pa = shape2D[ia], pb = shape2D[ib], pc = shape2D[ic];
				ceilPositions.push(pa.x, ceilY, pa.y, pb.x, ceilY, pb.y, pc.x, ceilY, pc.y);
			}
			ceilGeo.setAttribute('position', new Float32BufferAttribute(ceilPositions, 3));
			ceilGeo.computeVertexNormals();

			const ceilMat = new MeshStandardMaterial({
				color,
				transparent: true,
				opacity: selected ? 0.26 : 0.10,
				side: DoubleSide,
				depthWrite: false,
				roughness: 0.8,
				metalness: 0
			});
			const ceilMesh = new Mesh(ceilGeo, ceilMat);
			ceilMesh.userData.roomCandidateId = candidate.id;
			ceilMesh.renderOrder = 10;
			candidateGroup.add(ceilMesh);

			// ------------------------------------------------------------------
			// Perimeter wireframe at floor level
			// ------------------------------------------------------------------
			const edgePositions: number[] = [];
			for (let i = 0; i < polygon.length; i++) {
				const a = polygon[i];
				const b = polygon[(i + 1) % polygon.length];
				edgePositions.push(
					a.x, floorY + 0.01, a.z,
					b.x, floorY + 0.01, b.z
				);
			}
			const edgeGeo = new BufferGeometry();
			edgeGeo.setAttribute('position', new Float32BufferAttribute(edgePositions, 3));
			const edgeMat = new LineBasicMaterial({ color: selected ? color.clone().lerp(new Color('#ffffff'), 0.36) : color, linewidth: 1 });
			const wire = new LineSegments(edgeGeo, edgeMat);
			wire.userData.roomCandidateId = candidate.id;
			wire.renderOrder = 11;
			candidateGroup.add(wire);

			// ------------------------------------------------------------------
			// Label at centroid, midway between floor and ceiling
			// ------------------------------------------------------------------
			const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
			const cz = polygon.reduce((s, p) => s + p.z, 0) / polygon.length;
			const midY = (floorY + ceilY) / 2;
			const shortId = candidate.id.slice(-8);
			const labelText = `${candidate.status[0].toUpperCase()} ${candidate.planArea.toFixed(1)}m² h${candidate.clearHeight.toFixed(2)}`;
			const labelPos = new Vector3(cx, midY + span * 0.015, cz);
			const lbl = makeRoomLabel(labelText, shortId, hex, labelPos, span, selected);
			lbl.userData.roomCandidateId = candidate.id;
			candidateGroup.add(lbl);
			overlayRoot.add(candidateGroup);
			overlayObjects.push(candidateGroup);
		}
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
		annotationUnit;
		roomCandidates;
		selectedRoomCandidateId;
		if (mounted) {
			refreshSurfaceMaterials();
			rebuildAnnotationHighlight();
			buildOverlays();
			buildRoomDebugOverlays();
		}
	});

	$effect(() => {
		roomFocusRequest;
		selectedRoomCandidateId;
		roomCandidates;
		if (!mounted || roomFocusRequest === appliedRoomFocusRequest) return;
		appliedRoomFocusRequest = roomFocusRequest;
		const candidate = roomCandidates.find((item) => item.id === selectedRoomCandidateId);
		if (candidate) focusRoomCandidate(candidate);
	});


	$effect(() => {
		spaces;
		if (mounted) applyEditTransform();
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
