import { ReactNode } from 'react';
import { Server } from 'lucide-react';
import { usePortalAuth } from './PortalAuthContext';
import { PortalAccount } from './api';

/**
 * Wrapper for per-account pages: renders children only when an account is
 * selected; otherwise shows an inline "pick an account" placeholder. The
 * sidebar already disables these links when there is no account, but a user
 * could deep-link or refresh into one — this catches that.
 */
export function RequireAccount({ children }: { children: (account: PortalAccount) => ReactNode }) {
  const { selectedAccount, accounts } = usePortalAuth();
  if (!selectedAccount) {
    return (
      <div className="card p-8 text-center text-slate-500 text-sm">
        <Server size={28} className="mx-auto mb-3 text-slate-300" />
        {accounts.length === 0
          ? <>You don't have a hosting account yet. Contact your hosting provider to get set up.</>
          : <>Pick a hosting account from the sidebar to manage it here.</>}
      </div>
    );
  }
  return <>{children(selectedAccount)}</>;
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4 gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
