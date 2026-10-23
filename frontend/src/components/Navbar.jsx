import React, { useEffect, useState } from 'react';
import { Cloud, Shield, Database, LogOut, User, Activity, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

export function Navbar() {
  const { user, logout } = useAuth();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.getHealth()
      .then(data => setHealth(data))
      .catch(() => setHealth({ status: 'offline' }));
  }, []);

  return (
    <header className="sticky top-0 z-40 glass-panel border-b border-slate-800/80 bg-[#0a0d14]/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand & Project Identity */}
        <div className="flex items-center space-x-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 shadow-lg shadow-sky-500/20">
            <Cloud className="w-5 h-5 text-white" />
            <Shield className="w-3 h-3 text-cyan-200 absolute -bottom-0.5 -right-0.5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold tracking-tight text-white font-sans">
                Cloud<span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">Vault</span>
              </span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                Phase 1 MVP
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Intelligent Cloud Storage • RAG & Vector Engine
            </p>
          </div>
        </div>

        {/* Right Section: Cloud Architecture Badge & User Controls */}
        <div className="flex items-center space-x-4">
          
          {/* Cloud Infra Status Pill */}
          <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
            <div className={`w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-slate-400 font-medium">
              {health?.status === 'ok' ? (
                <>Engine: <span className="text-slate-200">{health.dbEngine}</span></>
              ) : (
                <span className="text-rose-400">API Offline</span>
              )}
            </span>
          </div>

          {/* User profile dropdown / logout */}
          {user && (
            <div className="flex items-center space-x-3 pl-2 border-l border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-sky-500 flex items-center justify-center text-xs font-bold text-white shadow-inner">
                  {user.email.charAt(0).toUpperCase()}
                </div>
                <div className="hidden lg:block text-left">
                  <p className="text-xs font-medium text-slate-200 truncate max-w-[150px]">
                    {user.email}
                  </p>
                  <p className="text-[10px] text-slate-500">Authenticated</p>
                </div>
              </div>

              <button
                onClick={logout}
                title="Sign out"
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>

      </div>
    </header>
  );
}
