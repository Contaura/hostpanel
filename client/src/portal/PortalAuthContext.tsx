import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, PortalAccount, PortalClient } from './api';

interface PortalAuthValue {
  token: string | null;
  client: PortalClient | null;
  accounts: PortalAccount[];
  selectedAccount: PortalAccount | null;
  setSelectedAccount: (a: PortalAccount | null) => void;
  refreshAccounts: () => Promise<void>;
  refreshClient: () => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const Ctx = createContext<PortalAuthValue | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [token, setToken]                     = useState<string | null>(() => localStorage.getItem('hp_portal_token'));
  const [client, setClient]                   = useState<PortalClient | null>(null);
  const [accounts, setAccounts]               = useState<PortalAccount[]>([]);
  const [selectedAccount, setSelected]        = useState<PortalAccount | null>(null);
  const [loading, setLoading]                 = useState(true);

  const refreshClient = useCallback(async () => {
    try { const r = await api<PortalClient>('/api/portal/me'); setClient(r.data); }
    catch { setClient(null); }
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      const r = await api<PortalAccount[]>('/api/portal/accounts');
      setAccounts(r.data || []);
      // Restore previous selection by id if still present, else pick first
      setSelected(prev => {
        if (prev && r.data.find(a => a.id === prev.id)) return prev;
        const savedId = Number(localStorage.getItem('hp_portal_account_id') || 0);
        const restored = savedId ? r.data.find(a => a.id === savedId) : null;
        return restored || r.data[0] || null;
      });
    } catch { setAccounts([]); setSelected(null); }
  }, []);

  function setSelectedAccount(a: PortalAccount | null) {
    setSelected(a);
    if (a) localStorage.setItem('hp_portal_account_id', String(a.id));
    else   localStorage.removeItem('hp_portal_account_id');
  }

  useEffect(() => {
    if (!token) { setLoading(false); navigate('/portal/login'); return; }
    setLoading(true);
    Promise.all([refreshClient(), refreshAccounts()])
      .finally(() => setLoading(false));
  }, [token, refreshClient, refreshAccounts, navigate]);

  function logout() {
    localStorage.removeItem('hp_portal_token');
    localStorage.removeItem('hp_portal_name');
    localStorage.removeItem('hp_portal_account_id');
    setToken(null);
    setClient(null);
    setAccounts([]);
    setSelected(null);
    navigate('/portal/login');
  }

  return (
    <Ctx.Provider value={{ token, client, accounts, selectedAccount, setSelectedAccount, refreshAccounts, refreshClient, logout, loading }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePortalAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePortalAuth must be used inside PortalAuthProvider');
  return v;
}
