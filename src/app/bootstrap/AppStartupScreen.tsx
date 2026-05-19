export function AppStartupScreen() {
  return (
    <div className="app-startup-root" role="status" aria-live="polite">
      <div className="app-startup-lockup">
        <span className="app-startup-mark" aria-hidden="true">
          <img src="/gilbert-codex-logo.svg" alt="" draggable={false} />
        </span>
        <span>Loading Gilbert Codex...</span>
      </div>
    </div>
  );
}
