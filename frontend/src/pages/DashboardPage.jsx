import React, { useState, useEffect } from 'react';
import { 
  FileText, Upload, Search, Filter, Layers, HardDrive, 
  CheckCircle2, Clock, RefreshCw, AlertCircle, Plus, Sparkles
} from 'lucide-react';
import { api } from '../services/api';
import { Navbar } from '../components/Navbar';
import { DocumentCard } from '../components/DocumentCard';
import { UploadModal } from '../components/UploadModal';
import { ShareModal } from '../components/ShareModal';
import { DocPreviewModal } from '../components/DocPreviewModal';
import { SearchAskWidget } from '../components/SearchAskWidget';

export function DashboardPage() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [tab, setTab] = useState('all'); // 'all' | 'owned' | 'shared'

  // Modals
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [shareDoc, setShareDoc] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);

  const fetchDocuments = async () => {
    try {
      setError(null);
      const res = await api.listDocuments();
      setDocuments(res.documents || []);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
    // Periodic refresh every 10 seconds for any background updates
    const interval = setInterval(fetchDocuments, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleDocumentDeleted = (deletedId) => {
    setDocuments(prev => prev.filter(d => d.id !== deletedId));
  };

  const handleUploadSuccess = () => {
    fetchDocuments();
  };

  // Filtered documents
  const filteredDocs = documents.filter(doc => {
    const matchesQuery = doc.filename.toLowerCase().includes(filterQuery.toLowerCase());
    if (!matchesQuery) return false;
    if (tab === 'owned') return doc.is_owner;
    if (tab === 'shared') return !doc.is_owner;
    return true;
  });

  // Calculate statistics
  const totalDocs = documents.length;
  const readyDocs = documents.filter(d => d.status === 'ready').length;
  const totalChunks = documents.reduce((acc, d) => acc + (d.chunk_count || 0), 0);
  const totalBytes = documents.reduce((acc, d) => acc + (parseInt(d.file_size, 10) || 0), 0);

  const formatTotalSize = (bytes) => {
    if (!bytes) return '0 KB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return (bytes / 1024).toFixed(1) + ' KB';
    return mb.toFixed(2) + ' MB';
  };

  return (
    <div className="min-h-screen bg-[#0a0d14] text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Top Hero / Stats Ribbon */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-[#111726]/80 flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Total Documents</p>
              <h3 className="text-2xl font-bold text-white tracking-tight">{totalDocs}</h3>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-[#111726]/80 flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Vectorized & Ready</p>
              <h3 className="text-2xl font-bold text-emerald-400 tracking-tight">{readyDocs}</h3>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-[#111726]/80 flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">pgvector Chunks</p>
              <h3 className="text-2xl font-bold text-white tracking-tight">{totalChunks}</h3>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-[#111726]/80 flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shrink-0">
              <HardDrive className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">S3 Storage Used</p>
              <h3 className="text-2xl font-bold text-white tracking-tight">{formatTotalSize(totalBytes)}</h3>
            </div>
          </div>
        </div>

        {/* Action Bar: Search input, filter tabs, Upload button */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          
          {/* Search & Tabs */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px]">
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter documents..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            </div>

            {/* Filter Tabs */}
            <div className="flex p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs">
              <button
                onClick={() => setTab('all')}
                className={`px-3 py-1.5 rounded-lg transition-all ${tab === 'all' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white'}`}
              >
                All ({totalDocs})
              </button>
              <button
                onClick={() => setTab('owned')}
                className={`px-3 py-1.5 rounded-lg transition-all ${tab === 'owned' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white'}`}
              >
                Owned
              </button>
              <button
                onClick={() => setTab('shared')}
                className={`px-3 py-1.5 rounded-lg transition-all ${tab === 'shared' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white'}`}
              >
                Shared
              </button>
            </div>
          </div>

          {/* Upload Button */}
          <button
            onClick={() => setIsUploadOpen(true)}
            className="flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-lg shadow-sky-500/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Upload Document</span>
          </button>

        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Documents Grid / Empty State */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Accessible Documents ({filteredDocs.length})
            </h3>
            <button
              onClick={fetchDocuments}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center space-x-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          </div>

          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-500 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-sky-400" />
              <p className="text-xs">Loading CloudVault documents...</p>
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="glass-panel rounded-2xl p-12 text-center border border-slate-800 bg-[#111726]/40 flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mb-4">
                <Upload className="w-8 h-8" />
              </div>
              <h4 className="text-base font-semibold text-white">No documents uploaded yet</h4>
              <p className="text-xs text-slate-400 max-w-sm mt-1 mb-6">
                Upload your first PDF, DOCX, or text file to extract chunks, generate vector embeddings, and enable RAG queries.
              </p>
              <button
                onClick={() => setIsUploadOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white text-xs font-semibold shadow-md shadow-sky-500/20 hover:from-sky-400 hover:to-indigo-500 transition-all flex items-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>Upload Document</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  onDeleted={handleDocumentDeleted}
                  onShareClick={(d) => setShareDoc(d)}
                  onInfoClick={(d) => setPreviewDoc(d)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Semantic Vector Search & RAG Widget */}
        <div className="pt-4">
          <SearchAskWidget />
        </div>

      </main>

      {/* Modals */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />

      <ShareModal
        doc={shareDoc}
        isOpen={Boolean(shareDoc)}
        onClose={() => setShareDoc(null)}
      />

      <DocPreviewModal
        doc={previewDoc}
        isOpen={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <p>CloudVault — Intelligent Cloud Storage & Retrieval Platform</p>
        
      </footer>

    </div>
  );
}
