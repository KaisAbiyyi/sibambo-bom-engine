<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import { gsap } from "gsap";
  import { ScrollTrigger } from "gsap/ScrollTrigger";
  import {
    AmbientLight,
    BufferGeometry,
    Color,
    DirectionalLight,
    EdgesGeometry,
    Float32BufferAttribute,
    Group,
    HemisphereLight,
    LineBasicMaterial,
    LineSegments,
    MeshBasicMaterial,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Raycaster,
    Scene,
    SpotLight,
    TorusGeometry,
    Vector2,
    Vector3,
    WebGLRenderer
  } from "three";
  import { MACRO_LABELS, MACRO_OFFSETS, type MacroKey } from "../data/layers";
  import { FOCUS_BEATS } from "../data/beats";
  import type { LayerStat, ParsedModel } from "../types";

  export let model: ParsedModel;
  export let selectedLayer = "";
  export let selectedMacro: MacroKey | "" = "";
  export let exploreMode = false;

  const dispatch = createEventDispatcher<{ layerselect: string; activebeat: number }>();

  type LayerRecord = {
    layer: LayerStat;
    mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
    edges: LineSegments<EdgesGeometry, LineBasicMaterial>;
    baseOpacity: number;
    macroOffset: Vector3;
  };

  let host: HTMLDivElement;
  let renderer: WebGLRenderer;
  let camera: PerspectiveCamera;
  let scene: Scene;
  let modelGroup: Group;
  let focusHalo: Mesh<TorusGeometry, MeshBasicMaterial>;
  let focusNeedle: LineSegments<BufferGeometry, LineBasicMaterial>;
  let spotlight: SpotLight;
  let spotlightTarget: Group;
  let controls: { enabled: boolean; update: () => void; dispose: () => void } | null = null;
  let animationFrame = 0;
  let scrollTrigger: ScrollTrigger | null = null;
  let cameraTween: gsap.core.Tween | null = null;
  let layerRecords: LayerRecord[] = [];
  let scrollProgress = 0;
  let destroyed = false;
  let reticleX = 50;
  let reticleY = 50;
  let reticleLabel = "";
  let reticleMeta = "";
  let reticleColor = "#f2efe5";
  let reticleVisible = false;
  $: reticleSide = reticleX > 68 ? "left" : "right";

  gsap.registerPlugin(ScrollTrigger);

  function smoothstep(edge0: number, edge1: number, value: number): number {
    const x = Math.max(0, Math.min(1, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
    return x * x * (3 - 2 * x);
  }

  function beatIndexFor(progress: number): number {
    return Math.min(FOCUS_BEATS.length - 1, Math.max(0, Math.round(progress * (FOCUS_BEATS.length - 1))));
  }

  function focusMacroFor(progress: number): MacroKey | "" {
    if (selectedMacro) return selectedMacro;
    return FOCUS_BEATS[beatIndexFor(progress)]?.macro ?? "";
  }

  function focusLayerFor(progress: number): string {
    return selectedLayer || FOCUS_BEATS[beatIndexFor(progress)]?.layerKey || "";
  }

  function centeredPoint(point: [number, number, number]): Vector3 {
    return new Vector3(
      point[0] - model.bounds.center[0],
      point[1] - model.bounds.center[1],
      point[2] - model.bounds.center[2]
    );
  }

  function focusCenterFor(index: number): Vector3 {
    const beat = FOCUS_BEATS[index] ?? FOCUS_BEATS[0];
    const layer = beat.layerKey ? model.layers.find((item) => item.key === beat.layerKey) : null;
    if (layer) return centeredPoint(layer.bounds.center);
    if (beat.macro) {
      const macro = model.macros.find((item) => item.key === beat.macro);
      if (macro) return centeredPoint(macro.bounds.center);
    }
    return new Vector3(0, 0, 0);
  }

  function worldFocus(localPoint: Vector3): Vector3 {
    if (!modelGroup) return localPoint.clone();
    modelGroup.updateMatrixWorld();
    return modelGroup.localToWorld(localPoint.clone());
  }

  function activeBoundsFor(index: number) {
    const beat = FOCUS_BEATS[index] ?? FOCUS_BEATS[0];
    if (beat.layerKey) return model.layers.find((item) => item.key === beat.layerKey)?.bounds ?? model.bounds;
    if (beat.macro) return model.macros.find((item) => item.key === beat.macro)?.bounds ?? model.bounds;
    return model.bounds;
  }

  function shotFor(index: number): { position: Vector3; target: Vector3; fov: number } {
    const beat = FOCUS_BEATS[index] ?? FOCUS_BEATS[0];
    const target = worldFocus(focusCenterFor(index));
    const r = model.bounds.fitRadius;
    const bounds = activeBoundsFor(index);
    const focusRadius = Math.max(bounds.fitRadius, 0.28);
    const closeDistance = Math.min(Math.max(focusRadius * 3.7, r * 0.18), r * 0.58);
    const fullDistance = r * 1.16;
    const vectors: Record<string, [number, number, number, number]> = {
      hero: [0.82, 0.34, 0.76, 35],
      roof: [0.16, 0.5, 0.22, 26],
      openings: [-0.28, 0.1, 0.32, 24],
      wall: [0.5, 0.12, 0.03, 26],
      floor: [-0.23, 0.12, 0.34, 25],
      foundation: [0.2, -0.28, 0.34, 25],
      orbit: [0.76, 0.34, -0.66, 34]
    };
    const offset = vectors[beat.camera] ?? vectors.hero;
    const distance = beat.layerKey || beat.macro ? closeDistance : fullDistance;
    const direction = new Vector3(offset[0], offset[1], offset[2]).normalize();
    return {
      position: target.clone().add(direction.multiplyScalar(distance)),
      target,
      fov: offset[3]
    };
  }

  function updateReticle(focusWorld: Vector3, focusLayer: string, focusMacro: MacroKey | ""): void {
    if (!camera || !host || !focusLayer) {
      reticleVisible = false;
      return;
    }
    const projection = focusWorld.clone().project(camera);
    reticleVisible = projection.z > -1 && projection.z < 1;
    reticleX = Math.max(7, Math.min(93, (projection.x * 0.5 + 0.5) * 100));
    reticleY = Math.max(10, Math.min(86, (-projection.y * 0.5 + 0.5) * 100));
    const layer = model.layers.find((item) => item.key === focusLayer);
    reticleLabel = layer?.label ?? (focusMacro ? MACRO_LABELS[focusMacro] : "Full model");
    reticleMeta = layer ? `${layer.meshCount.toLocaleString("en-US")} faces / ${layer.areaM2.toFixed(1)} m2` : "";
    reticleColor = layer?.color ?? "#f2efe5";
  }

  function applyCameraState(progress: number): void {
    if (!camera || exploreMode) return;
    const scaled = progress * (FOCUS_BEATS.length - 1);
    const fromIndex = Math.min(FOCUS_BEATS.length - 1, Math.floor(scaled));
    const toIndex = Math.min(FOCUS_BEATS.length - 1, fromIndex + 1);
    const local = smoothstep(0, 1, scaled - fromIndex);
    const from = shotFor(fromIndex);
    const to = shotFor(toIndex);
    const position = from.position.lerp(to.position, local);
    const target = from.target.lerp(to.target, local);
    camera.position.copy(position);
    camera.fov = from.fov + (to.fov - from.fov) * local;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }

  function centeredPositions(layer: LayerStat): Float32Array {
    const out = new Float32Array(layer.positions.length);
    const [cx, cy, cz] = model.bounds.center;
    for (let index = 0; index < layer.positions.length; index += 3) {
      out[index] = layer.positions[index] - cx;
      out[index + 1] = layer.positions[index + 1] - cy;
      out[index + 2] = layer.positions[index + 2] - cz;
    }
    return out;
  }

  function createLayerRecord(layer: LayerStat): LayerRecord {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(centeredPositions(layer), 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new MeshStandardMaterial({
      color: new Color(layer.color),
      roughness: 0.72,
      metalness: 0.08,
      transparent: true,
      opacity: 0.92
    });
    const mesh = new Mesh(geometry, material);
    mesh.userData.layerKey = layer.key;

    const edgeMaterial = new LineBasicMaterial({
      color: new Color("#d8e2df"),
      transparent: true,
      opacity: 0.12
    });
    const edges = new LineSegments(new EdgesGeometry(geometry, 24), edgeMaterial);

    const offset = MACRO_OFFSETS[layer.macro] ?? [0, 0, 0];
    return {
      layer,
      mesh,
      edges,
      baseOpacity: 0.88,
      macroOffset: new Vector3(offset[0], offset[1], offset[2])
    };
  }

  function applyVisualState(): void {
    const focusMacro = focusMacroFor(scrollProgress);
    const focusLayer = focusLayerFor(scrollProgress);
    const beatIndex = beatIndexFor(scrollProgress);
    const beat = FOCUS_BEATS[beatIndex] ?? FOCUS_BEATS[0];
    const directedFocus = Boolean(focusLayer);
    const releaseView = beat.id === "release" && !selectedLayer;
    const explode = releaseView ? 0.28 : directedFocus ? 0.035 : 0;
    modelGroup.rotation.x = -0.08;
    modelGroup.rotation.y = -0.42;
    modelGroup.rotation.z = -0.015;
    modelGroup.updateMatrixWorld();
    const focusPoint = focusLayer
      ? centeredPoint((model.layers.find((layer) => layer.key === focusLayer)?.bounds.center ?? model.bounds.center) as [number, number, number])
      : focusCenterFor(beatIndex);
    const focusWorld = worldFocus(focusPoint);

    for (const record of layerRecords) {
      const selected = focusLayer === record.layer.key;
      const macroFocused = !focusMacro || record.layer.macro === focusMacro;
      const opacity = selected ? 1 : directedFocus ? (macroFocused ? 0.075 : 0.018) : macroFocused ? 0.5 : 0.18;
      const edgeOpacity = selected ? 0.92 : directedFocus ? (macroFocused ? 0.035 : 0.006) : 0.08;

      record.mesh.position.copy(record.macroOffset).multiplyScalar(selected ? explode * 0.12 : explode);
      record.edges.position.copy(record.mesh.position);
      record.mesh.material.opacity = opacity;
      record.mesh.material.emissive.set(selected ? record.layer.color : "#000000");
      record.mesh.material.emissiveIntensity = selected ? 0.72 : 0;
      record.mesh.material.depthWrite = selected || !directedFocus;
      record.mesh.renderOrder = selected ? 4 : macroFocused ? 2 : 1;
      record.edges.material.opacity = edgeOpacity;
      record.edges.visible = selected || !directedFocus || (macroFocused && !focusLayer);
    }

    applyCameraState(scrollProgress);
    focusHalo?.position.copy(focusWorld);
    focusHalo?.lookAt(camera.position);
    if (focusHalo) {
      const layer = model.layers.find((item) => item.key === focusLayer);
      focusHalo.material.color.set(layer?.color ?? model.macros.find((item) => item.key === focusMacro)?.color ?? "#d18a52");
      focusHalo.material.opacity = directedFocus ? 0.98 : 0;
      const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.08;
      focusHalo.scale.setScalar(directedFocus ? pulse * 0.72 : 0.1);
    }
    if (focusNeedle) focusNeedle.position.copy(focusWorld);
    if (spotlight && spotlightTarget) {
      spotlight.position.copy(focusWorld).add(new Vector3(0, model.bounds.size[1] * 0.78, model.bounds.fitRadius * 0.18));
      spotlightTarget.position.copy(focusWorld);
      const layer = model.layers.find((item) => item.key === focusLayer);
      spotlight.color.set(layer?.color ?? model.macros.find((item) => item.key === focusMacro)?.color ?? "#d18a52");
    }
    updateReticle(focusWorld, focusLayer, focusMacro);
  }

  function resize(): void {
    if (!host || !renderer || !camera) return;
    const rect = host.getBoundingClientRect();
    renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
    camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
    camera.updateProjectionMatrix();
  }

  function pickLayer(event: PointerEvent): void {
    if (!renderer || !camera) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(layerRecords.map((record) => record.mesh), false)[0];
    if (hit?.object.userData.layerKey) {
      dispatch("layerselect", hit.object.userData.layerKey);
    }
  }

  async function init(): Promise<void> {
    scene = new Scene();
    scene.background = null;

    const rect = host.getBoundingClientRect();
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
    renderer.setClearColor(0x07100f, 0);
    host.appendChild(renderer.domElement);

    camera = new PerspectiveCamera(38, Math.max(rect.width, 1) / Math.max(rect.height, 1), 0.1, 1000);
    camera.position.set(model.bounds.fitRadius * 0.72, model.bounds.fitRadius * 0.46, model.bounds.fitRadius * 0.82);
    camera.lookAt(0, 0, 0);

    scene.add(new AmbientLight("#18201e", 0.62));
    scene.add(new HemisphereLight("#ede6d0", "#030303", 0.78));
    const key = new DirectionalLight("#fff1cf", 1.55);
    key.position.set(8, 12, 7);
    scene.add(key);
    const rim = new DirectionalLight("#9ff1dc", 1.7);
    rim.position.set(-7, 5, -9);
    scene.add(rim);

    spotlightTarget = new Group();
    scene.add(spotlightTarget);
    spotlight = new SpotLight("#d18a52", 260, model.bounds.fitRadius * 2.4, Math.PI * 0.105, 0.72, 1.25);
    spotlight.target = spotlightTarget;
    scene.add(spotlight);
    scene.add(spotlight.target);

    modelGroup = new Group();
    scene.add(modelGroup);

    layerRecords = model.layers.map(createLayerRecord);
    for (const record of layerRecords) {
      modelGroup.add(record.mesh);
      modelGroup.add(record.edges);
    }

    focusHalo = new Mesh(
      new TorusGeometry(Math.max(model.bounds.size[0], model.bounds.size[2]) * 0.08, 0.018, 10, 96),
      new MeshBasicMaterial({ color: "#d18a52", transparent: true, opacity: 0.6, depthTest: false })
    );
    focusHalo.renderOrder = 10;
    scene.add(focusHalo);

    const needleGeometry = new BufferGeometry();
    needleGeometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, -model.bounds.size[1] * 0.55, 0, 0, model.bounds.size[1] * 0.75, 0], 3)
    );
    focusNeedle = new LineSegments(
      needleGeometry,
      new LineBasicMaterial({ color: "#e9efe9", transparent: true, opacity: 0.22, depthTest: false })
    );
    focusNeedle.renderOrder = 9;
    scene.add(focusNeedle);

    const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = exploreMode;
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    scrollTrigger = ScrollTrigger.create({
      trigger: "#story-scroll",
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => {
        scrollProgress = self.progress;
        dispatch("activebeat", beatIndexFor(scrollProgress));
        applyVisualState();
      }
    });

    applyVisualState();
    window.addEventListener("resize", resize);
    renderer.domElement.addEventListener("pointerdown", pickLayer);

    const render = () => {
      if (destroyed) return;
      controls?.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();
  }

  $: if (controls) controls.enabled = exploreMode;
  $: if (layerRecords.length) applyVisualState();

  onMount(() => {
    void init();
  });

  onDestroy(() => {
    destroyed = true;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", resize);
    renderer?.domElement.removeEventListener("pointerdown", pickLayer);
    controls?.dispose();
    cameraTween?.kill();
    scrollTrigger?.kill();
    layerRecords.forEach((record) => {
      record.mesh.geometry.dispose();
      record.mesh.material.dispose();
      record.edges.geometry.dispose();
      record.edges.material.dispose();
    });
    focusHalo?.geometry.dispose();
    focusHalo?.material.dispose();
    focusNeedle?.geometry.dispose();
    focusNeedle?.material.dispose();
    renderer?.dispose();
    renderer?.domElement.remove();
  });
</script>

<div class="canvas-stage" bind:this={host} class:is-exploring={exploreMode}>
  {#if reticleVisible}
    <div
      class="focus-reticle"
      class:focus-reticle--left={reticleSide === "left"}
      style={`--reticle-x:${reticleX}%;--reticle-y:${reticleY}%;--reticle:${reticleColor}`}
      aria-hidden="true"
    >
      <span>{reticleLabel}</span>
      <em>{reticleMeta}</em>
    </div>
  {/if}
</div>
