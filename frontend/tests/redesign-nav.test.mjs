// Redesign da navegação: quatro destinos, rotas antigas preservadas e isolamento dos dados simulados.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_REDIRECTS, NAV_ITEMS, isNavActive } from '../src/components/navConfig.ts';

const SRC = path.resolve(import.meta.dirname, '../src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const active = (p) => NAV_ITEMS.filter((l) => isNavActive(l, p)).map((l) => l.label);

test('navegação principal tem exatamente quatro destinos', () => {
  assert.deepEqual(NAV_ITEMS.map((l) => l.label), ['Início', 'Agenda', 'Financeiro', 'Mais']);
});

test('cada rota pertence a um único destino da navegação', () => {
  assert.deepEqual(active('/'), ['Início']);
  assert.deepEqual(active('/clientes'), ['Início']);
  assert.deepEqual(active('/clientes/abc'), ['Início']);
  assert.deepEqual(active('/agenda'), ['Agenda']);
  assert.deepEqual(active('/financeiro/a-receber'), ['Financeiro']);
  for (const p of ['/mais', '/servicos', '/configuracoes', '/suporte/solicitacoes', '/ajuda']) assert.deepEqual(active(p), ['Mais'], p);
});

test('Clientes é acessível pelo "Mais" e a rota continua registrada (o redesign tinha tirado da navegação sem pôr em outro lugar)', () => {
  const mais = fs.readFileSync(path.join(SRC, 'pages/Mais.tsx'), 'utf8');
  assert.match(mais, /<Item to="\/clientes" title="Clientes"/);
  assert.match(mais, /<Item to="\/retorno" title="Clientes para chamar"/);   // o item existente não foi trocado
  const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  assert.match(app, /path="\/clientes" element=\{<Clientes \/>\}/);
  assert.deepEqual(NAV_ITEMS.map((l) => l.label), ['Início', 'Agenda', 'Financeiro', 'Mais']);   // a barra principal não mudou
});

test('rotas antigas continuam existindo e redirecionam para o novo lugar', () => {
  const map = Object.fromEntries(LEGACY_REDIRECTS.map((r) => [r.from, r.to]));
  assert.equal(map['/dashboard'], '/financeiro/desempenho');
  assert.equal(map['/gastos'], '/financeiro/gastos');
  assert.equal(map['/perfil'], '/configuracoes?tab=perfil');
  assert.equal(map['/disponibilidade'], '/configuracoes?tab=disponibilidade');
  const app = fs.readFileSync(path.join(SRC, 'App.tsx'), 'utf8');
  for (const r of ['/p/:slug', '/agenda-publica', '/admin', '/suporte', '/servicos', '/configuracoes', '/clientes/:id', '/clientes/importar', '/mais', '/comecar', '/mensagens', '/redefinir-senha']) assert.ok(app.includes(`path="${r}"`), `rota ausente: ${r}`);
});

test('nenhuma tela chama a API fora de services/api.ts e do download de relatório (que também respeita o modo simulado)', () => {
  const comFetch = files.filter((f) => /\bfetch\(/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f).replaceAll('\\', '/')).sort();
  assert.deepEqual(comFetch, ['services/api.ts', 'services/financeiro.ts']);
  const api = fs.readFileSync(path.join(SRC, 'services/api.ts'), 'utf8');
  assert.match(api, /USE_MOCKS \? 'mock:\/\/offline'/);
  assert.match(api, /if \(USE_MOCKS\) \{[\s\S]*?mockRequest/);
  assert.match(fs.readFileSync(path.join(SRC, 'services/financeiro.ts'), 'utf8'), /startsWith\('mock:\/\/'\)\) throw/);
});

test('dados simulados não têm URLs, fetch nem endereço de produção', () => {
  for (const f of files.filter((x) => x.includes(`${path.sep}mocks${path.sep}`))) {
    // o único endereço permitido é o LINK do Instagram montado para exibição (nenhuma requisição sai dele)
    const s = fs.readFileSync(f, 'utf8').replaceAll('https://www.instagram.com/', '');
    assert.doesNotMatch(s, /\bfetch\(|https?:\/\/|duckdns/, f);
  }
  assert.match(fs.readFileSync(path.join(SRC, 'mocks/mode.ts'), 'utf8'), /MODE === 'mock'/);
});

// ── Acessibilidade e atendimento (verificações de código-fonte; o comportamento foi exercitado no navegador com dados simulados) ──
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

test('todo diálogo da área da profissional usa ModalA11y (Esc, foco preso, foco devolvido)', () => {
  const semA11y = files
    // admin-professionals/Modal e SupportLauncher (painel não modal) já tratam Esc e foco por conta própria
    .filter((f) => !f.includes('admin-professionals') && !f.endsWith('ModalA11y.tsx') && !f.endsWith('SupportLauncher.tsx'))
    .filter((f) => fs.readFileSync(f, 'utf8').includes('role="dialog"'))
    .filter((f) => !fs.readFileSync(f, 'utf8').includes('<ModalA11y'))
    .map((f) => path.relative(SRC, f));
  assert.deepEqual(semA11y, []);
});

test('atendimento: check-in usa o endpoint próprio, "em atendimento" não é status novo e há resumo antes de salvar', () => {
  const modal = read('components/AppointmentModal.tsx');
  assert.match(modal, /\/appointments\/\$\{appointment\.id\}\/check-in/);
  assert.match(modal, /Revisar e salvar/);
  assert.match(modal, /Concluído não significa recebido/);
  assert.doesNotMatch(modal, /'em_atendimento'/);               // não existe como status do agendamento
  assert.doesNotMatch(read('types.ts'), /em_atendimento/);
  assert.match(read('pages/Agenda.tsx'), /a\.status === 'confirmado' && a\.checkedInAt/);
});

test('sinal da reserva (Pix) e pagamento do atendimento têm nomes diferentes', () => {
  const modal = read('components/AppointmentModal.tsx');
  assert.match(modal, /Sinal recebido/);
  assert.doesNotMatch(modal, />\s*Pagamento recebido\s*</);
});

test('backend: rota de check-in só atua em agendamento confirmado e ainda sem chegada', () => {
  const routes = fs.readFileSync(path.resolve(SRC, '../../backend/src/routes/appointments.routes.js'), 'utf8');
  const ctrl = fs.readFileSync(path.resolve(SRC, '../../backend/src/controllers/appointmentsController.js'), 'utf8');
  assert.match(routes, /router\.post\('\/:id\/check-in', checkInAppointment\)/);
  assert.match(ctrl, /status = 'confirmado' AND checked_in_at IS NULL/);
});

test('modo Financeiro desligado: só as abas legadas aparecem e Início não consulta alertas', () => {
  const fin = read('pages/financeiro/Financeiro.tsx');
  assert.match(fin, /TABS\.filter\(\(t\) => moduloAtivo \|\| !t\.modulo\)/);
  assert.match(read('pages/Inicio.tsx'), /if \(!ativo\) return;/);
});

test('todo link /configuracoes?tab=<aba> aponta para uma aba que existe (inclui aparencia)', () => {
  const ids = [...read('pages/Configuracoes.tsx').matchAll(/\{ id: '(\w+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), ['agendamento', 'aparencia', 'disponibilidade', 'perfil', 'seguranca', 'whatsapp']);
  const usados = new Set();
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/configuracoes\?tab=(\w+)/g)) usados.add(m[1]);
  for (const u of usados) assert.ok(ids.includes(u), `aba inexistente: ${u}`);
  assert.doesNotMatch(read('pages/Configuracoes.tsx'), /tabParam === 'perfil' \|\|/); // lista fixa que esquecia "aparencia"
});

test('layout: link "Pular para o conteúdo", alvo focável e dois menus nomeados', () => {
  const l = read('components/Layout.tsx');
  assert.match(l, /href="#conteudo"/);
  assert.match(l, /<main id="conteudo" tabIndex=\{-1\}/);
  assert.equal((l.match(/<nav aria-label="Navegação principal"/g) || []).length, 2);
});

test('falha ao carregar não vira "nenhum registro": telas com lista usam LoadError antes do estado vazio', () => {
  for (const f of ['pages/Clientes.tsx', 'pages/Servicos.tsx', 'pages/Financeiro/../Gastos.tsx']) {
    const s = read(f);
    assert.match(s, /LoadError/, f);
    assert.ok(s.indexOf('loadError ?') > -1 && s.indexOf('loadError ?') < s.search(/Nenhum(a)? (cliente|serviço|gasto)/), `${f}: erro deve vir antes do vazio`);
  }
  assert.match(read('pages/Agenda.tsx'), /loadError && <LoadError/);
  assert.match(read('pages/Inicio.tsx'), /<LoadError message=\{`Não foi possível carregar o resumo do dia/);
});

test('Agenda: agendamento dentro do intervalo ou de um bloqueio continua visível (não é escondido pela linha de intervalo)', () => {
  const s = read('pages/Agenda.tsx');
  assert.match(s, /if \(isBreak && !apptHere\)/);
  assert.match(s, /if \(blockedHere && !apptHere\)/);
});

test('privacidade: o painel só usa endpoints existentes e não promete o que a política não confirma', () => {
  const p = read('components/PrivacidadePanel.tsx');
  for (const e of ["'/auth/password'", "'/auth/logout-all'"]) assert.ok(p.includes(e), e);
  assert.ok(read('services/api.ts').includes('/auth/export'));
  assert.match(p, /ainda não foi publicada/);              // status da política vem de POLICY_PAGE_PUBLISHED (false)
  assert.doesNotMatch(p, /[0-9]+ dias|LGPD|conforme a lei/i); // nenhum prazo ou afirmação jurídica inventada
  assert.match(read('content/avisoPrivacidade.ts'), /POLICY_PAGE_PUBLISHED: boolean = false/);
});

test('onboarding e importação reaproveitam endpoints existentes e a importação exige confirmação', () => {
  const c = read('pages/Comecar.tsx');
  for (const e of ["'/auth/me'", "'/services'", "'/onboarding/status'"]) assert.ok(c.includes(e), e);
  assert.match(c, /Disponibilidade/);
  const i = read('pages/ImportarClientes.tsx');
  assert.ok(i.includes('dryRun'));
  assert.ok(i.includes('disabled={busy || !authorized'));
  assert.ok(i.includes('.xlsx'));                          // orienta salvar como CSV em vez de ler o formato
});

test('modelos de mensagem: nada é enviado (sem chamadas à API de mensagens nem wa.me)', () => {
  const m = read('pages/ModelosMensagem.tsx');
  for (const proibido of ['api.post', 'api.put', 'wa.me', 'fetch(']) assert.ok(!m.includes(proibido), proibido);
});

test('cores do tema: nenhuma classe usa tom que não existe na escala (ex.: wine-900 geraria botão invisível)', () => {
  const cfg = fs.readFileSync(path.resolve(SRC, '../tailwind.config.js'), 'utf8');
  const escala = {};
  for (const nome of ['wine', 'gold', 'sage']) {
    const bloco = cfg.match(new RegExp(`${nome}: \{([^}]*)\}`))?.[1] ?? '';
    escala[nome] = new Set([...bloco.matchAll(/^\s*(\d+):/gm)].map((m) => m[1]));
    assert.ok(escala[nome].size > 0, `escala ${nome} não encontrada`);
  }
  const ruins = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|accent)-(wine|gold|sage)-(\d+)\b/g)) {
      if (!escala[m[1]].has(m[2])) ruins.push(`${path.relative(SRC, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual([...new Set(ruins)], []);
});

test('Início: cliente já no horário (confirmada, não iniciada) vira o cartão principal; a API só chama de "próximo" o que ainda vai começar', () => {
  const s = read('pages/Inicio.tsx');
  assert.match(s, /const heroAppt = emAtendimento \?\? noHorario \?\? proximoFull;/);
  assert.match(s, /a\.status === 'confirmado' && !a\.checkedInAt/);
  assert.match(s, /!heroAppt && nextOnboardingStep/);
});
