import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((type: ToastType, message: string) => {
    const id = ++nextId;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const value: ToastContextValue = {
    success: (msg) => add('success', msg),
    error:   (msg) => add('error',   msg),
    info:    (msg) => add('info',    msg),
  };

  const icons = { success: CheckCircle, error: XCircle, info: Info } as const;

  const styles: Record<ToastType, string> = {
    success: 'border-emerald-200 dark:border-emerald-700/60 text-emerald-700 dark:text-emerald-300',
    error:   'border-rose-200    dark:border-rose-700/60    text-rose-700    dark:text-rose-300',
    info:    'border-indigo-200  dark:border-indigo-700/60  text-indigo-700  dark:text-indigo-300',
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => {
          const Icon = icons[toast.type];
          return (
            <div
              key={toast.id}
              className={`flex items-center gap-3 rounded-xl border shadow-lg shadow-black/10 dark:shadow-black/40
                          bg-white dark:bg-slate-800 px-4 py-3 text-sm font-medium
                          min-w-64 max-w-sm pointer-events-auto animate-in ${styles[toast.type]}`}
            >
              <Icon size={16} className="flex-shrink-0" />
              <span className="flex-1 text-slate-800 dark:text-slate-200">{toast.message}</span>
              <button
                onClick={() => remove(toast.id)}
                className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
