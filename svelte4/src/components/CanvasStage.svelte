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
    GridHelper,
    Group,
    HemisphereLight,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Raycaster,
    Scene,
    Vector2,
    Vector3,
    WebGLRenderer
  } from "three";
  import { MACRO_OFFSETS, type MacroKey } from "../data/layers";
  import type { LayerStat, ParsedModel } from "../types";

  export let model: ParsedModel;
  export let selectedLayer = "";
  export let selectedMacro: MacroKey | "" = "";
  export let exploreMode = false;

  const dispatch = createEventDispatcher<{ layerselect: string }>();

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
  let controls: { enabled: boolean; update: () => void; dispose: () => void } | null = null;
  let animationFrame = 0;
  let scrollTrigger: ScrollTrigger | null = null;
  let layerRecords: LayerRecord[] = [];
  let scrollProgress = 0;
  let destroyed = false;

  gsap.registerPlugin(ScrollTrigger);

  function smoothstep(edge0: number, edge1: number, value: number): number {
    const x = Math.max(0, Math.min(1, (value - edge0) / Math.max(edge1 - edge0, 0.0001)));
    return x * x * (3 - 2 * x);
  }

  function focusMacroFor(progress: number): MacroKey | "" {
    if (selectedMacro) return selectedMacro;
    if (progress < 0.18) return "";
    if (progress < 0.33) return "roof";
    if (progress < 0.48) return "walls";
    if (progress < 0.62) return "structure";
    if (progress < 0.76) return "floor";
    if (progress < 0.9) return "foundation";
    return "";
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
    const explode = smoothstep(0.16, 0.52, scrollProgress) * (1 - smoothstep(0.82, 0.98, scrollProgress) * 0.45);
    const xray = smoothstep(0.52, 0.74, scrollProgress);
    const focusMacro = focusMacroFor(scrollProgress);

    for (const record of layerRecords) {
      const selected = selectedLayer === record.layer.key;
      const macroFocused = !focusMacro || record.layer.macro === focusMacro;
      const opacity = selected ? 1 : macroFocused ? 0.9 : 0.16 + xray * 0.08;
      const edgeOpacity = selected ? 0.62 : macroFocused ? 0.2 : 0.06;
      const dim = selectedLayer && !selected ? 0.36 : 1;

      record.mesh.position.copy(record.macroOffset).multiplyScalar(explode);
      record.edges.position.copy(record.mesh.position);
      record.mesh.material.opacity = opacity * dim;
      record.mesh.material.emissive.set(selected ? "#2a1a0d" : "#000000");
      record.edges.material.opacity = edgeOpacity;
    }

    modelGroup.rotation.x = -0.18 + scrollProgress * 0.28;
    modelGroup.rotation.y = -0.68 + scrollProgress * 1.18;
    modelGroup.rotation.z = -0.02 + Math.sin(scrollProgress * Math.PI) * 0.05;
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

    scene.add(new AmbientLight("#7d8d87", 1.3));
    scene.add(new HemisphereLight("#d6efe3", "#241913", 1.1));
    const key = new DirectionalLight("#fff4dc", 2.2);
    key.position.set(8, 12, 7);
    scene.add(key);
    const rim = new DirectionalLight("#7ed6c6", 1.4);
    rim.position.set(-7, 5, -9);
    scene.add(rim);

    modelGroup = new Group();
    scene.add(modelGroup);

    layerRecords = model.layers.map(createLayerRecord);
    for (const record of layerRecords) {
      modelGroup.add(record.mesh);
      modelGroup.add(record.edges);
    }

    const gridSize = Math.max(model.bounds.size[0], model.bounds.size[2], 12) * 1.7;
    const grid = new GridHelper(gridSize, 28, "#31524b", "#17312d");
    grid.position.y = -model.bounds.size[1] * 0.52;
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    scene.add(grid);

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
        applyVisualState();
      }
    });

    const cameraTarget = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z
    };
    gsap.to(cameraTarget, {
      x: model.bounds.fitRadius * -0.48,
      y: model.bounds.fitRadius * 0.58,
      z: model.bounds.fitRadius * 0.92,
      ease: "none",
      scrollTrigger: {
        trigger: "#story-scroll",
        start: "top top",
        end: "bottom bottom",
        scrub: true
      },
      onUpdate: () => {
        if (!exploreMode) {
          camera.position.set(cameraTarget.x, cameraTarget.y, cameraTarget.z);
          camera.lookAt(0, 0, 0);
        }
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
    scrollTrigger?.kill();
    ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    layerRecords.forEach((record) => {
      record.mesh.geometry.dispose();
      record.mesh.material.dispose();
      record.edges.geometry.dispose();
      record.edges.material.dispose();
    });
    renderer?.dispose();
    renderer?.domElement.remove();
  });
</script>

<div class="canvas-stage" bind:this={host} class:is-exploring={exploreMode}></div>
