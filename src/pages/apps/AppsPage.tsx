import { ArrowLeft, Puzzle, ShieldCheck } from "lucide-react";
import "../../styles/apps.css";

interface AppsPageProps {
  locationServicesEnabled: boolean;
  onBackToChat: () => void;
  onOpenRadar: () => void;
  onOpenSupport: () => void;
}

export function AppsPage({ onBackToChat }: AppsPageProps) {
  return (
    <section className="apps-page">
      <header className="apps-hero">
        <div className="apps-hero-title">
          <span className="apps-hero-icon">
            <Puzzle size={22} aria-hidden="true" />
          </span>
          <span>
            <h1>Apps</h1>
            <small>Plugins, Apps, Skills, and more</small>
          </span>
        </div>
        <button className="apps-back-button" type="button" onClick={onBackToChat}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Chat</span>
        </button>
      </header>

      <main className="apps-coming-soon" aria-labelledby="apps-coming-soon-title">
        <span className="apps-coming-kicker">
          <ShieldCheck size={15} aria-hidden="true" />
          Next update
        </span>

        <div className="apps-coming-copy">
          <h2 id="apps-coming-soon-title">Coming soon in the next update</h2>
          <p>Plugins, Apps, Skills, and more.</p>
        </div>

        <div className="apps-coming-list" aria-label="Upcoming capabilities">
          <span>Plugins</span>
          <span>Apps</span>
          <span>Skills</span>
          <span>More</span>
        </div>
      </main>
    </section>
  );
}
