import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!localStorage.getItem('cloudvault_token')) { setLoading(false); return; }
    api.getMe().then(({ user }) => {
      if (active) setUser(user);
    }).catch(() => {
      localStorage.removeItem('cloudvault_token');
      localStorage.removeItem('cloudvault_user');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const login = async (email, password) => {
    const res = await api.login(email, password);
    localStorage.setItem('cloudvault_token', res.token);
    localStorage.setItem('cloudvault_user', JSON.stringify(res.user));
    setUser(res.user);
    return res;
  };

  const register = async (email, password) => {
    const res = await api.register(email, password);
    localStorage.setItem('cloudvault_token', res.token);
    localStorage.setItem('cloudvault_user', JSON.stringify(res.user));
    setUser(res.user);
    return res;
  };

  const logout = () => {
    localStorage.removeItem('cloudvault_token');
    localStorage.removeItem('cloudvault_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
