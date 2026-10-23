import React, { useState, useEffect } from 'react';
import { X, Users, Send, Check, Shield, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../services/api';

export function ShareModal({ doc, isOpen, onClose }) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState('view');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [existingShares, setExistingShares] = useState([]);

  useEffect(() => {
    if (doc && isOpen) {
      api.getDocumentShares(doc.id)
        .then(res => setExistingShares(res.shares || []))
        .catch(() => setExistingShares([]));
    }
  }, [doc, isOpen]);

  if (!isOpen || !doc) return null;

  const handleShare = async (e) => {
    e.preventDefault();
    if (!email) return;

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const res = await api.shareDocument(doc.id, {
        email: email.trim(),
        permission
      });

      setSuccess(`Document successfully shared with ${email}!`);
      setEmail('');

      // Refresh shares
      const sharesRes = await api.getDocumentShares(doc.id);
      setExistingShares(sharesRes.shares || []);
    } catch (err) {
      setError(err.message || 'Failed to share document.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md glass-panel rounded-2xl p-6 shadow-2xl border border-slate-700/80 bg-[#101524]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-semibold text-white">Share Document</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Target Document preview */}
        <div className="mt-4 p-3 rounded-lg bg-slate-900/60 border border-slate-800">
          <p className="text-xs text-slate-400">Target Document:</p>
          <p className="text-sm font-medium text-slate-200 truncate mt-0.5">{doc.filename}</p>
        </div>

        {/* Share Form */}
        <form onSubmit={handleShare} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              User Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              required
              className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Access Permission
            </label>
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="view">View & Semantic Query (view)</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Granting view permission allows the user to semantically search and ask questions against this document's vector chunks.
            </p>
          </div>

          {error && (
            <div className="flex items-center space-x-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center space-x-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              <Check className="w-4 h-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading || !email}
              className="flex items-center space-x-2 px-4 py-2 text-xs font-medium rounded-lg bg-gradient-to-r from-indigo-500 to-sky-500 text-white shadow-md hover:from-indigo-600 hover:to-sky-600 disabled:opacity-50 transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sharing...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Grant Access</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Existing Shares List */}
        {existingShares.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-800">
            <h5 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Currently Shared With ({existingShares.length})
            </h5>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {existingShares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-900/40 border border-slate-800/80 text-xs"
                >
                  <span className="text-slate-300 font-medium truncate">{share.shared_with_email}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    {share.permission}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
