import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-4">
      <p className="text-7xl font-black text-slate-200 dark:text-slate-700">404</p>
      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">Page not found</p>
      <p className="text-sm text-slate-500">The page you're looking for doesn't exist.</p>
      <button className="btn-primary" onClick={() => navigate('/')}>Go to Dashboard</button>
    </div>
  );
}
