// Informa se o módulo Financeiro está disponível neste servidor (404 = desligado, 503 = estrutura ausente).
// A resposta é guardada em memória: várias telas perguntam e só a primeira consulta chega à API.
import { useEffect, useState } from 'react';
import { financeiro } from '../services/financeiro';

let cache: boolean | null = null;
let inflight: Promise<boolean> | null = null;

export function consultarFinanceiroAtivo(): Promise<boolean> {
  if (cache !== null) return Promise.resolve(cache);
  inflight ??= financeiro.probe().then(() => true, () => false).then((ok) => { cache = ok; inflight = null; return ok; });
  return inflight;
}

/** `null` enquanto consulta; depois true/false. */
export function useFinanceiroAtivo(): boolean | null {
  const [on, setOn] = useState<boolean | null>(cache);
  useEffect(() => {
    let alive = true;
    consultarFinanceiroAtivo().then((v) => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, []);
  return on;
}
