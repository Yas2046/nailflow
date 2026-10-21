// Executor MÍNIMO de workflows do n8n, só para testar a lógica do JSON de lembretes em ambiente isolado. NÃO é o n8n:
// cobre apenas os tipos de nó usados (scheduleTrigger, httpRequest, if, splitInBatches, code) e as expressões simples do workflow.
// Segurança: toda requisição passa pelo mapa `urlMap`; qualquer endereço fora dele é recusado (nada chega a produção, Evolution real ou internet).
import fs from 'node:fs';

export class WorkflowCrash extends Error {}   // simula o n8n morrendo no meio da execução
class WorkflowStop extends Error {}           // erro de nó sem tratamento: o n8n para a execução

export const loadWorkflow = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function createRunner({ workflow, urlMap, credentials, abortBefore = null, retryWaitMs = 1 }) {
  const nodes = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));
  const conns = workflow.connections;
  const allowed = urlMap.map(([, to]) => to);
  const log = [];
  const loops = new Map();

  const rewrite = (url) => {
    for (const [from, to] of urlMap) if (url.startsWith(from)) return to + url.slice(from.length);
    throw new Error(`endereço não permitido no teste: ${url}`);
  };

  function evalExpr(expr, ctx) {
    const $ = (name) => ({ item: { json: ctx.pairs[name] }, first: () => ({ json: ctx.pairs[name] }) });
    // eslint-disable-next-line no-new-func
    return new Function('$json', '$', 'JSON', `"use strict"; return (${expr});`)(ctx.json, $, JSON);
  }
  function value(v, ctx) {
    if (typeof v !== 'string' || !v.startsWith('=')) return v;
    const body = v.slice(1);
    const single = body.match(/^\{\{([\s\S]*)\}\}$/);
    if (single && !single[1].includes('}}')) return evalExpr(single[1], ctx);
    return body.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(evalExpr(e, ctx)));
  }
  const ctxOf = (item) => ({ json: item.json, pairs: item.pairs });
  const out = (node, item, json) => ({ json, pairs: { ...item.pairs, [node.name]: json } });

  async function http(node, items) {
    const p = node.parameters;
    const ok = []; const err = [];
    for (const item of items) {
      const ctx = ctxOf(item);
      const method = p.method || 'GET';
      let url = rewrite(value(p.url, ctx));
      if (p.sendQuery) {
        const q = new URLSearchParams();
        for (const x of p.queryParameters?.parameters ?? []) q.set(x.name, String(value(x.value, ctx)));
        url += (url.includes('?') ? '&' : '?') + q;
      }
      const headers = {};
      const cred = credentials[node.credentials?.httpHeaderAuth?.name];
      if (!cred) throw new Error(`credencial simulada ausente para o nó ${node.name}`);
      headers[cred.header] = cred.value;
      let body;
      if (p.sendBody && p.specifyBody === 'json') {
        const b = value(p.jsonBody, ctx);
        body = typeof b === 'string' ? b : JSON.stringify(b);
        JSON.parse(body);                                   // corpo inválido = erro de JSON, como no n8n
        headers['content-type'] = 'application/json';
      }
      const neverError = !!p.options?.response?.response?.neverError;
      const tries = node.retryOnFail ? (node.maxTries ?? 3) : 1;
      let last;
      for (let t = 1; t <= tries; t++) {
        try {
          const timeout = p.options?.timeout;
          const res = await fetch(url, { method, headers, body, ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}) });
          const text = await res.text();
          let data; try { data = JSON.parse(text); } catch { data = text; }
          log.push({ node: node.name, method, url: url.replace(/\?.*/, ''), status: res.status, attempt: t });
          if (res.status >= 400 && !neverError) { last = { message: `${res.status} - erro HTTP`, name: "AxiosError", code: "ERR_BAD_RESPONSE", status: res.status }; continue; }
          last = null;
          const arr = Array.isArray(data) ? data : [data];
          if (arr.length === 0 && node.alwaysOutputData) arr.push({});
          for (const d of arr) ok.push(out(node, item, d));
          break;
        } catch (e) {
          log.push({ node: node.name, method, url: url.replace(/\?.*/, ''), status: 'rede', attempt: t });
          last = { message: String(e.message), name: "AxiosError", code: e.name === "TimeoutError" ? "ECONNABORTED" : String(e.cause?.code ?? "") };
        }
        if (t < tries) await new Promise((r) => setTimeout(r, retryWaitMs));
      }
      if (last) {
        if (node.onError === 'continueErrorOutput') err.push(out(node, item, { error: last }));
        else if (node.onError === 'continueRegularOutput') ok.push(out(node, item, { error: last }));
        else throw new WorkflowStop(`${node.name}: ${last.message}`);
      }
    }
    return [ok, err];
  }

  function ifNode(node, items) {
    const yes = []; const no = [];
    for (const item of items) {
      const ctx = ctxOf(item);
      const pass = (node.parameters.conditions.conditions ?? []).every((c) => {
        const left = value(c.leftValue, ctx);
        const { type, operation } = c.operator;
        if (type === 'string' && operation === 'notEmpty') return left !== undefined && left !== null && String(left) !== '';
        if (type === 'boolean' && operation === 'true') return left === true;
        throw new Error(`operador não suportado: ${type}/${operation}`);
      });
      (pass ? yes : no).push(out(node, item, item.json));
    }
    return [yes, no];
  }

  function code(node, items) {
    const p = node.parameters;
    if (p.mode !== 'runOnceForEachItem') throw new Error(`${node.name}: o runner só aceita Code por item (em "todos os itens" $json e .item não existem)`);
    const res = [];
    for (const item of items) {
      const ctx = ctxOf(item);
      const $ = (name) => ({ item: { json: ctx.pairs[name] } });
      // eslint-disable-next-line no-new-func
      const r = new Function('$json', '$', `"use strict"; ${p.jsCode}`)(ctx.json, $);
      if (!r || typeof r.json !== 'object' || Array.isArray(r)) throw new Error(`${node.name}: o Code por item deve retornar { json }`);
      res.push(out(node, item, r.json));
    }
    return [res];
  }

  const descendants = (start, outIdx) => {
    const seen = new Set(); const stack = (conns[start]?.main?.[outIdx] ?? []).map((c) => c.node);
    while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n); for (const o of conns[n]?.main ?? []) for (const c of o) stack.push(c.node); }
    return seen;
  };

  function split(node, items, from) {
    const size = node.parameters.batchSize ?? 1;
    let st = loops.get(node.name);
    const isBack = st && descendants(node.name, 1).has(from);
    if (!isBack) { st = { pending: [...items], done: [] }; loops.set(node.name, st); }
    else st.done.push(...items);
    if (st.pending.length === 0) { loops.delete(node.name); return [st.done, []]; }   // [0]=done  [1]=loop
    const batch = st.pending.splice(0, size).map((i) => out(node, i, i.json));
    return [[], batch];
  }

  async function run() {
    const trigger = workflow.nodes.find((n) => n.type.endsWith('scheduleTrigger'));
    const queue = [{ node: trigger.name, from: null, items: [{ json: {}, pairs: { [trigger.name]: {} } }] }];
    let steps = 0;
    while (queue.length) {
      if (++steps > 5000) throw new Error('execução não terminou (laço infinito?)');
      const { node: name, from, items } = queue.shift();
      const node = nodes[name];
      if (abortBefore === name) throw new WorkflowCrash(`n8n encerrou antes de "${name}"`);
      let outputs;
      const t = node.type.split('.').pop();
      if (t === 'scheduleTrigger') outputs = [items];
      else if (t === 'httpRequest') outputs = await http(node, items);
      else if (t === 'if') outputs = ifNode(node, items);
      else if (t === 'splitInBatches') outputs = split(node, items, from);
      else if (t === 'code') outputs = code(node, items);
      else throw new Error(`tipo de nó não suportado: ${node.type}`);
      log.push({ node: name, in: items.length, out: outputs.map((o) => o.length) });
      outputs.forEach((o, idx) => {
        if (!o.length) return;
        for (const c of conns[name]?.main?.[idx] ?? []) queue.push({ node: c.node, from: name, items: o });
      });
    }
    return log;
  }

  return { run, log, allowed };
}
