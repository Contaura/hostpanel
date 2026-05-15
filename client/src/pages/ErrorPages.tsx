import { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Save, RefreshCw } from 'lucide-react';
import { useToast } from '../components/Toast';

const ERROR_CODES = [400, 401, 403, 404, 500, 502, 503];
const ERROR_LABELS: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
  404: 'Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
};

export default function ErrorPages() {
  const toast = useToast();
  const [domains, setDomains] = useState<string[]>([]);
  const [domain, setDomain] = useState('');
  const [code, setCode] = useState(404);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    document.title = 'Error Pages — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => {
    axios.get<string[]>('/api/domains/domains').then(r => {
      setDomains(r.data);
      if (r.data.length) setDomain(r.data[0]);
    }).catch(() => {}).finally(() => setPageLoading(false));
  }, []);

  async function loadPage() {
    if (!domain) return;
    setLoading(true);
    try {
      const { data } = await axios.get('/api/errpages/read', { params: { domain, code } });
      setContent(data.content);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to load'); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadPage(); }, [domain, code]);

  async function save() {
    setSaving(true);
    try {
      await axios.post('/api/errpages/save', { domain, code, content });
      toast.success(`Error ${code} page saved for ${domain}`);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  }

  if (pageLoading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Error Pages</h1>
        <p className="page-subtitle">Customize HTTP error pages per domain</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Domain</label>
          <select className="input w-52" value={domain} onChange={e => setDomain(e.target.value)}>
            {domains.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Error Code</label>
          <div className="flex flex-wrap gap-2">
            {ERROR_CODES.map(c => (
              <button key={c} type="button"
                onClick={() => setCode(c)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                  code === c
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-indigo-300 hover:text-indigo-600 dark:hover:border-indigo-600 dark:hover:text-indigo-400'
                }`}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <button onClick={loadPage} className="btn-secondary self-end">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {domain && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {code} — {ERROR_LABELS[code]} for {domain}
              </span>
            </div>
            <button onClick={save} disabled={saving} className="btn-primary">
              <Save size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <textarea
            className="input font-mono text-xs leading-relaxed resize-y"
            style={{ minHeight: '400px' }}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="HTML content for the error page…"
            spellCheck={false}
          />
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Changes are saved to <code className="font-mono">/var/www/{domain}/public_html/error{code}.html</code> and the Apache vhost is updated automatically.
          </p>
        </div>
      )}
    </div>
  );
}
