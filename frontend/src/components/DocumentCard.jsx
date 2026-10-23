import React, { useEffect, useState } from 'react';
import { 
  FileText, CheckCircle2, Clock, AlertTriangle, 
  Trash2, Share2, Info, RefreshCw, Layers, ShieldCheck, Users
} from 'lucide-react';
import { api } from '../services/api';

export function DocumentCard({ doc, onDeleted, onShareClick, onInfoClick }) {
  const [currentDoc, setCurrentDoc] = useState(doc);
  const [deleting, setDeleting] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  // Sync state if prop changes
  useEffect(() => {
    setCurrentDoc(doc);
  }, [doc]);

  // Real-time status polling if document is currently in pending or processing state
  useEffect(() => {
    if (currentDoc.status !== 'pending' && currentDoc.status !== 'processing') {
      return;
    }

    const intervalId = setInterval(async () => {
      try {
        const statusRes = await api.getDocumentStatus(currentDoc.id);
        if (statusRes.status !== currentDoc.status) {
          setCurrentDoc(prev => ({
            ...prev,
            status: statusRes.status,
            error_message: statusRes.errorMessage
          }));
        }
      } catch (err) {
        console.warn(`Polling error for doc ${currentDoc.id}:`, err);
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [currentDoc.id, currentDoc.status]);

  const handleDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete "${currentDoc.filename}"? All associated vector embeddings will also be permanently purged.`)) {
      return;
    }

    try {
      setDeleting(true);
      await api.deleteDocument(currentDoc.id);
      onDeleted(currentDoc.id);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
      setDeleting(false);
    }
  };

  const handleReindex = async () => {
    try {
      setReindexing(true);
      await api.reindexDocument(currentDoc.id);
      setCurrentDoc(prev => ({ ...prev, status: 'processing', error_message: null }));
    } catch (err) {
      alert(`Re-indexing failed: ${err.message}`);
    } finally {
      setReindexing(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getFileBadge = (filename) => {
    const ext = filename.split('.').pop()?.toUpperCase() || 'FILE';
    switch (ext) {
      case 'PDF':
        return { label: 'PDF', color: 'from-rose-500 to-red-600', text: 'text-rose-400' };
      case 'DOCX':
        return { label: 'DOCX', color: 'from-blue-500 to-indigo-600', text: 'text-blue-400' };
      default:
        return { label: ext, color: 'from-sky-500 to-cyan-600', text: 'text-sky-400' };
    }
  };

  const fileBadge = getFileBadge(currentDoc.filename);

  return (
    <div className="glass-card rounded-xl p-5 flex flex-col justify-between border border-slate-800 hover:border-sky-500/40 transition-all duration-300">
      
      {/* Top Header: File Icon, Name, and Status Badge */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center space-x-3 truncate">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${fileBadge.color} flex items-center justify-center text-white font-bold text-xs shadow-md shrink-0`}>
              {fileBadge.label}
            </div>
            <div className="truncate">
              <h4 
                className="text-sm font-semibold text-slate-100 truncate hover:text-sky-400 cursor-pointer transition-colors"
                onClick={() => onInfoClick(currentDoc)}
                title={currentDoc.filename}
              >
                {currentDoc.filename}
              </h4>
              <p className="text-xs text-slate-500 flex items-center space-x-2 mt-0.5">
                <span>{formatFileSize(currentDoc.file_size)}</span>
                <span>•</span>
                <span>{formatDate(currentDoc.uploaded_at)}</span>
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="shrink-0">
            {currentDoc.status === 'ready' && (
              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" />
                <span>Ready</span>
              </span>
            )}

            {currentDoc.status === 'processing' && (
              <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
                <span>Vectorizing</span>
              </span>
            )}

            {currentDoc.status === 'pending' && (
              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Clock className="w-3 h-3" />
                <span>Pending</span>
              </span>
            )}

            {currentDoc.status === 'failed' && (
              <span 
                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 cursor-help"
                title={currentDoc.error_message || 'Ingestion failed'}
              >
                <AlertTriangle className="w-3 h-3" />
                <span>Failed</span>
              </span>
            )}
          </div>
        </div>

        {/* Vector Ingestion Info / Error snippet */}
        <div className="mt-3 py-2 px-3 rounded-lg bg-slate-900/50 border border-slate-800/80 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-1.5 text-slate-400">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Chunks:</span>
            <span className="text-slate-200 font-semibold">{currentDoc.chunk_count || 0}</span>
          </div>

          <div className="flex items-center space-x-1 text-slate-400 text-[11px]">
            {currentDoc.is_owner ? (
              <span className="text-sky-400 flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Owner</span>
              </span>
            ) : (
              <span className="text-indigo-400 flex items-center space-x-1">
                <Users className="w-3 h-3" />
                <span>Shared by {currentDoc.owner_email?.split('@')[0]}</span>
              </span>
            )}
          </div>
        </div>

        {/* Error message display if failed */}
        {currentDoc.status === 'failed' && currentDoc.error_message && (
          <p className="mt-2 text-xs text-rose-400/90 truncate bg-rose-500/5 p-2 rounded border border-rose-500/10">
            Error: {currentDoc.error_message}
          </p>
        )}
      </div>

      {/* Action Footer */}
      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
        <button
          onClick={() => onInfoClick(currentDoc)}
          className="text-xs text-slate-400 hover:text-sky-400 flex items-center space-x-1 transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
          <span>Details</span>
        </button>

        <div className="flex items-center space-x-2">
          {currentDoc.status === 'failed' && currentDoc.is_owner && (
            <button
              onClick={handleReindex}
              disabled={reindexing}
              title="Re-run vector ingestion"
              className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-400/10 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reindexing ? 'animate-spin' : ''}`} />
            </button>
          )}

          {currentDoc.is_owner && (
            <button
              onClick={() => onShareClick(currentDoc)}
              title="Share document"
              className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-400/10 rounded-lg transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          )}

          {currentDoc.is_owner && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Delete document and purge vectors"
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
