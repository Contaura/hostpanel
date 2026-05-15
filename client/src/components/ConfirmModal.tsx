import { AlertTriangle } from 'lucide-react';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ message, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-sm w-full p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 h-9 w-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle size={16} className="text-red-500" />
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-1.5">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost text-sm" onClick={onCancel}>Cancel</button>
          <button className="btn-danger text-sm" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
