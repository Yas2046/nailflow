import { useOutletContext } from 'react-router-dom';

/**
 * O AdminLayout busca a foto da administradora (GET /auth/me) para mostrá-la no menu.
 * Telas que alteram a foto avisam o layout por aqui, sem recarregar a página.
 */
export interface AdminShellContext {
  setAvatar: (avatar: string | null) => void;
}

export function useAdminShell() {
  return useOutletContext<AdminShellContext | null>();
}
