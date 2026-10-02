import { useEffect } from 'react';
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · NailFlow` : 'NailFlow';
    return () => { document.title = 'NailFlow'; };
  }, [title]);
}
