// Modo de dados simulados. Só liga com `vite --mode mock` (npm run dev:mock) ou VITE_USE_MOCKS=true.
// Em modo simulado a URL da API vira `mock://offline` (nenhum fetch real pode sair) e o build de produção recusa a flag.
export const USE_MOCKS: boolean = import.meta.env.MODE === 'mock' || import.meta.env.VITE_USE_MOCKS === 'true';

if (USE_MOCKS && import.meta.env.PROD) {
  throw new Error('Dados simulados não podem ser usados em build de produção (use apenas npm run dev:mock).');
}
