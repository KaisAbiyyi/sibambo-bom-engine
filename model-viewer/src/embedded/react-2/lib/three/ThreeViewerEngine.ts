import * as THREE from "three";
import { detectVisGroup, layerInfoFromRegistry, LAYER_META, resolveVisGroup } from "../../features/viewer/layerMeta";
import type {
  Axis,
  BomEntity,
  BomFace,
  BomMaterial,
  BomModel,
  BomVertex,
  CameraMode,
  LayerInfo,
  RenderMode,
  SelectionInfo,
  TooltipInfo,
  TreeNode,
  ViewerStats
} from "../../features/viewer/types";

type StoryLayerState = "active" | "context" | "hidden" | "final";
type CerucukRenderMode = "original" | "proxy";

interface RegistryEntry {
  label: string;
  color: string;
  order: number;
  visible: boolean;
  meshes: THREE.Mesh[];
  group: THREE.Group;
  storyState?: StoryLayerState;
  storyEdges?: boolean;
  explodeOffset?: number;
}

interface StoryFocusOptions {
  activeEdges?: boolean;
  finalMode?: boolean;
  hiddenKeys?: string[];
  suppressKeys?: string[];
}

interface StoryGroups {
  roofMeshes: THREE.Mesh[];
  wallMeshes: THREE.Mesh[];
  floorMeshes: THREE.Mesh[];
  frameMeshes: THREE.Mesh[];
  foundationMeshes: THREE.Mesh[];
  cerucukMeshes: THREE.Mesh[];
  finalMeshes: THREE.Mesh[];
}

export interface ModelLoadProgress {
  phase: "fetch" | "parse" | "build" | "finalize" | "ready";
  current?: number;
  total?: number;
  message?: string;
}

interface ProgressiveLoadOptions {
  chunkSize?: number;
  frameBudgetMs?: number;
  onProgress?: (progress: ModelLoadProgress) => void;
}

interface ProgressiveBuildFrame {
  entities: Array<BomEntity | BomFace>;
  index: number;
  treeNodes: TreeNode[];
  parentVisGroup: string | null;
}

interface EngineCallbacks {
  onLayers?: (layers: LayerInfo[]) => void;
  onTree?: (tree: TreeNode[]) => void;
  onMaterials?: (materials: Array<{ name: string; color: string; reflectance?: number | string }>) => void;
  onStats?: (stats: ViewerStats) => void;
  onSelect?: (selection: SelectionInfo | null) => void;
  onTooltip?: (tooltip: TooltipInfo | null) => void;
  onCutChange?: (axis: Axis, state: { enabled: boolean; value: number; label: string }) => void;
}

const AXES: Axis[] = ["x", "y", "z"];
const ROOF_STORY_KEYS = ["perabung", "atap_spandek", "roof_slope", "listplank"];
const WALL_STORY_KEYS = ["wall_x_pos", "wall_x_neg", "wall_y_pos", "wall_y_neg", "door", "window"];
const FLOOR_STORY_KEYS = ["keramik_lantai", "cor_lantai"];
const FRAME_STORY_KEYS = ["balok", "kolom", "structure"];
const FOUNDATION_STORY_KEYS = ["urugan", "sloof", "pondasi_batu", "foundation"];
const STORY_UPDATE_CHUNK_SIZE = 520;
const STORY_SYNC_MESH_LIMIT = 360;
const CERUCUK_RENDER_MODE: CerucukRenderMode = "original";

export class ThreeViewerEngine {
  private canvas: HTMLCanvasElement;
  private callbacks: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private gridHelper: THREE.GridHelper;
  private groundMesh: THREE.Mesh;
  private sceneBox = new THREE.Box3();
  private target = new THREE.Vector3(0, 1.5, 0);
  private spherical = { theta: 0.8, phi: 0.6, r: 16 };
  private camAnim: {
    active: boolean;
    version: number;
    startTheta: number; startPhi: number; startR: number; startTarget: THREE.Vector3;
    endTheta: number; endPhi: number; endR: number; endTarget: THREE.Vector3;
    startTime: number; duration: number;
  } | null = null;
  private heroDriftActive = false;
  private frameId = 0;
  private renderDirty = true;
  private lastStoryIdleRender = 0;
  private lastStoryDriftRender = 0;
  private storyIdleRenderInterval = 500;
  private storyDriftRenderInterval = 50;
  private isDragging = false;
  private isRMB = false;
  private previousMouse = { x: 0, y: 0 };
  private dragDistance = 0;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private pickTargets: THREE.Mesh[] = [];
  private componentMap = new Map<string, THREE.Mesh>();
  private layerRegistry: Record<string, RegistryEntry> = {};
  private originalColors = new WeakMap<THREE.Material, THREE.Color>();
  private hoveredObj: THREE.Mesh | null = null;
  private selectedObj: THREE.Mesh | null = null;
  private currentMode: RenderMode = "shaded";
  private presentationMode: "dark" | "paper" = "dark";
  private clipPlanes: Record<Axis, THREE.Plane> = {
    x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 50),
    y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 50),
    z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 50)
  };
  private cutEnabled: Record<Axis, boolean> = { x: false, y: false, z: false };
  private cutValues: Record<Axis, number> = { x: 1, y: 1, z: 1 };

  private storyMaterials = {
    context: new THREE.MeshBasicMaterial({ 
      color: 0x4e5660,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide
    }),
    ghost: new THREE.MeshBasicMaterial({ 
      color: 0xdbe4ec, 
      transparent: true, 
      opacity: 0.08, 
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide
    }),
    foundationContext: new THREE.MeshBasicMaterial({
      color: 0x665a48,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide
    }),
    cerucukActive: new THREE.MeshPhongMaterial({
      color: 0xb8874a,
      shininess: 16,
      specular: new THREE.Color(0x3b2c1c),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    })
  };
  private activeMaterialByCategory = new Map<string, THREE.MeshPhongMaterial>();
  private storyGroups: StoryGroups = {
    roofMeshes: [],
    wallMeshes: [],
    floorMeshes: [],
    frameMeshes: [],
    foundationMeshes: [],
    cerucukMeshes: [],
    finalMeshes: []
  };
  private cerucukOriginalMeshes: THREE.Mesh[] = [];
  private cerucukProxyGroup: THREE.Group | null = null;
  private storyApplyToken = 0;
  private pendingStoryFrames: number[] = [];

  private edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xc8a96a,
    transparent: true,
    opacity: 0.62,
    depthTest: true,
    depthWrite: false
  });

  private storyTransitionVersion = 0;
  private cameraTweenVersion = 0;
  private explosionTweenVersion = 0;
  private exploreAnim: {
    active: boolean,
    version: number,
    startExp: number,
    endExp: number,
    startTime: number,
    duration: number
  } | null = null;
  private currentExplodeAmount = 0;
  private interactionMode: "viewer" | "story" = "viewer";
  private isLoadingModel = false;
  private isLoadedModel = false;
  private isDisposed = false;
  private loadVersion = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x0b0f14);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0b0f14, 30, 90);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    this.gridHelper = new THREE.GridHelper(20, 20, 0x263241, 0x1f2937);
    this.scene.add(this.gridHelper);
    this.groundMesh = this.createGround();
    this.scene.add(this.groundMesh);
    this.setupLights();
    this.bindEvents();
    this.resize();
    this.animate();
  }

  dispose() {
    this.isDisposed = true;
    this.isLoadingModel = false;
    this.loadVersion += 1;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener("resize", this.resize);
    this.canvas.removeEventListener("contextmenu", this.preventContext);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.clearScene();
    this.edgeMaterial.dispose();
    this.storyMaterials.context.dispose();
    this.storyMaterials.ghost.dispose();
    this.storyMaterials.foundationContext.dispose();
    this.storyMaterials.cerucukActive.dispose();
    this.activeMaterialByCategory.forEach((material) => material.dispose());
    this.renderer.dispose();
  }

  loadModel(data: BomModel) {
    this.isLoadingModel = false;
    this.isLoadedModel = false;
    this.loadVersion += 1;
    this.clearScene();
    const entities = data.entities ?? [];
    const hierarchy: TreeNode[] = [];
    this.walkEntities(entities, hierarchy, null);
    if (!this.sceneBox.isEmpty()) {
      this.fitGridToModel(this.sceneBox);
      const center = this.sceneBox.getCenter(new THREE.Vector3());
      const size = this.sceneBox.getSize(new THREE.Vector3());
      this.target.copy(center);
      const footprint = Math.max(size.x, size.z);
      this.spherical.r = Math.max(footprint * 1.8, size.y * 3, 8);
      this.spherical.theta = 0.75;
      this.spherical.phi = 0.62;
      this.updateCamera();
    }
    this.callbacks.onTree?.(hierarchy);
    this.callbacks.onLayers?.(this.getLayerInfo());
    this.callbacks.onMaterials?.(normalizeMaterials(data.materials));
    this.callbacks.onStats?.(this.computeStats());
    this.applyRenderMode(this.currentMode);
    this.isLoadedModel = true;
  }

  async loadModelProgressive(data: BomModel, options: ProgressiveLoadOptions = {}) {
    if (this.isLoadingModel || this.isLoadedModel) {
      options.onProgress?.({ phase: "ready", message: "Model already prepared" });
      return;
    }

    this.isLoadingModel = true;
    const version = (this.loadVersion += 1);
    const chunkSize = options.chunkSize ?? (this.interactionMode === "story" ? 700 : 900);
    const frameBudgetMs = options.frameBudgetMs ?? (this.interactionMode === "story" ? 11 : 14);

    this.devLog("model load started", { mode: this.interactionMode, chunkSize, frameBudgetMs });
    console.time("model:build");
    this.clearScene();
    options.onProgress?.({ phase: "build", current: 0, message: "Preparing model layers" });
    await this.nextFrame();
    if (!this.isCurrentLoad(version)) return;

    const entities = data.entities ?? [];
    const hierarchy: TreeNode[] = [];
    const builtCount = await this.buildEntitiesProgressively(entities, hierarchy, null, {
      chunkSize,
      frameBudgetMs,
      version,
      onProgress: options.onProgress
    });

    if (!this.isCurrentLoad(version)) return;

    options.onProgress?.({ phase: "finalize", current: builtCount, message: "Fitting camera and layers" });
    this.finalizeLoadedModel(data, hierarchy, false);
    this.isLoadingModel = false;
    this.isLoadedModel = true;
    console.timeEnd("model:build");
    console.time("model:firstRender");
    this.invalidateRender();
    await this.nextFrame();
    console.timeEnd("model:firstRender");
    options.onProgress?.({ phase: "ready", current: builtCount, message: "Model ready" });
    this.devLog("model load ready", {
      meshes: this.pickTargets.length,
      edgeHelpers: this.countEdgeHelpers()
    });

    this.scheduleIdle(() => {
      if (version !== this.loadVersion) return;
      this.callbacks.onStats?.(this.computeStats());
    });
  }

  clearScene() {
    const groups = Object.values(this.layerRegistry).map((entry) => entry.group);
    for (const mesh of this.pickTargets) {
      mesh.children.forEach((child) => {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
        }
      });
      mesh.geometry.dispose();
      const materials = new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
      if (mesh.userData.originalMaterial) materials.add(mesh.userData.originalMaterial as THREE.Material);
      materials.forEach((material) => {
        if (material !== this.storyMaterials.context && material !== this.storyMaterials.ghost) material.dispose();
      });
      mesh.parent?.remove(mesh);
    }
    groups.forEach((group) => this.scene.remove(group));
    this.pickTargets = [];
    this.componentMap.clear();
    this.layerRegistry = {};
    this.storyGroups = {
      roofMeshes: [],
      wallMeshes: [],
      floorMeshes: [],
      frameMeshes: [],
      foundationMeshes: [],
      cerucukMeshes: [],
      finalMeshes: []
    };
    this.cerucukOriginalMeshes = [];
    if (this.cerucukProxyGroup?.parent) this.cerucukProxyGroup.parent.remove(this.cerucukProxyGroup);
    this.cerucukProxyGroup = null;
    this.cancelPendingStoryUpdates();
    this.sceneBox = new THREE.Box3();
    this.hoveredObj = null;
    this.selectedObj = null;
    this.isLoadedModel = false;
    this.callbacks.onSelect?.(null);
    this.callbacks.onTooltip?.(null);
    this.invalidateRender();
  }

  private finalizeLoadedModel(data: BomModel, hierarchy: TreeNode[], computeStatsNow: boolean) {
    if (!this.sceneBox.isEmpty()) {
      this.fitGridToModel(this.sceneBox);
      const center = this.sceneBox.getCenter(new THREE.Vector3());
      const size = this.sceneBox.getSize(new THREE.Vector3());
      this.target.copy(center);
      const footprint = Math.max(size.x, size.z);
      this.spherical.r = Math.max(footprint * 1.8, size.y * 3, 8);
      this.spherical.theta = 0.75;
      this.spherical.phi = 0.62;
      this.updateCamera();
    }
    this.callbacks.onTree?.(hierarchy);
    this.callbacks.onLayers?.(this.getLayerInfo());
    this.callbacks.onMaterials?.(normalizeMaterials(data.materials));
    if (computeStatsNow) this.callbacks.onStats?.(this.computeStats());
    if (this.currentMode !== "shaded") this.applyRenderMode(this.currentMode);
    if (this.interactionMode === "story") {
      this.buildStoryGroupsOnce();
      this.applyStoryRenderSafety();
      this.debugStoryMaterialSafety();
    }
    this.invalidateRender();
  }

  setRenderMode(mode: RenderMode) {
    if (this.interactionMode === "story") this.restoreViewerMaterials();
    this.currentMode = mode;
    this.applyRenderMode(mode);
    this.invalidateRender();
  }

  setPresentationMode(mode: "dark" | "paper") {
    if (this.presentationMode === mode) return;
    this.presentationMode = mode;
    
    if (mode === "paper") {
      this.renderer.setClearColor(0xefe6d6);
      this.scene.fog = new THREE.Fog(0xefe6d6, 30, 120);
      this.scene.remove(this.gridHelper);
      const divisions = this.gridHelper.userData?.divisions || 20;
      const size = this.gridHelper.userData?.size || 20;
      this.gridHelper = new THREE.GridHelper(size, divisions, 0x1f1a14, 0x1f1a14);
      (this.gridHelper.material as THREE.Material).opacity = 0.08;
      (this.gridHelper.material as THREE.Material).transparent = true;
      this.scene.add(this.gridHelper);
      (this.groundMesh.material as THREE.MeshStandardMaterial).color.setHex(0xf6efe3);
    } else {
      this.restoreViewerMaterials();
      this.renderer.setClearColor(0x0a0e13);
      this.scene.fog = new THREE.Fog(0x06080b, 32, 92);
      this.scene.remove(this.gridHelper);
      const divisions = this.gridHelper.userData?.divisions || 20;
      const size = this.gridHelper.userData?.size || 20;
      this.gridHelper = new THREE.GridHelper(size, divisions, 0x2a2f36, 0x191f27);
      this.scene.add(this.gridHelper);
      (this.groundMesh.material as THREE.MeshStandardMaterial).color.setHex(0x0a0e13);
    }
    // Re-apply current mode to refresh materials
    this.applyRenderMode(this.currentMode);
    this.invalidateRender();
  }

  setCamera(mode: CameraMode) {
    if (mode === "persp") {
      this.spherical = { theta: 0.8, phi: 0.6, r: this.spherical.r };
    }
    if (mode === "top") {
      this.spherical.phi = 0.02;
      this.spherical.theta = 0;
    }
    if (mode === "front") {
      this.spherical.theta = 0;
      this.spherical.phi = Math.PI / 2;
    }
    if (mode === "side") {
      this.spherical.theta = Math.PI / 2;
      this.spherical.phi = Math.PI / 2;
    }
    this.updateCamera();
    this.invalidateRender();
  }

  setInteractionMode(mode: "viewer" | "story") {
    if (this.interactionMode === mode) return;
    this.interactionMode = mode;
    this.callbacks.onTooltip?.(null);
    if (mode === "story") {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
      this.renderer.shadowMap.enabled = false;
      this.applyStoryRenderSafety();
    } else {
      this.restoreViewerMaterials();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.applyViewerShadowDefaults();
    }
    this.resize();
    this.invalidateRender();
  }

  resetCamera() {
    const center = this.sceneBox.isEmpty() ? new THREE.Vector3(0, 1.5, 0) : this.sceneBox.getCenter(new THREE.Vector3());
    const size = this.sceneBox.isEmpty() ? new THREE.Vector3(8, 4, 8) : this.sceneBox.getSize(new THREE.Vector3());
    this.target.copy(center);
    this.spherical = { theta: 0.8, phi: 0.6, r: Math.max(Math.max(size.x, size.z) * 1.8, size.y * 3, 8) };
    this.updateCamera();
    this.invalidateRender();
  }

  setLayerVisible(key: string, visible: boolean) {
    const entry = this.layerRegistry[key];
    if (!entry) return;
    entry.visible = visible;
    entry.group.visible = visible;
    this.callbacks.onLayers?.(this.getLayerInfo());
    this.invalidateRender();
  }

  setAllLayers(visible: boolean) {
    Object.keys(this.layerRegistry).forEach((key) => this.setLayerVisible(key, visible));
  }

  focusNode(id: string) {
    const mesh = this.componentMap.get(id);
    if (!mesh) return;
    this.selectMesh(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    this.target.copy(box.getCenter(new THREE.Vector3()));
    this.updateCamera();
    this.invalidateRender();
  }

  setCut(axis: Axis, enabled: boolean, value = this.cutValues[axis]) {
    this.cutEnabled[axis] = enabled;
    this.cutValues[axis] = value;
    this.updateCutPlane(axis, value);
    this.applyClippingToAll();
    this.callbacks.onCutChange?.(axis, {
      enabled,
      value,
      label: enabled ? this.cutLabel(axis) : "off"
    });
  }

  resetCuts() {
    AXES.forEach((axis) => this.setCut(axis, false, 1));
  }

  beginStoryTransition() {
    this.storyTransitionVersion += 1;
    this.cameraTweenVersion += 1;
    this.explosionTweenVersion += 1;
    this.cancelPendingStoryUpdates();
    if (this.camAnim) this.camAnim.active = false;
    if (this.exploreAnim) this.exploreAnim.active = false;
    this.invalidateRender();
    return this.storyTransitionVersion;
  }

  applyStoryFocus(activeKeys: string[], contextKeys?: string[], options: StoryFocusOptions = {}) {
    const token = this.cancelPendingStoryUpdates();
    const startedAt = performance.now();
    const show = new Set(activeKeys);
    const context = new Set(contextKeys || []);
    const hidden = new Set([...(options.hiddenKeys ?? ["notasi_2d", "furniture"]), ...(options.suppressKeys ?? [])]);
    const activeEdges = options.activeEdges ?? true;
    const isCerucukFocus = show.size === 1 && show.has("cerucuk") && !options.finalMode;
    const sectionLabel = options.finalMode ? "final" : isCerucukFocus ? "cerucuk" : Array.from(show).join("+") || "none";
    const changed: Array<{ key: string; entry: RegistryEntry; state: StoryLayerState; edges: boolean }> = [];

    if (isCerucukFocus) {
      this.setCerucukRepresentation(CERUCUK_RENDER_MODE);
    } else {
      this.hideCerucukProxyGroup();
    }
    
    Object.entries(this.layerRegistry).forEach(([key, entry]) => {
      let mode: StoryLayerState = "hidden";
      if (hidden.has(key)) mode = "hidden";
      else if (show.has(key)) mode = options.finalMode ? "final" : "active";
      else if (context.has(key)) mode = "context";

      const edgeState = mode === "active" && activeEdges && key !== "cerucuk" && entry.meshes.length <= 160;
      if (entry.storyState === mode && entry.storyEdges === edgeState) return;
      entry.storyState = mode;
      entry.storyEdges = edgeState;
      changed.push({ key, entry, state: mode, edges: edgeState });
    });

    let updatedMeshes = 0;
    let pendingJobs = 0;
    const finish = () => {
      if (token !== this.storyApplyToken) return;
      this.devLog("story switch", {
        section: sectionLabel,
        ms: Math.round((performance.now() - startedAt) * 10) / 10,
        changedGroups: changed.length,
        updatedMeshes,
        cerucukOriginalCount: this.cerucukOriginalMeshes.length,
        proxyVisible: this.cerucukProxyGroup?.visible ?? false,
        originalVisibleCount: this.countVisibleMeshes(this.cerucukOriginalMeshes)
      });
    };

    changed.forEach((job) => {
      const done = (count: number) => {
        updatedMeshes += count;
        pendingJobs -= 1;
        if (pendingJobs === 0) finish();
      };
      pendingJobs += 1;
      this.updateGroupState(job.key, job.entry, job.state, job.edges, token, done);
    });

    if (pendingJobs === 0) finish();
    this.invalidateRender();
  }

  private updateGroupState(
    key: string,
    entry: RegistryEntry,
    state: StoryLayerState,
    edgeState: boolean,
    token: number,
    done: (updatedCount: number) => void
  ) {
    if (state === "hidden") {
      entry.group.visible = false;
      done(0);
      this.invalidateRender();
      return;
    }

    entry.group.visible = true;
    const meshes = entry.meshes;
    if (meshes.length <= STORY_SYNC_MESH_LIMIT) {
      let updated = 0;
      meshes.forEach((mesh, index) => {
        updated += this.applyMeshState(mesh, key, state, edgeState, index);
      });
      done(updated);
      this.invalidateRender();
      return;
    }

    let cursor = 0;
    let updated = 0;
    const step = () => {
      if (token !== this.storyApplyToken) return;
      const end = Math.min(cursor + STORY_UPDATE_CHUNK_SIZE, meshes.length);
      for (let index = cursor; index < end; index += 1) {
        updated += this.applyMeshState(meshes[index], key, state, edgeState, index);
      }
      cursor = end;
      this.invalidateRender();
      if (cursor < meshes.length) {
        this.pendingStoryFrames.push(requestAnimationFrame(step));
        return;
      }
      done(updated);
    };
    step();
  }

  setHeroDrift(active: boolean) {
    if (this.heroDriftActive === active) return;
    this.heroDriftActive = active;
    this.invalidateRender();
  }

  showAllStoryLayers() {
    this.applyStoryFocus(Object.keys(this.layerRegistry), [], { activeEdges: false });
  }

  applyFinalOverview(activeKeys: string[], hiddenKeys: string[] = []) {
    this.beginStoryTransition();
    this.setExplodedAmount(0);
    this.applyStoryFocus(activeKeys, [], {
      activeEdges: false,
      finalMode: true,
      hiddenKeys,
      suppressKeys: []
    });
  }

  moveStoryCamera(theta: number, phi: number, rFactor: number, targetYBias: number, durationMs = 540) {
    if (this.sceneBox.isEmpty()) return;
    this.cameraTweenVersion += 1;
    const version = this.cameraTweenVersion;
    const center = this.sceneBox.getCenter(new THREE.Vector3());
    const size = this.sceneBox.getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z);
    
    const endTarget = new THREE.Vector3(center.x, center.y + size.y * targetYBias, center.z);
    const endR = Math.max(footprint * rFactor, 4);

    const matchMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (matchMedia.matches) {
      this.target.copy(endTarget);
      this.spherical = { theta, phi, r: endR };
      this.updateCamera();
      if (this.camAnim) this.camAnim.active = false;
      this.invalidateRender();
    } else {
      this.camAnim = {
        active: true,
        version,
        startTheta: this.spherical.theta,
        startPhi: this.spherical.phi,
        startR: this.spherical.r,
        startTarget: this.target.clone(),
        endTheta: theta,
        endPhi: phi,
        endR: endR,
        endTarget,
        startTime: performance.now(),
        duration: durationMs
      };
      this.invalidateRender();
    }
  }

  setExplodedAmount(amount: number) {
    if (Math.abs(this.currentExplodeAmount - amount) < 0.0001) return;
    this.currentExplodeAmount = amount;
    Object.entries(this.layerRegistry).forEach(([key, entry]) => {
      let offset = 0;
      if (key === "Roof" || key.includes("roof") || key.includes("atap") || key.includes("perabung") || key.includes("listplank")) {
        offset = 0.5 * amount; // move up
      } else if (key === "Wall" || key.includes("wall")) {
        offset = 0.2 * amount;
      } else if (key === "Floor" || key.includes("lantai") || key.includes("floor") || key.includes("ceiling")) {
        offset = -0.1 * amount;
      } else if (key === "Foundation" || key.includes("pondasi") || key.includes("cerucuk") || key.includes("urugan")) {
        offset = -0.3 * amount;
      }
      if (entry.explodeOffset === offset) return;
      entry.explodeOffset = offset;
      entry.group.position.set(0, offset, 0);
    });
    this.invalidateRender();
  }

  animateExplodedAmount(target: number, durationMs: number) {
    this.explosionTweenVersion += 1;
    const version = this.explosionTweenVersion;
    const matchMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (matchMedia.matches) {
      this.setExplodedAmount(target);
      if (this.exploreAnim) this.exploreAnim.active = false;
      this.invalidateRender();
    } else {
      this.exploreAnim = {
        active: true,
        version,
        startExp: this.currentExplodeAmount,
        endExp: target,
        startTime: performance.now(),
        duration: durationMs
      };
      this.invalidateRender();
    }
  }

  private setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xf7efe2, 0x151c26, 0.78));
    const sun = new THREE.DirectionalLight(0xfff1d0, 1.05);
    sun.position.set(10, 18, 12);
    sun.castShadow = true;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd0c2a5, 0.24);
    fill.position.set(-8, 8, -10);
    this.scene.add(fill);
  }

  private createGround() {
    const geometry = new THREE.PlaneGeometry(40, 40);
    const material = new THREE.MeshLambertMaterial({ color: 0x101720 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.02;
    mesh.receiveShadow = this.interactionMode !== "story";
    return mesh;
  }

  private bindEvents() {
    window.addEventListener("resize", this.resize);
    this.canvas.addEventListener("contextmenu", this.preventContext);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private preventContext = (event: Event) => event.preventDefault();

  private onPointerDown = (event: PointerEvent) => {
    this.isDragging = true;
    this.isRMB = event.button === 2;
    this.previousMouse = { x: event.clientX, y: event.clientY };
    this.dragDistance = 0;
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.isDragging) {
      const dx = event.clientX - this.previousMouse.x;
      const dy = event.clientY - this.previousMouse.y;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      if (this.isRMB || event.shiftKey) {
        const right = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        this.camera.getWorldDirection(right);
        right.cross(up).normalize();
        const speed = this.spherical.r * 0.0012;
        this.target.addScaledVector(right, -dx * speed);
        this.target.y += dy * speed;
      } else {
        this.spherical.theta -= dx * 0.005;
        this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi + dy * 0.005, 0.05, Math.PI - 0.05);
      }
      this.previousMouse = { x: event.clientX, y: event.clientY };
      this.updateCamera();
      this.invalidateRender();
      return;
    }

    if (this.interactionMode === "story") return; // disable hover hit-testing for performance

    const rect = this.canvas.getBoundingClientRect();
    const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const normalizedY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.mouse.set(normalizedX, normalizedY);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickTargets, false);
    if (hits.length) {
      const mesh = hits[0].object as THREE.Mesh;
      if (mesh !== this.hoveredObj) {
        if (this.hoveredObj && this.hoveredObj !== this.selectedObj) this.restoreColor(this.hoveredObj);
        this.hoveredObj = mesh;
        if (mesh !== this.selectedObj) this.tintMesh(mesh, new THREE.Color(1, 1, 1), 0.22);
      }
      this.callbacks.onTooltip?.({ ...selectionFromMesh(mesh), x: event.clientX, y: event.clientY });
    } else {
      if (this.hoveredObj && this.hoveredObj !== this.selectedObj) this.restoreColor(this.hoveredObj);
      this.hoveredObj = null;
      this.callbacks.onTooltip?.(null);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    const wasClick = this.dragDistance < 3;
    this.isDragging = false;
    this.canvas.releasePointerCapture?.(event.pointerId);
    if (this.interactionMode === "story") return;
    if (wasClick && event.button === 0) {
      this.mouseFromEvent(event);
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObjects(this.pickTargets, false);
      this.selectMesh(hits.length ? (hits[0].object as THREE.Mesh) : null);
    }
  };

  private onWheel = (event: WheelEvent) => {
    if (this.interactionMode === "story" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      return; // allow naturally scrolling the page
    }
    event.preventDefault();
    this.spherical.r = THREE.MathUtils.clamp(this.spherical.r * (event.deltaY > 0 ? 1.1 : 0.9), 1, 200);
    this.updateCamera();
    this.invalidateRender();
  };

  private mouseFromEvent(event: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private selectMesh(mesh: THREE.Mesh | null) {
    if (this.selectedObj && this.selectedObj !== this.hoveredObj) this.restoreColor(this.selectedObj);
    this.selectedObj = mesh;
    if (!mesh) {
      this.callbacks.onSelect?.(null);
      this.invalidateRender();
      return;
    }
    this.tintMesh(mesh, new THREE.Color(0.17, 0.83, 0.75), 0.55);
    this.callbacks.onSelect?.(selectionFromMesh(mesh));
    this.invalidateRender();
  }

  private updateCamera() {
    const sinPhi = Math.sin(this.spherical.phi);
    this.camera.position.set(
      this.target.x + this.spherical.r * sinPhi * Math.sin(this.spherical.theta),
      this.target.y + this.spherical.r * Math.cos(this.spherical.phi),
      this.target.z + this.spherical.r * sinPhi * Math.cos(this.spherical.theta)
    );
    this.camera.lookAt(this.target);
  }

  private resize = () => {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
    this.invalidateRender();
  };

  private animate = () => {
    this.frameId = requestAnimationFrame(this.animate);

    let needsRender = this.interactionMode === "viewer" || this.renderDirty || this.isDragging;
    const now = performance.now();

    if (this.camAnim?.active) {
      if (this.camAnim.version !== this.cameraTweenVersion) {
        this.camAnim.active = false;
      } else {
        needsRender = true;
        const t = Math.min((now - this.camAnim.startTime) / this.camAnim.duration, 1.0);
        const ease = this.easeOutCubic(t);

        this.spherical.theta = this.lerp(this.camAnim.startTheta, this.camAnim.endTheta, ease);
        this.spherical.phi = this.lerp(this.camAnim.startPhi, this.camAnim.endPhi, ease);
        this.spherical.r = this.lerp(this.camAnim.startR, this.camAnim.endR, ease);
        this.target.lerpVectors(this.camAnim.startTarget, this.camAnim.endTarget, ease);

        this.updateCamera();

        if (t >= 1.0) {
          this.camAnim.active = false;
        }
      }
    } else if (this.heroDriftActive) {
      if (this.interactionMode !== "story" || now - this.lastStoryDriftRender >= this.storyDriftRenderInterval) {
        needsRender = true;
        this.lastStoryDriftRender = now;
        this.spherical.theta += 0.0014;
        this.updateCamera();
      }
    }

    if (this.exploreAnim?.active) {
      if (this.exploreAnim.version !== this.explosionTweenVersion) {
        this.exploreAnim.active = false;
      } else {
        needsRender = true;
        const t = Math.min((now - this.exploreAnim.startTime) / this.exploreAnim.duration, 1.0);
        const ease = this.easeOutCubic(t);
        this.setExplodedAmount(this.lerp(this.exploreAnim.startExp, this.exploreAnim.endExp, ease));
        if (t >= 1.0) {
          this.exploreAnim.active = false;
        }
      }
    }

    if (this.interactionMode === "story" && !needsRender) {
      needsRender = now - this.lastStoryIdleRender >= this.storyIdleRenderInterval;
      if (needsRender) this.lastStoryIdleRender = now;
    }

    if (needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.renderDirty = false;
    }
  };

  private lerp(start: number, end: number, t: number) {
    return start + (end - start) * t;
  }

  private easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3);
  }

  private isBomFace(entity: BomEntity | BomFace): entity is BomFace {
    return entity.type === "Face" && "vertices" in entity;
  }

  private walkEntities(entities: Array<BomEntity | BomFace>, treeNodes: TreeNode[], parentVisGroup: string | null) {
    entities.forEach((entity, index) => {
      if (this.isBomFace(entity)) {
        this.buildFace(entity, parentVisGroup);
        return;
      }

      const name = entity.name || entity.definition_name || entity.type || "Entity";
      const node: TreeNode = {
        id: entity.id || `${name}-${index}-${treeNodes.length}`,
        name,
        type: entity.type || "Entity",
        faceCount: entity.face_count,
        children: []
      };
      treeNodes.push(node);

      if (entity.size && entity.center) {
        this.buildBBox(entity, node.id, parentVisGroup);
      }

      const detected = detectVisGroup(name);
      const childGroup = detected || parentVisGroup;
      if (entity.children?.length) this.walkEntities(entity.children, node.children, childGroup);
    });
  }

  private async buildEntitiesProgressively(
    entities: Array<BomEntity | BomFace>,
    treeNodes: TreeNode[],
    parentVisGroup: string | null,
    options: {
      chunkSize: number;
      frameBudgetMs: number;
      version: number;
      onProgress?: (progress: ModelLoadProgress) => void;
    }
  ) {
    const stack: ProgressiveBuildFrame[] = [{ entities, index: 0, treeNodes, parentVisGroup }];
    let builtCount = 0;
    let processedCount = 0;
    let lastProgressAt = 0;

    options.onProgress?.({ phase: "build", current: 0, message: "Building model geometry" });

    while (stack.length) {
      if (!this.isCurrentLoad(options.version)) return builtCount;

      const frameStart = performance.now();
      let chunkBuildCount = 0;

      while (stack.length && chunkBuildCount < options.chunkSize && performance.now() - frameStart < options.frameBudgetMs) {
        const frame = stack[stack.length - 1];

        if (frame.index >= frame.entities.length) {
          stack.pop();
          continue;
        }

        const entity = frame.entities[frame.index];
        const siblingIndex = frame.index;
        frame.index += 1;
        processedCount += 1;

        if (this.isBomFace(entity)) {
          this.buildFace(entity, frame.parentVisGroup);
          builtCount += 1;
          chunkBuildCount += 1;
          continue;
        }

        const name = entity.name || entity.definition_name || entity.type || "Entity";
        const node: TreeNode = {
          id: entity.id || `${name}-${siblingIndex}-${frame.treeNodes.length}`,
          name,
          type: entity.type || "Entity",
          faceCount: entity.face_count,
          children: []
        };
        frame.treeNodes.push(node);

        if (entity.size && entity.center) {
          this.buildBBox(entity, node.id, frame.parentVisGroup);
          builtCount += 1;
          chunkBuildCount += 1;
        }

        const detected = detectVisGroup(name);
        const childGroup = detected || frame.parentVisGroup;
        if (entity.children?.length) {
          stack.push({
            entities: entity.children,
            index: 0,
            treeNodes: node.children,
            parentVisGroup: childGroup
          });
        }
      }

      if (builtCount !== lastProgressAt) {
        lastProgressAt = builtCount;
        options.onProgress?.({
          phase: "build",
          current: builtCount,
          message: `Building model geometry (${builtCount.toLocaleString()} parts)`
        });
      } else {
        options.onProgress?.({
          phase: "build",
          current: processedCount,
          message: `Reading model hierarchy (${processedCount.toLocaleString()} entries)`
        });
      }

      this.invalidateRender();
      await this.nextFrame();
    }

    return builtCount;
  }

  private buildFace(face: BomFace, parentVisGroup: string | null) {
    if (!face.vertices || face.vertices.length < 3) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;

    for (const vertex of face.vertices) {
      cx += vertex.position.x;
      cy += vertex.position.z;
      cz += -vertex.position.y;
    }

    const invVertexCount = 1 / face.vertices.length;
    cx *= invVertexCount;
    cy *= invVertexCount;
    cz *= invVertexCount;

    const triangleCount = face.vertices.length - 2;
    const positions = new Float32Array(triangleCount * 9);
    const normals = new Float32Array(positions.length);
    let cursor = 0;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    const writeVertex = (vertex: BomVertex) => {
      const x = vertex.position.x - cx;
      const y = vertex.position.z - cy;
      const z = -vertex.position.y - cz;
      positions[cursor] = x;
      positions[cursor + 1] = y;
      positions[cursor + 2] = z;
      cursor += 3;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    };

    for (let i = 1; i < face.vertices.length - 1; i += 1) {
      writeVertex(face.vertices[0]);
      writeVertex(face.vertices[i]);
      writeVertex(face.vertices[i + 1]);
    }

    for (let index = 0; index < positions.length; index += 9) {
      const ax = positions[index + 3] - positions[index];
      const ay = positions[index + 4] - positions[index + 1];
      const az = positions[index + 5] - positions[index + 2];
      const bx = positions[index + 6] - positions[index];
      const by = positions[index + 7] - positions[index + 1];
      const bz = positions[index + 8] - positions[index + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const normalLength = Math.hypot(nx, ny, nz);
      if (normalLength < 0.000001) {
        nx = 0;
        ny = 1;
        nz = 0;
      } else {
        nx /= normalLength;
        ny /= normalLength;
        nz /= normalLength;
      }

      for (let vertex = 0; vertex < 9; vertex += 3) {
        normals[index + vertex] = nx;
        normals[index + vertex + 1] = ny;
        normals[index + vertex + 2] = nz;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ)
    );

    const visGroup = resolveVisGroup(face.surface_type, parentVisGroup);
    const meta = LAYER_META[visGroup] ?? LAYER_META.other;
    const color = this.resolveMaterialColor(face.material_front?.color?.hex, meta.color);
    const material = this.makeMaterial(color);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx, cy, cz);
    this.applyMeshShadowDefaults(mesh);
    mesh.userData = {
      originalMaterial: material,
      id: face.id,
      name: face.name || face.material_front?.name || meta.label,
      type: face.type,
      visGroup,
      layer: face.layer,
      area_m2: face.area_m2,
      volume_m3: face.volume_m3,
      surface_type: face.surface_type
    };
    mesh.userData.storyCategory = visGroup;
    mesh.userData.storyGroup = this.storyGroupForVisGroup(visGroup);
    mesh.userData.originalVisible = true;

    this.pickTargets.push(mesh);
    if (face.id) this.componentMap.set(face.id, mesh);
    this.registerLayer(visGroup, mesh);
    this.expandSceneBoxFromGeometry(mesh);
  }

  private buildBBox(entity: BomEntity, id: string, parentVisGroup: string | null) {
    if (!entity.size || !entity.center) return;
    const visGroup = resolveVisGroup(entity.category, parentVisGroup);
    const meta = LAYER_META[visGroup] ?? LAYER_META.other;
    const geometry = new THREE.BoxGeometry(entity.size.x, entity.size.z, entity.size.y);
    const material = this.makeMaterial(this.resolveMaterialColor(undefined, meta.color));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(entity.center.x, entity.center.z, -entity.center.y);
    this.applyMeshShadowDefaults(mesh);
    mesh.userData = {
      originalMaterial: material,
      id,
      name: entity.name || entity.definition_name || entity.type,
      type: entity.type,
      visGroup,
      area_m2: 0,
      volume_m3: entity.size.x * entity.size.y * entity.size.z
    };
    mesh.userData.storyCategory = visGroup;
    mesh.userData.storyGroup = this.storyGroupForVisGroup(visGroup);
    mesh.userData.originalVisible = true;
    
    this.pickTargets.push(mesh);
    this.componentMap.set(id, mesh);
    this.registerLayer(visGroup, mesh);
    this.sceneBox.union(
      new THREE.Box3(
        new THREE.Vector3(entity.center.x - entity.size.x / 2, entity.center.z - entity.size.z / 2, -entity.center.y - entity.size.y / 2),
        new THREE.Vector3(entity.center.x + entity.size.x / 2, entity.center.z + entity.size.z / 2, -entity.center.y + entity.size.y / 2)
      )
    );
  }

  private expandSceneBoxFromGeometry(mesh: THREE.Mesh) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box) return;
    this.sceneBox.union(box.clone().translate(mesh.position));
  }

  private makeMaterial(color: number) {
    const material = new THREE.MeshPhongMaterial({
      color,
      shininess: 8,
      specular: new THREE.Color(0x4f4a42),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    });
    material.clippingPlanes = this.getActivePlanes();
    this.originalColors.set(material, material.color.clone());
    return material;
  }

  private resolveMaterialColor(primary?: string, fallback = "#b8ad9e") {
    const parsedPrimary = this.parseHexColor(primary);
    if (parsedPrimary !== null && parsedPrimary > 0x101010) return parsedPrimary;
    const parsedFallback = this.parseHexColor(fallback);
    if (parsedFallback !== null && parsedFallback > 0x101010) return parsedFallback;
    return 0xb8ad9e;
  }

  private parseHexColor(value?: string) {
    if (!value) return null;
    const normalized = value.trim().replace("#", "");
    if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null;
    const expanded = normalized.length === 3
      ? normalized.split("").map((char) => `${char}${char}`).join("")
      : normalized;
    const color = Number.parseInt(expanded, 16);
    return Number.isFinite(color) ? color : null;
  }

  private registerLayer(key: string, mesh: THREE.Mesh) {
    if (!this.layerRegistry[key]) {
      const meta = LAYER_META[key] ?? { label: key, color: "#94A3B8", order: 90 };
      const group = new THREE.Group();
      group.name = `layer-${key}`;
      this.scene.add(group);
      this.layerRegistry[key] = { ...meta, visible: true, meshes: [], group };
    }
    this.layerRegistry[key].group.add(mesh);
    this.layerRegistry[key].meshes.push(mesh);
  }

  private assignMaterial(mesh: THREE.Mesh, material: THREE.Material) {
    if (mesh.material === material) return;
    mesh.material = material;
  }

  private restoreActiveMaterial(mesh: THREE.Mesh) {
    const material = mesh.material as THREE.MeshPhongMaterial;
    const original = this.originalColors.get(material);
    if (!original || !("color" in material)) return;

    const programStateChanged =
      material.transparent ||
      material.opacity !== 1 ||
      !material.depthWrite;
    const colorChanged = !material.color.equals(original);

    if (!programStateChanged && !colorChanged) return;

    if (colorChanged) material.color.copy(original);
    material.opacity = 1;
    material.transparent = false;
    material.depthWrite = true;
    if (programStateChanged) material.needsUpdate = true;
  }

  private restoreViewerMaterials() {
    this.cancelPendingStoryUpdates();
    Object.values(this.layerRegistry).forEach((entry) => {
      entry.storyState = undefined;
      entry.storyEdges = false;
      entry.group.visible = entry.visible;
      entry.group.position.set(0, 0, 0);
      entry.explodeOffset = 0;
      entry.meshes.forEach((mesh) => {
        mesh.visible = true;
        mesh.renderOrder = 0;
        this.assignMaterial(mesh, (mesh.userData.originalMaterial as THREE.Material) || mesh.material);
        this.restoreActiveMaterial(mesh);
        const edges = this.getMeshEdges(mesh);
        if (edges) edges.visible = false;
      });
    });
  }

  private hideLayerMeshes(entry: RegistryEntry) {
    entry.meshes.forEach((mesh) => {
      mesh.visible = false;
      mesh.renderOrder = 0;
      const edges = this.getMeshEdges(mesh);
      if (edges) edges.visible = false;
    });
  }

  private applyMeshShadowDefaults(mesh: THREE.Mesh) {
    const enabled = this.interactionMode !== "story";
    mesh.castShadow = enabled;
    mesh.receiveShadow = enabled;
  }

  private buildStoryGroupsOnce() {
    const byKeys = (keys: string[]) => keys.flatMap((key) => this.layerRegistry[key]?.meshes ?? []);
    this.storyGroups = {
      roofMeshes: byKeys(ROOF_STORY_KEYS),
      wallMeshes: byKeys(WALL_STORY_KEYS),
      floorMeshes: byKeys(FLOOR_STORY_KEYS),
      frameMeshes: byKeys(FRAME_STORY_KEYS),
      foundationMeshes: byKeys(FOUNDATION_STORY_KEYS),
      cerucukMeshes: byKeys(["cerucuk"]),
      finalMeshes: Object.values(this.layerRegistry).flatMap((entry) => entry.meshes)
    };
    this.cerucukOriginalMeshes = this.storyGroups.cerucukMeshes;
    this.hideCerucukProxyGroup();
    this.devLog("story groups", {
      totalMeshes: this.storyGroups.finalMeshes.length,
      roofMeshes: this.storyGroups.roofMeshes.length,
      wallMeshes: this.storyGroups.wallMeshes.length,
      floorMeshes: this.storyGroups.floorMeshes.length,
      frameMeshes: this.storyGroups.frameMeshes.length,
      foundationMeshes: this.storyGroups.foundationMeshes.length,
      cerucukOriginalMeshes: this.cerucukOriginalMeshes.length,
      cerucukRenderMode: CERUCUK_RENDER_MODE,
      proxyPresent: !!this.cerucukProxyGroup,
      floorSamples: this.storyGroups.floorMeshes.slice(0, 10).map((mesh) => ({
        name: String(mesh.userData.name ?? ""),
        visGroup: String(mesh.userData.visGroup ?? ""),
        layer: String(mesh.userData.layer ?? ""),
        surfaceType: String(mesh.userData.surface_type ?? ""),
        storyGroup: String(mesh.userData.storyGroup ?? "")
      }))
    });
  }

  private storyGroupForVisGroup(visGroup: string) {
    if (ROOF_STORY_KEYS.includes(visGroup)) return "roof";
    if (WALL_STORY_KEYS.includes(visGroup)) return "wall";
    if (FLOOR_STORY_KEYS.includes(visGroup)) return "floor";
    if (FRAME_STORY_KEYS.includes(visGroup)) return "frame";
    if (FOUNDATION_STORY_KEYS.includes(visGroup)) return "foundation";
    if (visGroup === "cerucuk") return "cerucuk";
    return "other";
  }

  private cancelPendingStoryUpdates() {
    this.storyApplyToken += 1;
    this.pendingStoryFrames.forEach((id) => cancelAnimationFrame(id));
    this.pendingStoryFrames = [];
    return this.storyApplyToken;
  }

  private applyMeshState(mesh: THREE.Mesh, key: string, state: StoryLayerState, edgeState: boolean, index: number) {
    const visible = this.storyVisibilityForMesh(mesh, key, state);
    if (
      mesh.userData.storyState === state &&
      mesh.userData.storyEdges === edgeState &&
      mesh.visible === visible
    ) {
      return 0;
    }

    mesh.userData.storyState = state;
    mesh.userData.storyEdges = edgeState;
    mesh.visible = visible;
    mesh.renderOrder = state === "active" ? 10 : state === "context" ? 1 : 0;

    const edges = edgeState ? this.getOrCreateEdges(mesh) : this.getMeshEdges(mesh);
    if (state === "active") {
      this.assignMaterial(mesh, this.getActiveStoryMaterial(key));
      if (edges) edges.visible = edgeState && index < 80;
    } else if (state === "context") {
      this.assignMaterial(mesh, this.getContextStoryMaterial(key));
      if (edges) edges.visible = false;
    } else {
      this.assignMaterial(mesh, (mesh.userData.originalMaterial as THREE.Material) || mesh.material);
      this.restoreActiveMaterial(mesh);
      if (edges) edges.visible = false;
    }
    return 1;
  }

  private storyVisibilityForMesh(mesh: THREE.Mesh, key: string, state: StoryLayerState) {
    if (state === "hidden") return false;
    if (key !== "cerucuk") return true;
    if (state === "active" && CERUCUK_RENDER_MODE === "proxy") return false;
    return true;
  }

  private setCerucukRepresentation(mode: CerucukRenderMode) {
    if (mode === "original") {
      this.cerucukOriginalMeshes.forEach((mesh) => {
        mesh.visible = true;
      });
      this.hideCerucukProxyGroup();
      return;
    }

    this.cerucukOriginalMeshes.forEach((mesh) => {
      mesh.visible = false;
    });
    if (this.cerucukProxyGroup) {
      if (!this.cerucukProxyGroup.parent) this.scene.add(this.cerucukProxyGroup);
      this.cerucukProxyGroup.visible = true;
    }
  }

  private hideCerucukProxyGroup() {
    if (this.cerucukProxyGroup) this.cerucukProxyGroup.visible = false;
  }

  private countVisibleMeshes(meshes: THREE.Mesh[]) {
    let count = 0;
    meshes.forEach((mesh) => {
      if (mesh.visible) count += 1;
    });
    return count;
  }

  private getActiveStoryMaterial(key: string) {
    if (key === "cerucuk") return this.storyMaterials.cerucukActive;
    const existing = this.activeMaterialByCategory.get(key);
    if (existing) return existing;
    const meta = LAYER_META[key] ?? LAYER_META.other;
    const material = new THREE.MeshPhongMaterial({
      color: this.resolveMaterialColor(meta.color, "#c8a96a"),
      shininess: 10,
      specular: new THREE.Color(0x3b3324),
      side: THREE.DoubleSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true
    });
    material.clippingPlanes = this.getActivePlanes();
    this.activeMaterialByCategory.set(key, material);
    return material;
  }

  private getContextStoryMaterial(key: string) {
    if (FOUNDATION_STORY_KEYS.includes(key)) return this.storyMaterials.foundationContext;
    return this.storyMaterials.context;
  }

  private applyStoryRenderSafety() {
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      } else if (object instanceof THREE.Light) {
        object.castShadow = false;
      }
    });
    this.groundMesh.receiveShadow = false;
  }

  private applyViewerShadowDefaults() {
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = object !== this.groundMesh;
        object.receiveShadow = true;
      } else if (object instanceof THREE.DirectionalLight) {
        object.castShadow = true;
      }
    });
  }

  private getMeshEdges(mesh: THREE.Mesh) {
    return mesh.userData.edges as THREE.LineSegments | undefined;
  }

  private getOrCreateEdges(mesh: THREE.Mesh) {
    const existing = this.getMeshEdges(mesh);
    if (existing) return existing;

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), this.edgeMaterial);
    edges.visible = false;
    edges.renderOrder = 20;
    mesh.userData.edges = edges;
    mesh.add(edges);
    return edges;
  }

  private countEdgeHelpers() {
    return this.pickTargets.reduce((count, mesh) => count + (this.getMeshEdges(mesh) ? 1 : 0), 0);
  }

  private debugStoryMaterialSafety() {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
    if (!meta.env?.DEV || this.interactionMode !== "story") return;

    let nearBlackMaterials = 0;
    let riskyTransparentMaterials = 0;
    let shadowMeshes = 0;
    const samples: string[] = [];

    this.pickTargets.forEach((mesh) => {
      if (mesh.castShadow || mesh.receiveShadow) shadowMeshes += 1;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        const color = "color" in material && material.color instanceof THREE.Color ? material.color : null;
        if (color && color.r < 0.04 && color.g < 0.04 && color.b < 0.04) {
          nearBlackMaterials += 1;
          if (samples.length < 5) samples.push(String(mesh.userData.name ?? mesh.userData.visGroup ?? "mesh"));
        }
        if (material.transparent && (material.opacity > 0.4 || material.depthWrite)) {
          riskyTransparentMaterials += 1;
          if (material.depthWrite) material.depthWrite = false;
        }
      });
    });

    if (nearBlackMaterials || riskyTransparentMaterials || shadowMeshes) {
      console.warn("[ThreeViewerEngine] story render safety warnings", {
        nearBlackMaterials,
        riskyTransparentMaterials,
        shadowMeshes,
        samples
      });
    }
  }

  private devLog(message: string, data?: unknown) {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
    if (!meta.env?.DEV) return;
    if (data === undefined) console.debug(`[ThreeViewerEngine] ${message}`);
    else console.debug(`[ThreeViewerEngine] ${message}`, data);
  }

  private invalidateRender() {
    this.renderDirty = true;
  }

  private nextFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  private scheduleIdle(callback: () => void) {
    const requestIdle = window.requestIdleCallback;
    if (requestIdle) {
      requestIdle(callback, { timeout: 1200 });
      return;
    }
    window.setTimeout(callback, 80);
  }

  private isCurrentLoad(version: number) {
    if (!this.isDisposed && version === this.loadVersion) return true;
    this.isLoadingModel = false;
    return false;
  }

  private getLayerInfo() {
    const registry = Object.fromEntries(
      Object.entries(this.layerRegistry).map(([key, entry]) => [key, { visible: entry.visible, count: entry.meshes.length }])
    );
    return layerInfoFromRegistry(registry);
  }

  private computeStats(): ViewerStats {
    let faces = 0;
    let vertices = 0;
    let area = 0;
    let volume = 0;
    this.pickTargets.forEach((mesh) => {
      const geometry = mesh.geometry;
      vertices += geometry.getAttribute("position")?.count ?? 0;
      faces += Math.floor((geometry.getAttribute("position")?.count ?? 0) / 3);
      area += Number(mesh.userData.area_m2 ?? 0);
      volume += Number(mesh.userData.volume_m3 ?? 0);
    });
    return { faces, vertices, meshes: this.pickTargets.length, area, volume };
  }

  private applyRenderMode(mode: RenderMode) {
    this.pickTargets.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshPhongMaterial)) return;
        const orig = this.originalColors.get(material);
        const nextWireframe = mode === "wireframe";
        const nextTransparent = mode === "xray";
        const nextOpacity = mode === "xray" ? 0.32 : 1;
        const nextDepthWrite = mode !== "xray";
        const programStateChanged =
          material.wireframe !== nextWireframe ||
          material.transparent !== nextTransparent ||
          material.opacity !== nextOpacity ||
          material.depthWrite !== nextDepthWrite;

        material.wireframe = nextWireframe;
        material.transparent = nextTransparent;
        material.opacity = nextOpacity;
        material.depthWrite = nextDepthWrite;
        if (mode === "surface") {
          const meta = LAYER_META[mesh.userData.visGroup] ?? LAYER_META.other;
          material.color.set(meta.color);
        } else if (orig) {
          material.color.copy(orig);
        }
        if (programStateChanged) material.needsUpdate = true;
      });
    });
    this.invalidateRender();
  }

  private tintMesh(mesh: THREE.Mesh, color: THREE.Color, amount: number) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if ("color" in material && material.color instanceof THREE.Color) {
        const original = this.originalColors.get(material) ?? material.color.clone();
        material.color.copy(original).lerp(color, amount);
      }
    });
  }

  private restoreColor(mesh: THREE.Mesh) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if ("color" in material && material.color instanceof THREE.Color) {
        const original = this.originalColors.get(material);
        if (original) material.color.copy(original);
      }
    });
    this.applyRenderMode(this.currentMode);
  }

  private getActivePlanes() {
    return AXES.filter((axis) => this.cutEnabled[axis]).map((axis) => this.clipPlanes[axis]);
  }

  private applyClippingToAll() {
    const planes = this.getActivePlanes();
    this.pickTargets.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (material.clippingPlanes === planes) return;
        material.clippingPlanes = planes;
        material.needsUpdate = true;
      });
    });
  }

  private updateCutPlane(axis: Axis, value: number) {
    if (this.sceneBox.isEmpty()) return;
    const size = this.sceneBox.getSize(new THREE.Vector3());
    const center = this.sceneBox.getCenter(new THREE.Vector3());
    const key = axis === "y" ? "y" : axis;
    const half = size[key] / 2;
    const pos = center[key] + value * half;
    if (axis === "x") this.clipPlanes.x.set(new THREE.Vector3(-1, 0, 0), pos);
    if (axis === "y") this.clipPlanes.y.set(new THREE.Vector3(0, -1, 0), pos);
    if (axis === "z") this.clipPlanes.z.set(new THREE.Vector3(0, 0, -1), pos);
  }

  private cutLabel(axis: Axis) {
    if (this.sceneBox.isEmpty()) return "0.00m";
    const size = this.sceneBox.getSize(new THREE.Vector3());
    const center = this.sceneBox.getCenter(new THREE.Vector3());
    const key = axis === "y" ? "y" : axis;
    const pos = center[key] + this.cutValues[axis] * (size[key] / 2);
    return `${pos.toFixed(2)}m`;
  }

  private fitGridToModel(box: THREE.Box3) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const gridSize = Math.max(Math.ceil(Math.max(size.x, size.z)) + 10, 8);
    this.scene.remove(this.gridHelper);
    this.gridHelper = new THREE.GridHelper(gridSize, gridSize, 0x334155, 0x1e293b);
    this.gridHelper.position.set(center.x, box.min.y - 0.02, center.z);
    this.scene.add(this.gridHelper);
    this.groundMesh.geometry.dispose();
    this.groundMesh.geometry = new THREE.PlaneGeometry(gridSize + 2, gridSize + 2);
    this.groundMesh.position.set(center.x, box.min.y - 0.04, center.z);
  }
}

function selectionFromMesh(mesh: THREE.Mesh): SelectionInfo {
  const data = mesh.userData;
  return {
    id: data.id,
    name: data.name || mesh.uuid.slice(0, 8),
    type: data.type || "Mesh",
    visGroup: data.visGroup || "other",
    layer: data.layer,
    area: data.area_m2,
    volume: data.volume_m3
  };
}

function normalizeMaterials(materials: BomModel["materials"]) {
  if (!materials) return [];
  const rows: BomMaterial[] = Array.isArray(materials) ? materials : Object.values(materials);
  return rows.map((material) => ({
    name: material.name || "Material",
    color: material.color?.hex || "#94A3B8",
    reflectance: material.reflectance ?? "-"
  }));
}
