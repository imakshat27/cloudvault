import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cloudvault_token');
    const storedUser = localStorage.getItem('cloudvault_user');

    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        // Verify token with backend
        api.getMe()
          .then((res) => {
            setUser(res.user);
            localStorage.setItem('cloudvault_user', JSON.stringify(res.user));
          })
          .catch(() => {
            logout();
          })
          .finally(() => setLoading(false));
      } catch (e) {
        logout();
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
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
