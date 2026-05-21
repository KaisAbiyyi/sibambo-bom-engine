<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    ACESFilmicToneMapping,
    AmbientLight,
    BufferGeometry,
    Color,
    DirectionalLight,
    DoubleSide,
    EdgesGeometry,
    Group,
    LineBasicMaterial,
    LineSegments,
    MathUtils,
    Mesh,
    MeshStandardMaterial,
    PCFSoftShadowMap,
    PerspectiveCamera,
    PlaneGeometry,
    Scene,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer
  } from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
  import { formatArea, formatInteger } from "../lib/format";
  import type { LayerKey, LayerModel, MacroGroupKey, ParsedModel } from "../types/model";
  import type { CameraBlendState, SceneData } from "../types/scene";

  export let model: ParsedModel | null = null;
  export let activeScene: SceneData;
  export let scenes: SceneData[] = [];
  export let cameraBlend: CameraBlendState;
  export let sceneProgress = 0;
  export let exploreMode = false;
  export let hiddenLayerKeys = new Set<LayerKey>();
  export let theme: "light" | "dark" = "light";

  type LayerVisualState = "active" | "muted" | "ghost" | "hidden";
  type LayerRuntime = {
    key: LayerKey;
    layer: LayerModel;
    group: Group;
    mesh: Mesh;
    edges: LineSegments;
    geometry: BufferGeometry;
    edgeGeometry: EdgesGeometry;
    material: MeshStandardMaterial;
    edgeMaterial: LineBasicMaterial;
    target: Vector3;
    visualState: LayerVisualState;
    materialTheme: "light" | "dark";
  };

  type CameraState = {
    theta: number;
    phi: number;
    radius: number;
    target: Vector3;
  };

  const WORLD_UP = new Vector3(0, 1, 0);
  let stageEl: HTMLDivElement;
  let canvasHost: HTMLDivElement;
  let labelLayer: HTMLDivElement;

  let renderer: WebGLRenderer | null = null;
  let scene3d: Scene | null = null;
  let camera: PerspectiveCamera | null = null;
  let rootGroup: Group | null = null;
  let controls: OrbitControls | null = null;
  let ground: Mesh | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let raf = 0;
  let mounted = false;
  let currentModel: ParsedModel | null = null;
  let layerRuntimes = new Map<LayerKey, LayerRuntime>();
  let labels: HTMLElement[] = [];
  let cameraCurrent: CameraState = { theta: 0.65, phi: 0.92, radius: 10, target: new Vector3() };

  function stagePalette() {
    return theme === "dark"
      ? { background: "#0c1116", ground: "#111820" }
      : { background: "#f7f8f6", ground: "#fdfdfb" };
  }

  function requestFrame() {
    if (raf || !renderer || !scene3d || !camera) return;
    raf = window.requestAnimationFrame(renderLoop);
  }

  function renderLoop() {
    raf = 0;
    const movingLayers = animateLayers();
    const movingCamera = animateCamera();
    controls?.update();
    updateLabels();
    renderer!.render(scene3d!, camera!);
    if (movingLayers || movingCamera || exploreMode) requestFrame();
  }

  function materialForState(layer: LayerModel, visualState: LayerVisualState) {
    const opacity = visualState === "ghost" ? 0.18 : 1;
    const color =
      visualState === "active"
        ? theme === "dark"
          ? "#f4f0e8"
          : "#fbfbf7"
        : visualState === "ghost"
          ? theme === "dark"
            ? "#505963"
            : "#d9ddd8"
          : theme === "dark"
            ? "#d6d1c7"
            : "#f0f2ed";

    return new MeshStandardMaterial({
      color,
      roughness: 0.76,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      side: DoubleSide,
      depthWrite: visualState !== "ghost"
    });
  }

  function layerVisualState(sceneData: SceneData, layerKey: string): LayerVisualState {
    if (hiddenLayerKeys.has(layerKey as LayerKey)) return "hidden";
    if (sceneData.displayMode === "assembled") return "muted";
    if (sceneData.displayMode === "exploded") return "active";
    if (sceneData.displayMode === "xray") {
      if (sceneData.activeLayerKeys.includes(layerKey as LayerKey)) return "active";
      if (sceneData.contextLayerKeys.includes(layerKey as LayerKey)) return "ghost";
      return "hidden";
    }
    if (sceneData.activeLayerKeys.includes(layerKey as LayerKey)) return "active";
    if (sceneData.contextLayerKeys.includes(layerKey as LayerKey)) return "ghost";
    return "hidden";
  }

  function mergeLayerGeometry(layer: LayerModel) {
    const translated = layer.meshes.map((mesh) => {
      const geometry = mesh.geometry.clone();
      geometry.translate(mesh.position[0], mesh.position[1], mesh.position[2]);
      return geometry;
    });
    const merged = translated.length ? mergeGeometries(translated, false) : new BufferGeometry();
    translated.forEach((geometry) => geometry.dispose());
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  function disposeRuntime(runtime: LayerRuntime) {
    runtime.geometry.dispose();
    runtime.edgeGeometry.dispose();
    runtime.material.dispose();
    runtime.edgeMaterial.dispose();
  }

  function clearSceneModel() {
    if (!rootGroup) return;
    layerRuntimes.forEach((runtime) => {
      rootGroup!.remove(runtime.group);
      disposeRuntime(runtime);
    });
    layerRuntimes.clear();
    labels.forEach((label) => label.remove());
    labels = [];
    currentModel = null;
  }

  function buildSceneModel(nextModel: ParsedModel | null) {
    if (!rootGroup || currentModel === nextModel) return;
    clearSceneModel();
    currentModel = nextModel;
    if (!nextModel) return;

    const center = nextModel.bounds.center;
    rootGroup.position.set(-center.x, -center.y, -center.z);

    Object.entries(nextModel.layers).forEach(([key, layer]) => {
      const visualState = layerVisualState(activeScene, key);
      const geometry = mergeLayerGeometry(layer);
      const edgeGeometry = new EdgesGeometry(geometry, visualState === "ghost" ? 42 : 28);
      const material = materialForState(layer, visualState);
      const edgeMaterial = new LineBasicMaterial({
        color: visualState === "active" ? (theme === "dark" ? "#d9d3c8" : "#66706b") : "#9fa7a1",
        transparent: true,
        opacity: visualState === "active" ? 0.28 : 0.1
      });
      const group = new Group();
      const mesh = new Mesh(geometry, material);
      const edges = new LineSegments(edgeGeometry, edgeMaterial);

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      edges.frustumCulled = true;
      group.name = key;
      group.visible = visualState !== "hidden";
      group.add(mesh, edges);
      rootGroup!.add(group);

      layerRuntimes.set(key as LayerKey, {
        key: key as LayerKey,
        layer,
        group,
        mesh,
        edges,
        geometry,
        edgeGeometry,
        material,
        edgeMaterial,
        target: new Vector3(),
        visualState,
        materialTheme: theme
      });
    });

    updateGround(nextModel);
    cameraCurrent = cameraTargetState();
    positionCamera(cameraCurrent);
    updateVisuals();
  }

  function updateVisuals() {
    if (!currentModel) return;
    const explodeProgress = activeScene.displayMode === "exploded" ? sceneProgress : 0;
    layerRuntimes.forEach((runtime, key) => {
      const visualState = layerVisualState(activeScene, key);
      const macro = currentModel!.macroGroups[runtime.layer.macroGroup];
      runtime.target.copy(macro.explodeOffset).multiplyScalar(explodeProgress);
      runtime.group.visible = visualState !== "hidden";
      runtime.edges.visible = activeScene.displayMode !== "assembled" && visualState === "active";

      if (runtime.visualState !== visualState || runtime.materialTheme !== theme) {
        runtime.material.dispose();
        runtime.edgeMaterial.dispose();
        runtime.material = materialForState(runtime.layer, visualState);
        runtime.edgeMaterial = new LineBasicMaterial({
          color: visualState === "active" ? (theme === "dark" ? "#d9d3c8" : "#66706b") : theme === "dark" ? "#626c73" : "#9fa7a1",
          transparent: true,
          opacity: visualState === "active" ? 0.28 : 0.1
        });
        runtime.mesh.material = runtime.material;
        runtime.edges.material = runtime.edgeMaterial;
        runtime.visualState = visualState;
        runtime.materialTheme = theme;
      }
    });
    buildLabels();
    updateLabels();
    requestFrame();
  }

  function updateGround(nextModel: ParsedModel | null) {
    if (!ground) return;
    const fit = nextModel?.bounds.fitRadius ?? 10;
    const center = nextModel?.bounds.center ?? new Vector3();
    ground.scale.setScalar(Math.max(fit * 0.62, 14));
    ground.position.set(0, -center.y - 0.02, 0);
  }

  function updateStageTheme() {
    const palette = stagePalette();
    renderer?.setClearColor(new Color(palette.background));
    if (scene3d) scene3d.background = new Color(palette.background);
    const material = ground?.material;
    if (material && !Array.isArray(material)) material.color.set(palette.ground);
    requestFrame();
  }

  function buildLabels() {
    labels.forEach((label) => label.remove());
    labels = [];
    if (!currentModel || !labelLayer) return;

    const items =
      activeScene.displayMode === "exploded"
        ? Object.values(currentModel.macroGroups)
            .filter((macro) => macro.layerKeys.length)
            .map((macro) => ({
              className: "model-label model-label--macro",
              position: macro.center.clone().add(macro.explodeOffset.clone().multiplyScalar(sceneProgress)),
              title: macro.label,
              meta: `${formatInteger(macro.meshCount)} meshes`
            }))
        : (activeScene.macroGroup === "all"
            ? Object.values(currentModel.macroGroups)
                .filter((macro) => macro.layerKeys.length)
                .flatMap((macro) => macro.layerKeys.slice(0, 1))
            : activeScene.activeLayerKeys
          )
            .slice(0, 6)
            .map((layerKey) => currentModel!.layerRegistry[layerKey])
            .filter(Boolean)
            .map((layer) => ({
              className: "model-label",
              position: layer!.center,
              title: layer!.label,
              meta: formatArea(layer!.area)
            }));

    labels = items.map((item) => {
      const el = document.createElement("div");
      el.className = item.className;
      el.dataset.x = String(item.position.x);
      el.dataset.y = String(item.position.y);
      el.dataset.z = String(item.position.z);
      el.innerHTML = `<span>${item.title}</span><strong>${item.meta}</strong>`;
      labelLayer.appendChild(el);
      return el;
    });
  }

  function animateLayers() {
    let moving = false;
    layerRuntimes.forEach((runtime) => {
      const alpha = 0.16;
      runtime.group.position.lerp(runtime.target, alpha);
      if (runtime.group.position.distanceToSquared(runtime.target) > 0.00004) moving = true;
    });
    return moving;
  }

  function zoomIntentScale(sceneData: SceneData): number {
    if (sceneData.camera.zoomIntent === "detail") return 0.72;
    if (sceneData.camera.zoomIntent === "close") return 0.84;
    if (sceneData.camera.zoomIntent === "medium") return 0.94;
    return 1;
  }

  function screenAxis(value: "left" | "center" | "right"): number {
    if (value === "left") return 1;
    if (value === "right") return -1;
    return 0;
  }

  function screenYAxis(value: "top" | "center" | "bottom"): number {
    if (value === "top") return -1;
    if (value === "bottom") return 1;
    return 0;
  }

  function resolveCameraState(modelData: ParsedModel | null, sceneData: SceneData, width: number): CameraState {
    const modelCenter = modelData?.bounds.center ?? new Vector3();
    const modelSize = modelData?.bounds.size ?? new Vector3(8, 5, 8);
    const macro =
      modelData && sceneData.macroGroup !== "all"
        ? modelData.macroGroups[sceneData.macroGroup as MacroGroupKey]
        : null;
    const focusCenter = macro && macro.layerKeys.length ? macro.center.clone().sub(modelCenter) : new Vector3();
    const focusSize = macro && macro.layerKeys.length ? macro.size : modelSize;
    const footprint = Math.max(focusSize.x, focusSize.z, modelData?.bounds.footprint ?? 8, 1);
    const mobile = width < 760;
    const mobileScale = mobile ? 1.22 : 1;
    const focusSpan = Math.max(focusSize.x, focusSize.y, focusSize.z, 1);
    const baseRadius =
      sceneData.macroGroup === "all"
        ? modelData?.bounds.fitRadius ?? 10
        : (focusSpan / 2) / Math.tan((42 / 2) * Math.PI / 180) * 1.24;
    const radius = Math.max(baseRadius * sceneData.camera.radiusFactor * zoomIntentScale(sceneData) * mobileScale, 2.8);
    const theta = sceneData.camera.theta;
    const phi = MathUtils.clamp(sceneData.camera.phi, 0.28, 1.74);

    const sinPhi = Math.sin(phi);
    const eyeDirection = new Vector3(Math.sin(theta) * sinPhi, Math.cos(phi), Math.cos(theta) * sinPhi).normalize();
    const forward = eyeDirection.clone().multiplyScalar(-1);
    const right = new Vector3().crossVectors(forward, WORLD_UP).normalize();
    const viewUp = new Vector3().crossVectors(right, forward).normalize();
    const screenScale = footprint * (sceneData.camera.zoomIntent === "detail" ? 0.08 : sceneData.camera.zoomIntent === "wide" ? 0.18 : 0.14);
    const screenYOffset = Math.max(focusSize.y, footprint * 0.38, 1) * 0.12;

    const target = new Vector3(
      focusCenter.x + sceneData.camera.targetXBias * footprint * (mobile ? 0.35 : 1),
      focusCenter.y + sceneData.camera.targetYBias * Math.max(focusSize.y, 1),
      focusCenter.z + (sceneData.camera.targetZBias ?? 0) * footprint
    );
    target.addScaledVector(right, screenAxis(sceneData.camera.modelScreenX) * screenScale * (mobile ? 1.15 : 1));
    target.addScaledVector(viewUp, screenYAxis(sceneData.camera.modelScreenY) * screenYOffset * (mobile ? 0.55 : 1));

    return { theta, phi, radius, target };
  }

  function mixCameraStates(from: CameraState, to: CameraState, progress: number): CameraState {
    const t = MathUtils.clamp(progress, 0, 1);
    return {
      theta: MathUtils.lerp(from.theta, to.theta, t),
      phi: MathUtils.lerp(from.phi, to.phi, t),
      radius: MathUtils.lerp(from.radius, to.radius, t),
      target: from.target.clone().lerp(to.target, t)
    };
  }

  function cameraTargetState() {
    const fallback = scenes[0] ?? activeScene;
    const fromScene = scenes.find((candidate) => candidate.id === cameraBlend.fromId) ?? fallback;
    const toScene = scenes.find((candidate) => candidate.id === cameraBlend.toId) ?? fromScene;
    const width = stageEl?.clientWidth ?? window.innerWidth;
    return mixCameraStates(
      resolveCameraState(currentModel, fromScene, width),
      resolveCameraState(currentModel, toScene, width),
      cameraBlend.progress
    );
  }

  function animateCamera() {
    if (!camera || !currentModel || exploreMode) return false;
    const targetState = cameraTargetState();
    const alpha = 0.14;
    cameraCurrent.theta = MathUtils.lerp(cameraCurrent.theta, targetState.theta, alpha);
    cameraCurrent.phi = MathUtils.lerp(cameraCurrent.phi, targetState.phi, alpha);
    cameraCurrent.radius = MathUtils.lerp(cameraCurrent.radius, targetState.radius, alpha);
    cameraCurrent.target.lerp(targetState.target, alpha);

    positionCamera(cameraCurrent);

    return (
      Math.abs(cameraCurrent.theta - targetState.theta) > 0.002 ||
      Math.abs(cameraCurrent.phi - targetState.phi) > 0.002 ||
      Math.abs(cameraCurrent.radius - targetState.radius) > 0.02 ||
      cameraCurrent.target.distanceToSquared(targetState.target) > 0.0004
    );
  }

  function positionCamera(state: CameraState) {
    if (!camera) return;
    const sinPhiRadius = Math.sin(state.phi) * state.radius;
    camera.position.set(
      state.target.x + Math.sin(state.theta) * sinPhiRadius,
      state.target.y + Math.cos(state.phi) * state.radius,
      state.target.z + Math.cos(state.theta) * sinPhiRadius
    );
    camera.near = 0.05;
    camera.far = Math.max(state.radius * 8, 400);
    camera.lookAt(state.target);
    camera.updateProjectionMatrix();
  }

  function updateLabels() {
    if (!camera || !currentModel || !labelLayer) return;
    const rect = labelLayer.getBoundingClientRect();
    const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
    labels.forEach((label) => {
      const position = new Vector3(Number(label.dataset.x), Number(label.dataset.y), Number(label.dataset.z));
      position.sub(currentModel!.bounds.center).project(camera!);
      const x = (position.x * 0.5 + 0.5) * rect.width;
      const y = (-position.y * 0.5 + 0.5) * rect.height;
      const visible = position.z >= -1 && position.z <= 1;
      const width = label.offsetWidth || 160;
      const height = label.offsetHeight || 38;
      const box = { x: x - width / 2, y: y - height / 2, width, height };
      const collides = occupied.some(
        (item) =>
          box.x < item.x + item.width + 18 &&
          box.x + box.width + 18 > item.x &&
          box.y < item.y + item.height + 12 &&
          box.y + box.height + 12 > item.y
      );
      label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      label.style.opacity = visible && !collides ? "1" : "0";
      if (visible && !collides) occupied.push(box);
    });
  }

  function resize() {
    if (!renderer || !camera || !stageEl) return;
    const width = stageEl.clientWidth;
    const height = stageEl.clientHeight;
    const dpr = width < 760 ? 1 : Math.min(window.devicePixelRatio || 1, 1.25);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    requestFrame();
  }

  onMount(() => {
    mounted = true;
    renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setClearColor(new Color(stagePalette().background));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    canvasHost.appendChild(renderer.domElement);

    scene3d = new Scene();
    scene3d.background = new Color(stagePalette().background);
    camera = new PerspectiveCamera(42, 1, 0.05, 400);
    camera.position.set(8, 6, 9);

    scene3d.add(new AmbientLight("#ffffff", 1.08));
    const sun = new DirectionalLight("#fff8ea", 2.45);
    sun.position.set(9, 16, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    scene3d.add(sun);
    const fill = new DirectionalLight("#dbeafe", 0.9);
    fill.position.set(-8, 7, -6);
    scene3d.add(fill);
    const rim = new DirectionalLight("#ffffff", 0.72);
    rim.position.set(-4, 10, 10);
    scene3d.add(rim);

    rootGroup = new Group();
    scene3d.add(rootGroup);

    ground = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshStandardMaterial({ color: stagePalette().ground, roughness: 0.74, metalness: 0 })
    );
    ground.receiveShadow = true;
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene3d.add(ground);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.enableRotate = false;
    controls.minPolarAngle = Math.PI * 0.18;
    controls.maxPolarAngle = Math.PI * 0.84;
    controls.addEventListener("change", requestFrame);

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stageEl);
    resize();
    buildSceneModel(model);
    requestFrame();
  });

  onDestroy(() => {
    mounted = false;
    if (raf) window.cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    controls?.dispose();
    clearSceneModel();
    ground?.geometry.dispose();
    const groundMaterial = ground?.material;
    if (groundMaterial && !Array.isArray(groundMaterial)) groundMaterial.dispose();
    renderer?.dispose();
    renderer?.domElement.remove();
  });

  $: if (mounted) buildSceneModel(model);
  $: if (mounted) {
    activeScene;
    sceneProgress;
    hiddenLayerKeys;
    updateStageTheme();
    updateVisuals();
    if (controls && model) {
      const fit = model.bounds.fitRadius ?? 10;
      controls.enabled = exploreMode;
      controls.enableZoom = exploreMode;
      controls.enableRotate = exploreMode;
      controls.minDistance = Math.max(fit * 0.42, 2);
      controls.maxDistance = fit * 2.4;
      if (exploreMode) {
        controls.target.copy(cameraCurrent.target);
        controls.update();
      } else {
        controls.target.copy(cameraCurrent.target);
      }
    }
    requestFrame();
  }
</script>

<div bind:this={stageEl} id="webgl-stage" class:is-exploring={exploreMode} aria-hidden={!exploreMode}>
  <div bind:this={canvasHost} class="three-canvas-host"></div>
  <div bind:this={labelLayer} class="model-label-layer"></div>
</div>
