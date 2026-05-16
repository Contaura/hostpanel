import { Outlet } from 'react-router-dom';
import { PortalAuthProvider, usePortalAuth } from './PortalAuthContext';
import PortalSidebar from './PortalSidebar';
import PortalHeader from './PortalHeader';

function Inner() {
  const { loading, token } = usePortalAuth();
  if (!token) return null;
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-slate-900">
      <PortalSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <PortalHeader />
        <main className="flex-1 overflow-y-auto p-6">
          {loading ? <div className="text-slate-400 text-sm">Loading…</div> : <Outlet />}
        </main>
      </div>
    </div>
  );
}

export default function PortalLayout() {
  return (
    <PortalAuthProvider>
      <Inner />
    </PortalAuthProvider>
  );
}
