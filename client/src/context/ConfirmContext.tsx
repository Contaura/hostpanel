import { createContext, useContext, useRef, useState, ReactNode } from 'react';
import ConfirmModal from '../components/ConfirmModal';

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<(message: string) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  function confirm(message: string): Promise<boolean> {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setState({ message, resolve });
    });
  }

  function handle(result: boolean) {
    resolveRef.current?.(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && <ConfirmModal message={state.message} onConfirm={() => handle(true)} onCancel={() => handle(false)} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
