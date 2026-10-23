import React, { useState } from 'react';
import { Search, Sparkles, MessageSquare, Layers, ArrowRight, Loader2, BookOpen, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

export function SearchAskWidget() {
  const [mode, setMode] = useState('ask'); // 'ask' (RAG) | 'search' (Vector Search)
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [askResult, setAskResult] = useState(null);
  const [error, setError] = useState(null);

  const handleQuery = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    try {
      setLoading(true);
      setError(null);

      if (mode === 'search') {
        const res = await api.search(query.trim(), 5);
        setSearchResult(res);
        setAskResult(null);
      } else {
        const res = await api.ask(query.trim(), 4);
        setAskResult(res);
        setSearchResult(null);
      }
    } catch (err) {
      setError(err.message || 'Query execution failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-6 border border-slate-800 bg-[#101524]/90 shadow-xl">
      
      {/* Widget Header & Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-sky-400" />
            <h3 className="text-base font-semibold text-white">AI Retrieval & RAG Query Layer</h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Query across accessible documents using pgvector similarity & context synthesis
          </p>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 shrink-0">
          <button
            onClick={() => setMode('ask')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mode === 'ask'
                ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Ask RAG</span>
          </button>

          <button
            onClick={() => setMode('search')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              mode === 'search'
                ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Vector Search</span>
          </button>
        </div>
      </div>

      {/* Query Input Bar */}
      <form onSubmit={handleQuery} className="mt-5">
        <div className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'ask'
                ? 'Ask a question about your documents (e.g. "What is the security model?")'
                : 'Enter keywords or phrases for semantic vector search...'
            }
            className="w-full pl-11 pr-28 py-3.5 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-500 transition-all shadow-inner"
          />
          <div className="absolute left-3.5 text-slate-500">
            {mode === 'ask' ? <MessageSquare className="w-5 h-5 text-sky-400" /> : <Search className="w-5 h-5 text-indigo-400" />}
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute right-2 px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 disabled:opacity-50 transition-all flex items-center space-x-1.5"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Thinking...</span>
              </>
            ) : (
              <>
                <span>Run</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Loading state indicator */}
      {loading && (
        <div className="mt-4 p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center space-x-3 text-xs text-sky-300 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-sky-400 shrink-0" />
          <span>
            {mode === 'ask' 
              ? 'Retrieving context from pgvector & synthesizing grounded answer with Gemini LLM (~5-8s)...' 
              : 'Executing semantic cosine vector search on pgvector database...'}
          </span>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div className="mt-4 flex items-center space-x-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* RAG Answer Display */}
      {askResult && (
        <div className="mt-6 space-y-4 animate-fade-in">
          <div className="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-900/60 border border-sky-500/30 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2 text-xs font-semibold text-sky-400 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                <span>RAG Synthesized Response</span>
              </div>
              {askResult.llmModel && (
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-gradient-to-r from-sky-500/10 to-indigo-500/10 text-sky-300 border border-sky-500/20 font-medium flex items-center space-x-1">
                  <span>✨</span>
                  <span>Model: {askResult.llmModel}</span>
                </span>
              )}
            </div>
            <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-line font-normal">
              {askResult.answer}
            </p>
          </div>

          {/* Citations / Sources */}
          {askResult.sources && askResult.sources.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                <span>Retrieved Context Sources ({askResult.sources.length})</span>
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {askResult.sources.map((src, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 text-xs">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span className="font-semibold text-slate-300 truncate max-w-[180px]">{src.filename}</span>
                      <span className="text-sky-400 font-mono">Similarity: {(src.similarity * 100).toFixed(1)}%</span>
                    </div>
                    <p className="text-slate-400 text-[11px] line-clamp-3 italic">
                      "{src.snippet}"
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Semantic Search Results Display */}
      {searchResult && (
        <div className="mt-6 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Found <span className="text-slate-200 font-semibold">{searchResult.matchCount}</span> semantic chunk matches</span>
            <span className="text-[11px]">Filtered by strict application ACL</span>
          </div>

          <div className="space-y-2.5">
            {searchResult.results.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">No matching chunks found in accessible documents.</p>
            ) : (
              searchResult.results.map((res) => (
                <div key={res.id} className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all text-xs">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sky-300">{res.filename} (Chunk #{res.chunkIndex + 1})</span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-mono">
                      Cosine: {(res.similarity * 100).toFixed(1)}% match
                    </span>
                  </div>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    {res.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

    </div>
  );
}
