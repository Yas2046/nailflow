/**
 * Utilitários de timezone. O NailFlow é usado por profissionais no Brasil,
 * então todo horário "civil" (expediente, almoço, horário pedido pela
 * cliente) é sempre interpretado em America/Sao_Paulo — independentemente
 * de qual timezone o processo Node/servidor esteja rodando (em produção,
 * containers costumam rodar em UTC).
 *
 * Isso é feito com Intl.DateTimeFormat (nativo do Node), sem depender de
 * bibliotecas externas, e funciona corretamente mesmo se o Brasil voltar
 * a adotar horário de verão no futuro.
 */

export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Sao_Paulo';

/**
 * Descobre, em minutos, o quanto uma timezone está "à frente" de UTC
 * num instante específico (ex.: America/Sao_Paulo hoje = -180).
 */
function getTimeZoneOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/**
 * Converte um horário "civil" (ano, mês, dia, hora, minuto), na timezone
 * do negócio, para o instante UTC correspondente (objeto Date).
 *
 * Ex.: zonedTimeToUtc(2026, 1, 10, 14, 15) -> instante UTC equivalente a
 * "10/01/2026 14:15" em São Paulo (não em UTC nem na timezone do servidor).
 */
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone = BUSINESS_TIMEZONE) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMinutes * 60000);
}

/**
 * Decompõe um instante (Date/timestamptz) nos componentes de data e hora
 * "civis" como eles aparecem na timezone do negócio, incluindo o dia da
 * semana (0=domingo ... 6=sábado, mesma convenção da coluna `weekday`).
 */
export function getZonedParts(date, timeZone = BUSINESS_TIMEZONE) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday],
  };
}

/**
 * Converte um horário do tipo `TIME` do Postgres (ex.: "08:00:00") para o
 * instante UTC correspondente no mesmo dia civil de `zonedParts`
 * (normalmente obtido via getZonedParts de algum outro instante).
 */
export function timeStringToUtcOnDate(zonedParts, timeStr, timeZone = BUSINESS_TIMEZONE) {
  const [h, m] = timeStr.split(':').map(Number);
  return zonedTimeToUtc(zonedParts.year, zonedParts.month, zonedParts.day, h, m, timeZone);
}

const OFFSET_SUFFIX_REGEX = /(Z|[+-]\d{2}:?\d{2})$/;
const NAIVE_DATETIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Interpreta uma entrada de data/hora vinda da API (string ISO ou Date) e
 * devolve o instante UTC correto.
 *
 * - Se a string já tem timezone explícito ("Z" ou "+03:00" etc.), o
 *   instante é inequívoco e usamos `new Date()` normalmente.
 * - Se a string é "naive" (sem timezone, ex.: "2026-01-10T14:15:00" ou
 *   "2026-01-10T14:15"), ela é interpretada como horário civil em
 *   America/Sao_Paulo — NUNCA como UTC e NUNCA como o horário local do
 *   servidor. Esse é o caso que evita o bug de "14:15 no Brasil vira
 *   14:15 UTC".
 */
export function parseZonedDateTime(input, timeZone = BUSINESS_TIMEZONE) {
  if (input instanceof Date) return input;

  const str = String(input).trim();

  if (OFFSET_SUFFIX_REGEX.test(str)) {
    return new Date(str);
  }

  const match = str.match(NAIVE_DATETIME_REGEX);
  if (!match) {
    return new Date(NaN); // deixa o chamador decidir como reportar o erro
  }
  const [, y, mo, d, h, mi] = match;
  return zonedTimeToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), timeZone);
}
