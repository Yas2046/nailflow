import { useOutletContext } from 'react-router-dom';
import type { AdminSummary } from '../services/support';

/**
 * O AdminLayout busca a foto da administradora (GET /auth/me) para mostrá-la no menu.
 * Telas que alteram a foto avisam o layout por aqui, sem recarregar a página.
 */
export interface AdminShellContext {
  setAvatar: (avatar: string | null) => void;
  /** Central de Suporte: estado vindo de GET /admin/support/summary (404 = desligada). */
  support: { enabled: boolean; checked: boolean; summary: AdminSummary | null; refresh: () => void };
}

export function useAdminShell() {
  return useOutletContext<AdminShellContext | null>();
}
