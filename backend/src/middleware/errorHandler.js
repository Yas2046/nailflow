/**
 * Middleware central de erros. Controllers chamam next(err) e caem aqui.
 * Evita vazar detalhes internos (stack trace, SQL) para o cliente.
 */
const STACK_FRAME = /^\s+at\s/;

/**
 * Resumo de um erro SEGURO para o log: sem a mensagem (a do V8, do body-parser e as do PostgreSQL podem trazer
 * trechos de dados do usuário, como o DETAIL de uma violação) e sem o corpo da requisição. Fica só o que ajuda a
 * diagnosticar: tipo, códigos, constraint/tabela/rotina do PostgreSQL e os quadros da pilha (sem a 1ª linha, que
 * repete a mensagem). A mensagem só é incluída nos HttpError, que são escritos pelo próprio código.
 */
export function describeErrorForLog(err) {
  const out = { name: typeof err?.name === 'string' ? err.name : 'Error' };
  for (const key of ['code', 'status', 'type', 'constraint', 'table', 'routine']) {
    const v = err?.[key];
    if (typeof v === 'string' || typeof v === 'number') out[key] = v;
  }
  if (err instanceof HttpError) out.message = err.message;
  if (typeof err?.stack === 'string') {
    out.stack = err.stack.split('\n').filter((l) => STACK_FRAME.test(l)).slice(0, 8).join('\n');
  }
  return out;
}

export function errorHandler(err, req, res, next) {
  // JSON malformado: o body-parser anexa o corpo bruto ao erro (err.body) e a mensagem do V8 pode trazer um trecho
  // dele. Em rotas de suporte isso seria texto de mensagem da profissional nos logs, então só o tipo é registrado.
  if (err.type === 'entity.parse.failed') console.error('JSON inválido na requisição (corpo omitido do log).');
  else console.error('Erro na requisição:', describeErrorForLog(err));

  // Conflito de horário (EXCLUDE constraint do Postgres)
  if (err.code === '23P01') {
    return res.status(409).json({ error: 'Já existe um agendamento nesse horário.' });
  }

  // Violação de foreign key / not null / etc.
  if (err.code === '23503' || err.code === '23502') {
    return res.status(400).json({ error: 'Dados inválidos ou referência inexistente.' });
  }

  // Violação de unique constraint
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Registro já existe.' });
  }

  const status = err.status || 500;
  const message = status === 500 ? 'Erro interno do servidor.' : err.message;
  res.status(status).json({ error: message });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
