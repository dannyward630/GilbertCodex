import { ArrowLeft, MapPin, Puzzle, Radar, ShieldCheck } from "lucide-react";
import { PluginDirectory } from "../plugins/PluginsPage";
import "../../styles/apps.css";

interface AppsPageProps {
  locationServicesEnabled: boolean;
  onBackToChat: () => void;
  onOpenRadar: () => void;
}

export function AppsPage({ locationServicesEnabled, onBackToChat, onOpenRadar }: AppsPageProps) {
  return (
    <section className="apps-page">
      <header className="apps-hero">
        <div className="apps-hero-title">
          <span className="apps-hero-icon">
            <Puzzle size={22} aria-hidden="true" />
          </span>
          <span>
            <h1>Apps</h1>
            <small>Native tools and capability bundles</small>
          </span>
        </div>
        <button className="apps-back-button" type="button" onClick={onBackToChat}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Chat</span>
        </button>
      </header>

      {locationServicesEnabled ? (
        <section className="apps-native-section" aria-labelledby="apps-native-title">
          <div className="apps-section-heading">
            <h2 id="apps-native-title">Native Apps</h2>
          </div>
          <div className="apps-card-grid">
            <article className="apps-card">
              <span className="apps-card-icon">
                <Radar size={23} aria-hidden="true" />
              </span>
              <span className="apps-card-copy">
                <strong>Radar</strong>
                <small>Country-aware weather layers</small>
              </span>
              <span className="apps-card-meta">
                <MapPin size={14} aria-hidden="true" />
                <span>Location</span>
              </span>
              <button type="button" onClick={onOpenRadar}>
                Open
              </button>
            </article>
          </div>
        </section>
      ) : null}

      <section className="apps-plugin-section" aria-labelledby="apps-plugin-title">
        <div className="apps-section-heading">
          <h2 id="apps-plugin-title">Plugins</h2>
          <span>
            <ShieldCheck size={14} aria-hidden="true" />
            <small>Reviewable permissions</small>
          </span>
        </div>
        <PluginDirectory embedded />
      </section>
    </section>
  );
}
