<script lang="ts">
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import {
		ANALYSIS_META,
		DEFAULT_INPUTS,
		GLASS_PRESETS,
		LAMP_PRESETS,
		PART_META,
		ROOM_FUNCTIONS,
		ROOF_PRESETS,
		SURFACE_META,
		WALL_PRESETS,
		format,
		getReadiness,
		getTotalArea,
		getTotalVolume,
		parseBomModelJson,
		readBomModelData,
		runAnalysis,
		type AnalysisKind,
		type AnalysisResult,
		type BomModelJson,
		type FaceRecord,
		type PartKey,
		type ParsedBuildingModel,
		type ProjectInputs,
		type ReadinessItem,
		type RoomFunctionKey,
		type SurfaceKey,
		type SpaceZone,
		type TouchedInputs,
		type WindDirection
	} from '$lib/model';
	import {
		sketchUpCaptureToThreeCamera,
		type QACameraSpec,
		type SketchUpCameraCapture
	} from '$lib/render/qa-camera';
	import {
		buildAnnotationReviewQueue,
		createClassificationUnitIndex,
		createGroundTruthDocument,
		validateGroundTruthDocument,
		type AnnotationUnitFilters,
		type AnnotationUnitSort,
		type AnnotationConfidence,
		type AnnotationStatus,
		type ClassificationUnitIndex,
		type ClassificationUnitRecord,
		type SourceLabelReliability,
		type SurfaceRole,
		type Tier1AnnotationRecord
	} from '$lib/annotation';
	import { createGeometryFoundation } from '$lib/geometry';
	import type { RoomCandidate } from '$lib/rooms/types';
	import { runRoomDebugPipeline } from '$lib/rooms/room-debug-pipeline';
	import { serializeRoomCandidateTrace, type RoomCandidateTrace } from '$lib/rooms/room-provenance';
	import { getVisibleRoomCandidates, resolveRoomCandidateSelection, type RoomDebugVisibility } from '$lib/rooms/debug-selection';
	import { compatibilityMessage, type PersistedAnalysisCompatibilityReason } from '$lib/rooms/room-analysis-schema';


	type NumberInputKey = 'peopleCount' | 'operationHours' | 'setPointC' | 'orientationDeg' | 'glassRatio' | 'roomHeightM';
	type ModelCanvasProps = {
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
		roomOverlayVisibility?: RoomDebugVisibility;
		selectedRoomCandidateTrace?: RoomCandidateTrace | null;
		showSelectedRoomEvidence?: boolean;
		onQaReady?: (payload: {
			viewName: string;
			width: number;
			height: number;
			runtimeGroups: number;
			visibleRuntimeGroups: number;
			visibleRuntimeInstances: number;
			renderedBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
		}) => void;
	};


	const SAMPLE_URL = `${import.meta.env.BASE_URL}Model_SBMBOOST_bom_visual_nonPretty-print.json`;
	const TEMPLATE_KEY = 'model-eval-analysis-template-v1';
	const MAX_MODEL_FILE_BYTES = 80 * 1024 * 1024;
	const MAX_DECOMPRESSED_MODEL_BYTES = 120 * 1024 * 1024;
	const MAX_TEMPLATE_BYTES = 512 * 1024;
	const QA_VIEWS = ['isometric', 'front', 'back', 'left', 'right', 'top'] as const;
	const analysisOptions = Object.entries(ANALYSIS_META) as Array<[AnalysisKind, (typeof ANALYSIS_META)[AnalysisKind]]>;
	const roomOptions = Object.entries(ROOM_FUNCTIONS) as Array<[RoomFunctionKey, (typeof ROOM_FUNCTIONS)[RoomFunctionKey]]>;
	const wallOptions = Object.entries(WALL_PRESETS) as Array<[ProjectInputs['wallMaterial'], (typeof WALL_PRESETS)[ProjectInputs['wallMaterial']]]>;
	const glassOptions = Object.entries(GLASS_PRESETS) as Array<[ProjectInputs['glassMaterial'], (typeof GLASS_PRESETS)[ProjectInputs['glassMaterial']]]>;
	const roofOptions = Object.entries(ROOF_PRESETS) as Array<[ProjectInputs['roofMaterial'], (typeof ROOF_PRESETS)[ProjectInputs['roofMaterial']]]>;
	const lampOptions = Object.entries(LAMP_PRESETS) as Array<[ProjectInputs['lampPreset'], (typeof LAMP_PRESETS)[ProjectInputs['lampPreset']]]>;
	const windOptions: WindDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
	const fieldByAnalysis: Record<AnalysisKind, Array<keyof ProjectInputs>> = {
		lighting: ['roomFunction', 'lampPreset', 'roomHeightM'],
		ac: ['roomFunction', 'peopleCount', 'operationHours', 'setPointC', 'roofMaterial'],
		ottv: ['orientationDeg', 'wallMaterial', 'glassMaterial', 'glassRatio'],
		thermal: ['roomFunction', 'wallMaterial', 'roofMaterial', 'roomHeightM'],
		people: ['roomFunction', 'peopleCount'],
		wind: ['dominantWind', 'orientationDeg']
	};
	const whyText: Record<keyof ProjectInputs, string> = {
		roomFunction: 'Menentukan target lux, beban AC, dan kepadatan orang.',
		peopleCount: 'Menentukan panas tubuh dan kapasitas flow.',
		operationHours: 'Membedakan ruang singkat dan ruang operasi lama.',
		setPointC: 'Set point lebih rendah menaikkan beban AC.',
		orientationDeg: 'Fasad timur/barat menerima panas matahari lebih berat.',
		dominantWind: 'Arah angin menentukan potensi ventilasi silang.',
		wallMaterial: 'U-value dan absorptance mempengaruhi panas masuk.',
		glassMaterial: 'SHGC kaca mempengaruhi OTTV.',
		roofMaterial: 'Atap sering jadi sumber panas terbesar.',
		lampPreset: 'Lumen, watt, CU, dan LLF dihitung dari preset.',
		glassRatio: 'Jika jendela tidak eksplisit, OTTV butuh rasio kaca.',
		roomHeightM: 'Volume ruang dihitung dari area dan tinggi.'
	};

	let fileInput: HTMLInputElement;
	let annotationFileInput = $state<HTMLInputElement>();
	let model = $state<ParsedBuildingModel | null>(null);
	let spaces = $state<SpaceZone[]>([]);
	let inputs = $state<ProjectInputs>({ ...DEFAULT_INPUTS });
	let touched = $state<TouchedInputs>({});
	let selectedAnalysis = $state<AnalysisKind>('lighting');
	let visiblePartKeys = $state<PartKey[]>([]);
	let selectedInspectionId = $state('');
	let result = $state<AnalysisResult | null>(null);
	let isLoading = $state(false);
	let loadError = $state('');
	let templateMessage = $state('');
	let parseMessage = $state('Belum ada model');
	let ModelCanvasComponent = $state<Component<ModelCanvasProps> | null>(null);
	let qaMode = $state(false);
	let qaCamera = $state<QACameraSpec | null>(null);
	let qaReady = $state(false);
	let qaMetricsJson = $state('');
	let qaSlug = $state('');
	let qaLoadStartedAt = 0;
	let qaSourceBytes = 0;
	let annotationMode = $state(false);
	let annotationUnits = $state<ClassificationUnitRecord[]>([]);
	let annotationIndex = $state<ClassificationUnitIndex | null>(null);
	let annotationProcessing = $state(false);
	let annotationRun = 0;
	let annotationFilters = $state<AnnotationUnitFilters>({ status: 'all', orientation: 'all', sourcePresence: 'all', confidence: 'all' });
	let annotationSort = $state<AnnotationUnitSort>('unit-id');
	let selectedAnnotationUnitId = $state('');
	let annotationRecords = $state<Map<string, Tier1AnnotationRecord>>(new Map());
	let sourceExportHash = $state('unverified');
	let annotationRole = $state<SurfaceRole>('unknown');
	let annotationStatus = $state<AnnotationStatus>('proposed');
	let annotationConfidence = $state<AnnotationConfidence>('medium');
	let annotationSourceReliability = $state<SourceLabelReliability>('absent');
	let annotationNote = $state('');
	let annotationMessage = $state('');
	let annotationJsonText = $state('');
	let roomDebug = $state(false);
	let roomCandidates = $state<RoomCandidate[]>([]);
	let roomCandidateTraces = $state<RoomCandidateTrace[]>([]);
	let roomDebugDurationMs = $state(0);
	let roomDebugDiagnostics = $state<import('$lib/rooms/types').RoomCandidateDiagnostics | undefined>(undefined);
	let roomDebugDetectedRooms = $state<import('$lib/rooms/detected-room').DetectedRoomResult | undefined>(undefined);
	let roomDebugError = $state('');
	let roomDebugSchemaError = $state<{ reason: PersistedAnalysisCompatibilityReason; message: string } | undefined>(undefined);
	let roomDebugRunning = $state(false);
	let selectedRoomCandidateId = $state<string | null>(null);
	let roomFocusRequest = $state(0);
	let roomOverlayVisibility = $state<RoomDebugVisibility>({ primary: true, secondary: true, plan: true, prism: true, labels: true });
	let showSelectedRoomEvidence = $state(false);
	let roomTraceCopyMessage = $state('');

	let annotationQueue = $derived(buildAnnotationReviewQueue(annotationUnits, annotationRecords, annotationFilters, annotationSort));
	let selectedAnnotationUnit = $derived(annotationQueue.find((unit) => unit.id === selectedAnnotationUnitId) || annotationQueue[0] || null);
	let selectedRoomCandidate = $derived(roomCandidates.find((candidate) => candidate.id === selectedRoomCandidateId) || null);
	let selectedRoomCandidateTrace = $derived(roomCandidateTraces.find((trace) => trace.candidate.id === selectedRoomCandidateId) || null);
	let visibleRoomCandidates = $derived(getVisibleRoomCandidates(roomCandidates, roomOverlayVisibility));
	let readiness = $derived<ReadinessItem[]>(getReadiness(model, inputs, touched));
	let selectedReadiness = $derived<ReadinessItem | undefined>(readiness.find((item) => item.kind === selectedAnalysis));
	let presentParts = $derived(model ? model.partStats.filter((part) => part.count > 0) : []);
	let inspectionFaces = $derived.by<FaceRecord[]>(() => {
		if (!model) return [];
		return [...model.faces]
			.sort((left, right) => {
				const leftUnknown = left.category === 'unknown' ? 0 : 1;
				const rightUnknown = right.category === 'unknown' ? 0 : 1;
				return leftUnknown - rightUnknown || (left.classification?.confidence || 0) - (right.classification?.confidence || 0);
			})
			.slice(0, 250);
	});
	let inspectionFace = $derived(
		inspectionFaces.find((face) => face.id === selectedInspectionId) || inspectionFaces[0] || null
	);
	let grossHorizontalArea = $derived(
		model
			? model.surfaceStats
					.filter((surface) => surface.key === 'floor' || surface.key === 'ceiling')
					.reduce((sum, surface) => sum + surface.areaM2, 0)
			: 0
	);

	$effect(() => {
		const nextSelection = resolveRoomCandidateSelection(visibleRoomCandidates, selectedRoomCandidateId);
		if (nextSelection !== selectedRoomCandidateId) selectedRoomCandidateId = nextSelection;
	});

	onMount(() => {
		const stored = localStorage.getItem(TEMPLATE_KEY);
		if (stored) {
			if (stored.length > MAX_TEMPLATE_BYTES) {
				localStorage.removeItem(TEMPLATE_KEY);
			} else {
				try {
					const parsed = JSON.parse(stored) as { inputs?: Partial<ProjectInputs> };
					const safeInputs = sanitizeInputs(parsed.inputs);
					if (safeInputs) {
						inputs = { ...inputs, ...safeInputs };
						templateMessage = 'Template input ditemukan';
					}
				} catch {
					localStorage.removeItem(TEMPLATE_KEY);
				}
			}
		}
		const params = new URLSearchParams(window.location.search);
		const corpus = params.get('corpus');
		const format = params.get('format') || 'bome2';
		qaMode = params.get('qa') === '1';
		annotationMode = params.get('annotate') === 'tier1';
		roomDebug = params.get('roomDebug') === '1';
		const debugModel = params.get('debugModel');

		qaSlug = corpus || '';
		const view = params.get('view') || 'isometric';
		if (corpus) {
			if (qaMode) void Promise.all([loadQaCamera(corpus, view), loadCorpus(corpus, format)]);
			else void loadCorpus(corpus, format);
		}
		const devModel = params.get('devModel');
		if (devModel) {
			if (!import.meta.env.DEV) {
				loadError = 'Dev model loader is disabled in production.';
			} else if (devModel.includes('..') || devModel.includes('/') || devModel.includes('\\')) {
				loadError = 'Invalid dev model path.';
			} else {
				void loadDevModel(devModel);
			}
		}
		if (roomDebug && debugModel === 'house2') {
			if (!import.meta.env.DEV) {
				roomDebugError = 'House2 debug loader is disabled in production.';
			} else {
				void loadHouse2DebugModel();
			}
		}
	});

	async function ensureModelCanvas() {
		if (ModelCanvasComponent) return;
		ModelCanvasComponent = (await import('$lib/ModelCanvas.svelte')).default;
	}

	function visible(key: keyof ProjectInputs) {
		return fieldByAnalysis[selectedAnalysis].includes(key);
	}

	async function loadSample() {
		isLoading = true;
		loadError = '';
		parseMessage = 'Load sample JSON...';
		try {
			const response = await fetch(SAMPLE_URL);
			if (!response.ok) throw new Error(`Sample tidak bisa dibaca: ${response.status}`);
			const data = (await response.json()) as BomModelJson;
			acceptModel(data, 'Model_SBMBOOST_bom_visual_nonPretty-print.json');
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Gagal load sample';
		} finally {
			isLoading = false;
		}
	}

	async function loadCorpus(slug: string, format: string) {
		isLoading = true;
		qaReady = false;
		qaLoadStartedAt = performance.now();
		loadError = '';
		parseMessage = `Load regression corpus ${slug} (${format})...`;
		try {
			const response = await fetch(`/api/corpus/${encodeURIComponent(slug)}/${encodeURIComponent(format)}`);
			if (!response.ok) throw new Error(`Corpus tidak bisa dibaca: ${response.status}`);
			const bytes = await response.arrayBuffer();
			qaSourceBytes = bytes.byteLength;
			const filename = response.headers.get('x-bom-corpus-file') || `${slug}.${format}.gz`;
			const file = new File([bytes], filename, { type: response.headers.get('content-type') || 'application/octet-stream' });
			const data = await readBomModelData(file, MAX_DECOMPRESSED_MODEL_BYTES);
			acceptModel(data, filename);
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Gagal load regression corpus';
			if (qaMode) {
				(window as Window & { __BOM_QA__?: unknown }).__BOM_QA__ = { status: 'error', error: loadError };
			}
		} finally {
			isLoading = false;
		}
	}

	async function loadDevModel(filename: string) {
		isLoading = true;
		qaReady = false;
		loadError = '';
		parseMessage = `Loading dev model ${filename}...`;
		try {
			const response = await fetch(`/dev-models/${filename}`);
			if (!response.ok) throw new Error(`Dev model tidak ditemukan: ${response.status}`);
			let data = (await response.json()) as any;
			const { isModelEvalJsonV1, parseModelEvalJsonV1 } = await import('$lib/formats/model-eval-json');
			if (isModelEvalJsonV1(data)) {
				data = { __modelEvalRuntime: parseModelEvalJsonV1(data) };
			}
			acceptModel(data, filename);
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Gagal load dev model';
		} finally {
			isLoading = false;
		}
	}

	async function loadHouse2DebugModel() {
		isLoading = true;
		qaReady = false;
		loadError = '';
		roomDebugError = '';
		parseMessage = 'Loading local House2 debug model...';
		try {
			const response = await fetch('/api/debug-model/house2');
			if (!response.ok) throw new Error(`House2 debug model tidak bisa dibaca: ${response.status}`);
			const bytes = await response.arrayBuffer();
			const file = new File([bytes], 'house2_model-eval.json', {
				type: response.headers.get('content-type') || 'application/json'
			});
			const data = await readBomModelData(file, MAX_DECOMPRESSED_MODEL_BYTES);
			acceptModel(data, file.name);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Gagal load House2 debug model';
			loadError = message;
			roomDebugError = message;
		} finally {
			isLoading = false;
		}
	}

	async function loadQaCamera(slug: string, view: string) {
		try {
			const response = await fetch(`/api/corpus/${encodeURIComponent(slug)}/camera/${encodeURIComponent(view)}`);
			if (!response.ok) throw new Error(`Camera metadata tidak bisa dibaca: ${response.status}`);
			const payload = (await response.json()) as { capture: SketchUpCameraCapture; backgroundColor?: string };
			qaCamera = sketchUpCaptureToThreeCamera(payload.capture, payload.backgroundColor);
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Gagal load camera QA';
			(window as Window & { __BOM_QA__?: unknown }).__BOM_QA__ = { status: 'error', error: loadError };
		}
	}

	function switchQaView(event: Event) {
		const view = (event.currentTarget as HTMLSelectElement).value;
		if (!qaSlug || !QA_VIEWS.includes(view as (typeof QA_VIEWS)[number])) return;
		qaReady = false;
		qaMetricsJson = '';
		qaLoadStartedAt = performance.now();
		void loadQaCamera(qaSlug, view);
	}

	function handleQaReady(payload: {
		viewName: string;
		width: number;
		height: number;
		runtimeGroups: number;
		visibleRuntimeGroups: number;
		visibleRuntimeInstances: number;
		renderedBounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
	}) {
		qaReady = true;
		const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
		const metrics = {
			status: 'ready',
			slug: qaSlug,
			view: payload.viewName,
			viewport: { width: payload.width, height: payload.height },
			expectedViewport: qaCamera?.viewport,
			camera: qaCamera,
			sourceBytes: qaSourceBytes,
			faceCount: model?.faceCount || 0,
			runtimeGroups: payload.runtimeGroups,
			visibleRuntimeGroups: payload.visibleRuntimeGroups,
			visibleRuntimeInstances: payload.visibleRuntimeInstances,
			renderedBounds: payload.renderedBounds,
			loadToRenderMs: Number((performance.now() - qaLoadStartedAt).toFixed(2)),
			usedJSHeapBytes: memory?.usedJSHeapSize || null,
			warnings: model?.warnings || []
		};
		qaMetricsJson = JSON.stringify(metrics);
		(window as Window & { __BOM_QA__?: unknown }).__BOM_QA__ = metrics;
	}

	async function handleFileChange(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > MAX_MODEL_FILE_BYTES) {
			loadError = `File terlalu besar. Maksimum ${Math.round(MAX_MODEL_FILE_BYTES / 1024 / 1024)} MB.`;
			if (fileInput) fileInput.value = '';
			return;
		}
		isLoading = true;
		loadError = '';
		parseMessage = `Membaca ${file.name}...`;
		try {
			const data = await readBomModelData(file, MAX_DECOMPRESSED_MODEL_BYTES);
			acceptModel(data, file.name, await sha256File(file));
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'JSON tidak valid';
		} finally {
			isLoading = false;
			if (fileInput) fileInput.value = '';
		}
	}

	function acceptModel(data: BomModelJson, name: string, exportHash = `unverified:${name}`) {
		model = parseBomModelJson(data, name, inputs.roomHeightM);
		sourceExportHash = exportHash;
		selectedInspectionId = [...model.faces].sort((left, right) => {
			const leftUnknown = left.category === 'unknown' ? 0 : 1;
			const rightUnknown = right.category === 'unknown' ? 0 : 1;
			return leftUnknown - rightUnknown || (left.classification?.confidence || 0) - (right.classification?.confidence || 0);
		})[0]?.id || '';
		void ensureModelCanvas();
		spaces = model.spaces.map((space) => ({ ...space }));
		visiblePartKeys = model.partStats.map((part) => part.key);
		const detectedHeight = averageRoomHeight(spaces);
		if (spaces[0]) inputs = { ...inputs, roomFunction: spaces[0].functionKey, roomHeightM: detectedHeight };
		else inputs = { ...inputs, roomHeightM: detectedHeight };
		result = null;
		parseMessage = `${format(model.faceCount)} face terbaca dari ${name}`;
		setupAnnotationMode();
		if (roomDebug && model.runtimeScene) {
			void runRoomDebug(model.runtimeScene);
		}
	}

	async function runRoomDebug(scene: NonNullable<ParsedBuildingModel['runtimeScene']>) {
		roomDebugRunning = true;
		roomDebugError = '';
		roomCandidates = [];
		roomCandidateTraces = [];
		try {
		const res = await runRoomDebugPipeline(scene);
		roomCandidates = res.candidates;
		roomCandidateTraces = res.traces;
		selectedRoomCandidateId = resolveRoomCandidateSelection(res.candidates, selectedRoomCandidateId);
		roomDebugDurationMs = res.durationMs;
		roomDebugDiagnostics = res.diagnostics;
		roomDebugDetectedRooms = res.detectedRooms;
		if (res.error) roomDebugError = res.error;
		} catch (err) {
			roomDebugError = err instanceof Error ? err.message : String(err);
		} finally {
			roomDebugRunning = false;
		}
	}

	function selectRoomCandidate(id: string) {
		if (roomCandidates.some((candidate) => candidate.id === id)) selectedRoomCandidateId = id;
	}

	function focusSelectedRoomCandidate() {
		if (selectedRoomCandidateId) roomFocusRequest += 1;
	}

	function toggleRoomOverlayVisibility(key: keyof RoomDebugVisibility) {
		roomOverlayVisibility = { ...roomOverlayVisibility, [key]: !roomOverlayVisibility[key] };
	}

	async function copySelectedRoomTrace() {
		if (!selectedRoomCandidateTrace) return;
		roomTraceCopyMessage = '';
		try {
			await navigator.clipboard.writeText(serializeRoomCandidateTrace(selectedRoomCandidateTrace));
			roomTraceCopyMessage = 'Trace copied.';
		} catch (error) {
			roomTraceCopyMessage = `Copy failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}


	function setupAnnotationMode() {
		annotationRun += 1;
		annotationIndex?.cancel();
		annotationIndex = null;
		annotationUnits = [];
		annotationRecords = new Map();
		selectedAnnotationUnitId = '';
		if (!annotationMode || !model?.runtimeScene) return;
		annotationIndex = createClassificationUnitIndex(createGeometryFoundation(model.runtimeScene), model.sourceName);
		annotationMessage = `Menyiapkan objek pertama dari ${annotationIndex.progress.totalLogicalObjects} logical object.`;
		void runIncrementalIndexing();
	}

	async function runIncrementalIndexing() {
		const index = annotationIndex;
		const run = annotationRun;
		if (!index || index.complete || index.progress.cancelled) return;

		annotationProcessing = true;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		if (run !== annotationRun || index !== annotationIndex) return;

		const added: ClassificationUnitRecord[] = [];
		const started = performance.now();
		const isInitial = annotationUnits.length === 0;

		while (!index.complete && !index.progress.cancelled) {
			const progress = index.processNext();
			if (progress.addedUnits) {
				added.push(...progress.addedUnits);
			}
			if (performance.now() - started > 30) {
				if (!isInitial || (annotationUnits.length + added.length > 0)) {
					break;
				}
			}
		}

		if (run !== annotationRun || index !== annotationIndex) return;

		if (added.length > 0) {
			annotationUnits.push(...added);
			annotationUnits = annotationUnits;
			if (!selectedAnnotationUnitId && annotationQueue.length > 0) {
				selectedAnnotationUnitId = annotationQueue[0].id;
			}
		}

		const progress = index.progress;
		annotationMessage = `${progress.processedLogicalObjects}/${progress.totalLogicalObjects} logical object, ${progress.unitsDiscovered} unit, ${Math.round(progress.elapsedMs)} ms.`;

		annotationProcessing = false;

		if (!index.complete && !index.progress.cancelled) {
			void runIncrementalIndexing();
		}
	}

	function resumeAnnotationProcessing() {
		if (!annotationIndex) return;
		annotationIndex.resume();
		void runIncrementalIndexing();
	}

	function cancelAnnotationProcessing() {
		annotationRun += 1;
		annotationIndex?.cancel();
		annotationProcessing = false;
		annotationMessage = 'Pemrosesan annotation dihentikan. Objek yang sudah diproses tetap tersimpan di cache.';
	}

	function resetAnnotationFilters() {
		annotationFilters = { status: 'all', orientation: 'all', sourcePresence: 'all', confidence: 'all' };
		annotationSort = 'unit-id';
	}

	function updateAnnotationObjectFilter(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		annotationFilters = { ...annotationFilters, logicalObjectId: value === 'all' ? undefined : value };
	}

	function updateAnnotationSelectFilter(key: 'orientation' | 'status' | 'confidence' | 'sourcePresence', event: Event) {
		annotationFilters = { ...annotationFilters, [key]: (event.currentTarget as HTMLSelectElement).value } as AnnotationUnitFilters;
	}

	function updateAnnotationNumberFilter(key: 'materialId' | 'minimumAreaM2' | 'maximumAreaM2' | 'minimumElevationM' | 'maximumElevationM', event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		annotationFilters = { ...annotationFilters, [key]: value === '' ? undefined : Number(value) };
	}

	function applyAnnotationDraft(role = annotationRole, status = annotationStatus) {
		if (!selectedAnnotationUnit || !model) return;
		const record: Tier1AnnotationRecord = {
			modelId: model.sourceName,
			sourceExportHash,
			classificationUnitId: selectedAnnotationUnit.id,
			logicalObjectId: selectedAnnotationUnit.logicalObjectId,
			surfaceClusterIds: selectedAnnotationUnit.surfaceClusterIds,
			expectedSurfaceRole: role,
			status,
			annotationConfidence,
			evidenceNote: annotationNote.slice(0, 500),
			sourceLabelReliability: annotationSourceReliability,
			screenshotReferences: [],
			annotatedAt: new Date().toISOString(),
			reviewer: 'local-reviewer',
			split: 'train'
		};
		annotationRecords = new Map(annotationRecords).set(record.classificationUnitId, record);
		annotationRole = role;
		annotationStatus = status;
		annotationMessage = `${record.status}: ${record.expectedSurfaceRole}`;
	}

	function selectAnnotationUnit(id: string) {
		selectedAnnotationUnitId = id;
		const record = annotationRecords.get(id);
		if (record) {
			annotationRole = record.expectedSurfaceRole;
			annotationStatus = record.status;
			annotationConfidence = record.annotationConfidence;
			annotationSourceReliability = record.sourceLabelReliability;
			annotationNote = record.evidenceNote;
		} else {
			annotationRole = 'unknown'; annotationStatus = 'proposed'; annotationConfidence = 'medium'; annotationSourceReliability = 'absent'; annotationNote = '';
		}
	}

	function moveAnnotation(delta: number) {
		const index = Math.max(0, annotationQueue.findIndex((unit) => unit.id === selectedAnnotationUnitId));
		const target = annotationQueue[(index + delta + annotationQueue.length) % Math.max(annotationQueue.length, 1)];
		if (target) selectAnnotationUnit(target.id);
	}

	function exportAnnotations() {
		if (!model) return;
		const annotationDocument = createGroundTruthDocument({ modelId: model.sourceName, sourceExportHash, split: 'train', annotations: [...annotationRecords.values()] });
		const blob = new Blob([JSON.stringify(annotationDocument, null, 2)], { type: 'application/json;charset=utf-8' });
		const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = `${model.sourceName}_tier1-ground-truth.json`; anchor.click(); URL.revokeObjectURL(url);
	}

	function generateAnnotationText() {
		if (!model) return;
		const doc = createGroundTruthDocument({ modelId: model.sourceName, sourceExportHash, split: 'train', annotations: [...annotationRecords.values()] });
		annotationJsonText = JSON.stringify(doc, null, 2);
	}

	async function copyAnnotationText() {
		generateAnnotationText();
		if (annotationJsonText) {
			try {
				await navigator.clipboard.writeText(annotationJsonText);
				annotationMessage = 'Copied to clipboard.';
			} catch {
				annotationMessage = 'Failed to copy to clipboard.';
			}
		}
	}

	function importAnnotationText() {
		if (!model || !annotationJsonText) return;
		try {
			const value = JSON.parse(annotationJsonText);
			const validation = validateGroundTruthDocument(value, { sourceExportHash, units: annotationUnits });
			if (!validation.valid) throw new Error(validation.errors.join(' '));
			const annotations = value.annotations as Tier1AnnotationRecord[];
			annotationRecords = new Map(annotations.map((annotation) => [annotation.classificationUnitId, annotation]));
			annotationMessage = `${annotations.length} annotation dimuat dari text.`;
			if (selectedAnnotationUnitId) selectAnnotationUnit(selectedAnnotationUnitId);
		} catch (error) {
			annotationMessage = error instanceof Error ? error.message : 'Annotation JSON tidak valid.';
		}
	}

	async function handleAnnotationFileChange(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file || !model) return;
		try {
			const value = JSON.parse(await file.text());
			const validation = validateGroundTruthDocument(value, { sourceExportHash, units: annotationUnits });
			if (!validation.valid) throw new Error(validation.errors.join(' '));
			const annotations = value.annotations as Tier1AnnotationRecord[];
			annotationRecords = new Map(annotations.map((annotation) => [annotation.classificationUnitId, annotation]));
			annotationMessage = `${annotations.length} annotation dimuat.`;
			if (selectedAnnotationUnitId) selectAnnotationUnit(selectedAnnotationUnitId);
		} catch (error) { annotationMessage = error instanceof Error ? error.message : 'Annotation JSON tidak valid.'; }
		finally { if (annotationFileInput) annotationFileInput.value = ''; }
	}

	async function sha256File(file: File) {
		const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
		return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
	}

	function selectInspection(event: Event) {
		selectedInspectionId = (event.currentTarget as HTMLSelectElement).value;
	}

	function averageRoomHeight(rows: SpaceZone[]) {
		if (!rows.length) return inputs.roomHeightM;
		const value = rows.reduce((sum, space) => sum + space.heightM, 0) / rows.length;
		return Number(value.toFixed(2));
	}

	function selectAnalysis(kind: AnalysisKind) {
		selectedAnalysis = kind;
		result = null;
	}

	function updateSelect<K extends keyof ProjectInputs>(key: K, value: ProjectInputs[K]) {
		inputs = { ...inputs, [key]: value };
		touched = { ...touched, [key]: true };
		result = null;
		if (key === 'roomFunction') {
			spaces = spaces.map((space) => ({ ...space, functionKey: value as RoomFunctionKey }));
		}
	}

	function updateNumber(key: NumberInputKey, event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const raw = Number(input.value);
		const min = input.min === '' ? -Infinity : Number(input.min);
		const max = input.max === '' ? Infinity : Number(input.max);
		const fallback = Number.isFinite(inputs[key]) ? inputs[key] : DEFAULT_INPUTS[key];
		const value = Number.isFinite(raw) ? Math.min(Math.max(raw, min), max) : fallback;
		updateSelect(key, value as ProjectInputs[typeof key]);
		if (key === 'roomHeightM') {
			spaces = spaces.map((space) => ({
				...space,
				heightM: value,
				volumeM3: Number((space.areaM2 * value).toFixed(1))
			}));
		}
	}

	function updateSpaceFunction(id: string, event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value as RoomFunctionKey;
		spaces = spaces.map((space) => (space.id === id ? { ...space, functionKey: value } : space));
		touched = { ...touched, roomFunction: true };
		result = null;
	}

	function updateSpaceArea(id: string, event: Event) {
		const value = Math.max(Number((event.currentTarget as HTMLInputElement).value), 0.1);
		spaces = spaces.map((space) =>
			space.id === id
				? {
						...space,
						areaM2: value,
						volumeM3: Number((value * space.heightM).toFixed(1))
					}
				: space
		);
		result = null;
	}

	function updateSpaceHeight(id: string, event: Event) {
		const value = Math.max(Number((event.currentTarget as HTMLInputElement).value), 0.1);
		spaces = spaces.map((space) =>
			space.id === id
				? {
						...space,
						heightM: value,
						volumeM3: Number((space.areaM2 * value).toFixed(1))
					}
				: space
		);
		inputs = { ...inputs, roomHeightM: averageRoomHeight(spaces) };
		result = null;
	}

	function runSelectedAnalysis() {
		if (!model) return;
		result = runAnalysis(selectedAnalysis, model, inputs, spaces);
	}

	function togglePart(key: PartKey, event: Event) {
		const checked = (event.currentTarget as HTMLInputElement).checked;
		visiblePartKeys = checked ? Array.from(new Set([...visiblePartKeys, key])) : visiblePartKeys.filter((item) => item !== key);
	}

	function showAllParts() {
		visiblePartKeys = presentParts.map((part) => part.key);
	}

	function hideRoof() {
		visiblePartKeys = visiblePartKeys.filter((key) => key !== 'roof');
	}

	function surfacePartKey(key: SurfaceKey): PartKey {
		if (key.startsWith('wall')) return 'walls';
		if (key === 'roof_slope') return 'roof';
		if (key === 'floor') return 'floor';
		if (key === 'ceiling') return 'ceiling';
		if (key === 'door') return 'doors';
		if (key === 'window') return 'windows';
		if (key === 'structure') return 'structure';
		if (key === 'furniture') return 'furniture';
		return 'other';
	}

	function surfaceStatsForPart(key: PartKey) {
		return model?.surfaceStats.filter((stat) => surfacePartKey(stat.key) === key).slice(0, 4) || [];
	}

	function saveTemplate() {
		localStorage.setItem(TEMPLATE_KEY, JSON.stringify({ inputs, spaces }));
		templateMessage = 'Template tersimpan';
	}

	function loadTemplate() {
		const stored = localStorage.getItem(TEMPLATE_KEY);
		if (!stored) {
			templateMessage = 'Belum ada template';
			return;
		}
		if (stored.length > MAX_TEMPLATE_BYTES) {
			localStorage.removeItem(TEMPLATE_KEY);
			templateMessage = 'Template terlalu besar dan dihapus';
			return;
		}
		try {
			const parsed = JSON.parse(stored) as { inputs?: ProjectInputs; spaces?: SpaceZone[] };
			const safeInputs = sanitizeInputs(parsed.inputs);
			if (safeInputs) inputs = { ...inputs, ...safeInputs };
			const safeSpaces = sanitizeTemplateSpaces(parsed.spaces);
			if (safeSpaces.length && spaces.length) {
				const byId = new Map(safeSpaces.map((space) => [space.id, space]));
				spaces = spaces.map((space) => ({ ...space, ...(byId.get(space.id) || {}) }));
			}
			templateMessage = 'Template dimuat';
			result = null;
		} catch {
			templateMessage = 'Template rusak';
		}
	}

	function exportReport() {
		if (!model || !result) return;
		const html = buildReportHtml(model.sourceName, result);
		const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `laporan-analisis-${result.kind}-${Date.now()}.html`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function buildReportHtml(sourceName: string, analysisResult: AnalysisResult) {
		const rows = analysisResult.tables
			.map(
				(table) => `
				<h2>${escapeHtml(table.title)}</h2>
				<table>
					<thead><tr><th>Item</th><th>Nilai</th><th>Unit</th><th>Catatan</th></tr></thead>
					<tbody>
						${table.rows
							.map(
								(row) =>
									`<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.unit || '')}</td><td>${escapeHtml(row.note || '')}</td></tr>`
							)
							.join('')}
					</tbody>
				</table>`
			)
			.join('');
		return `<!doctype html>
<html lang="id">
<head>
	<meta charset="utf-8">
	<title>Laporan Analisis Bangunan</title>
	<style>
		body{font-family:Arial,sans-serif;margin:32px;color:#172126;line-height:1.45}
		h1{font-size:28px;margin:0 0 4px}
		h2{margin-top:24px}
		table{width:100%;border-collapse:collapse;margin-top:8px}
		th,td{border:1px solid #d8e0df;padding:8px;text-align:left}
		th{background:#edf4f2}
		.badge{display:inline-block;background:#e8f1ef;padding:4px 8px;border-radius:4px}
	</style>
</head>
<body>
	<h1>${escapeHtml(analysisResult.title)}</h1>
	<p class="badge">${escapeHtml(sourceName)} | confidence ${Math.round(analysisResult.confidence * 100)}%</p>
	<p>${escapeHtml(analysisResult.summary)}</p>
	<h2>Input</h2>
	<pre>${escapeHtml(JSON.stringify(inputs, null, 2))}</pre>
	<h2>Deteksi JSON</h2>
	<ul>
		<li>Ruang: ${spaces.length}</li>
		<li>Area: ${format(getTotalArea(spaces), 1)} m2</li>
		<li>Volume: ${format(getTotalVolume(spaces), 1)} m3</li>
		<li>Face: ${model?.faceCount ?? 0}</li>
	</ul>
	${rows}
	<h2>Rekomendasi</h2>
	<ul>${analysisResult.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
	<p>Catatan: hasil estimasi awal, bukan pengganti perhitungan profesional final.</p>
</body>
</html>`;
	}

	function escapeHtml(value: string) {
		return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
	}

	function sanitizeInputs(value: Partial<ProjectInputs> | undefined) {
		if (!value || typeof value !== 'object') return null;
		const next: Partial<ProjectInputs> = {};
		if (roomOptions.some(([key]) => key === value.roomFunction)) next.roomFunction = value.roomFunction;
		if (lampOptions.some(([key]) => key === value.lampPreset)) next.lampPreset = value.lampPreset;
		if (wallOptions.some(([key]) => key === value.wallMaterial)) next.wallMaterial = value.wallMaterial;
		if (glassOptions.some(([key]) => key === value.glassMaterial)) next.glassMaterial = value.glassMaterial;
		if (roofOptions.some(([key]) => key === value.roofMaterial)) next.roofMaterial = value.roofMaterial;
		if (windOptions.includes(value.dominantWind as WindDirection)) next.dominantWind = value.dominantWind;
		const ranges: Record<NumberInputKey, [number, number]> = {
			peopleCount: [1, 10000],
			operationHours: [1, 24],
			setPointC: [18, 28],
			orientationDeg: [0, 359],
			glassRatio: [0, 90],
			roomHeightM: [2.2, 6]
		};
		for (const [key, [min, max]] of Object.entries(ranges) as Array<[NumberInputKey, [number, number]]>) {
			const numberValue = Number(value[key]);
			if (Number.isFinite(numberValue)) next[key] = Math.min(Math.max(numberValue, min), max) as never;
		}
		return next;
	}

	function sanitizeTemplateSpaces(value: SpaceZone[] | undefined) {
		if (!Array.isArray(value)) return [];
		return value
			.filter((space) => typeof space.id === 'string' && space.id.length <= 120)
			.slice(0, 500)
			.map((space) => {
				const areaM2 = Math.min(Math.max(Number(space.areaM2) || 0.1, 0.1), 100000);
				const heightM = Math.min(Math.max(Number(space.heightM) || inputs.roomHeightM, 0.1), 100);
				return {
					...space,
					name: String(space.name || 'Ruang').slice(0, 120),
					areaM2,
					heightM,
					volumeM3: Number((areaM2 * heightM).toFixed(1)),
					functionKey: roomOptions.some(([key]) => key === space.functionKey) ? space.functionKey : inputs.roomFunction
				};
			});
	}
</script>

<svelte:head>
	<title>Model Evaluation</title>
</svelte:head>

<main
	class="app-shell"
	class:qa-mode={qaMode}
	data-qa-status={qaReady ? 'ready' : qaMode ? 'loading' : 'interactive'}
	data-qa-metrics={qaMetricsJson || undefined}
	style={qaMode && qaCamera ? `--qa-width:${qaCamera.viewport.width}px;--qa-height:${qaCamera.viewport.height}px` : undefined}
>
	{#if qaMode}
		<select class="qa-view-selector" aria-label="QA matched view" value={qaCamera?.viewName || ''} onchange={switchQaView}>
			{#each QA_VIEWS as view}<option value={view}>{view}</option>{/each}
		</select>
	{/if}
	<aside class="left-panel">
		<section class="panel-block upload-block">
			<div>
				<p class="eyebrow">JSON 3D</p>
				<h1>Analisis Bangunan</h1>
				<p class="muted">{parseMessage}</p>
			</div>
			<div class="button-row">
				<button class="primary-button" type="button" onclick={() => fileInput.click()}>Upload JSON</button>
				<button class="ghost-button" type="button" onclick={loadSample} disabled={isLoading}>Load sample</button>
			</div>
			<input bind:this={fileInput} accept=".json,.json.gz,.bome,.bome.gz,.bome2,.bome2.gz,application/json,application/gzip,application/octet-stream" hidden type="file" onchange={handleFileChange} />
			{#if isLoading}
				<p class="status-line">Parsing model...</p>
			{/if}
			{#if loadError}
				<p class="error-line">{loadError}</p>
			{/if}
		</section>

		{#if annotationMode && model}
			<section class="panel-block annotation-panel" aria-label="Tier-1 annotation mode">
				<div class="section-heading">
					<h2>Tier-1 annotation</h2>
					<span>{annotationRecords.size}/{annotationQueue.length} queue</span>
				</div>
				<p class="muted small">Ground truth manual. Prediksi classifier tidak ditampilkan dan tidak mengisi label.</p>
				{#if annotationIndex}
					<p class="status-line">{annotationIndex.progress.processedLogicalObjects}/{annotationIndex.progress.totalLogicalObjects} object · {annotationIndex.progress.unitsDiscovered} unit · {Math.round(annotationIndex.progress.elapsedMs)} ms</p>
					<div class="button-row">
						<button class="ghost-button" type="button" onclick={resumeAnnotationProcessing} disabled={annotationProcessing || annotationIndex.complete}>Resume</button>
						<button class="ghost-button" type="button" onclick={cancelAnnotationProcessing} disabled={!annotationProcessing}>Stop</button>
					</div>
				{/if}
				<div class="annotation-fields">
					<label class="field"><span>Object</span><select value={annotationFilters.logicalObjectId || 'all'} onchange={updateAnnotationObjectFilter}><option value="all">all processed</option>{#each [...new Set(annotationUnits.map((unit) => unit.logicalObjectId))].sort() as objectId}<option value={objectId}>{objectId}</option>{/each}</select></label>
					<label class="field"><span>Orientation</span><select value={annotationFilters.orientation || 'all'} onchange={(event) => updateAnnotationSelectFilter('orientation', event)}><option value="all">all</option><option value="horizontal">horizontal</option><option value="vertical">vertical</option><option value="sloped">sloped</option><option value="mixed">mixed</option></select></label>
					<label class="field"><span>Status</span><select value={annotationFilters.status || 'all'} onchange={(event) => updateAnnotationSelectFilter('status', event)}><option value="all">all</option><option value="unreviewed">unreviewed</option><option value="proposed">proposed</option><option value="verified">verified</option><option value="ambiguous">ambiguous</option><option value="excluded">excluded</option></select></label>
					<label class="field"><span>Confidence</span><select value={annotationFilters.confidence || 'all'} onchange={(event) => updateAnnotationSelectFilter('confidence', event)}><option value="all">all</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></label>
					<label class="field"><span>Source</span><select value={annotationFilters.sourcePresence || 'all'} onchange={(event) => updateAnnotationSelectFilter('sourcePresence', event)}><option value="all">all</option><option value="present">present</option><option value="absent">absent</option></select></label>
					<label class="field"><span>Material ID</span><input type="number" value={annotationFilters.materialId ?? ''} oninput={(event) => updateAnnotationNumberFilter('materialId', event)} /></label>
					<label class="field"><span>Min area</span><input type="number" min="0" step="0.001" value={annotationFilters.minimumAreaM2 ?? ''} oninput={(event) => updateAnnotationNumberFilter('minimumAreaM2', event)} /></label>
					<label class="field"><span>Max area</span><input type="number" min="0" step="0.001" value={annotationFilters.maximumAreaM2 ?? ''} oninput={(event) => updateAnnotationNumberFilter('maximumAreaM2', event)} /></label>
					<label class="field"><span>Min elevation</span><input type="number" step="0.001" value={annotationFilters.minimumElevationM ?? ''} oninput={(event) => updateAnnotationNumberFilter('minimumElevationM', event)} /></label>
					<label class="field"><span>Max elevation</span><input type="number" step="0.001" value={annotationFilters.maximumElevationM ?? ''} oninput={(event) => updateAnnotationNumberFilter('maximumElevationM', event)} /></label>
					<label class="field"><span>Sort</span><select bind:value={annotationSort}><option value="unit-id">unit ID</option><option value="area-desc">area descending</option><option value="elevation-asc">elevation ascending</option><option value="logical-object">logical object</option><option value="orientation-consistency">orientation consistency</option><option value="source-name">source name</option></select></label>
				</div>
				<div class="button-row"><button class="ghost-button" type="button" onclick={resetAnnotationFilters}>Reset filters</button><span class="muted small">{annotationQueue.length} filtered unit</span></div>
				<div class="annotation-nav">
					<button type="button" onclick={() => moveAnnotation(-1)}>← Prev</button>
					<select aria-label="Classification unit" value={selectedAnnotationUnit?.id || ''} onchange={(event) => selectAnnotationUnit((event.currentTarget as HTMLSelectElement).value)}>
						{#each annotationQueue.slice(0, 500) as unit}<option value={unit.id}>{unit.id} · {format(unit.areaM2, 2)} m²</option>{/each}
					</select>
					<button type="button" onclick={() => moveAnnotation(1)}>Next →</button>
				</div>
				{#if selectedAnnotationUnit}
					<div class="annotation-evidence">
						<code>{selectedAnnotationUnit.id}</code>
						<span>Object: {selectedAnnotationUnit.logicalObjectId}</span>
						<span>Clusters: {selectedAnnotationUnit.surfaceClusterIds.join(', ')}</span>
						<span>{format(selectedAnnotationUnit.areaM2, 2)} m² · {selectedAnnotationUnit.triangleCount} tri</span>
						<span>Vert {Math.round(selectedAnnotationUnit.verticalAreaRatio * 100)}% · Up {Math.round(selectedAnnotationUnit.upwardHorizontalAreaRatio * 100)}% · Down {Math.round(selectedAnnotationUnit.downwardHorizontalAreaRatio * 100)}%</span>
						<span>Elev {selectedAnnotationUnit.relativeMinElevation.toFixed(2)}–{selectedAnnotationUnit.relativeMaxElevation.toFixed(2)} · materials {selectedAnnotationUnit.materialIds.join(', ') || 'none'}</span>
						<span>Source: {selectedAnnotationUnit.sourceNames.join(', ') || 'none'} / {selectedAnnotationUnit.sourceTags.join(', ') || 'untagged'}</span>
					</div>
					<div class="annotation-roles" aria-label="Surface role">
						<button class:active={annotationRole === 'wall'} type="button" onclick={() => { annotationRole = 'wall'; applyAnnotationDraft('wall'); }}>1 Wall</button>
						<button class:active={annotationRole === 'floor'} type="button" onclick={() => { annotationRole = 'floor'; applyAnnotationDraft('floor'); }}>2 Floor</button>
						<button class:active={annotationRole === 'ceiling'} type="button" onclick={() => { annotationRole = 'ceiling'; applyAnnotationDraft('ceiling'); }}>3 Ceiling</button>
						<button class:active={annotationRole === 'roof'} type="button" onclick={() => { annotationRole = 'roof'; applyAnnotationDraft('roof'); }}>4 Roof</button>
						<button class:active={annotationRole === 'unknown'} type="button" onclick={() => { annotationRole = 'unknown'; applyAnnotationDraft('unknown'); }}>5 Unknown</button>
					</div>
					<div class="annotation-fields">
						<label class="field"><span>Status</span><select bind:value={annotationStatus}><option value="proposed">proposed</option><option value="verified">verified</option><option value="ambiguous">ambiguous</option><option value="excluded">excluded</option></select></label>
						<label class="field"><span>Confidence</span><select bind:value={annotationConfidence}><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></label>
						<label class="field"><span>Source label</span><select bind:value={annotationSourceReliability}><option value="correct">correct</option><option value="incorrect">incorrect</option><option value="absent">absent</option><option value="ambiguous">ambiguous</option></select></label>
					</div>
					<label class="field"><span>Evidence note</span><textarea bind:value={annotationNote} maxlength="500" placeholder="Visual / geometry evidence"></textarea></label>
					<div class="button-row">
						<button class="primary-button" type="button" onclick={() => applyAnnotationDraft()}>Save unit</button>
						<button class="ghost-button" type="button" onclick={() => { annotationStatus = 'ambiguous'; applyAnnotationDraft(annotationRole, 'ambiguous'); }}>Ambiguous</button>
						<button class="ghost-button" type="button" onclick={() => { annotationStatus = 'excluded'; applyAnnotationDraft(annotationRole, 'excluded'); }}>Excluded</button>
					</div>
					<div class="button-row">
						<button class="ghost-button" type="button" onclick={exportAnnotations}>Export JSON</button>
						<button class="ghost-button" type="button" onclick={() => annotationFileInput?.click()}>Reload JSON</button>
					</div>
					<div class="field" style="margin-top: 10px;">
						<span>JSON Text</span>
						<textarea bind:value={annotationJsonText} rows="4" style="font-family:monospace; font-size:10px; width:100%; resize:vertical; background: #1e1e1e; color: #d4d4d4; border: 1px solid #3c3c3c; border-radius: 4px; padding: 4px;" placeholder="Annotation JSON text for copy/paste"></textarea>
					</div>
					<div class="button-row" style="margin-top: 5px;">
						<button class="ghost-button" type="button" onclick={generateAnnotationText}>Show JSON</button>
						<button class="ghost-button" type="button" onclick={copyAnnotationText}>Copy JSON</button>
						<button class="ghost-button" type="button" onclick={importAnnotationText}>Import Pasted JSON</button>
					</div>
					<input bind:this={annotationFileInput} accept=".json,application/json" hidden type="file" onchange={handleAnnotationFileChange} />
				{/if}
				{#if annotationMessage}<p class="status-line">{annotationMessage}</p>{/if}
			</section>
		{/if}

		{#if model}
			<section class="panel-block">
				<div class="section-heading">
					<h2>Deteksi</h2>
					<span>{Math.round(model.confidence * 100)}%</span>
				</div>
				<div class="metric-grid">
					<div><strong>{spaces.length}</strong><span>ruang/zona</span></div>
					<div><strong>{format(getTotalArea(spaces), 1)}</strong><span>m2 ruang terdeteksi</span></div>
					<div><strong>{format(grossHorizontalArea, 1)}</strong><span>m2 horizontal gross</span></div>
					<div><strong>{format(getTotalVolume(spaces), 1)}</strong><span>m3 volume</span></div>
					<div><strong>{format(model.faceCount)}</strong><span>face</span></div>
					<div><strong>{model.components.doors}</strong><span>pintu</span></div>
					<div><strong>{model.components.windows}</strong><span>jendela</span></div>
				</div>
				<div class="part-list">
					<div class="part-list-heading">
						<strong>Bagian model</strong>
						<div>
							<button type="button" onclick={showAllParts}>All</button>
							<button type="button" onclick={hideRoof}>Hide atap</button>
						</div>
					</div>
					{#each presentParts as part}
						<div class="part-group">
							<label class="part-row">
								<input checked={visiblePartKeys.includes(part.key)} type="checkbox" onchange={(event) => togglePart(part.key, event)} />
								<span class="swatch" style={`background:${PART_META[part.key].color}`}></span>
								<span>{part.label}</span>
								<strong>{format(part.areaM2, 1)} m2</strong>
							</label>
							{#if surfaceStatsForPart(part.key).length}
								<div class="surface-detail">
									{#each surfaceStatsForPart(part.key) as stat}
										<div class="surface-row">
											<span class="swatch muted-swatch" style={`background:${SURFACE_META[stat.key].color}`}></span>
											<span>{stat.label}</span>
											<strong>{format(stat.areaM2, 1)} m2</strong>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
				{#if model.warnings.length}
					<ul class="warning-list">
						{#each model.warnings as warning}
							<li>{warning}</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="panel-block classifier-inspector">
				<div class="section-heading">
					<h2>Classifier Debug</h2>
					<span>{inspectionFace?.classification?.ruleBankVersion || 'no trace'}</span>
				</div>
				<div class="category-grid">
					{#each model.categoryStats as category}
						<div class:unknown-category={category.key === 'unknown'} class="category-chip">
							<strong>{format(category.count)}</strong>
							<span>{category.label}</span>
						</div>
					{/each}
				</div>
				<label class="field inspector-select">
					<span>Face trace — unknown dan confidence rendah lebih dulu</span>
					<select value={inspectionFace?.id || ''} onchange={selectInspection}>
						{#each inspectionFaces as face}
							<option value={face.id}>
								{face.category || 'unknown'} · {Math.round((face.classification?.confidence || 0) * 100)}% · {face.name || face.id}
							</option>
						{/each}
					</select>
					<small>Maksimum 250 face untuk menjaga DOM tetap ringan.</small>
				</label>
				{#if inspectionFace?.classification}
					{@const trace = inspectionFace.classification}
					<div class="trace-final">
						<div><span>Kategori akhir</span><strong>{trace.category}</strong></div>
						<div><span>Confidence</span><strong>{Math.round(trace.confidence * 100)}%</strong></div>
					</div>
					<p class="trace-explanation">{trace.explanation}</p>
					<div class="trace-block">
						<strong>Seluruh kandidat</strong>
						{#if trace.candidates.length}
							{#each trace.candidates as candidate}
								<div class="candidate-row">
									<span>{candidate.category}</span>
									<code>{candidate.score.toFixed(3)} / {candidate.threshold.toFixed(3)}</code>
								</div>
							{/each}
						{:else}
							<span class="muted small">Tidak ada kandidat.</span>
						{/if}
					</div>
					<details open class="trace-block">
						<summary>Rule aktif ({trace.activatedRules.length})</summary>
						<ul class="trace-list">
							{#each trace.activatedRules as rule}<li><code>{rule}</code></li>{/each}
						</ul>
					</details>
					<details class="trace-block">
						<summary>Evidence mendukung ({trace.supportingEvidence.length})</summary>
						<ul class="trace-list">
							{#each trace.supportingEvidence as evidence}
								<li><code>{evidence.key}</code> — {evidence.detail}</li>
							{/each}
						</ul>
					</details>
					<details class="trace-block">
						<summary>Evidence menolak ({trace.rejectingEvidence.length})</summary>
						<ul class="trace-list">
							{#each trace.rejectingEvidence as evidence}
								<li><code>{evidence.key}</code> — {evidence.detail}</li>
							{/each}
						</ul>
					</details>
					<p class="conflict-box"><strong>Conflict resolution:</strong> {trace.conflictResolution}</p>
					{#if trace.unknownReason}
						<p class="unknown-box"><strong>Unknown:</strong> {trace.unknownReason}</p>
					{/if}
				{/if}
			</section>

			<section class="panel-block">
				<div class="section-heading">
					<h2>Kesiapan</h2>
					<span>{ANALYSIS_META[selectedAnalysis].shortLabel}</span>
				</div>
				<div class="readiness-list">
					{#each readiness as item}
						<button
							class:active={selectedAnalysis === item.kind}
							class={`readiness-row ${item.status}`}
							type="button"
							onclick={() => selectAnalysis(item.kind)}
						>
							<span>{item.label}</span>
							<strong>{item.status === 'ready' ? 'Siap' : item.status === 'estimate' ? 'Estimasi' : 'Belum'}</strong>
						</button>
					{/each}
				</div>
				{#if selectedReadiness}
					<p class="muted small">
						{selectedReadiness.missing.length ? selectedReadiness.missing.join(', ') : 'Data lengkap'}.
						Confidence {Math.round(selectedReadiness.confidence * 100)}%.
					</p>
				{/if}
			</section>
		{/if}
	</aside>

	<section class="stage-panel">
		{#if ModelCanvasComponent}
			<ModelCanvasComponent {model} {spaces} {visiblePartKeys} activeAnalysis={selectedAnalysis} {result} {qaMode} {qaCamera} annotationUnit={annotationMode ? selectedAnnotationUnit : null} roomCandidates={roomDebug ? visibleRoomCandidates : []} {selectedRoomCandidateId} onRoomCandidateSelect={selectRoomCandidate} {roomFocusRequest} {roomOverlayVisibility} {selectedRoomCandidateTrace} {showSelectedRoomEvidence} onQaReady={handleQaReady} />

		{:else}
			<div class="model-stage-placeholder">
				<strong>JSON belum dimuat</strong>
				<span>Upload atau load sample.</span>
			</div>
		{/if}
		<div class="stage-hud">
			<div>
				<span>Mode</span>
				<strong>{ANALYSIS_META[selectedAnalysis].label}</strong>
			</div>
			{#if result}
				<div>
					<span>Hasil</span>
					<strong>{Math.round(result.confidence * 100)}%</strong>
				</div>
			{/if}
		</div>
		{#if roomDebug}
			<div class="room-debug-hud">
				<div class="room-debug-hud__title">
					<span>Room Debug</span>
					{#if isLoading}
						<span class="room-debug-hud__badge room-debug-hud__badge--running">loading…</span>
					{:else if roomDebugRunning}
						<span class="room-debug-hud__badge room-debug-hud__badge--running">running…</span>
					{:else if roomDebugError}
						<span class="room-debug-hud__badge room-debug-hud__badge--error">error</span>
					{:else}
						<span class="room-debug-hud__badge room-debug-hud__badge--ok">{visibleRoomCandidates.length}/{roomCandidates.length} candidates</span>
					{/if}
				</div>
				{#if roomDebugError}
					<p class="room-debug-hud__error">{roomDebugError}</p>
				{/if}
				{#if roomDebugSchemaError}
					<p class="room-debug-hud__schema-error" aria-label="Schema compatibility error">
						⚠️ {roomDebugSchemaError.message}
					</p>
				{/if}
				<div class="room-debug-hud__controls" aria-label="Room debug visibility">
					<button class:room-debug-hud__control--active={roomOverlayVisibility.primary} class="room-debug-hud__control" type="button" aria-pressed={roomOverlayVisibility.primary} onclick={() => toggleRoomOverlayVisibility('primary')}>Show primary</button>
					<button class:room-debug-hud__control--active={roomOverlayVisibility.secondary} class="room-debug-hud__control" type="button" aria-pressed={roomOverlayVisibility.secondary} onclick={() => toggleRoomOverlayVisibility('secondary')}>Show secondary</button>
					<button class:room-debug-hud__control--active={roomOverlayVisibility.plan} class="room-debug-hud__control" type="button" aria-pressed={roomOverlayVisibility.plan} onclick={() => toggleRoomOverlayVisibility('plan')}>Show plan polygons</button>
					<button class:room-debug-hud__control--active={roomOverlayVisibility.prism} class="room-debug-hud__control" type="button" aria-pressed={roomOverlayVisibility.prism} onclick={() => toggleRoomOverlayVisibility('prism')}>Show vertical prisms</button>
					<button class:room-debug-hud__control--active={roomOverlayVisibility.labels} class="room-debug-hud__control" type="button" aria-pressed={roomOverlayVisibility.labels} onclick={() => toggleRoomOverlayVisibility('labels')}>Show labels</button>
				</div>
				<button class="room-debug-hud__focus" type="button" onclick={focusSelectedRoomCandidate} disabled={!selectedRoomCandidateId}>Focus selected</button>
				<button class:room-debug-hud__control--active={showSelectedRoomEvidence} class="room-debug-hud__control room-debug-hud__evidence-toggle" type="button" aria-pressed={showSelectedRoomEvidence} disabled={!selectedRoomCandidateTrace} onclick={() => showSelectedRoomEvidence = !showSelectedRoomEvidence}>Show selected evidence</button>
				{#if visibleRoomCandidates.length > 0}
					<div class="room-debug-hud__timing">{roomDebugDurationMs.toFixed(0)} ms</div>
					{#if roomDebugDiagnostics?.hasQuarantinedEnvelopeInputs}
						<div class="room-debug-hud__warning">
							{roomDebugDiagnostics.envelopeValidation.quarantined} malformed envelope candidates were excluded:
							<ul style="margin: 2px 0 0; padding-left: 16px;">
								{#each Object.entries(roomDebugDiagnostics.envelopeValidation.reasons) as [reason, count]}
									<li>{reason.replace(/_/g, ' ')}: {count}</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if roomDebugDetectedRooms}
						<div class="room-debug-hud__detected-rooms" aria-label="Detected rooms summary">
							<div class="room-debug-hud__detected-rooms-header">
								Detected Rooms:
								<span class="room-debug-hud__detected-badge room-debug-hud__detected-badge--valid">{roomDebugDetectedRooms.diagnostics.roomsAccepted} valid</span>
								{#if roomDebugDetectedRooms.diagnostics.roomsAmbiguous > 0}
									<span class="room-debug-hud__detected-badge room-debug-hud__detected-badge--ambiguous">{roomDebugDetectedRooms.diagnostics.roomsAmbiguous} ambiguous</span>
								{/if}
								{#if roomDebugDetectedRooms.diagnostics.roomsRejected > 0}
									<span class="room-debug-hud__detected-badge room-debug-hud__detected-badge--rejected">{roomDebugDetectedRooms.diagnostics.roomsRejected} rejected</span>
								{/if}
							</div>
							<ul class="room-debug-hud__detected-list">
								{#each roomDebugDetectedRooms.rooms.slice(0, 8) as dr (dr.id)}
									<li class="room-debug-hud__detected-item room-debug-hud__detected-item--{dr.status}">
										<span class="room-debug-hud__detected-status">{dr.status[0].toUpperCase()}</span>
										<span class="room-debug-hud__detected-area">{dr.floorArea.toFixed(1)} m²</span>
										<span class="room-debug-hud__detected-height">{dr.height.toFixed(2)} m</span>
										<span class="room-debug-hud__detected-confidence" title="Confidence: {dr.confidence.level}">{dr.confidence.level[0].toUpperCase()}</span>
										<span class="room-debug-hud__detected-id" title={dr.id}>{dr.id.slice(-10)}</span>
									</li>
								{/each}
							</ul>
							{#if roomDebugDetectedRooms.diagnostics.openingBridgesApplied > 0}
								<div class="room-debug-hud__detected-note">⬡ {roomDebugDetectedRooms.diagnostics.openingBridgesApplied} opening bridge(s) applied</div>
							{/if}
						</div>
					{/if}
					<ul class="room-debug-hud__list">
						{#each visibleRoomCandidates.slice(0, 12) as c (c.id)}
							<li>
								<button class="room-debug-hud__item room-debug-hud__item--{c.status}" class:room-debug-hud__item--selected={c.id === selectedRoomCandidateId} type="button" aria-pressed={c.id === selectedRoomCandidateId} onclick={() => selectRoomCandidate(c.id)}>
									<span class="room-debug-hud__status">{c.status[0].toUpperCase()}</span>
									<span class="room-debug-hud__area">{c.planArea.toFixed(1)} m²</span>
									<span class="room-debug-hud__elev">{c.lowerElevation.toFixed(2)}–{c.upperElevation.toFixed(2)} m</span>
									<span class="room-debug-hud__id">{c.id.slice(-8)}</span>
								</button>
							</li>
						{/each}
						{#if visibleRoomCandidates.length > 12}
							<li class="room-debug-hud__more">+{visibleRoomCandidates.length - 12} more</li>
						{/if}
					</ul>
					{#if selectedRoomCandidate}
						<div class="room-debug-hud__details">
							<strong>Selected candidate</strong>
							<dl>
								<dt>ID</dt><dd>{selectedRoomCandidate.id}</dd>
								<dt>Status</dt><dd>{selectedRoomCandidate.status}</dd>
								<dt>Area</dt><dd>{selectedRoomCandidate.planArea.toFixed(6)} m²</dd>
								<dt>Elevations</dt><dd>{selectedRoomCandidate.lowerElevation.toFixed(6)}–{selectedRoomCandidate.upperElevation.toFixed(6)} m</dd>
								<dt>Clear height</dt><dd>{selectedRoomCandidate.clearHeight.toFixed(6)} m</dd>
								<dt>Volume</dt><dd>{selectedRoomCandidate.estimatedVolume.toFixed(6)} m³</dd>
								<dt>Envelope</dt><dd>{selectedRoomCandidate.selectedEnvelopeId}</dd>
								<dt>Alternatives</dt><dd>{selectedRoomCandidate.alternativeEnvelopeIds.length}</dd>
								<dt>Quality</dt><dd>{Object.entries(selectedRoomCandidate.qualityFlags).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none'}</dd>
							</dl>
							{#if selectedRoomCandidateTrace}
								<details class="room-debug-hud__evidence">
									<summary>Evidence</summary>
									<dl>
										<dt>Loop</dt><dd>{selectedRoomCandidateTrace.loop.id} · {selectedRoomCandidateTrace.loop.status} · {selectedRoomCandidateTrace.loop.score.toFixed(2)}</dd>
										<dt>Boundary</dt><dd>{selectedRoomCandidateTrace.loop.edgeIds.join(', ') || 'none'}</dd>
										<dt>Envelope</dt><dd>{selectedRoomCandidateTrace.selectedEnvelope?.id || 'missing'} · {selectedRoomCandidateTrace.selectedEnvelope?.score.toFixed(2) || 'n/a'}</dd>
										<dt>Lower</dt><dd>{selectedRoomCandidateTrace.lowerAssignment ? `${selectedRoomCandidateTrace.lowerAssignment.id} · ${selectedRoomCandidateTrace.lowerAssignment.elevation.toFixed(6)} m · ${selectedRoomCandidateTrace.lowerAssignment.loopCoverageRatio.toFixed(3)}/${selectedRoomCandidateTrace.lowerAssignment.evidenceCoverageRatio.toFixed(3)}` : 'missing'}</dd>
										<dt>Upper</dt><dd>{selectedRoomCandidateTrace.upperAssignment ? `${selectedRoomCandidateTrace.upperAssignment.id} · ${selectedRoomCandidateTrace.upperAssignment.elevation.toFixed(6)} m · ${selectedRoomCandidateTrace.upperAssignment.loopCoverageRatio.toFixed(3)}/${selectedRoomCandidateTrace.upperAssignment.evidenceCoverageRatio.toFixed(3)}` : 'missing'}</dd>
										<dt>Alternatives</dt><dd>{selectedRoomCandidateTrace.alternativeEnvelopes.map((item) => `${item.id} (${item.score.toFixed(2)})`).join(', ') || 'none'}</dd>
										<dt>Flags</dt><dd>{Object.entries(selectedRoomCandidateTrace.selectedEnvelope?.qualityFlags || {}).filter(([, value]) => value).map(([key]) => key).join(', ') || 'none'}</dd>
										{#if selectedRoomCandidateTrace.verticalExtentProfile}
											<dt>Vertical Profile</dt>
											<dd>
												Span: {selectedRoomCandidateTrace.verticalExtentProfile.robustSpan.toFixed(3)} m 
												[{selectedRoomCandidateTrace.verticalExtentProfile.robustBase.toFixed(3)} to {selectedRoomCandidateTrace.verticalExtentProfile.robustTop.toFixed(3)} m]
											</dd>
											<dt>Refinement Score</dt>
											<dd>
												Raw: {selectedRoomCandidateTrace.rawEnvelopeScore?.toFixed(2) ?? 'n/a'} 
												({selectedRoomCandidateTrace.rawEnvelopeStatus ?? 'n/a'}) · 
												Refined: {selectedRoomCandidateTrace.refinedEnvelopeScore?.toFixed(2) ?? 'n/a'} 
												({selectedRoomCandidateTrace.refinedEnvelopeStatus ?? 'n/a'}, rank {selectedRoomCandidateTrace.refinedEnvelopeRank ?? 'n/a'})
											</dd>
											<dt>Refinement Alignment</dt>
											<dd>
												Base: {selectedRoomCandidateTrace.baseAlignment?.toFixed(3) ?? 'n/a'} m · 
												Top: {selectedRoomCandidateTrace.topAlignment?.toFixed(3) ?? 'n/a'} m · 
												Span Coverage: {selectedRoomCandidateTrace.barrierSpanCoverage?.toFixed(3) ?? 'n/a'}
											</dd>
											<dt>Refinement Reasons</dt>
											<dd>{selectedRoomCandidateTrace.refinementReasons?.join(', ') || 'none'}</dd>
										{/if}
									</dl>
									<button class="room-debug-hud__copy" type="button" onclick={copySelectedRoomTrace}>Copy trace JSON</button>
									{#if roomTraceCopyMessage}<p class="room-debug-hud__copy-message">{roomTraceCopyMessage}</p>{/if}
								</details>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</section>


	<aside class="right-panel">
		<section class="panel-block">
			<div class="section-heading">
				<h2>Input Bertahap</h2>
				<span>{ANALYSIS_META[selectedAnalysis].shortLabel}</span>
			</div>

			{#if visible('roomFunction')}
				<label class="field">
					<span>Fungsi ruang</span>
					<select value={inputs.roomFunction} onchange={(event) => updateSelect('roomFunction', (event.currentTarget as HTMLSelectElement).value as RoomFunctionKey)}>
						{#each roomOptions as [key, option]}
							<option value={key}>{option.label}</option>
						{/each}
					</select>
					<small>{whyText.roomFunction}</small>
				</label>
			{/if}

			{#if visible('lampPreset')}
				<label class="field">
					<span>Preset lampu</span>
					<select value={inputs.lampPreset} onchange={(event) => updateSelect('lampPreset', (event.currentTarget as HTMLSelectElement).value as ProjectInputs['lampPreset'])}>
						{#each lampOptions as [key, option]}
							<option value={key}>{option.label}</option>
						{/each}
					</select>
					<small>{whyText.lampPreset}</small>
				</label>
			{/if}

			{#if visible('peopleCount')}
				<label class="field">
					<span>Jumlah orang</span>
					<input min="1" type="number" value={inputs.peopleCount} oninput={(event) => updateNumber('peopleCount', event)} />
					<small>{whyText.peopleCount}</small>
				</label>
			{/if}

			{#if visible('operationHours')}
				<label class="field">
					<span>Jam operasional</span>
					<input min="1" max="24" type="number" value={inputs.operationHours} oninput={(event) => updateNumber('operationHours', event)} />
					<small>{whyText.operationHours}</small>
				</label>
			{/if}

			{#if visible('setPointC')}
				<label class="field">
					<span>Set point suhu</span>
					<input min="18" max="28" type="number" value={inputs.setPointC} oninput={(event) => updateNumber('setPointC', event)} />
					<small>{whyText.setPointC}</small>
				</label>
			{/if}

			{#if visible('wallMaterial')}
				<label class="field">
					<span>Material dinding</span>
					<select value={inputs.wallMaterial} onchange={(event) => updateSelect('wallMaterial', (event.currentTarget as HTMLSelectElement).value as ProjectInputs['wallMaterial'])}>
						{#each wallOptions as [key, option]}
							<option value={key}>{option.label}</option>
						{/each}
					</select>
					<small>{whyText.wallMaterial}</small>
				</label>
			{/if}

			{#if visible('glassMaterial')}
				<label class="field">
					<span>Material kaca</span>
					<select value={inputs.glassMaterial} onchange={(event) => updateSelect('glassMaterial', (event.currentTarget as HTMLSelectElement).value as ProjectInputs['glassMaterial'])}>
						{#each glassOptions as [key, option]}
							<option value={key}>{option.label}</option>
						{/each}
					</select>
					<small>{whyText.glassMaterial}</small>
				</label>
			{/if}

			{#if visible('roofMaterial')}
				<label class="field">
					<span>Material atap</span>
					<select value={inputs.roofMaterial} onchange={(event) => updateSelect('roofMaterial', (event.currentTarget as HTMLSelectElement).value as ProjectInputs['roofMaterial'])}>
						{#each roofOptions as [key, option]}
							<option value={key}>{option.label}</option>
						{/each}
					</select>
					<small>{whyText.roofMaterial}</small>
				</label>
			{/if}

			{#if visible('glassRatio')}
				<label class="field">
					<span>Rasio kaca fasad (%)</span>
					<input min="0" max="90" type="number" value={inputs.glassRatio} oninput={(event) => updateNumber('glassRatio', event)} />
					<small>{whyText.glassRatio}</small>
				</label>
			{/if}

			{#if visible('roomHeightM')}
				<label class="field">
					<span>Tinggi ruang (m)</span>
					<input min="2.2" max="6" step="0.1" type="number" value={inputs.roomHeightM} oninput={(event) => updateNumber('roomHeightM', event)} />
					<small>{whyText.roomHeightM}</small>
				</label>
			{/if}

			{#if visible('dominantWind')}
				<label class="field">
					<span>Arah angin dominan</span>
					<select value={inputs.dominantWind} onchange={(event) => updateSelect('dominantWind', (event.currentTarget as HTMLSelectElement).value as WindDirection)}>
						{#each windOptions as option}
							<option value={option}>{option}</option>
						{/each}
					</select>
					<small>{whyText.dominantWind}</small>
				</label>
			{/if}

			{#if visible('orientationDeg')}
				<div class="field">
					<span>Orientasi bangunan</span>
					<div class="compass-row">
						<div class="compass" style={`--angle: ${inputs.orientationDeg}deg`}>
							<div class="needle"></div>
							<span>N</span>
						</div>
						<input min="0" max="359" type="range" value={inputs.orientationDeg} oninput={(event) => updateNumber('orientationDeg', event)} />
						<strong>{inputs.orientationDeg} deg</strong>
					</div>
					<small>{whyText.orientationDeg}</small>
				</div>
			{/if}

			<div class="button-row">
				<button class="primary-button" type="button" onclick={runSelectedAnalysis} disabled={!model || selectedReadiness?.status === 'blocked'}>Run analisis</button>
				<button class="ghost-button" type="button" onclick={saveTemplate}>Save template</button>
				<button class="ghost-button" type="button" onclick={loadTemplate}>Load template</button>
			</div>
			{#if templateMessage}
				<p class="muted small">{templateMessage}</p>
			{/if}
		</section>

		{#if model}
			<section class="panel-block">
				<div class="section-heading">
					<h2>Edit Ruang</h2>
					<span>{spaces.length} zona</span>
				</div>
				<div class="space-table">
					{#each spaces as space}
						<div class="space-row">
							<strong>{space.name}</strong>
							<input min="0.1" step="0.1" type="number" value={space.areaM2} aria-label={`Area ${space.name}`} oninput={(event) => updateSpaceArea(space.id, event)} />
							<input min="0.1" step="0.1" type="number" value={space.heightM.toFixed(2)} aria-label={`Tinggi ${space.name}`} oninput={(event) => updateSpaceHeight(space.id, event)} />
							<select value={space.functionKey} aria-label={`Fungsi ${space.name}`} onchange={(event) => updateSpaceFunction(space.id, event)}>
								{#each roomOptions as [key, option]}
									<option value={key}>{option.label}</option>
								{/each}
							</select>
							<span>{Math.round(space.confidence * 100)}%</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if result}
			<section class="panel-block result-block">
				<div class="section-heading">
					<h2>{result.title}</h2>
					<span>{Math.round(result.confidence * 100)}%</span>
				</div>
				<p class="result-summary">{result.summary}</p>
				{#each result.tables as table}
					<div class="result-table">
						<h3>{table.title}</h3>
						{#each table.rows as row}
							<div class:warn={row.status === 'warn'} class:bad={row.status === 'bad'} class="result-row">
								<span>{row.label}</span>
								<strong>{row.value}</strong>
								<em>{row.unit || row.note || ''}</em>
							</div>
						{/each}
					</div>
				{/each}
				<div class="compare-grid">
					{#each result.beforeAfter as item}
						<div>
							<span>{item.metric}</span>
							<strong>{item.before}</strong>
							<em>{item.after}</em>
						</div>
					{/each}
				</div>
				<ul class="recommendations">
					{#each result.recommendations as item}
						<li>{item}</li>
					{/each}
				</ul>
				<button class="primary-button full" type="button" onclick={exportReport}>Export report</button>
			</section>
		{/if}
	</aside>
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		background: #edf1ef;
		color: #172126;
	}

	button,
	input,
	select {
		font: inherit;
	}

	button {
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.52;
	}

	.app-shell {
		display: grid;
		grid-template-columns: minmax(290px, 330px) minmax(360px, 1fr) minmax(320px, 390px);
		min-height: 100vh;
	}

	.left-panel,
	.right-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 12px;
		background: #f8faf8;
		overflow-y: auto;
		max-height: 100vh;
	}

	.left-panel {
		border-right: 1px solid #d9e2df;
	}

	.right-panel {
		border-left: 1px solid #d9e2df;
	}

	.stage-panel {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
	}

	.model-stage-placeholder {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		gap: 0.35rem;
		background:
			linear-gradient(rgba(238, 242, 240, 0.88), rgba(238, 242, 240, 0.88)),
			repeating-linear-gradient(90deg, transparent 0 42px, rgba(48, 65, 72, 0.07) 42px 43px),
			repeating-linear-gradient(0deg, transparent 0 42px, rgba(48, 65, 72, 0.07) 42px 43px);
		color: #304148;
		text-align: center;
	}

	.model-stage-placeholder strong {
		font-size: 1.1rem;
	}

	.model-stage-placeholder span {
		color: #66777f;
	}

	.panel-block {
		background: #ffffff;
		border: 1px solid #dce5e1;
		border-radius: 8px;
		padding: 14px;
		box-shadow: 0 10px 28px rgba(23, 33, 38, 0.05);
	}

	.upload-block {
		display: grid;
		gap: 14px;
	}

	.eyebrow {
		margin: 0 0 4px;
		color: #58706e;
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0;
		text-transform: uppercase;
	}

	h1,
	h2,
	h3,
	p {
		margin: 0;
	}

	h1 {
		font-size: 1.45rem;
		line-height: 1.1;
	}

	h2 {
		font-size: 0.98rem;
	}

	h3 {
		font-size: 0.88rem;
	}

	.muted {
		color: #66777f;
		font-size: 0.9rem;
	}

	.small {
		font-size: 0.78rem;
		line-height: 1.35;
	}

	.button-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.primary-button,
	.ghost-button {
		min-height: 38px;
		border-radius: 6px;
		padding: 0 12px;
		font-weight: 800;
		border: 1px solid transparent;
	}

	.primary-button {
		background: #214f46;
		color: #ffffff;
	}

	.ghost-button {
		background: #edf4f2;
		color: #21423d;
		border-color: #d2dfdb;
	}

	.full {
		width: 100%;
	}

	.status-line {
		color: #2563eb;
		font-size: 0.82rem;
	}

	.error-line {
		color: #b42318;
		background: #fff1f0;
		border: 1px solid #ffd4cf;
		border-radius: 6px;
		padding: 8px;
		font-size: 0.82rem;
	}

	.annotation-panel {
		display: grid;
		gap: 10px;
		border-color: #f0b77b;
		background: #fffaf4;
	}

	.annotation-nav,
	.annotation-roles,
	.annotation-fields {
		display: grid;
		gap: 6px;
	}

	.annotation-nav {
		grid-template-columns: auto minmax(0, 1fr) auto;
	}

	.annotation-roles {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.annotation-roles button,
	.annotation-nav button {
		border: 1px solid #e3c5a4;
		border-radius: 5px;
		padding: 7px;
		background: #fff;
		color: #6c3e15;
		font-weight: 750;
	}

	.annotation-roles button.active {
		background: #9a4c12;
		border-color: #9a4c12;
		color: #fff;
	}

	.annotation-fields {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.annotation-evidence {
		display: grid;
		gap: 4px;
		padding: 8px;
		border-left: 3px solid #e67e22;
		background: #fff;
		font-size: 0.74rem;
		color: #5d5042;
	}

	.annotation-evidence code {
		font-size: 0.67rem;
		overflow-wrap: anywhere;
		color: #78350f;
	}

	textarea {
		min-height: 58px;
		resize: vertical;
		font: inherit;
	}

	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 12px;
	}

	.section-heading span {
		padding: 3px 8px;
		border-radius: 999px;
		background: #edf4f2;
		color: #42635e;
		font-size: 0.75rem;
		font-weight: 800;
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.metric-grid div {
		min-height: 64px;
		padding: 10px;
		border: 1px solid #e2e9e6;
		border-radius: 6px;
		background: #f8fbfa;
		display: grid;
		align-content: center;
		gap: 3px;
	}

	.metric-grid strong {
		font-size: 1.18rem;
	}

	.metric-grid span {
		color: #66777f;
		font-size: 0.75rem;
	}

	.part-list,
	.readiness-list,
	.result-table,
	.recommendations,
	.warning-list {
		display: grid;
		gap: 7px;
		margin-top: 12px;
	}

	.app-shell.qa-mode {
		display: block;
		width: var(--qa-width, 100vw);
		height: var(--qa-height, 100vh);
		min-height: var(--qa-height, 100vh);
		overflow: hidden;
	}

	.app-shell.qa-mode > .left-panel,
	.app-shell.qa-mode > .right-panel,
	.app-shell.qa-mode .stage-hud {
		display: none;
	}

	.app-shell.qa-mode > .stage-panel {
		width: var(--qa-width, 100vw);
		height: var(--qa-height, 100vh);
		min-height: var(--qa-height, 100vh);
	}

	.qa-view-selector {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 20;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.classifier-inspector {
		display: grid;
		gap: 12px;
	}

	.classifier-inspector .section-heading,
	.classifier-inspector .field {
		margin-bottom: 0;
	}

	.classifier-inspector .section-heading span {
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.category-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 5px;
		max-height: 156px;
		overflow-y: auto;
	}

	.category-chip {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		padding: 5px 7px;
		border: 1px solid #e1e9e6;
		border-radius: 5px;
		background: #f8fbfa;
		font-size: 0.7rem;
	}

	.category-chip span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.category-chip.unknown-category {
		border-color: #f3c5bf;
		background: #fff4f2;
		color: #9a2c20;
	}

	.inspector-select select {
		font-size: 0.75rem;
	}

	.trace-final {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 7px;
	}

	.trace-final div {
		display: grid;
		gap: 2px;
		padding: 8px;
		border-radius: 6px;
		background: #edf7f4;
	}

	.trace-final span,
	.trace-final strong {
		font-size: 0.75rem;
	}

	.trace-explanation,
	.conflict-box,
	.unknown-box {
		font-size: 0.75rem;
		line-height: 1.4;
	}

	.trace-block {
		display: grid;
		gap: 5px;
		padding-top: 8px;
		border-top: 1px solid #e4ebe8;
		font-size: 0.75rem;
	}

	.trace-block summary {
		cursor: pointer;
		font-weight: 800;
	}

	.trace-list {
		display: grid;
		gap: 4px;
		margin: 2px 0 0;
		padding-left: 18px;
		line-height: 1.35;
	}

	.candidate-row {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 4px 6px;
		border-radius: 4px;
		background: #f7faf9;
	}

	.conflict-box,
	.unknown-box {
		padding: 8px;
		border-radius: 5px;
		background: #f4f7f6;
	}

	.unknown-box {
		border: 1px solid #f3c5bf;
		background: #fff4f2;
		color: #8f2b20;
	}

	.result-row,
	.space-row {
		display: grid;
		align-items: center;
		gap: 8px;
	}

	.part-list {
		padding-top: 0;
	}

	.part-list-heading,
	.part-row {
		display: grid;
		align-items: center;
		gap: 8px;
	}

	.part-list-heading {
		grid-template-columns: 1fr auto;
		color: #2f4449;
		font-size: 0.82rem;
	}

	.part-list-heading div {
		display: flex;
		gap: 6px;
	}

	.part-list-heading button {
		min-height: 28px;
		border: 1px solid #d2dfdb;
		border-radius: 5px;
		background: #edf4f2;
		color: #21423d;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.part-row {
		grid-template-columns: 16px 12px 1fr auto;
		color: #415158;
		font-size: 0.82rem;
	}

	.part-group {
		display: grid;
		gap: 4px;
	}

	.surface-detail {
		display: grid;
		gap: 3px;
		margin-left: 36px;
		padding-left: 8px;
		border-left: 1px solid #e2e9e6;
	}

	.surface-row {
		display: grid;
		grid-template-columns: 10px 1fr auto;
		align-items: center;
		gap: 7px;
		color: #66777f;
		font-size: 0.75rem;
	}

	.part-row input {
		width: 16px;
		min-height: 16px;
		padding: 0;
	}

	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 3px;
	}

	.muted-swatch {
		width: 10px;
		height: 10px;
		opacity: 0.82;
	}

	.warning-list {
		padding-left: 18px;
		color: #8a5a10;
		font-size: 0.78rem;
	}

	.readiness-row {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 38px;
		padding: 8px 10px;
		border: 1px solid #dce5e1;
		border-radius: 6px;
		background: #f9fbfa;
		color: #25383d;
		text-align: left;
	}

	.readiness-row.active {
		border-color: #214f46;
		background: #edf7f4;
	}

	.readiness-row.ready strong {
		color: #18794e;
	}

	.readiness-row.estimate strong {
		color: #a05a00;
	}

	.readiness-row.blocked strong {
		color: #b42318;
	}

	.stage-hud {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: 16px;
		display: flex;
		justify-content: space-between;
		pointer-events: none;
	}

	.stage-hud div {
		background: rgba(248, 250, 248, 0.86);
		border: 1px solid rgba(214, 225, 220, 0.9);
		border-radius: 8px;
		padding: 8px 10px;
		display: grid;
		gap: 2px;
		backdrop-filter: blur(10px);
	}

	.stage-hud span {
		color: #66777f;
		font-size: 0.72rem;
		font-weight: 700;
	}

	.stage-hud strong {
		font-size: 0.9rem;
	}

	/* ─── Room Debug HUD ──────────────────────────────────────────── */
	.room-debug-hud {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 20;
		min-width: 220px;
		max-width: 300px;
		max-height: calc(100% - 20px);
		overflow-y: auto;
		background: rgba(10, 16, 22, 0.88);
		border: 1px solid rgba(34, 211, 238, 0.35);
		border-radius: 10px;
		padding: 10px 12px;
		font-size: 0.75rem;
		color: #cbd5e1;
		backdrop-filter: blur(6px);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	}

	.room-debug-hud__title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-weight: 700;
		font-size: 0.78rem;
		color: #e2e8f0;
		margin-bottom: 6px;
	}

	.room-debug-hud__badge {
		padding: 1px 7px;
		border-radius: 20px;
		font-size: 0.68rem;
		font-weight: 600;
	}
	.room-debug-hud__badge--ok { background: rgba(34, 211, 238, 0.18); color: #22d3ee; }
	.room-debug-hud__badge--running { background: rgba(245, 158, 11, 0.18); color: #f59e0b; }
	.room-debug-hud__badge--error { background: rgba(239, 68, 68, 0.18); color: #f87171; }

	.room-debug-hud__timing {
		color: #64748b;
		font-size: 0.68rem;
		margin-bottom: 6px;
	}

	.room-debug-hud__warning {
		background: rgba(245, 158, 11, 0.1);
		border-left: 2px solid #f59e0b;
		padding: 6px 8px;
		margin-bottom: 8px;
		color: #fcd34d;
		font-size: 0.72rem;
		line-height: 1.4;
	}

	.room-debug-hud__detected-rooms {
		background: rgba(100, 200, 100, 0.06);
		border-left: 2px solid #4ade80;
		padding: 6px 8px;
		margin-bottom: 8px;
		font-size: 0.72rem;
	}

	.room-debug-hud__detected-rooms-header {
		color: #86efac;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
		margin-bottom: 4px;
	}

	.room-debug-hud__detected-badge {
		font-size: 0.65rem;
		padding: 1px 5px;
		border-radius: 3px;
		font-weight: 500;
	}
	.room-debug-hud__detected-badge--valid { background: rgba(74, 222, 128, 0.2); color: #86efac; }
	.room-debug-hud__detected-badge--ambiguous { background: rgba(251, 191, 36, 0.2); color: #fcd34d; }
	.room-debug-hud__detected-badge--rejected { background: rgba(248, 113, 113, 0.2); color: #fca5a5; }

	.room-debug-hud__detected-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.room-debug-hud__detected-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		border-radius: 3px;
		font-size: 0.68rem;
	}
	.room-debug-hud__detected-item--valid { background: rgba(74, 222, 128, 0.08); }
	.room-debug-hud__detected-item--ambiguous { background: rgba(251, 191, 36, 0.08); }
	.room-debug-hud__detected-item--rejected { background: rgba(248, 113, 113, 0.06); opacity: 0.65; }

	.room-debug-hud__detected-status { font-weight: 700; width: 12px; text-align: center; color: #94a3b8; }
	.room-debug-hud__detected-area { color: #e2e8f0; min-width: 50px; }
	.room-debug-hud__detected-height { color: #94a3b8; }
	.room-debug-hud__detected-confidence { color: #64748b; font-size: 0.65rem; }
	.room-debug-hud__detected-id { color: #475569; font-family: monospace; font-size: 0.6rem; overflow: hidden; text-overflow: ellipsis; }

	.room-debug-hud__detected-note {
		color: #94a3b8;
		font-size: 0.65rem;
		margin-top: 4px;
	}

	.room-debug-hud__controls {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		margin: 0 0 6px;
	}

	.room-debug-hud__control {
		padding: 3px 5px;
		border: 1px solid rgba(148, 163, 184, 0.35);
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.04);
		color: #94a3b8;
		font: inherit;
		font-size: 0.64rem;
		text-align: left;
		cursor: pointer;
	}

	.room-debug-hud__control--active { border-color: rgba(34, 211, 238, 0.56); background: rgba(34, 211, 238, 0.12); color: #cffafe; }

	.room-debug-hud__focus {
		width: 100%;
		margin: 0 0 6px;
		padding: 4px 7px;
		border: 1px solid rgba(34, 211, 238, 0.52);
		border-radius: 5px;
		background: rgba(34, 211, 238, 0.12);
		color: #cffafe;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.room-debug-hud__focus:disabled { opacity: 0.45; cursor: not-allowed; }
	.room-debug-hud__evidence-toggle { width: 100%; margin: 0 0 6px; }
	.room-debug-hud__evidence-toggle:disabled { opacity: 0.45; cursor: not-allowed; }

	.room-debug-hud__error {
		color: #f87171;
		font-size: 0.72rem;
		word-break: break-all;
		margin: 4px 0 6px;
	}

	.room-debug-hud__schema-error {
		background: rgba(239, 68, 68, 0.08);
		border-left: 2px solid #ef4444;
		padding: 6px 8px;
		margin-bottom: 8px;
		color: #fca5a5;
		font-size: 0.72rem;
		line-height: 1.4;
	}

	.room-debug-hud__list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.room-debug-hud__item {
		display: grid;
		grid-template-columns: 16px 56px 1fr 56px;
		gap: 4px;
		align-items: center;
		padding: 3px 6px;
		border-radius: 5px;
		width: 100%;
		border-top: 0;
		border-right: 0;
		border-bottom: 0;
		background: rgba(255, 255, 255, 0.04);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		font-variant-numeric: tabular-nums;
	}

	.room-debug-hud__item:hover { background: rgba(255, 255, 255, 0.10); }
	.room-debug-hud__item--selected { background: rgba(34, 211, 238, 0.20); box-shadow: inset 0 0 0 1px rgba(207, 250, 254, 0.6); }

	.room-debug-hud__item--primary { border-left: 2px solid #22d3ee; }
	.room-debug-hud__item--secondary { border-left: 2px solid #a78bfa; }
	.room-debug-hud__item--ambiguous { border-left: 2px solid #f59e0b; }

	.room-debug-hud__status { font-weight: 700; }
	.room-debug-hud__area { color: #94a3b8; }
	.room-debug-hud__elev { color: #64748b; font-size: 0.68rem; }
	.room-debug-hud__id { color: #475569; font-family: monospace; font-size: 0.66rem; text-align: right; }

	.room-debug-hud__more {
		padding: 2px 6px;
		color: #475569;
		font-style: italic;
	}

	.room-debug-hud__details {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid rgba(148, 163, 184, 0.28);
		font-size: 0.68rem;
	}

	.room-debug-hud__details strong { color: #e2e8f0; }
	.room-debug-hud__details dl { display: grid; grid-template-columns: 72px 1fr; gap: 3px 6px; margin: 6px 0 0; }
	.room-debug-hud__evidence { margin-top: 8px; color: #94a3b8; }
	.room-debug-hud__evidence summary { cursor: pointer; color: #cffafe; font-weight: 700; }
	.room-debug-hud__evidence dd { overflow-wrap: anywhere; }
	.room-debug-hud__copy { margin-top: 6px; padding: 3px 6px; border: 1px solid rgba(34, 211, 238, 0.52); border-radius: 4px; background: rgba(34, 211, 238, 0.12); color: #cffafe; font: inherit; cursor: pointer; }
	.room-debug-hud__copy-message { margin: 4px 0 0; color: #67e8f9; }
	.room-debug-hud__details dt { color: #94a3b8; }
	.room-debug-hud__details dd { margin: 0; color: #cbd5e1; overflow-wrap: anywhere; }

	.field {
		display: grid;
		gap: 6px;
		margin-bottom: 12px;
	}

	.field > span {
		font-size: 0.8rem;
		font-weight: 800;
		color: #2f4449;
	}

	input,
	select {
		width: 100%;
		min-height: 38px;
		border: 1px solid #cddbd7;
		border-radius: 6px;
		background: #ffffff;
		color: #172126;
		padding: 0 10px;
	}

	input[type='range'] {
		padding: 0;
	}

	.field small {
		color: #697c82;
		line-height: 1.35;
	}

	.compass-row {
		display: grid;
		grid-template-columns: 58px 1fr 58px;
		align-items: center;
		gap: 10px;
	}

	.compass {
		position: relative;
		width: 54px;
		height: 54px;
		border-radius: 50%;
		border: 1px solid #cddbd7;
		background: #f5faf8;
		display: grid;
		place-items: center;
		font-size: 0.72rem;
		font-weight: 800;
		color: #52676b;
	}

	.needle {
		position: absolute;
		width: 3px;
		height: 20px;
		background: #c2410c;
		border-radius: 99px;
		transform-origin: center 23px;
		transform: rotate(var(--angle));
		top: 7px;
	}

	.space-table {
		display: grid;
		gap: 8px;
		max-height: 320px;
		overflow: auto;
	}

	.space-row {
		grid-template-columns: 1fr 66px 66px 96px 42px;
		padding: 8px;
		border: 1px solid #e2e9e6;
		border-radius: 6px;
		background: #fbfdfc;
	}

	.space-row strong,
	.space-row span {
		font-size: 0.78rem;
	}

	.space-row input,
	.space-row select {
		min-height: 32px;
		font-size: 0.78rem;
	}

	.result-block {
		border-color: #c8ddd6;
	}

	.result-summary {
		color: #25383d;
		line-height: 1.4;
	}

	.result-row {
		grid-template-columns: 1fr auto auto;
		padding: 8px;
		border-radius: 6px;
		background: #f7faf9;
		border: 1px solid #e1e9e6;
		font-size: 0.82rem;
	}

	.result-row.warn {
		background: #fff8eb;
		border-color: #f2d49b;
	}

	.result-row.bad {
		background: #fff1f0;
		border-color: #ffc9c2;
	}

	.result-row em {
		color: #66777f;
		font-style: normal;
	}

	.compare-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		margin-top: 12px;
	}

	.compare-grid div {
		display: grid;
		gap: 4px;
		padding: 10px;
		background: #edf4f2;
		border-radius: 6px;
		border: 1px solid #d4e3de;
	}

	.compare-grid span,
	.compare-grid em {
		font-size: 0.76rem;
		color: #66777f;
		font-style: normal;
	}

	.recommendations {
		padding-left: 18px;
		color: #2d3f45;
		font-size: 0.84rem;
		line-height: 1.35;
	}

	@media (max-width: 1180px) {
		.app-shell {
			grid-template-columns: 300px minmax(360px, 1fr);
		}

		.right-panel {
			grid-column: 1 / -1;
			border-left: 0;
			border-top: 1px solid #d9e2df;
			max-height: none;
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 820px) {
		.app-shell {
			display: block;
		}

		.left-panel,
		.right-panel {
			max-height: none;
		}

		.stage-panel {
			min-height: 62vh;
		}

		.right-panel {
			display: flex;
		}

		.space-row,
		.result-row {
			grid-template-columns: 1fr;
		}
	}
</style>
