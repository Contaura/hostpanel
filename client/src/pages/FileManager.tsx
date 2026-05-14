import { useEffect, useState, useRef, FormEvent } from 'react';
import axios from 'axios';
import {
  Folder, File, Upload, FolderPlus, Trash2, Edit3,
  Download, ChevronRight, Home, RefreshCw, X, Save, AlertCircle,
} from 'lucide-react';
import { useToast } from '../components/Toast';

interface FileItem {
  name: string; type: 'file' | 'directory';
  size: number; modified: string; permissions: string;
}

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}

export default function FileManager() {
  const toast = useToast();
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadDir(path: string) {
    setLoading(true); setError('');
    try {
      const { data } = await axios.get('/api/files/list', { params: { path } });
      setCurrentPath(data.path); setItems(data.items);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to load directory');
    } finally { setLoading(false); }
  }

  useEffect(() => { loadDir('/'); }, []);

  function navigate(item: FileItem) {
    if (item.type === 'directory') loadDir(`${currentPath}/${item.name}`.replace('//', '/'));
  }

  function goUp() {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    loadDir('/' + parts.join('/') || '/');
  }

  async function deleteItem(item: FileItem) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await axios.delete('/api/files/delete', { data: { path: `${currentPath}/${item.name}` } });
      toast.success(`"${item.name}" deleted`); loadDir(currentPath);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Delete failed'); }
  }

  async function openEditor(item: FileItem) {
    try {
      const { data } = await axios.get('/api/files/read', { params: { path: `${currentPath}/${item.name}` } });
      setEditing({ path: `${currentPath}/${item.name}`, content: data.content });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Cannot open file'); }
  }

  async function saveFile() {
    if (!editing) return;
    try {
      await axios.post('/api/files/write', { path: editing.path, content: editing.content });
      toast.success('File saved'); setEditing(null);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Save failed'); }
  }

  async function createFolder(e: FormEvent) {
    e.preventDefault(); if (!newFolderName) return;
    try {
      await axios.post('/api/files/mkdir', { path: `${currentPath}/${newFolderName}` });
      toast.success(`Folder "${newFolderName}" created`);
      setNewFolderName(''); setShowNewFolder(false); loadDir(currentPath);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to create folder'); }
  }

  async function uploadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files; if (!files?.length) return;
    setUploading(true);
    const form = new FormData();
    for (const f of files) form.append('files', f);
    try {
      await axios.post('/api/files/upload', form, {
        params: { path: currentPath },
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`${files.length} file(s) uploaded`); loadDir(currentPath);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); e.target.value = ''; }
  }

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  if (editing) {
    return (
      <div className="h-full flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase font-bold tracking-wide">Editing</p>
            <p className="text-sm font-mono text-slate-900 dark:text-slate-100 mt-0.5">{editing.path}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(null)} className="btn-secondary"><X size={14} /> Cancel</button>
            <button onClick={saveFile} className="btn-primary"><Save size={14} /> Save file</button>
          </div>
        </div>
        <textarea
          className="flex-1 font-mono text-sm rounded-xl border border-slate-200 dark:border-slate-700
                     bg-slate-950 text-slate-100 px-4 py-3 resize-none
                     focus:outline-none focus:ring-2 focus:ring-indigo-400 leading-relaxed"
          value={editing.content}
          onChange={e => setEditing({ ...editing, content: e.target.value })}
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">File Manager</h1>
          <p className="page-subtitle">Browse and manage server files</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowNewFolder(v => !v)} className="btn-secondary">
            <FolderPlus size={14} /> New folder
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-primary">
            {uploading
              ? <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Uploading…</>
              : <><Upload size={14} /> Upload</>
            }
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={uploadFiles} />
        </div>
      </div>

      {showNewFolder && (
        <form onSubmit={createFolder} className="flex gap-2 items-center">
          <input className="input max-w-xs" placeholder="Folder name" value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)} autoFocus />
          <button type="submit" className="btn-primary">Create</button>
          <button type="button" onClick={() => setShowNewFolder(false)} className="btn-ghost">Cancel</button>
        </form>
      )}

      <div className="card overflow-hidden">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700 text-sm">
          <button onClick={() => loadDir('/')} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400">
            <Home size={13} />
          </button>
          {breadcrumbs.map((part, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <ChevronRight size={12} className="text-slate-300 dark:text-slate-600" />
              <button
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                onClick={() => loadDir('/' + breadcrumbs.slice(0, i + 1).join('/'))}
              >
                {part}
              </button>
            </span>
          ))}
          <button onClick={() => loadDir(currentPath)} className="ml-auto p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 dark:text-slate-500">
            <RefreshCw size={13} />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-sm border-b border-rose-100 dark:border-rose-800/50">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700">
            <tr>
              <th className="table-header-cell">Name</th>
              <th className="table-header-cell hidden md:table-cell">Size</th>
              <th className="table-header-cell hidden lg:table-cell">Modified</th>
              <th className="table-header-cell hidden lg:table-cell">Perms</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {currentPath !== '/' && (
              <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer border-b border-slate-50 dark:border-slate-700/40" onClick={goUp}>
                <td className="table-cell">
                  <div className="flex items-center gap-2.5">
                    <Folder size={16} className="text-amber-400" />
                    <span className="text-indigo-600 dark:text-indigo-400 font-medium">..</span>
                  </div>
                </td>
                <td colSpan={4} />
              </tr>
            )}
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-16 text-center text-slate-400 text-sm">This directory is empty</td></tr>
            ) : items.map(item => (
              <tr key={item.name} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 border-b border-slate-50 dark:border-slate-700/40 last:border-0 group">
                <td className="table-cell cursor-pointer" onClick={() => navigate(item)}>
                  <div className="flex items-center gap-2.5">
                    {item.type === 'directory'
                      ? <Folder size={16} className="text-amber-400 flex-shrink-0" />
                      : <File   size={16} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                    }
                    <span className={item.type === 'directory' ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-800 dark:text-slate-200'}>
                      {item.name}
                    </span>
                  </div>
                </td>
                <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">
                  {item.type === 'file' ? formatSize(item.size) : '—'}
                </td>
                <td className="table-cell text-slate-500 dark:text-slate-400 hidden lg:table-cell text-xs">
                  {new Date(item.modified).toLocaleString()}
                </td>
                <td className="table-cell font-mono text-xs text-slate-400 dark:text-slate-500 hidden lg:table-cell">
                  {item.permissions}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.type === 'file' && (
                      <>
                        <button onClick={() => openEditor(item)} className="btn-icon" title="Edit"><Edit3 size={13} /></button>
                        <a href={`/api/files/download?path=${encodeURIComponent(`${currentPath}/${item.name}`)}`} className="btn-icon" title="Download">
                          <Download size={13} />
                        </a>
                      </>
                    )}
                    <button onClick={() => deleteItem(item)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
