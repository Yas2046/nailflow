import { ApiError } from '../services/api';

/**
 * Traduz o `reason` estruturado que o backend retorna (ver
 * backend/src/utils/availability.js -> checkSlotAvailability) em uma
 * mensagem amigável para a profissional. Isso NÃO recalcula disponibilidade
 * no frontend — só apresenta o motivo que o backend já decidiu.
 *
 * Se o backend não mandar um `reason` reconhecido (ex.: erros genéricos de
 * validação), cai de volta na mensagem que a própria API já retorna, que
 * também é escrita para ser exibida diretamente à usuária.
 */
const REASON_MESSAGES: Record<string, string> = {
  appointment_overlap: 'Esse horário está ocupado.',
  lunch_break: 'Esse horário está dentro do intervalo de almoço.',
  outside_working_hours: 'Esse horário não está dentro do expediente.',
  blocked_time: 'Esse horário está bloqueado.',
  inactive_service: 'Esse serviço está inativo no momento.',
  invalid_service: 'Selecione um serviço válido.',
  invalid_datetime: 'Informe uma data e horário válidos.',
};

export function getFriendlyAvailabilityMessage(err: unknown, fallback = 'Não foi possível salvar o agendamento.'): string {
  if (err instanceof ApiError) {
    if (err.reason && REASON_MESSAGES[err.reason]) return REASON_MESSAGES[err.reason];
    if (err.message) return err.message; // a API já escreve mensagens amigáveis (ver appointmentsController.js)
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * Horários alternativos sugeridos pelo backend (campo `alternatives`).
 * O backend já retorna essa lista em respostas 409 via appointmentsController.js.
 */
export function getSuggestedAlternatives(err: unknown): string[] {
  if (err instanceof ApiError && Array.isArray(err.alternatives)) {
    return err.alternatives;
  }
  return [];
}
