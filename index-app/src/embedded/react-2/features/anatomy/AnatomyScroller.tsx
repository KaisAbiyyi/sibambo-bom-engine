import type { AnatomySection } from "./anatomyConfig";

interface AnatomyScrollerProps {
  sections: AnatomySection[];
  activeId: string | null;
  onActivate: (section: AnatomySection) => void;
}

export function AnatomyScroller({ sections, activeId, onActivate }: AnatomyScrollerProps) {
  return (
    <div className="anatomy-scroll-container">
      <section className="anatomy-hero anatomy-scroll-section" data-story-hero="true" aria-label="Hero">
        <span className="scroll-sentinel">Structural Anatomy</span>
      </section>
      
      {sections.map((section, index) => {
        const isActive = activeId === section.id;
        
        return (
          <section
            className={`anatomy-section anatomy-scroll-section ${isActive ? "active" : ""}`}
            data-section-id={section.id}
            key={section.id}
            style={{ ["--section-color" as string]: section.color }}
          >
            <button className="scroll-sentinel" type="button" onClick={() => onActivate(section)}>
              {String(index + 1).padStart(2, "0")} {section.title}
            </button>
          </section>
        );
      })}
    </div>
  );
}
