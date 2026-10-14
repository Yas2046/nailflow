import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../services/api';
import { adminSupportApi, type AdminSummary } from '../../services/support';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';

/**
 * Estado da Central para a ADM, vindo de GET /admin/support/summary: 404 = Central desligada (o item "Suporte"
 * nem aparece); 200 = ligada, com os indicadores e o contador de não lidas. Atualiza a cada 60 s com a aba visível.
 * Falha passageira (rede, 5xx) mantém o último estado conhecido; sem resposta nenhuma, a Central fica oculta.
 */
export function useAdminSupportSummary(active: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [checked, setChecked] = useState(false);
  const off = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!active || off.current) return;
    try {
      const s = await adminSupportApi.summary();
      if (!alive.current) return;
      setSummary(s);
      setEnabled(true);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 404) { off.current = true; setEnabled(false); setSummary(null); }
    } finally {
      if (alive.current) setChecked(true);
    }
  }, [active]);

  useEffect(() => { void refresh(); }, [refresh]);
  useVisiblePolling(() => { void refresh(); }, 60_000, active && enabled);

  return { enabled, summary, checked, refresh };
}
