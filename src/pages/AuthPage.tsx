import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Code2, Database, KeyRound, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { createLocalAccount, loginLocalAccount } from "../app/authClient";
import { AuthTopBar } from "../components/chrome/AuthTopBar";
import type { AuthSession } from "../types/auth";

type AuthMode = "create" | "login";

interface AuthPageProps {
  hasAccounts: boolean;
  initialError?: string | null;
  loading?: boolean;
  onAuthenticated: (session: AuthSession) => void | Promise<void>;
}

export function AuthPage({ hasAccounts, initialError, loading = false, onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>(() => (hasAccounts ? "login" : "create"));
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [submitting, setSubmitting] = useState(false);
  const passwordScore = useMemo(() => getPasswordScore(password), [password]);
  const isCreateMode = mode === "create";

  useEffect(() => {
    if (!hasAccounts) {
      setMode("create");
    }
  }, [hasAccounts]);

  useEffect(() => {
    setError(initialError ?? null);
  }, [initialError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading || submitting) {
      return;
    }

    setError(null);

    try {
      setSubmitting(true);

      if (isCreateMode) {
        validateCreateAccount();
        const session = await createLocalAccount({
          displayName,
          email,
          password,
          username,
        });
        await onAuthenticated(session);
      } else {
        validateLogin();
        const session = await loginLocalAccount({
          login,
          password,
        });
        await onAuthenticated(session);
      }
    } catch (submitError) {
      setError(readErrorMessage(submitError, "The local auth request failed."));
    } finally {
      setSubmitting(false);
    }
  }

  function validateCreateAccount() {
    if (displayName.trim().length < 2) {
      throw new Error("Enter a display name with at least 2 characters.");
    }

    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username.trim())) {
      throw new Error("Choose a 3-32 character username using letters, numbers, dots, dashes, or underscores.");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new Error("Enter a valid email address.");
    }

    if (password.length < 8) {
      throw new Error("Use a password with at least 8 characters.");
    }

    if (password !== confirmPassword) {
      throw new Error("The password confirmation does not match.");
    }
  }

  function validateLogin() {
    if (!login.trim()) {
      throw new Error("Enter your username or email.");
    }

    if (!password) {
      throw new Error("Enter your password.");
    }
  }

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) {
      return;
    }

    setMode(nextMode);
    setError(null);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="auth-root">
      <AuthTopBar activeMode={mode} hasAccounts={hasAccounts} onModeChange={switchMode} />
      <main className="auth-shell">
        <div className="auth-ambient" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <section className="auth-brand-panel" aria-label="Gilbert Codex local auth">
          <div className="auth-brand-lockup">
            <div className="auth-brand-mark">
              <img src="/gilbert-codex-logo.svg" alt="" aria-hidden="true" draggable={false} />
            </div>
            <div>
              <span className="auth-kicker">Local-first workspace</span>
              <h1>Gilbert Codex</h1>
            </div>
          </div>
          <p>Keep chats, tools, settings, and workspace context tied to this computer and the local account you choose.</p>
          <div className="auth-workspace-preview" aria-hidden="true">
            <div className="auth-preview-header">
              <span />
              <span />
              <span />
            </div>
            <div className="auth-preview-body">
              <div className="auth-preview-thread">
                <strong>Project context</strong>
                <span>files / tools / runs</span>
              </div>
              <div className="auth-preview-grid">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="auth-preview-command">
                <Code2 size={15} />
                <span>ready for local work</span>
              </div>
            </div>
          </div>
          <div className="auth-local-stack" aria-label="Local account guarantees">
            <div>
              <Database size={16} aria-hidden="true" />
              <span>Local database</span>
            </div>
            <div>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>User-scoped workspace data</span>
            </div>
            <div>
              <Check size={16} aria-hidden="true" />
              <span>Password verifier, not plaintext</span>
            </div>
          </div>
        </section>

        <section className="auth-form-panel" aria-label={isCreateMode ? "Create local account" : "Sign in"}>
          <div className="auth-form-accent" aria-hidden="true">
            <Sparkles size={15} />
            <span>{isCreateMode ? "New local profile" : "Secure local entry"}</span>
          </div>
          <div className="auth-mode-switch" role="tablist" aria-label="Auth mode">
            <button type="button" role="tab" aria-selected={isCreateMode} data-active={isCreateMode} onClick={() => switchMode("create")}>
              Create account
            </button>
            <button type="button" role="tab" aria-selected={!isCreateMode} data-active={!isCreateMode} disabled={!hasAccounts} onClick={() => switchMode("login")}>
              Sign in
            </button>
          </div>

          <div className="auth-form-heading">
            <div className="auth-form-icon" aria-hidden="true">
              {isCreateMode ? <UserRound size={20} /> : <LockKeyhole size={20} />}
            </div>
            <div>
              <h2>{isCreateMode ? "Create your local account" : "Welcome back"}</h2>
              <p>{isCreateMode ? "This account stays on this device." : "Open your local Gilbert Codex workspace."}</p>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isCreateMode ? (
              <>
                <label className="auth-field">
                  <span>Display name</span>
                  <div className="auth-input-wrap">
                    <UserRound size={17} aria-hidden="true" />
                    <input value={displayName} autoComplete="name" placeholder="Your name" onChange={(event) => setDisplayName(event.target.value)} />
                  </div>
                </label>
                <label className="auth-field">
                  <span>Username</span>
                  <div className="auth-input-wrap">
                    <KeyRound size={17} aria-hidden="true" />
                    <input value={username} autoComplete="username" placeholder="local-user" onChange={(event) => setUsername(event.target.value)} />
                  </div>
                </label>
                <label className="auth-field">
                  <span>Email</span>
                  <div className="auth-input-wrap">
                    <Mail size={17} aria-hidden="true" />
                    <input value={email} type="email" autoComplete="email" placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} />
                  </div>
                </label>
              </>
            ) : (
              <label className="auth-field">
                <span>Username or email</span>
                <div className="auth-input-wrap">
                  <UserRound size={17} aria-hidden="true" />
                  <input value={login} autoComplete="username" placeholder="local-user" onChange={(event) => setLogin(event.target.value)} />
                </div>
              </label>
            )}

            <label className="auth-field">
              <span>Password</span>
              <div className="auth-input-wrap">
                <LockKeyhole size={17} aria-hidden="true" />
                <input value={password} type="password" autoComplete={isCreateMode ? "new-password" : "current-password"} onChange={(event) => setPassword(event.target.value)} />
              </div>
            </label>

            {isCreateMode ? (
              <>
                <label className="auth-field">
                  <span>Confirm password</span>
                  <div className="auth-input-wrap">
                    <LockKeyhole size={17} aria-hidden="true" />
                    <input value={confirmPassword} type="password" autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} />
                  </div>
                </label>
                <div className="auth-password-meter" data-score={passwordScore}>
                  <span />
                  <small>{getPasswordLabel(passwordScore)}</small>
                </div>
              </>
            ) : null}

            {error ? <div className="auth-error">{error}</div> : null}

            <button className="auth-submit" type="submit" disabled={loading || submitting}>
              <span>{loading ? "Loading local auth" : submitting ? "Working" : isCreateMode ? "Create account" : "Sign in"}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function getPasswordScore(password: string) {
  let score = 0;

  if (password.length >= 8) {
    score += 1;
  }

  if (password.length >= 12) {
    score += 1;
  }

  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) {
    score += 1;
  }

  if (/\d/.test(password) || /[^a-zA-Z0-9]/.test(password)) {
    score += 1;
  }

  return Math.min(score, 4);
}

function getPasswordLabel(score: number) {
  if (score >= 4) {
    return "Strong password";
  }

  if (score >= 2) {
    return "Good start";
  }

  return "Use 8+ characters";
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}
