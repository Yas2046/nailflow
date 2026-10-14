import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supportApi, type SupportBootstrap } from '../services/support';
import { useVisiblePolling } from '../hooks/useVisiblePolling';

/**
 * Estado da Central de Suporte para a profissional, vindo SÓ de GET /support/bootstrap (em tempo de execução,
 * sem variável de build). Padrão seguro: enquanto o bootstrap não respondeu, ou se a primeira resposta falhar,
 * a Central é tratada como indisponível: sem botão, sem item de menu e as rotas /suporte mostram "indisponível".
 * Depois de uma primeira resposta válida, uma falha passageira mantém o último estado conhecido.
 */
export type SupportLoad = 'loading' | 'ready' | 'unavailable';

interface SupportContextValue {
  load: SupportLoad;
  enabled: boolean;
  fabHidden: boolean;
  unreadTickets: number;
  unreadIds: string[];
  refresh: () => Promise<void>;
  setFabHidden: (hidden: boolean) => Promise<void>;
}

const DISABLED: SupportContextValue = {
  load: 'unavailable', enabled: false, fabHidden: false, unreadTickets: 0, unreadIds: [],
  refresh: async () => {}, setFabHidden: async () => {},
};

const SupportContext = createContext<SupportContextValue>(DISABLED);

export const BOOTSTRAP_POLL_MS = 60_000;

export function SupportProvider({ children }: { children: ReactNode }) {
  const { professional } = useAuth();
  const active = !!professional && !professional.isAdmin;
  const [load, setLoad] = useState<SupportLoad>('loading');
  const [data, setData] = useState<SupportBootstrap | null>(null);
  const everLoaded = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!active) return;
    try {
      const b = await supportApi.bootstrap();
      if (!alive.current) return;
      everLoaded.current = true;
      setData(b);
      setLoad('ready');
    } catch {
      if (!alive.current) return;
      if (!everLoaded.current) setLoad('unavailable');   // falha na primeira resposta: indisponível
    }
  }, [active]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Com a Central desligada não há o que atualizar: o polling só roda quando ela está ligada.
  useVisiblePolling(() => { void refresh(); }, BOOTSTRAP_POLL_MS, active && data?.enabled === true);

  const setFabHidden = useCallback(async (hidden: boolean) => {
    const r = await supportApi.setFabHidden(hidden);
    setData((d) => (d ? { ...d, fabHidden: r.fabHidden } : d));
  }, []);

  const value = useMemo<SupportContextValue>(() => ({
    load,
    enabled: load === 'ready' && data?.enabled === true,
    fabHidden: data?.fabHidden ?? false,
    unreadTickets: data?.unreadTickets ?? 0,
    unreadIds: data?.unreadIds ?? [],
    refresh,
    setFabHidden,
  }), [load, data, refresh, setFabHidden]);

  return <SupportContext.Provider value={value}>{children}</SupportContext.Provider>;
}

export function useSupport() {
  return useContext(SupportContext);
}
