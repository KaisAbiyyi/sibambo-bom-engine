import { useCallback, useEffect, useRef, useState } from "react";
import { LoadingOverlay } from "../../components/LoadingOverlay";
import { ThreeViewerEngine, type ModelLoadProgress } from "../../lib/three/ThreeViewerEngine";
import { CanvasViewport } from "../viewer/CanvasViewport";
import { useViewerStore } from "../viewer/viewerStore";
import {
  MAJOR_STORY_LAYER_KEYS,
  SECTION_CONFIG,
  STORY_HIDDEN_LAYER_KEYS,
  type AnatomySection
} from "./anatomyConfig";
import { AnatomyScroller } from "./AnatomyScroller";
import "./anatomy.css";

export function AnatomyPage() {
  const engineRef = useRef<ThreeViewerEngine | null>(null);
  const heroTimerRef = useRef<number | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const activeStoryIdRef = useRef<string | null>(null);
  const visibleSectionsRef = useRef(new Map<Element, IntersectionObserverEntry>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState<ModelLoadProgress>({
    phase: "fetch",
    message: "Preparing architectural model"
  });
  const loading = useViewerStore((state) => state.loading);
  const loadError = useViewerStore((state) => state.loadError);

  const applyHeroPresentation = useCallback((withIntro = false, engine = engineRef.current) => {
    if (!engine) return;
    if (!withIntro && activeStoryIdRef.current === "hero") return;
    if (heroTimerRef.current) {
      window.clearTimeout(heroTimerRef.current);
      heroTimerRef.current = null;
    }

    activeStoryIdRef.current = "hero";
    engine.beginStoryTransition();
    if (activeIdRef.current !== null) {
      activeIdRef.current = null;
      setActiveId(null);
    }
    engine.setPresentationMode("paper");
    engine.setInteractionMode("story");
    engine.setHeroDrift(true);
    engine.moveStoryCamera(0.72, 0.56, 1.62, 0.04, 560);

    if (withIntro) {
      engine.setExplodedAmount(0);
      engine.applyStoryFocus([], [], { hiddenKeys: STORY_HIDDEN_LAYER_KEYS });
      heroTimerRef.current = window.setTimeout(() => {
        engine.applyStoryFocus(MAJOR_STORY_LAYER_KEYS, [], {
          activeEdges: false,
          hiddenKeys: STORY_HIDDEN_LAYER_KEYS
        });
        engine.animateExplodedAmount(0.46, 650);
      }, 40);
      return;
    }

    engine.applyStoryFocus(MAJOR_STORY_LAYER_KEYS, [], {
      activeEdges: false,
      hiddenKeys: STORY_HIDDEN_LAYER_KEYS
    });
    engine.animateExplodedAmount(0.46, 560);
  }, []);

  const activate = useCallback((section: AnatomySection) => {
    if (activeIdRef.current === section.id) return;
    const engine = engineRef.current;
    if (!engine) return;

    if (heroTimerRef.current) {
      window.clearTimeout(heroTimerRef.current);
      heroTimerRef.current = null;
    }

    activeIdRef.current = section.id;
    activeStoryIdRef.current = section.id;
    setActiveId(section.id);
    engine.beginStoryTransition();
    engine.setHeroDrift(false);

    if (section.focusMode === "complete") {
      engine.applyFinalOverview(section.show, STORY_HIDDEN_LAYER_KEYS);
      engine.moveStoryCamera(section.cam.theta, section.cam.phi, section.cam.rFactor, section.cam.targetYBias, 700);
      return;
    }

    engine.applyStoryFocus(section.show, section.context, {
      activeEdges: true,
      hiddenKeys: STORY_HIDDEN_LAYER_KEYS,
      suppressKeys: section.suppressKeys
    });

    engine.animateExplodedAmount(section.explode ?? 0.12, 520);
    engine.moveStoryCamera(section.cam.theta, section.cam.phi, section.cam.rFactor, section.cam.targetYBias, 520);
  }, []);

  const handleModelLoaded = useCallback(
    (engine: ThreeViewerEngine) => {
      setModelReady(true);
      applyHeroPresentation(true, engine);
    },
    [applyHeroPresentation]
  );

  const handleLoadProgress = useCallback((progress: ModelLoadProgress) => {
    setLoadProgress(progress);
    if (progress.phase === "fetch" || progress.phase === "parse" || progress.phase === "build") {
      setModelReady(false);
    }
    if (progress.phase === "ready") {
      setModelReady(true);
    }
  }, []);

  useEffect(() => {
    document.body.classList.add("anatomy-mode");
    return () => document.body.classList.remove("anatomy-mode");
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.08) {
            visibleSectionsRef.current.set(entry.target, entry);
          } else {
            visibleSectionsRef.current.delete(entry.target);
          }
        });

        const activationBandY = window.innerHeight * 0.38;
        const active = Array.from(visibleSectionsRef.current.values())
          .filter((entry) => entry.intersectionRatio > 0.18)
          .sort(
            (a, b) =>
              Math.abs(a.boundingClientRect.top - activationBandY) -
              Math.abs(b.boundingClientRect.top - activationBandY)
          )[0];

        if (active) {
          if (active.target.getAttribute("data-story-hero") === "true") {
            applyHeroPresentation(false);
            return;
          }
          const id = active.target.getAttribute("data-section-id");
          const section = SECTION_CONFIG.find((item) => item.id === id);
          if (section) activate(section);
        }
      },
      { root: null, threshold: [0, 0.08, 0.18, 0.3, 0.45, 0.65, 0.85, 1.0] }
    );

    const timeout = window.setTimeout(() => {
      document
        .querySelectorAll<HTMLElement>(".anatomy-hero, .anatomy-section")
        .forEach((section) => observer.observe(section));
    }, 100);

    return () => {
      window.clearTimeout(timeout);
      if (heroTimerRef.current) window.clearTimeout(heroTimerRef.current);
      visibleSectionsRef.current.clear();
      observer.disconnect();
      if (engineRef.current) {
        engineRef.current.setHeroDrift(false);
        engineRef.current.setExplodedAmount(0);
        engineRef.current.setPresentationMode("dark");
      }
    };
  }, [activate, applyHeroPresentation]);

  return (
    <main className={`anatomy-story ${modelReady ? "model-ready" : "model-loading"}`}>
      <section className="anatomy-stage">
        <CanvasViewport
          autoLoad
          engineRef={engineRef}
          interactionMode="story"
          onLoadProgress={handleLoadProgress}
          onModelLoaded={handleModelLoaded}
        />
        
        {/* Architectural Overlays */}
        <div className="stage-blueprint-grid"></div>
        <div className="stage-guides">
          <div className="guide-h top"></div>
          <div className="guide-h bottom"></div>
          <div className="guide-v left"></div>
          <div className="guide-v right"></div>
        </div>
        
        <div className="stage-ruler top-ruler"></div>
        <div className="stage-ruler left-ruler"></div>

        {activeId && (
          <div className="stage-badge-layer">
            <span className="badge-eyebrow">{SECTION_CONFIG.find((item) => item.id === activeId)?.category}</span>
            <strong className="badge-title">{SECTION_CONFIG.find((item) => item.id === activeId)?.title}</strong>
          </div>
        )}
        
        {/* Right Rail Progress Dots */}
        <div className="anatomy-progress">
          {SECTION_CONFIG.map((section, idx) => (
            <button
              key={section.id} 
              className={`progress-dot ${activeId === section.id ? "active" : ""}`}
              onClick={() => {
                activate(section);
                const el = document.querySelector(`[data-section-id="${section.id}"]`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              type="button"
              aria-label={`Buka bagian ${idx + 1}: ${section.title}`}
              aria-current={activeId === section.id ? "step" : undefined}
            >
              <span className="dot-label">{String(idx + 1).padStart(2, "0")}</span>
              <span className="dot-title">{section.title}</span>
            </button>
          ))}
        </div>

        <LoadingOverlay
          error={loadError}
          loading={loading}
          label="Preparing architectural model..."
          progress={progressValue(loadProgress)}
          subtitle={loadProgress.message ?? phaseLabel(loadProgress.phase)}
        />
      </section>
      
      <div className="anatomy-content-overlay">
        <AnatomyScroller sections={SECTION_CONFIG} activeId={activeId} onActivate={activate} />
      </div>
    </main>
  );
}

function progressValue(progress: ModelLoadProgress) {
  if (progress.phase === "ready") return 100;
  if (!progress.current || !progress.total) return null;
  return Math.max(1, Math.min(99, Math.round((progress.current / progress.total) * 100)));
}

function phaseLabel(phase: ModelLoadProgress["phase"]) {
  if (phase === "fetch") return "Fetching exported JSON";
  if (phase === "parse") return "Parsing model structure";
  if (phase === "build") return "Building model geometry";
  if (phase === "finalize") return "Fitting camera and layers";
  return "Model ready";
}
