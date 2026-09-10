import { createContext, useContext, useState, type ReactNode } from 'react';
import { api } from '../services/api';

interface Professional {
  id: string;
  name: string;
  email: string;
  businessName: string;
}

interface AuthContextValue {
  professional: Professional | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [professional, setProfessional] = useState<Professional | null>(() => {
    const cached = localStorage.getItem('nailflow_professional');
    return cached ? JSON.parse(cached) : null;
  });
  const [loading, setLoading] = useState(false);

  async function login(email: string, password: string) {
    setLoading(true);
    try {
      const data = await api.post<{ token: string; professional: Professional }>('/auth/login', { email, password });
      localStorage.setItem('nailflow_professional', JSON.stringify(data.professional));
      setProfessional(data.professional);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    api.post('/auth/logout', {}).catch(() => {});
    localStorage.removeItem('nailflow_professional');
    setProfessional(null);
  }

  return (
    <AuthContext.Provider value={{ professional, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
