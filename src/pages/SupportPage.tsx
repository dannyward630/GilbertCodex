import { useState } from "react";
import { ArrowLeft, ExternalLink, Github, Heart, ShieldCheck } from "lucide-react";
import { openExternalUrl } from "../app/tauriClient";
import { supportConfig, type SupportLink } from "../services/supportConfig";
import "../styles/support.css";

interface SupportPageProps {
  onBackToChat: () => void;
}

export function SupportPage({ onBackToChat }: SupportPageProps) {
  const [linkError, setLinkError] = useState<string | null>(null);

  async function handleOpenUrl(url: string) {
    if (!url) {
      return;
    }

    setLinkError(null);

    try {
      await openExternalUrl(url);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "Could not open that funding link.");
    }
  }

  return (
    <section className="support-page">
      <header className="support-hero">
        <div className="support-hero-copy">
          <span className="support-kicker">
            <Heart size={15} aria-hidden="true" />
            Voluntary project funding
          </span>
          <h1>Help Fund Gilbert Codex</h1>
          <p>
            Gilbert Codex is open source, but it is still built like a serious project: something people should be able to open, use, and trust
            without having to fix half the app themselves.
          </p>
        </div>
        <button className="support-back-button" type="button" onClick={onBackToChat}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Chat</span>
        </button>
      </header>

      <div className="support-body">
        <section className="support-note" aria-label="Support note">
          <p>
            The app stays usable without payment or account pressure. If Gilbert Codex helps you, optional support helps keep the project moving,
            improving, and available as open source.
          </p>
          <p>No pressure, no locked features, no guilt trip. Just an honest way to help the work keep moving.</p>
        </section>

        <section className="support-actions" aria-labelledby="support-actions-title">
          <div className="support-section-heading">
            <h2 id="support-actions-title">Ways to chip in</h2>
            <span>{supportConfig.configuredCount > 0 ? `${supportConfig.configuredCount} ready` : "Coming soon"}</span>
          </div>
          <div className="support-action-grid">
            {supportConfig.visiblePrimaryLinks.map((link) => (
              <SupportAction key={link.id} link={link} onOpen={handleOpenUrl} />
            ))}
            <button className="support-action" data-tone="gold" type="button" onClick={() => void handleOpenUrl(supportConfig.githubUrl)}>
              <span>
                <Github size={19} aria-hidden="true" />
                <strong>View GitHub</strong>
              </span>
              <small>Source and releases</small>
              <ExternalLink size={15} aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className="support-secondary" aria-labelledby="support-secondary-title">
          <div className="support-section-heading">
            <h2 id="support-secondary-title">More options</h2>
            <span>Optional links</span>
          </div>
          <div className="support-secondary-grid">
            {supportConfig.visibleSecondaryLinks.map((link) => (
              <SupportProviderRow key={link.id} link={link} onOpen={handleOpenUrl} />
            ))}
          </div>
        </section>
      </div>

      <footer className="support-trust" aria-label="Support policy">
        <span>
          <ShieldCheck size={15} aria-hidden="true" />
          Funding is voluntary. Gilbert Codex stays open source.
        </span>
        <span>Payments open in your browser through the selected provider.</span>
      </footer>

      {linkError ? (
        <p className="support-error" role="status">
          {linkError}
        </p>
      ) : null}
    </section>
  );
}

interface SupportActionProps {
  link: SupportLink;
  onOpen: (url: string) => void | Promise<void>;
}

function SupportAction({ link, onOpen }: SupportActionProps) {
  return (
    <button className="support-action" data-tone={link.tone} disabled={!link.enabled} type="button" onClick={() => void onOpen(link.url)}>
      <span>
        <Heart size={19} aria-hidden="true" />
        <strong>{link.label}</strong>
      </span>
      <small>{link.enabled ? link.providerLabel : "Coming soon"}</small>
      {link.enabled ? <ExternalLink size={15} aria-hidden="true" /> : null}
    </button>
  );
}

function SupportProviderRow({ link, onOpen }: SupportActionProps) {
  return (
    <div className="support-provider-row" data-enabled={link.enabled} data-tone={link.tone}>
      <span>
        <strong>{link.label}</strong>
        <small>{link.description}</small>
      </span>
      <button disabled={!link.enabled} type="button" onClick={() => void onOpen(link.url)}>
        {link.enabled ? "Open" : "Coming soon"}
      </button>
    </div>
  );
}
