import { invoke } from "@tauri-apps/api/core";
import type { AuthSession, AuthStateResponse, CreateLocalAccountInput, LoginLocalAccountInput } from "../types/auth";
import { isTauriDesktopRuntime } from "./tauriClient";

const AUTH_DB_KEY = "gilbert-codex.local-auth-db.v1";
const AUTH_DATABASE_GENERATION = 2;
const PASSWORD_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_BITS = 256;
const WORKSPACE_STORAGE_KEYS = [
  "gilbert-codex.chats.v1",
  "gilbert-codex.projects.v1",
  "gilbert-codex.provider-settings.v1",
  "gilbert-codex.thinking-settings.v1",
  "gilbert-codex.appearance.v1",
  "gilbert-codex.active-chat.v1",
  "gilbert-codex.local-workspace.v1",
  "gilbert-codex.tool-registry.v1",
  "gilbert-codex.github-oauth-client-id.v1",
  "gilbert-codex.discord-bridge.v1",
  "gilbert-codex.browser-preview.v2",
  "gilbert-codex.browser-preview.v1",
  "gilbert-codex.agent-runs.v1",
];

interface AuthUserRecord {
  createdAt: number;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt?: number;
  passwordHash: string;
  passwordHashAlgorithm: string;
  passwordIterations: number;
  passwordSalt: string;
  updatedAt: number;
  username: string;
}

interface AuthSessionRecord {
  createdAt: number;
  sessionToken: string;
  userId: string;
}

interface BrowserAuthDatabase {
  currentSession: AuthSessionRecord | null;
  databaseGeneration: number;
  users: AuthUserRecord[];
}

interface AuthLoginChallenge {
  displayName: string;
  passwordHashAlgorithm: string;
  passwordIterations: number;
  passwordSalt: string;
  username: string;
}

export async function getAuthState(): Promise<AuthStateResponse> {
  if (isTauriDesktopRuntime()) {
    return invoke<AuthStateResponse>("auth_get_state");
  }

  return getBrowserAuthState();
}

export async function createLocalAccount(input: CreateLocalAccountInput): Promise<AuthSession> {
  const passwordSalt = createRandomBase64(18);
  const passwordHash = await derivePasswordHash(input.password, passwordSalt, PASSWORD_ITERATIONS, PASSWORD_ALGORITHM);
  const request = {
    displayName: input.displayName.trim(),
    email: input.email.trim(),
    passwordHash,
    passwordHashAlgorithm: PASSWORD_ALGORITHM,
    passwordIterations: PASSWORD_ITERATIONS,
    passwordSalt,
    username: input.username.trim(),
  };

  if (isTauriDesktopRuntime()) {
    return invoke<AuthSession>("auth_create_account", { request });
  }

  return createBrowserAccount(request);
}

export async function loginLocalAccount(input: LoginLocalAccountInput): Promise<AuthSession> {
  const login = input.login.trim();
  const challenge = await getLoginChallenge(login);
  const passwordHash = await derivePasswordHash(input.password, challenge.passwordSalt, challenge.passwordIterations, challenge.passwordHashAlgorithm);

  if (isTauriDesktopRuntime()) {
    return invoke<AuthSession>("auth_login", {
      request: {
        login,
        passwordHash,
      },
    });
  }

  return loginBrowserAccount(login, passwordHash);
}

export async function logoutLocalAccount(): Promise<void> {
  if (isTauriDesktopRuntime()) {
    await invoke<void>("auth_logout");
    return;
  }

  const database = loadBrowserDatabase();
  database.currentSession = null;
  saveBrowserDatabase(database);
}

async function getLoginChallenge(login: string): Promise<AuthLoginChallenge> {
  if (isTauriDesktopRuntime()) {
    return invoke<AuthLoginChallenge>("auth_get_login_challenge", {
      request: {
        login,
      },
    });
  }

  const database = loadBrowserDatabase();
  const user = findBrowserUser(database, login);

  if (!user) {
    throw new Error("No local account matches that username or email.");
  }

  return {
    displayName: user.displayName,
    passwordHashAlgorithm: user.passwordHashAlgorithm,
    passwordIterations: user.passwordIterations,
    passwordSalt: user.passwordSalt,
    username: user.username,
  };
}

async function derivePasswordHash(password: string, saltBase64: string, iterations: number, algorithm: string) {
  if (algorithm !== PASSWORD_ALGORITHM) {
    throw new Error("Unsupported local password hashing algorithm.");
  }

  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure local password hashing is not available in this runtime.");
  }

  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      iterations,
      name: "PBKDF2",
      salt: decodeBase64(saltBase64),
    },
    key,
    PASSWORD_KEY_BITS,
  );

  return encodeBase64(new Uint8Array(bits));
}

function createBrowserAccount(request: Omit<AuthUserRecord, "createdAt" | "id" | "lastLoginAt" | "updatedAt">) {
  const database = loadBrowserDatabase();
  const username = normalizeUsername(request.username);
  const email = normalizeEmail(request.email);
  const displayName = normalizeDisplayName(request.displayName);

  if (database.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("That username is already used by another local account.");
  }

  if (database.users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
    throw new Error("That email is already used by another local account.");
  }

  const now = Date.now();
  const user: AuthUserRecord = {
    ...request,
    createdAt: now,
    displayName,
    email,
    id: `user-${createRandomId()}`,
    lastLoginAt: now,
    updatedAt: now,
    username,
  };
  const session = createBrowserSession(user, now);

  database.users.push(user);
  database.currentSession = {
    createdAt: session.createdAt,
    sessionToken: session.sessionToken,
    userId: user.id,
  };
  saveBrowserDatabase(database);

  return session;
}

function loginBrowserAccount(login: string, passwordHash: string) {
  const database = loadBrowserDatabase();
  const userIndex = database.users.findIndex((user) => loginMatchesUser(user, login));

  if (userIndex < 0) {
    throw new Error("No local account matches that username or email.");
  }

  if (database.users[userIndex].passwordHash !== passwordHash) {
    throw new Error("The password did not match this local account.");
  }

  const now = Date.now();
  database.users[userIndex] = {
    ...database.users[userIndex],
    lastLoginAt: now,
    updatedAt: now,
  };

  const session = createBrowserSession(database.users[userIndex], now);
  database.currentSession = {
    createdAt: session.createdAt,
    sessionToken: session.sessionToken,
    userId: database.users[userIndex].id,
  };
  saveBrowserDatabase(database);

  return session;
}

function getBrowserAuthState(): AuthStateResponse {
  const database = loadBrowserDatabase();
  const session = database.currentSession ? createSessionFromDatabase(database, database.currentSession) : null;

  return {
    hasAccounts: database.users.length > 0,
    session,
  };
}

function createBrowserSession(user: AuthUserRecord, createdAt: number): AuthSession {
  return {
    createdAt,
    sessionToken: `session-${createRandomId()}`,
    user: publicUser(user),
  };
}

function createSessionFromDatabase(database: BrowserAuthDatabase, session: AuthSessionRecord): AuthSession | null {
  const user = database.users.find((record) => record.id === session.userId);

  if (!user) {
    return null;
  }

  return {
    createdAt: session.createdAt,
    sessionToken: session.sessionToken,
    user: publicUser(user),
  };
}

function publicUser(user: AuthUserRecord) {
  return {
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    lastLoginAt: user.lastLoginAt,
    updatedAt: user.updatedAt,
    username: user.username,
  };
}

function loadBrowserDatabase(): BrowserAuthDatabase {
  try {
    const storedValue = window.localStorage.getItem(AUTH_DB_KEY);
    const parsed = storedValue ? (JSON.parse(storedValue) as Partial<BrowserAuthDatabase>) : null;

    if (!parsed || !Array.isArray(parsed.users)) {
      return createEmptyBrowserDatabase();
    }

    if (parsed.databaseGeneration !== AUTH_DATABASE_GENERATION) {
      return resetBrowserAuthDatabase();
    }

    return {
      currentSession: parsed.currentSession ?? null,
      databaseGeneration: AUTH_DATABASE_GENERATION,
      users: parsed.users.filter(isBrowserUserRecord),
    };
  } catch {
    return resetBrowserAuthDatabase();
  }
}

function saveBrowserDatabase(database: BrowserAuthDatabase) {
  window.localStorage.setItem(AUTH_DB_KEY, JSON.stringify(database));
}

function createEmptyBrowserDatabase(): BrowserAuthDatabase {
  return {
    currentSession: null,
    databaseGeneration: AUTH_DATABASE_GENERATION,
    users: [],
  };
}

function resetBrowserAuthDatabase() {
  const database = createEmptyBrowserDatabase();

  try {
    removeBrowserWorkspaceStorage();
    saveBrowserDatabase(database);
  } catch {
    return database;
  }

  return database;
}

function removeBrowserWorkspaceStorage() {
  const keysToRemove: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (!key) {
      continue;
    }

    if (key === AUTH_DB_KEY || WORKSPACE_STORAGE_KEYS.some((storageKey) => key === storageKey || key.startsWith(`${storageKey}.user.`))) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}

function findBrowserUser(database: BrowserAuthDatabase, login: string) {
  return database.users.find((user) => loginMatchesUser(user, login));
}

function loginMatchesUser(user: AuthUserRecord, login: string) {
  const normalizedLogin = login.trim().toLowerCase();

  return user.username.toLowerCase() === normalizedLogin || user.email.toLowerCase() === normalizedLogin;
}

function normalizeDisplayName(value: string) {
  const displayName = value.trim();

  if (displayName.length < 2) {
    throw new Error("Enter a display name with at least 2 characters.");
  }

  if (displayName.length > 80) {
    throw new Error("Keep the display name under 80 characters.");
  }

  return displayName;
}

function normalizeUsername(value: string) {
  const username = value.trim().replace(/^@+/, "").toLowerCase();

  if (username.length < 3) {
    throw new Error("Choose a username with at least 3 characters.");
  }

  if (username.length > 32) {
    throw new Error("Keep the username under 32 characters.");
  }

  if (!/^[a-z0-9_.-]+$/.test(username)) {
    throw new Error("Use only letters, numbers, dots, dashes, or underscores in the username.");
  }

  return username;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address for this local account.");
  }

  return email;
}

function isBrowserUserRecord(value: unknown): value is AuthUserRecord {
  if (typeof value !== "object" || !value) {
    return false;
  }

  const user = value as Partial<AuthUserRecord>;

  return (
    typeof user.id === "string" &&
    typeof user.displayName === "string" &&
    typeof user.email === "string" &&
    typeof user.username === "string" &&
    typeof user.passwordHash === "string" &&
    typeof user.passwordSalt === "string"
  );
}

function createRandomId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

function createRandomBase64(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return encodeBase64(bytes);
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
