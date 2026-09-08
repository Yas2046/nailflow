/**
 * Middleware central de erros. Controllers chamam next(err) e caem aqui.
 * Evita vazar detalhes internos (stack trace, SQL) para o cliente.
 */
export function errorHandler(err, req, res, next) {
  console.error(err);

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
