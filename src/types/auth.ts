export interface AuthUser {
  createdAt: number;
  displayName: string;
  email: string;
  id: string;
  lastLoginAt?: number;
  updatedAt: number;
  username: string;
}

export interface AuthSession {
  createdAt: number;
  sessionToken: string;
  user: AuthUser;
}

export interface AuthStateResponse {
  hasAccounts: boolean;
  session: AuthSession | null;
}

export interface CreateLocalAccountInput {
  displayName: string;
  email: string;
  password: string;
  username: string;
}

export interface LoginLocalAccountInput {
  login: string;
  password: string;
}
