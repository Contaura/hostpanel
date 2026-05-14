import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

interface AuthState {
  token: string | null;
  username: string | null;
  role: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => ({
    token: localStorage.getItem('hp_token'),
    username: localStorage.getItem('hp_user'),
    role: localStorage.getItem('hp_role'),
  }));

  useEffect(() => {
    if (auth.token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${auth.token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [auth.token]);

  async function login(username: string, password: string) {
    const { data } = await axios.post('/api/auth/login', { username, password });
    const state = { token: data.token, username: data.username, role: data.role };
    setAuth(state);
    localStorage.setItem('hp_token', data.token);
    localStorage.setItem('hp_user', data.username);
    localStorage.setItem('hp_role', data.role);
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
  }

  function logout() {
    setAuth({ token: null, username: null, role: null });
    localStorage.removeItem('hp_token');
    localStorage.removeItem('hp_user');
    localStorage.removeItem('hp_role');
    delete axios.defaults.headers.common['Authorization'];
  }

  return (
    <AuthContext.Provider value={{ ...auth, login, logout, isAuthenticated: !!auth.token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
