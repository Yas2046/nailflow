// Financeiro: relatório do período (JSON, Excel detalhado, PDF resumido) e alertas internos. Só leitura, isolado por req.professionalId.
// Os números vêm das mesmas consultas do Dashboard e de Gastos (utils/financeiroRelatorios.js): recebimentos efetivos e despesas efetivamente pagas.
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from '../config/db.js';
import { wrap, fail } from './financeiroController.js';
import { parseDateOnly, todayInBusinessTz } from '../utils/financeiroPagamentos.js';
import { BUSINESS_TZ, periodSums, receivableRows, openExpenseRows, closingRows } from '../utils/financeiroRelatorios.js';

const METHOD_LABEL = { pix: 'Pix', dinheiro: 'Dinheiro', cartao_debito: 'Débito', cartao_credito: 'Crédito', transferencia: 'Transferência', outra: 'Outros', boleto: 'Boleto', nao_informado: 'Método não informado' };
const STATE_LABEL = { a_revisar: 'A revisar', pendente: 'Pendente', vencida: 'Vencida', paga: 'Paga' };
const ml = (m) => METHOD_LABEL[m] ?? String(m ?? 'Método não informado');
const brDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MAX_DETAIL_ROWS = 20000;

function period(req) {
  const from = req.query.from ? parseDateOnly(String(req.query.from)) : null;
  const to = req.query.to ? parseDateOnly(String(req.query.to)) : null;
  if (!from || !to) fail(400, 'validation', 'Informe o período (from e to, AAAA-MM-DD).');
  if (from > to) fail(400, 'validation', 'A data inicial não pode ser posterior à final.');
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 366) fail(400, 'validation', 'Período máximo de 366 dias.');
  return { from, to };
}

/** Relatório consolidado (sem os detalhes linha a linha). */
async function buildReport(pid, from, to) {
  const today = todayInBusinessTz();
  const sums = await periodSums(pool, pid, from, to);
  const receber = await receivableRows(pool, pid, today);
  const abertas = await openExpenseRows(pool, pid, today);
  const fechamentos = await closingRows(pool, pid, from, to);
  const sumBy = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
  const exp = (state) => {
    const rows = abertas.filter((r) => r.state === state);
    return { count: rows.length, amountCents: sumBy(rows, (r) => r.amount_cents), remainingCents: sumBy(rows, (r) => r.amount_cents - r.paid_cents) };
  };
  return {
    periodo: { from, to, hoje: today },
    resumo: sums.totais,
    recebimentosPorMetodo: sums.recebimentosPorMetodo,
    despesasPagasPorMetodo: sums.despesasPagasPorMetodo,
    despesasPagasPorCategoria: sums.despesasPagasPorCategoria,
    pendencias: {
      aReceber: {
        pendenteCents: sumBy(receber.filter((r) => !r.overdue), (r) => r.balance), vencidoCents: sumBy(receber.filter((r) => r.overdue), (r) => r.balance),
        emAberto: receber.length, vencidos: receber.filter((r) => r.overdue).length,
      },
      despesas: { aRevisar: exp('a_revisar'), pendentes: exp('pendente'), vencidas: exp('vencida') },
    },
    caixa: { diasFechados: fechamentos.filter((f) => f.status === 'fechado').length, diasReabertos: fechamentos.filter((f) => f.status === 'aberto').length, comDivergencia: fechamentos.filter((f) => f.divergente).length, fechamentos },
    _receber: receber, _abertas: abertas,
  };
}
const publicReport = ({ _receber, _abertas, ...r }) => r;

export const getRelatorio = wrap(async (req, res) => {
  const { from, to } = period(req);
  res.json(publicReport(await buildReport(req.professionalId, from, to)));
});

// ── Excel detalhado ────────────────────────────────────────────────────────
export const getRelatorioXlsx = wrap(async (req, res) => {
  const pid = req.professionalId;
  const { from, to } = period(req);
  const r = await buildReport(pid, from, to);
  const rec = await pool.query(
    `SELECT to_char(fp.occurred_on, 'YYYY-MM-DD') AS day, fp.kind, c.name AS client, s.name AS service, fp.method, fp.amount_cents, fp.notes
       FROM financial_payments fp JOIN appointments a ON a.id = fp.appointment_id AND a.professional_id = fp.professional_id
       JOIN clients c ON c.id = a.client_id AND c.professional_id = a.professional_id JOIN services s ON s.id = a.service_id AND s.professional_id = a.professional_id
      WHERE fp.professional_id = $1 AND fp.occurred_on BETWEEN $2::date AND $3::date ORDER BY fp.occurred_on, fp.created_at, fp.id LIMIT ${MAX_DETAIL_ROWS + 1}`, [pid, from, to]);
  const dep = await pool.query(
    `SELECT to_char(p.paid_on, 'YYYY-MM-DD') AS day, ex.description, ex.category, p.method, p.amount_cents
       FROM (SELECT x.professional_id, x.expense_id, x.method, x.amount_cents, x.paid_on FROM expense_payments x
             UNION ALL SELECT e.professional_id, e.id, e.paid_method, e.amount_cents, e.paid_on FROM expenses e WHERE e.payment_status = 'paga' AND e.paid_on IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM expense_payments x WHERE x.expense_id = e.id AND x.professional_id = e.professional_id)) p
       JOIN expenses ex ON ex.id = p.expense_id AND ex.professional_id = p.professional_id
      WHERE p.professional_id = $1 AND p.paid_on BETWEEN $2::date AND $3::date ORDER BY p.paid_on, ex.description LIMIT ${MAX_DETAIL_ROWS + 1}`, [pid, from, to]);
  if (rec.rows.length > MAX_DETAIL_ROWS || dep.rows.length > MAX_DETAIL_ROWS) fail(413, 'too_large', 'Período com movimentações demais para exportar: reduza o intervalo.');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'NailFlow';
  wb.created = new Date();
  const money = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  const sheet = (name, cols, rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map(([header, key, width, isMoney]) => ({ header, key, width, style: isMoney ? { numFmt: money } : {} }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    rows.forEach((row) => ws.addRow(row));
    return ws;
  };
  const c = (cents) => (cents == null ? null : cents / 100);

  const resumo = [
    ['Período', `${brDate(from)} a ${brDate(to)}`], ['Gerado em (fuso America/Sao_Paulo)', brDate(r.periodo.hoje)],
    ['Recebido', c(r.resumo.receivedCents)], ['Estornado', c(r.resumo.refundedCents)], ['Recebido líquido', c(r.resumo.netReceivedCents)],
    ['Despesas pagas', c(r.resumo.expensesPaidCents)], ['Saldo de caixa do período (recebido líquido − despesas pagas)', c(r.resumo.saldoCents)],
    ['A receber pendente (atendimentos concluídos, hoje)', c(r.pendencias.aReceber.pendenteCents)], ['A receber vencido (hoje)', c(r.pendencias.aReceber.vencidoCents)],
    ['Despesas pendentes (saldo)', c(r.pendencias.despesas.pendentes.remainingCents)], ['Despesas vencidas (saldo)', c(r.pendencias.despesas.vencidas.remainingCents)],
    ['Despesas antigas a revisar (quantidade)', r.pendencias.despesas.aRevisar.count],
    ['Dias fechados no período', r.caixa.diasFechados], ['Dias com divergência no fechamento', r.caixa.comDivergencia],
  ];
  const ws0 = sheet('Resumo', [['Indicador', 'k', 62], ['Valor', 'v', 24, false]], resumo.map(([k, v]) => ({ k, v })));
  ws0.eachRow((row, i) => { if (i > 1 && typeof row.getCell('v').value === 'number' && !/quantidade|Dias/.test(String(row.getCell('k').value))) row.getCell('v').numFmt = money; });
  sheet('Por método', [['Método', 'm', 24], ['Recebido', 'r', 16, true], ['Estornado', 'e', 16, true], ['Líquido', 'n', 16, true]],
    r.recebimentosPorMetodo.map((m) => ({ m: ml(m.method), r: c(m.receivedCents), e: c(m.refundedCents), n: c(m.netCents) })));
  sheet('Despesas pagas por método', [['Método', 'm', 28], ['Pago', 'p', 16, true]], r.despesasPagasPorMetodo.map((m) => ({ m: ml(m.method), p: c(m.paidCents) })));
  sheet('Despesas pagas por categoria', [['Categoria', 'c', 28], ['Pago', 'p', 16, true]], r.despesasPagasPorCategoria.map((m) => ({ c: m.category, p: c(m.paidCents) })));
  sheet('Recebimentos', [['Data', 'd', 12], ['Tipo', 't', 14], ['Cliente', 'c', 28], ['Serviço', 's', 26], ['Método', 'm', 18], ['Valor', 'v', 14, true], ['Observação', 'o', 40]],
    rec.rows.map((x) => ({ d: brDate(x.day), t: x.kind === 'estorno' ? 'Estorno' : 'Recebimento', c: x.client, s: x.service, m: ml(x.method), v: c(x.kind === 'estorno' ? -x.amount_cents : x.amount_cents), o: x.notes ?? '' })));
  sheet('Despesas pagas', [['Data', 'd', 12], ['Descrição', 'e', 34], ['Categoria', 'c', 16], ['Método', 'm', 24], ['Valor', 'v', 14, true]],
    dep.rows.map((x) => ({ d: brDate(x.day), e: x.description, c: x.category, m: ml(x.method), v: c(x.amount_cents) })));
  sheet('Despesas em aberto', [['Descrição', 'd', 34], ['Categoria', 'c', 16], ['Situação', 's', 14], ['Vencimento', 'v', 12], ['Valor', 'a', 14, true], ['Pago', 'p', 14, true], ['Saldo', 'r', 14, true]],
    r._abertas.map((x) => ({ d: x.description, c: x.category, s: STATE_LABEL[x.state], v: brDate(x.due_on), a: c(x.amount_cents), p: c(x.paid_cents), r: c(x.amount_cents - x.paid_cents) })));
  sheet('A receber', [['Cliente', 'c', 28], ['Serviço', 's', 26], ['Concluído em', 'd', 14], ['Situação', 'st', 12], ['Valor', 'v', 14, true], ['Recebido líquido', 'n', 16, true], ['Saldo', 'b', 14, true]],
    r._receber.map((x) => ({ c: x.client_name, s: x.service_name, d: brDate(x.ended_on), st: x.overdue ? 'Vencido' : 'Pendente', v: c(x.value_cents), n: c(x.net), b: c(x.balance) })));
  const fech = [];
  for (const f of r.caixa.fechamentos) {
    if (!f.metodos.length) fech.push({ d: brDate(f.day), s: f.status === 'fechado' ? 'Fechado' : 'Reaberto', m: '(sem registro por método)', e: null, c: null, f: null, j: '' });
    for (const m of f.metodos) fech.push({ d: brDate(f.day), s: f.status === 'fechado' ? 'Fechado' : 'Reaberto', m: ml(m.method), e: c(m.expectedCents), c: c(m.countedCents), f: c(m.differenceCents), j: m.justification ?? '' });
  }
  sheet('Fechamentos', [['Dia', 'd', 12], ['Situação', 's', 12], ['Método', 'm', 24], ['Esperado', 'e', 14, true], ['Contado', 'c', 14, true], ['Diferença', 'f', 14, true], ['Justificativa', 'j', 44]], fech);

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="financeiro-${from}-a-${to}.xlsx"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(buf));
});

// ── PDF resumido ───────────────────────────────────────────────────────────
export const getRelatorioPdf = wrap(async (req, res) => {
  const { from, to } = period(req);
  const r = await buildReport(req.professionalId, from, to);
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Relatório financeiro', Author: 'NailFlow' } });
  const chunks = [];
  doc.on('data', (d) => chunks.push(d));
  const done = new Promise((resolve) => doc.on('end', resolve));
  const h = (t) => { doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).text(t).moveDown(0.2).font('Helvetica').fontSize(10); };
  const line = (label, value) => { const y = doc.y; doc.text(label, 48, y, { width: 330 }); doc.text(value, 380, y, { width: 167, align: 'right' }); };
  doc.font('Helvetica-Bold').fontSize(16).text('Relatório financeiro');
  doc.font('Helvetica').fontSize(10).text(`Período: ${brDate(from)} a ${brDate(to)} · gerado em ${brDate(r.periodo.hoje)} (America/Sao_Paulo)`);
  h('Resumo do período');
  line('Recebido', brl(r.resumo.receivedCents)); line('Estornado', brl(r.resumo.refundedCents)); line('Recebido líquido', brl(r.resumo.netReceivedCents));
  line('Despesas pagas', brl(r.resumo.expensesPaidCents)); line('Saldo de caixa do período', brl(r.resumo.saldoCents));
  h('Recebimentos por método (líquido)');
  for (const m of r.recebimentosPorMetodo) line(ml(m.method), brl(m.netCents));
  h('Despesas pagas por método');
  if (!r.despesasPagasPorMetodo.length) doc.text('Nenhuma despesa paga no período.');
  for (const m of r.despesasPagasPorMetodo) line(m.method === 'boleto' ? 'Boleto (em Outros no caixa)' : m.method === 'nao_informado' ? 'Método não informado (em Outros no caixa)' : ml(m.method), brl(m.paidCents));
  h('Despesas pagas por categoria');
  if (!r.despesasPagasPorCategoria.length) doc.text('—');
  for (const m of r.despesasPagasPorCategoria.slice(0, 12)) line(m.category, brl(m.paidCents));
  h('Pendências (posição de hoje)');
  line('A receber pendente', brl(r.pendencias.aReceber.pendenteCents)); line('A receber vencido', brl(r.pendencias.aReceber.vencidoCents));
  line('Despesas pendentes (saldo)', brl(r.pendencias.despesas.pendentes.remainingCents)); line('Despesas vencidas (saldo)', brl(r.pendencias.despesas.vencidas.remainingCents));
  line('Despesas antigas a revisar', String(r.pendencias.despesas.aRevisar.count));
  h('Fechamento de caixa no período');
  line('Dias fechados', String(r.caixa.diasFechados)); line('Dias com divergência', String(r.caixa.comDivergencia));
  doc.moveDown(1).fontSize(8).fillColor('#666').text('Resumo gerado a partir de recebimentos e pagamentos efetivamente registrados; atendimento concluído sem recebimento não é contado como recebido. Detalhes na exportação Excel.');
  doc.end();
  await done;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="financeiro-${from}-a-${to}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.concat(chunks));
});

// ── GET /financeiro/alertas ────────────────────────────────────────────────
// Alertas internos (sem notificação externa): cada um traz o caminho da tela onde a pendência se resolve.
export const getAlertas = wrap(async (req, res) => {
  const pid = req.professionalId;
  const today = todayInBusinessTz();
  const receber = await receivableRows(pool, pid, today);
  const abertas = await openExpenseRows(pool, pid, today);
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 60);
  const fechamentos = (await closingRows(pool, pid, from.toISOString().slice(0, 10), today)).filter((f) => f.status === 'fechado' && f.divergente);
  const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
  const alertas = [];
  const venc = abertas.filter((r) => r.state === 'vencida');
  if (venc.length) alertas.push({ type: 'despesas_vencidas', severity: 'alta', title: 'Despesas vencidas', count: venc.length, amountCents: sum(venc, (r) => r.amount_cents - r.paid_cents), path: '/financeiro/despesas?situacao=vencida' });
  const rv = receber.filter((r) => r.overdue);
  if (rv.length) alertas.push({ type: 'a_receber_vencido', severity: 'alta', title: 'Valores a receber vencidos', count: rv.length, amountCents: sum(rv, (r) => r.balance), path: '/financeiro/a-receber' });
  if (fechamentos.length) {
    const first = fechamentos[fechamentos.length - 1];
    alertas.push({
      type: 'divergencia_caixa', severity: 'media', title: 'Divergências no fechamento de caixa (últimos 60 dias)', count: fechamentos.length,
      amountCents: sum(fechamentos, (f) => sum(f.metodos, (m) => Math.abs(m.differenceCents))), path: `/financeiro/caixa?data=${first.day}`, dias: fechamentos.map((f) => f.day),
    });
  }
  const rev = abertas.filter((r) => r.state === 'a_revisar');
  if (rev.length) alertas.push({ type: 'despesas_a_revisar', severity: 'media', title: 'Registros antigos de despesa para revisar', count: rev.length, amountCents: sum(rev, (r) => r.amount_cents), path: '/financeiro/despesas?situacao=a_revisar' });
  const rp = receber.filter((r) => !r.overdue);
  if (rp.length) alertas.push({ type: 'a_receber_pendente', severity: 'baixa', title: 'Valores a receber', count: rp.length, amountCents: sum(rp, (r) => r.balance), path: '/financeiro/a-receber' });
  res.json({ hoje: today, total: alertas.length, alertas });
});
