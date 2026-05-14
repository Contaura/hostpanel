import { useEffect, useState, useRef, FormEvent } from 'react';
import axios from 'axios';
import {
  Folder, File, Upload, FolderPlus, Trash2, Edit3,
  Download, ChevronRight, Home, RefreshCw, X, Save, AlertCircle, Lock,
  Archive, PackageOpen, Scissors, Clipboard, PenLine,
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
  const [chmodTarget, setChmodTarget] = useState<FileItem | null>(null);
  const [chmodMode, setChmodMode] = useState('755');
  const [chmodRecursive, setChmodRecursive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compressFormat, setCompressFormat] = useState<'tar.gz' | 'zip'>('tar.gz');
  const [compressName, setCompressName] = useState('');
  const [showCompress, setShowCompress] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [clipboard, setClipboard] = useState<{ items: string[]; srcPath: string } | null>(null);

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

  async function compressSelected() {
    if (!selected.size || !compressName) { toast.error('Select files and enter archive name'); return; }
    const paths = Array.from(selected).map(n => `${currentPath}/${n}`);
    const dest = `${currentPath}/${compressName}.${compressFormat}`;
    try {
      await axios.post('/api/files/compress', { paths, destination: dest, format: compressFormat });
      toast.success('Archive created'); setShowCompress(false); setSelected(new Set()); setCompressName('');
      loadDir(currentPath);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Compress failed'); }
  }

  async function extractItem(item: FileItem) {
    try {
      await axios.post('/api/files/extract', { path: `${currentPath}/${item.name}` });
      toast.success('Extracted'); loadDir(currentPath);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Extract failed'); }
  }

  async function renameItem() {
    if (!renameTarget || !renameTo.trim()) { toast.error('Enter a new name'); return; }
    try {
      await axios.post('/api/files/rename', { from: `${currentPath}/${renameTarget}`, to: `${currentPath}/${renameTo.trim()}` });
      toast.success('Renamed');
      setRenameTarget(null); setRenameTo(''); loadDir(currentPath);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Rename failed'); }
  }

  function cutSelected() {
    if (!selected.size) { toast.error('Select files first'); return; }
    setClipboard({ items: Array.from(selected), srcPath: currentPath });
    setSelected(new Set());
    toast.success(`${selected.size} item(s) cut`);
  }

  async function pasteItems() {
    if (!clipboard) return;
    try {
      await Promise.all(clipboard.items.map(name =>
        axios.post('/api/files/move', {
          from: `${clipboard.srcPath}/${name}`,
          to: `${currentPath}/${name}`,
        })
      ));
      toast.success(`${clipboard.items.length} item(s) moved`);
      setClipboard(null); loadDir(currentPath);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Move failed'); }
  }

  async function applyChmod() {
    if (!chmodTarget || !/^[0-7]{3,4}$/.test(chmodMode)) { toast.error('Invalid permission mode'); return; }
    try {
      await axios.post('/api/files/chmod', { path: `${currentPath}/${chmodTarget.name}`, mode: chmodMode, recursive: chmodRecursive });
      toast.success(`Permissions set to ${chmodMode}`);
      setChmodTarget(null); loadDir(currentPath);
    } catch (e: any) { toast.error(e.response?.data?.error || 'chmod failed'); }
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
          {selected.size > 0 && (
            <>
              <button onClick={() => setShowCompress(true)} className="btn-secondary">
                <Archive size={14} /> Compress ({selected.size})
              </button>
              <button onClick={cutSelected} className="btn-secondary">
                <Scissors size={14} /> Cut ({selected.size})
              </button>
            </>
          )}
          {clipboard && (
            <button onClick={pasteItems} className="btn-secondary text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700">
              <Clipboard size={14} /> Paste ({clipboard.items.length})
            </button>
          )}
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
              <th className="w-8 px-2"><input type="checkbox" onChange={e => setSelected(e.target.checked ? new Set(items.map(i => i.name)) : new Set())} /></th>
              <th className="table-header-cell">Name</th>
              <th className="table-header-cell hidden md:table-cell">Size</th>
              <th className="table-header-cell hidden lg:table-cell">Modified</th>
              <th className="table-header-cell hidden lg:table-cell">Perms</th>
              <th className="px-4 py-3 w-28" />
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
                <td className="w-8 px-2"><input type="checkbox" checked={selected.has(item.name)} onChange={e => setSelected(s => { const n = new Set(s); e.target.checked ? n.add(item.name) : n.delete(item.name); return n; })} /></td>
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
                        {/\.(zip|tar\.gz|tgz|tar\.bz2|tar)$/i.test(item.name) && (
                          <button onClick={() => extractItem(item)} className="btn-icon text-amber-500" title="Extract"><PackageOpen size={13} /></button>
                        )}
                      </>
                    )}
                    <button onClick={() => { setRenameTarget(item.name); setRenameTo(item.name); }} className="btn-icon" title="Rename"><PenLine size={13} /></button>
                    <button onClick={() => { setChmodTarget(item); setChmodMode('755'); setChmodRecursive(false); }} className="btn-icon" title="Permissions"><Lock size={13} /></button>
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

      {/* Rename dialog */}
      {renameTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRenameTarget(null)}>
          <div className="card p-5 w-80 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-sm">Rename</h3>
            <div>
              <label className="label">New Name</label>
              <input className="input font-mono" value={renameTo} onChange={e => setRenameTo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && renameItem()} autoFocus />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={renameItem}>Rename</button>
              <button className="btn-ghost" onClick={() => setRenameTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Compress dialog */}
      {showCompress && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCompress(false)}>
          <div className="card p-5 w-80 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-sm">Create Archive</h3>
            <p className="text-xs text-slate-500">{selected.size} item{selected.size !== 1 ? 's' : ''} selected</p>
            <div>
              <label className="label">Archive Name</label>
              <input className="input font-mono" placeholder="archive" value={compressName} onChange={e => setCompressName(e.target.value)} />
            </div>
            <div>
              <label className="label">Format</label>
              <select className="input" value={compressFormat} onChange={e => setCompressFormat(e.target.value as any)}>
                <option value="tar.gz">tar.gz (recommended)</option>
                <option value="zip">zip</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={compressSelected}><Archive size={14} /> Create</button>
              <button className="btn-ghost" onClick={() => setShowCompress(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Chmod modal */}
      {chmodTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setChmodTarget(null)}>
          <div className="card p-5 w-80 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-sm">Change Permissions</h3>
            <p className="text-xs text-slate-500 font-mono">{currentPath}/{chmodTarget.name}</p>
            <div>
              <label className="label">Octal Mode</label>
              <input className="input font-mono" value={chmodMode} onChange={e => setChmodMode(e.target.value)} placeholder="755" maxLength={4} />
              <p className="text-xs text-slate-400 mt-1">e.g. 644 (file), 755 (dir), 600 (private)</p>
            </div>
            {chmodTarget.type === 'directory' && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={chmodRecursive} onChange={e => setChmodRecursive(e.target.checked)} />
                Apply recursively to all contents
              </label>
            )}
            <div className="flex gap-2">
              <button className="btn-primary" onClick={applyChmod}>Apply</button>
              <button className="btn-ghost" onClick={() => setChmodTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
