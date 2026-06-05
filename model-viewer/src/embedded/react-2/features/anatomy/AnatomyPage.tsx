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
  const activeSection = activeId ? SECTION_CONFIG.find((item) => item.id === activeId) ?? null : null;
  const activeSectionIndex = activeSection ? SECTION_CONFIG.indexOf(activeSection) + 1 : 0;

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
    engine.setPresentationMode("dark");
    engine.setInteractionMode("story");
    engine.setHeroDrift(true);
    engine.moveStoryCamera(0.72, 0.56, 1.42, 0.04, 560);

    if (withIntro) {
      engine.setExplodedAmount(0);
      engine.applyStoryFocus(MAJOR_STORY_LAYER_KEYS, [], {
        activeEdges: false,
        hiddenKeys: STORY_HIDDEN_LAYER_KEYS
      });
      heroTimerRef.current = window.setTimeout(() => {
        engine.applyStoryFocus(MAJOR_STORY_LAYER_KEYS, [], {
          activeEdges: false,
          hiddenKeys: STORY_HIDDEN_LAYER_KEYS
        });
        engine.animateExplodedAmount(0, 450);
      }, 40);
      return;
    }

    engine.applyStoryFocus(MAJOR_STORY_LAYER_KEYS, [], {
      activeEdges: false,
      hiddenKeys: STORY_HIDDEN_LAYER_KEYS
    });
    engine.animateExplodedAmount(0, 560);
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
      activeEdges: section.id !== "cerucuk",
      hiddenKeys: STORY_HIDDEN_LAYER_KEYS,
      suppressKeys: section.suppressKeys
    });

    engine.animateExplodedAmount(section.explode ?? 0.08, 520);
    engine.moveStoryCamera(section.cam.theta, section.cam.phi, section.cam.rFactor, section.cam.targetYBias, 540);
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
        <div className="stage-atmosphere" />
        <div className="stage-floor-line" />

        <div className="showcase-topbar" aria-label="Draft labels">
          <span>SIBAMBO / UI Draft 02</span>
          <span>Dark Architectural Showcase</span>
        </div>

        {!activeSection && (
          <div className="hero-copy">
            <span className="hero-kicker">BOM Engine / exported JSON model</span>
            <h1>Structural Anatomy</h1>
            <p className="hero-subtitle">Sibambo model presented as a professional architectural system.</p>
            <p className="hero-intro">
              Explore the structural layers of the exported JSON model through a cinematic 3D scroll narrative.
            </p>
            <button
              className="hero-scroll-hint"
              type="button"
              onClick={() => SECTION_CONFIG[0] && scrollToSection(SECTION_CONFIG[0].id)}
            >
              <span />
              Scroll
            </button>
          </div>
        )}

        <aside className="showcase-progress" aria-label="Current section progress">
          <span className="progress-rule">
            <span style={{ height: `${Math.max(8, (activeSectionIndex / SECTION_CONFIG.length) * 100)}%` }} />
          </span>
          <div>
            <span className="progress-count">
              {String(activeSectionIndex).padStart(2, "0")} / {String(SECTION_CONFIG.length).padStart(2, "0")}
            </span>
            <strong>{activeSection?.navLabel ?? "Hero"}</strong>
          </div>
        </aside>

        {activeSection && (
          <aside className="caption-dock" key={activeSection.id}>
            <div className="caption-number">{String(SECTION_CONFIG.indexOf(activeSection) + 1).padStart(2, "0")}</div>
            <div className="caption-main">
              <span className="caption-category">{activeSection.category}</span>
              <h2>{activeSection.title}</h2>
              <p>{activeSection.desc}</p>
            </div>
            <dl className="caption-meta">
              {activeSection.specStatic.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        )}

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

function scrollToSection(id: string) {
  document.querySelector(`[data-section-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
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
