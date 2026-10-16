// Regressão: agendamentos criados pela agenda interna FORA da disponibilidade configurada (dia de folga, antes/depois do
// expediente) e fora da grade de 30 min (ex.: 14:15) precisam aparecer no dia e no horário certos na tela da Agenda.
// Antes da correção, a grade só tinha linhas dentro do expediente e o dia de folga mostrava "Dia de folga" sem os agendamentos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayAppointments, dayGridRange, slotAppointment } from '../src/utils/agendaDay.ts';

const DAY = new Date(2026, 9, 20);                      // terça, 20/10/2026 (meia-noite local)
const at = (h, m = 0, day = 20) => new Date(2026, 9, day, h, m).toISOString();
const appt = (id, h, m, minutes = 60, extra = {}) => ({
  id, status: 'pendente', startsAt: at(h, m), endsAt: new Date(new Date(at(h, m)).getTime() + minutes * 60000).toISOString(), ...extra,
});
const slotMs = (min, day = DAY) => day.getTime() + min * 60000;
const rows = ({ from, to }) => { const r = []; for (let m = from; m < to; m += 30) r.push(m); return r; };
const cardRows = (appts, range) => rows(range).filter((m) => slotAppointment(appts, slotMs(m)).startsHere).map((m) => [m, slotAppointment(appts, slotMs(m)).appt.id]);

test('sem agendamentos fora do expediente a grade é exatamente o expediente (nada muda)', () => {
  const a = [appt('a', 9, 0), appt('b', 14, 0)];
  assert.deepEqual(dayGridRange(8 * 60, 18 * 60, a, DAY), { from: 480, to: 1080 });
  assert.deepEqual(dayGridRange(8 * 60, 18 * 60, [], DAY), { from: 480, to: 1080 });
});

test('agendamento ANTES e DEPOIS do expediente amplia a grade e ganha o card na linha certa', () => {
  const a = [appt('cedo', 6, 30), appt('tarde', 19, 0), appt('normal', 10, 0)];
  const range = dayGridRange(8 * 60, 18 * 60, a, DAY);
  assert.deepEqual(range, { from: 6 * 60 + 30, to: 20 * 60 });           // 06:30 até 20:00 (19:00 + 60 min)
  assert.deepEqual(cardRows(a, range), [[390, 'cedo'], [600, 'normal'], [1140, 'tarde']]);
});

test('agendamento que cruza o fim do expediente (17:30–18:30) estende a grade até cobri-lo', () => {
  const a = [appt('cruza', 17, 30)];
  assert.deepEqual(dayGridRange(8 * 60, 18 * 60, a, DAY), { from: 480, to: 18 * 60 + 30 });
});

test('dia de folga (sem expediente) com agendamento: a grade cobre só o agendamento, e ele aparece', () => {
  const a = [appt('folga', 10, 0)];
  const range = dayGridRange(null, null, a, DAY);
  assert.deepEqual(range, { from: 600, to: 660 });
  assert.deepEqual(cardRows(a, range), [[600, 'folga']]);
});

test('agendamento fora da grade de 30 min (14:15) aparece na linha em que começa; a linha seguinte é continuação', () => {
  const a = [appt('quebrado', 14, 15)];
  const range = dayGridRange(8 * 60, 18 * 60, a, DAY);
  assert.deepEqual(cardRows(a, range), [[14 * 60, 'quebrado']]);
  const next = slotAppointment(a, slotMs(14 * 60 + 30));
  assert.equal(next.appt.id, 'quebrado');
  assert.equal(next.startsHere, false);
  assert.equal(slotAppointment(a, slotMs(13 * 60 + 30)).appt, undefined);   // antes dele a linha está livre
  assert.equal(slotAppointment(a, slotMs(15 * 60 + 30)).appt, undefined);   // 14:15 + 60 = 15:15: 15:30 já está livre
});


test('cancelado e de outro dia não entram na grade nem nas linhas', () => {
  const a = [appt('canc', 6, 0, 60, { status: 'cancelado' }), { ...appt('outro', 22, 0), startsAt: at(22, 0, 21), endsAt: at(23, 0, 21) }, appt('ok', 9, 0)];
  const doDia = dayAppointments(a, DAY);
  assert.deepEqual(doDia.map((x) => x.id), ['ok']);
  assert.deepEqual(dayGridRange(8 * 60, 18 * 60, doDia, DAY), { from: 480, to: 1080 });
  assert.equal(slotAppointment(a, slotMs(6 * 60)).appt, undefined);
});

test('o mesmo cálculo vale ao navegar entre dias: cada dia só enxerga os próprios agendamentos', () => {
  const a = [appt('d20', 6, 30, 60), { ...appt('d21', 19, 0, 60), startsAt: at(19, 0, 21), endsAt: at(20, 0, 21) }];
  const d21 = new Date(2026, 9, 21);
  assert.deepEqual(dayAppointments(a, DAY).map((x) => x.id), ['d20']);
  assert.deepEqual(dayAppointments(a, d21).map((x) => x.id), ['d21']);
  assert.deepEqual(dayGridRange(8 * 60, 18 * 60, dayAppointments(a, d21), d21), { from: 480, to: 20 * 60 });
});
