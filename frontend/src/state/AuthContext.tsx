import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, http, readToken, TOKEN_KEY } from '../api/endpoints';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  login(email: string, password: string): Promise<User>;
  register(name: string, email: string, password: string): Promise<User>;
  logout(): void;
}

const AuthContext = createContext<AuthState | null>(null);

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable - session lasts for this tab only */
  }
}

/** Global authentication state (React Context). The token is the only thing persisted. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    storeToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    http.setUnauthorizedHandler(logout); // expired/invalid token anywhere -> signed out
    if (!readToken()) {
      setReady(true);
      return;
    }
    api.auth
      .me()
      .then(setUser)
      .catch(() => storeToken(null))
      .finally(() => setReady(true));
  }, [logout]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      logout,
      async login(email, password) {
        const res = await api.auth.login(email, password);
        storeToken(res.token);
        setUser(res.user);
        return res.user;
      },
      async register(name, email, password) {
        const res = await api.auth.register(name, email, password);
        storeToken(res.token);
        setUser(res.user);
        return res.user;
      },
    }),
    [user, ready, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
