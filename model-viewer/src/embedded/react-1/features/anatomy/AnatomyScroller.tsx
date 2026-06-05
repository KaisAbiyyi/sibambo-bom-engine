import type { AnatomySection } from "./anatomyConfig";

interface AnatomyScrollerProps {
  sections: AnatomySection[];
  activeId: string | null;
  onActivate: (section: AnatomySection) => void;
}

export function AnatomyScroller({ sections, activeId, onActivate }: AnatomyScrollerProps) {
  const scrollToSection = (id: string) => {
    document.querySelector(`[data-section-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="anatomy-scroll-container">
      <section className="anatomy-hero" data-story-hero="true">
        <div className="section-content-box hero-box">
          <div className="hero-metadata">
            <span>UI DRAFT 01</span>
            <span className="separator"></span>
            <span>ANATOMY STORY</span>
          </div>
          <h1 className="hero-title">Anatomi Konstruksi</h1>
          <p className="hero-subtitle">Scroll-based architectural section of the Sibambo model</p>
          <p className="hero-desc">
            Jelajahi lapisan struktur bangunan dari atap, dinding, lantai, hingga pondasi melalui model 3D hasil ekspor JSON.
          </p>
          <button
            className="scroll-indicator"
            type="button"
            onClick={() => sections[0] && scrollToSection(sections[0].id)}
          >
            <span className="line"></span>
            <span>Mulai Eksplorasi</span>
          </button>
        </div>
      </section>
      
      {sections.map((section, index) => {
        const isActive = activeId === section.id;
        
        return (
          <section
            className={`anatomy-section ${isActive ? "active" : ""}`}
            data-section-id={section.id}
            key={section.id}
            style={{ ["--section-color" as string]: section.color }}
          >
            <div className="section-content-box">
              <div className="section-header">
                <div className="section-index">{String(index + 1).padStart(2, "0")}</div>
                <div className="category-eyebrow">
                  <span className="dot" style={{ backgroundColor: section.color }}></span>
                  {section.category}
                </div>
              </div>
              
              <h2 className="section-title">{section.title}</h2>
              <h3 className="section-subtitle">{section.subtitle}</h3>
              <p className="section-desc">{section.desc}</p>
              
              <div className="spec-table">
                {section.specStatic.map(([key, value]) => (
                  <div className="spec-row" key={key}>
                    <span className="spec-key">{key}</span>
                    <span className="spec-val">{value}</span>
                  </div>
                ))}
              </div>
              
              <button
                className="focus-affordance" 
                onClick={() => onActivate(section)}
                type="button"
              >
                <span>Fokus Area Ini</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
