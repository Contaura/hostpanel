import { useEffect, useState } from 'react';
import axios from 'axios';
import { Plus, Trash2, RefreshCw, ArrowUp } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, portalAuthHeader, FileItem } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Files() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [path, setPath]       = useState('/');
  const [items, setItems]     = useState<FileItem[]>([]);
  const [editor, setEditor]   = useState<{ path: string; content: string } | null>(null);
  const [busy, setBusy]       = useState(false);

  useEffect(() => { setPath('/'); }, [domain]);
  useEffect(() => { load(path); }, [path, domain]);

  async function load(p: string) {
    try {
      const r = await api(`/api/portal/files/${domain}/list?path=${encodeURIComponent(p)}`);
      setItems(r.data.items || []);
      setPath(r.data.path || p);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function open(name: string) {
    const full = path.replace(/\/$/, '') + '/' + name;
    try {
      const r = await api(`/api/portal/files/${domain}/read?path=${encodeURIComponent(full)}`);
      setEditor({ path: full, content: r.data.content });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function save() {
    if (!editor) return;
    setBusy(true);
    try { await apost(`/api/portal/files/${domain}/write`, { path: editor.path, content: editor.content }); toast.success('File saved'); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(name: string, type: string) {
    if (!await confirm(`Delete ${type === 'directory' ? 'folder' : 'file'} "${name}"?`)) return;
    const full = path.replace(/\/$/, '') + '/' + name;
    setBusy(true);
    try {
      await axios.delete(`/api/portal/files/${domain}/delete`, { headers: portalAuthHeader(), data: { path: full } });
      toast.success('Deleted');
      await load(path);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function mkdir() {
    const name = window.prompt('Folder name'); if (!name) return;
    const full = path.replace(/\/$/, '') + '/' + name.replace(/[/\\]/g, '');
    setBusy(true);
    try { await apost(`/api/portal/files/${domain}/mkdir`, { path: full }); toast.success('Folder created'); await load(path); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div>
      <PageTitle title="File Manager" subtitle={`Edit files inside /var/www/${domain}/public_html.`} />
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-500 truncate">{domain}:{path}</span>
          <button className="btn-secondary text-xs ml-auto" onClick={() => load(path)}><RefreshCw size={11} /> Refresh</button>
          <button className="btn-secondary text-xs" onClick={mkdir} disabled={busy}><Plus size={11} /> New folder</button>
          {path !== '/' && (
            <button className="btn-secondary text-xs" onClick={() => { const up = path.replace(/\/[^/]+\/?$/, '') || '/'; setPath(up); }}><ArrowUp size={11} /> Up</button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
            <th className="text-left py-2 px-1">Name</th><th className="text-left">Size</th><th className="text-left">Modified</th><th></th>
          </tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-400 text-xs">Empty</td></tr>}
            {items.map(f => (
              <tr key={f.name} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">
                  {f.type === 'directory'
                    ? <button className="text-indigo-600 hover:underline" onClick={() => setPath((path.replace(/\/$/, '') + '/' + f.name))}>{f.name}/</button>
                    : <button className="hover:underline" onClick={() => open(f.name)}>{f.name}</button>}
                </td>
                <td className="text-xs text-slate-500">{f.type === 'file' ? `${f.size} B` : '—'}</td>
                <td className="text-xs text-slate-500">{new Date(f.modified).toLocaleString()}</td>
                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => del(f.name, f.type)} disabled={busy}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {editor && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono">{editor.path}</span>
              <button className="btn-secondary text-xs ml-auto" onClick={() => setEditor(null)}>Close</button>
              <button className="btn-primary text-xs" onClick={save} disabled={busy}>Save</button>
            </div>
            <textarea className="input font-mono text-xs h-72" value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })} />
          </div>
        )}
      </div>
    </div>
  );
}
