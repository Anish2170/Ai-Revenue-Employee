'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';

interface User {
  id: string;
  email: string;
  name: string;
}

interface Organization {
  id: string;
  name: string;
}

interface AuthContextValue {
  user: User | null;
  organization: Organization | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string, organizationName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    api
      .me()
      .then((raw) => {
        const data = raw as { user: User; organization: Organization };
        setUser(data.user);
        setOrganization(data.organization);
      })
      .catch(() => {
        setUser(null);
        setOrganization(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const data = (await api.login(email, password)) as { user: User; organization: Organization };
    setUser(data.user);
    setOrganization(data.organization);
  }

  async function signup(email: string, password: string, name: string, organizationName?: string) {
    const data = (await api.signup(email, password, name, organizationName)) as {
      user: User;
      organization: Organization;
    };
    setUser(data.user);
    setOrganization(data.organization);
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setOrganization(null);
    router.push('/login');
  }

  return (
    <AuthContext.Provider value={{ user, organization, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

