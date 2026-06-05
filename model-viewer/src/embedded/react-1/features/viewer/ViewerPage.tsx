import { useRef, useState } from "react";
import { LoadingOverlay } from "../../components/LoadingOverlay";
import { ThreeViewerEngine } from "../../lib/three/ThreeViewerEngine";
import { CanvasViewport } from "./CanvasViewport";
import { InspectorPanel } from "./InspectorPanel";
import { SectionCutPanel } from "./SectionCutPanel";
import { Sidebar } from "./Sidebar";
import { StatusHUD } from "./StatusHUD";
import { TooltipOverlay } from "./TooltipOverlay";
import { TopToolbar } from "./TopToolbar";
import type { Axis, BomModel } from "./types";
import { useViewerStore } from "./viewerStore";

export function ViewerPage() {
  const maxModelFileBytes = 60 * 1024 * 1024;
  const engineRef = useRef<ThreeViewerEngine | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sectionOpen, setSectionOpen] = useState(false);
  const loading = useViewerStore((state) => state.loading);
  const loadError = useViewerStore((state) => state.loadError);
  const setLoading = useViewerStore((state) => state.setLoading);
  const setLoadError = useViewerStore((state) => state.setLoadError);
  const setModelName = useViewerStore((state) => state.setModelName);

  const loadFile = (file: File) => {
    if (file.size > maxModelFileBytes) {
      setLoadError(`File terlalu besar. Maksimum ${Math.round(maxModelFileBytes / 1024 / 1024)} MB.`);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as BomModel;
        engineRef.current?.loadModel(data);
        setModelName(file.name);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "JSON tidak valid");
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setLoadError("File tidak bisa dibaca");
      setLoading(false);
    };
    reader.readAsText(file);
  };

  const updateCut = (axis: Axis, enabled: boolean, value?: number) => {
    engineRef.current?.setCut(axis, enabled, value);
  };

  return (
    <main className="viewer-layout">
      <Sidebar
        onAllLayers={(visible) => engineRef.current?.setAllLayers(visible)}
        onFocusNode={(id) => engineRef.current?.focusNode(id)}
        onLayerToggle={(key, visible) => engineRef.current?.setLayerVisible(key, visible)}
      />
      <section className="viewer-main">
        <TopToolbar
          onCamera={(mode) => engineRef.current?.setCamera(mode)}
          onLoadClick={() => fileRef.current?.click()}
          onMode={(mode) => engineRef.current?.setRenderMode(mode)}
          onResetCamera={() => engineRef.current?.resetCamera()}
          onToggleSection={() => setSectionOpen((value) => !value)}
        />
        <div className="canvas-shell">
          <CanvasViewport engineRef={engineRef} />
          <StatusHUD />
          <TooltipOverlay />
          <LoadingOverlay error={loadError} loading={loading} />
          <input
            ref={fileRef}
            accept=".json,application/json"
            hidden
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) loadFile(file);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </section>
      <div className="right-rail">
        <SectionCutPanel open={sectionOpen} onReset={() => engineRef.current?.resetCuts()} onToggle={updateCut} />
        <InspectorPanel />
      </div>
    </main>
  );
}
