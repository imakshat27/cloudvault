import React, { useState } from 'react';
import { X, FileText, Database, HardDrive, Clock, Check, Copy } from 'lucide-react';

export function DocPreviewModal({ doc, isOpen, onClose }) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  if (!isOpen || !doc) return null;

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg glass-panel rounded-2xl p-6 shadow-2xl border border-slate-700/80 bg-[#101524]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-sky-400" />
            <h3 className="text-base font-semibold text-white">Document Details & Metadata</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="mt-4 space-y-3 text-xs">
          
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400 block mb-1">Filename</span>
            <span className="text-slate-200 font-semibold text-sm break-all">{doc.filename}</span>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between">
            <div className="truncate mr-2">
              <span className="text-slate-400 block mb-0.5">Document UUID (RDS Primary Key)</span>
              <span className="text-slate-300 font-mono text-[11px] truncate block">{doc.id}</span>
            </div>
            <button
              onClick={() => copyToClipboard(doc.id, 'id')}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0"
              title="Copy ID"
            >
              {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between">
            <div className="truncate mr-2">
              <span className="text-slate-400 block mb-0.5">S3 Object Key (Raw Storage)</span>
              <span className="text-slate-300 font-mono text-[11px] truncate block">{doc.s3_key}</span>
            </div>
            <button
              onClick={() => copyToClipboard(doc.s3_key, 'key')}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0"
              title="Copy S3 Key"
            >
              {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">Payload Size</span>
              <span className="text-slate-200 font-semibold">{formatFileSize(doc.file_size)}</span>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">Vector Index Status</span>
              <span className={`font-semibold capitalize ${doc.status === 'ready' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {doc.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">pgvector Chunks</span>
              <span className="text-slate-200 font-semibold">{doc.chunk_count || 0} chunks</span>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 block mb-1">Uploaded Timestamp</span>
              <span className="text-slate-300 text-[11px]">{new Date(doc.uploaded_at).toLocaleString()}</span>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
