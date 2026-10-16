// Guarda do link da política no aviso da Central de Suporte (usada por tests/support-notice.test.mjs e por
// tests/privacy.test.mjs). Não é um teste: é a verificação que os testes executam, sobre a árvore real do projeto e
// também sobre árvores sintéticas, para provar que ela de fato recusa a habilitação indevida.
//
// Regra: POLICY_PAGE_PUBLISHED (content/avisoPrivacidade.ts) só pode ser `true` quando TODOS os itens abaixo valem.
//   1. a política existe e está pronta (isPolicyReady) e o texto dela não tem marcadores [[...]];
//   2. a rota /privacidade está registrada em App.tsx e a página Privacidade é importada e existe;
//   3. docs/ATENDIMENTO_TITULARES.md não tem marcadores de pendência.
// Com a chave `false` não há nada a verificar. Sem conseguir ler a chave, a guarda FALHA (fail-closed).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Lê a chave do código-fonte (não importa o módulo), para poder avaliar cópias e árvores sintéticas.
const FLAG_DECLARATION = /^export const POLICY_PAGE_PUBLISHED\s*(?::\s*boolean)?\s*=\s*(true|false)\s*;/m;
const TEXT_MARKER = /\[\[(.+?)\]\]/g;
const DOC_MARKERS = /\[A DEFINIR|\[CONFIRMAR|\bTODO\b|\bTBD\b/i;
const ROUTE = /<Route path="\/privacidade" element=\{<Privacidade \/>\} \/>/;
const PAGE_IMPORT = /import Privacidade from '\.\/pages\/Privacidade';/;

export function readPublishedFlag(srcRoot) {
  const file = path.join(srcRoot, 'content', 'avisoPrivacidade.ts');
  const match = FLAG_DECLARATION.exec(fs.readFileSync(file, 'utf8'));
  if (!match) {
    throw new Error('POLICY_PAGE_PUBLISHED não encontrada ou em formato não reconhecido (esperado: export const POLICY_PAGE_PUBLISHED: boolean = false;)');
  }
  return match[1] === 'true';
}

/** @returns {{ published: boolean, violations: string[] }} lista vazia = a chave está coerente com o estado do projeto. */
export async function evaluateLinkGuard({ srcRoot, docsDir }) {
  const published = readPublishedFlag(srcRoot);
  if (!published) return { published, violations: [] };

  const violations = [];

  const policyFile = path.join(srcRoot, 'content', 'politicaPrivacidade.ts');
  if (!fs.existsSync(policyFile)) {
    violations.push('a política (content/politicaPrivacidade.ts) não existe');
  } else {
    // query única: evita reaproveitar um módulo já carregado de outra árvore
    const P = await import(`${pathToFileURL(policyFile).href}?guard=${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (!P.isPolicyReady()) violations.push(`a política não está pronta (pendências: ${P.pendingFields().join(', ')})`);
    const markers = [...P.policyPlainText(P.buildPolicy()).matchAll(TEXT_MARKER)];
    if (markers.length > 0) violations.push(`o texto da política ainda tem ${markers.length} marcador(es) [[...]]`);
  }

  const appFile = path.join(srcRoot, 'App.tsx');
  const app = fs.existsSync(appFile) ? fs.readFileSync(appFile, 'utf8') : '';
  if (!ROUTE.test(app)) violations.push('a rota /privacidade não está registrada em App.tsx');
  if (!PAGE_IMPORT.test(app)) violations.push('App.tsx não importa a página Privacidade');
  if (!fs.existsSync(path.join(srcRoot, 'pages', 'Privacidade.tsx'))) violations.push('a página pages/Privacidade.tsx não existe');

  const doc = docsDir ? path.join(docsDir, 'ATENDIMENTO_TITULARES.md') : null;
  if (!doc || !fs.existsSync(doc)) violations.push('docs/ATENDIMENTO_TITULARES.md não existe');
  else if (DOC_MARKERS.test(fs.readFileSync(doc, 'utf8'))) violations.push('docs/ATENDIMENTO_TITULARES.md ainda tem marcadores de pendência ([A DEFINIR, TODO...)');

  return { published, violations };
}
