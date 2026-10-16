// Grade do dia da Agenda. A agenda interna aceita agendamentos fora da disponibilidade configurada (dia de folga, antes ou
// depois do expediente) e em minutos fora da grade de 30 min (ex.: 14:15); a tela precisa mostrá-los no dia e horário certos.
// Funções puras (sem React) para poderem ser testadas.

export interface SlotAppt {
  startsAt: string;
  endsAt: string;
  status: string;
}

export const SLOT_MINUTES = 30;

/** Agendamentos não cancelados que começam no dia civil de `dayStart` (meia-noite local). */
export function dayAppointments<T extends SlotAppt>(appts: T[], dayStart: Date): T[] {
  const from = dayStart.getTime();
  const to = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1).getTime();
  return appts.filter((a) => {
    const t = new Date(a.startsAt).getTime();
    return a.status !== 'cancelado' && t >= from && t < to;
  });
}

/**
 * Faixa de minutos (desde a meia-noite) da grade do dia: o expediente configurado (null no dia de folga), ampliado para cobrir
 * todos os agendamentos do dia, em linhas de 30 min. Requer expediente ou ao menos um agendamento.
 */
export function dayGridRange(cfgStart: number | null, cfgEnd: number | null, appts: SlotAppt[], dayStart: Date): { from: number; to: number } {
  const min = (iso: string) => Math.round((new Date(iso).getTime() - dayStart.getTime()) / 60000);
  const froms = appts.map((a) => Math.floor(min(a.startsAt) / SLOT_MINUTES) * SLOT_MINUTES);
  const tos = appts.map((a) => Math.min(1440, Math.ceil(min(a.endsAt) / SLOT_MINUTES) * SLOT_MINUTES));
  const nonNull = (v: number | null): v is number => v !== null;
  return {
    from: Math.min(...[cfgStart, ...froms].filter(nonNull)),
    to: Math.max(...[cfgEnd, ...tos].filter(nonNull)),
  };
}

/**
 * Agendamento que a linha da grade (início em `slotStartMs`) deve mostrar: o que COMEÇA nela (mesmo fora da grade de 30 min,
 * ex.: 14:15 aparece na linha 14:00, com o card), ou, se nenhum começar, o que ainda a ocupa (linha de continuação).
 */
export function slotAppointment<T extends SlotAppt>(appts: T[], slotStartMs: number): { appt: T | undefined; startsHere: boolean } {
  const slotEndMs = slotStartMs + SLOT_MINUTES * 60000;
  const starts = appts.find((a) => {
    const s = new Date(a.startsAt).getTime();
    return a.status !== 'cancelado' && s >= slotStartMs && s < slotEndMs;
  });
  if (starts) return { appt: starts, startsHere: true };
  const covers = appts.find((a) => {
    const s = new Date(a.startsAt).getTime();
    const e = new Date(a.endsAt).getTime();
    return a.status !== 'cancelado' && slotStartMs >= s && slotStartMs < e;
  });
  return { appt: covers, startsHere: false };
}
