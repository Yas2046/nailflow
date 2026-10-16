// Defesa em profundidade contra CSRF: métodos que ALTERAM dados só entram se vierem da origem oficial do frontend.
//
// Por que existe: a sessão é um cookie (SameSite=Lax) e o CORS só diz ao NAVEGADOR o que ele pode ler; o servidor não recusava
// uma requisição de escrita só porque o Origin era estranho (o CORS não impede o servidor de processá-la). Este guarda fecha
// essa lacuna sem depender de token nem de mudança no frontend: o navegador sempre envia o cabeçalho Origin nas requisições
// que não são GET/HEAD, inclusive nas do mesmo site (o frontend chama /api pelo mesmo domínio), e uma página de outro site
// não consegue forjá-lo.
//
// Regras (somente métodos fora de GET, HEAD e OPTIONS):
//   1. Com Origin: precisa ser EXATAMENTE a origem oficial (FRONTEND_URL; esquema, host e porta). "null", valor vazio, outro
//      domínio, outra porta, outro esquema, subdomínio ou valor com caminho/credenciais => 403.
//   2. SEM Origin: é cliente que não é navegador (n8n, Evolution, curl, testes) ou navegador na própria origem; passa. Exceção:
//      se o navegador declarar Sec-Fetch-Site "cross-site" ou "same-site", recusa (navegador moderno em contexto de outro site).
//      Esses clientes não têm cookie de outra pessoa para ser "carona": a sessão por cookie só vai junto em navegador, e o
//      navegador envia Origin; as rotas /bot usam Bearer.
//   3. GET, HEAD e OPTIONS (inclusive o preflight do CORS) nunca são tocados.
// Roda antes da autenticação e dos limitadores de taxa: tentativa recusada não consome cota nem toca no banco.
// FRONTEND_URL ausente ou inválida:
//   * EM PRODUÇÃO (NODE_ENV=production) o servidor NÃO INICIA: lança um erro claro. A proteção nunca fica desligada em
//     silêncio; o problema aparece na hora do reinício (o health check falha e o rollback é imediato), e não semanas depois.
//   * Fora de produção, ausente usa o padrão de desenvolvimento (http://localhost:5173) e inválida registra o erro e
//     DESATIVA só esta verificação (o CORS e o SameSite seguem valendo), para não atrapalhar quem desenvolve ou testa.
// Antes de publicar, confira que a produção tem a variável correta: o cabeçalho Access-Control-Allow-Origin do preflight
// mostra o valor em uso (docs/SUPORTE_PUBLICACAO.md, seção 4).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
// Origem pura (esquema://host[:porta][/]): o navegador nunca envia caminho, consulta, fragmento nem credenciais.
const PURE_ORIGIN = /^https?:\/\/[^/?#@\s]+\/?$/i;

/**
 * Origem canônica (esquema + host + porta, minúsculos, sem porta padrão), ou null se o valor não for uma origem válida.
 * `lenient` aceita caminho/barra final (usado só para ler FRONTEND_URL, nunca para o cabeçalho da requisição).
 */
export function normalizeOrigin(value, { lenient = false } = {}) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'null') return null;
  if (!lenient && !PURE_ORIGIN.test(v)) return null;
  let url;
  try { url = new URL(v); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!lenient && (url.username || url.password)) return null;
  return url.origin;
}

function forbid(res) {
  return res.status(403).json({ error: 'Origem não permitida.' });
}

export function createOriginGuard({
  allowedOrigin = process.env.FRONTEND_URL,
  logger = console,
  production = process.env.NODE_ENV === 'production',
} = {}) {
  const given = typeof allowedOrigin === 'string' && allowedOrigin.trim() !== '';
  // Ausente: em produção não há padrão (fica inválida e o servidor não inicia); fora dela vale o padrão de desenvolvimento.
  const allowed = given ? normalizeOrigin(allowedOrigin, { lenient: true }) : (production ? null : normalizeOrigin(DEFAULT_FRONTEND_URL));
  if (!allowed) {
    if (production) {
      throw new Error('originGuard: em produção, FRONTEND_URL precisa ser a origem oficial do site (esquema://host[:porta], por exemplo https://nailflow.duckdns.org) e está ausente ou inválida. O servidor não inicia para que a proteção contra CSRF nunca fique desligada em silêncio.');
    }
    logger.error('originGuard: FRONTEND_URL inválida; a verificação de Origin ficou DESATIVADA (CORS e SameSite continuam valendo). Corrija a variável.');
    return function originGuardDisabled(_req, _res, next) { next(); };
  }
  return function originGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin !== undefined) {
      return normalizeOrigin(origin) === allowed ? next() : forbid(res);
    }
    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') return forbid(res);
    return next();
  };
}
