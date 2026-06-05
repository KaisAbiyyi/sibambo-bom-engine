import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { ThreeViewerEngine, type ModelLoadProgress } from "../../lib/three/ThreeViewerEngine";
import type { BomModel } from "./types";
import { useViewerStore } from "./viewerStore";

interface CanvasViewportProps {
  engineRef: MutableRefObject<ThreeViewerEngine | null>;
  autoLoad?: boolean;
  interactionMode?: "viewer" | "story";
  onModelLoaded?: (engine: ThreeViewerEngine, data: BomModel) => void;
  onLoadProgress?: (progress: ModelLoadProgress) => void;
}

export function CanvasViewport({
  engineRef,
  autoLoad = false,
  interactionMode = "viewer",
  onModelLoaded,
  onLoadProgress
}: CanvasViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const setLayers = useViewerStore((state) => state.setLayers);
  const setTree = useViewerStore((state) => state.setTree);
  const setMaterials = useViewerStore((state) => state.setMaterials);
  const setStats = useViewerStore((state) => state.setStats);
  const setSelected = useViewerStore((state) => state.setSelected);
  const setTooltip = useViewerStore((state) => state.setTooltip);
  const setCut = useViewerStore((state) => state.setCut);
  const setLoading = useViewerStore((state) => state.setLoading);
  const setLoadError = useViewerStore((state) => state.setLoadError);
  const setModelName = useViewerStore((state) => state.setModelName);

  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    const engine = new ThreeViewerEngine(canvasRef.current, {
      onLayers: setLayers,
      onTree: setTree,
      onMaterials: setMaterials,
      onStats: setStats,
      onSelect: setSelected,
      onTooltip: setTooltip,
      onCutChange: setCut
    });
    engine.setInteractionMode(interactionMode);
    engineRef.current = engine;

    if (autoLoad) {
      setLoading(true);
      setLoadError(null);
      onLoadProgress?.({ phase: "fetch", message: "Fetching model JSON" });
      fetch(`${import.meta.env.BASE_URL}Model_SBMBOOST_bom_visual_nonPretty-print.json`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          if (cancelled) return null;
          onLoadProgress?.({ phase: "parse", message: "Parsing exported model" });
          await nextFrame();
          const modelData = JSON.parse(text) as BomModel;
          return modelData;
        })
        .then(async (modelData) => {
          if (!modelData || cancelled) return;
          await engine.loadModelProgressive(modelData, {
            onProgress: onLoadProgress
          });
          if (cancelled) return;
          onModelLoaded?.(engine, modelData);
          setModelName(modelData.model_name || "Model SBMBOOST");
        })
        .catch((error: Error) => {
          if (error.name === "AbortError" || cancelled) return;
          setLoadError(error.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
      controller.abort();
      engine.dispose();
      engineRef.current = null;
    };
  }, [
    autoLoad,
    engineRef,
    interactionMode,
    onLoadProgress,
    onModelLoaded,
    setCut,
    setLayers,
    setLoadError,
    setLoading,
    setMaterials,
    setModelName,
    setSelected,
    setStats,
    setTooltip,
    setTree
  ]);

  return <canvas ref={canvasRef} className="viewer-canvas" aria-label="3D model viewport" />;
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
