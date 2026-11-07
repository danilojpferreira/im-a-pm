#!/usr/bin/env node
// im-a-pm: validate, sync, trace, diff, render and serve .im-a-pm/flows.json, and install the skills.
// Node 18+, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VIEWER = path.join(SKILL_DIR, 'assets', 'viewer.html');
const NODE_TYPES = new Set(['start', 'decision', 'action', 'data', 'external', 'outcome']);
const RESULTS = new Set(['success', 'rejected', 'error']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CHANNEL_RE = /^(queue|event|command|schedule|topic|webhook):[A-Za-z0-9_.:/-]+$/;
const FANOUT_MODES = new Set(['parallel', 'batch', 'each']);
const JOIN_MODES = new Set(['all', 'any', 'first']);
const CALL_KINDS = new Set(['call', 'framework', 'validation', 'query', 'config', 'event']);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`Cannot read ${file}: ${e.message}`);
  }
}

function fail(msg) {
  console.error(`im-a-pm: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

// ---------------------------------------------------------------- validate

export function validate(map) {
  const errors = [];
  const warnings = [];
  if (map.version !== 1) errors.push('version must be 1');
  if (!map.app?.name) errors.push('app.name is required');
  if (!Array.isArray(map.flows) || map.flows.length === 0) errors.push('flows must be a non-empty array');
  const flowIds = new Set();

  for (const flow of map.flows || []) {
    const where = `flow "${flow.id}"`;
    if (!flow.id || !ID_RE.test(flow.id)) errors.push(`${where}: id must be kebab-case`);
    if (flowIds.has(flow.id)) errors.push(`${where}: duplicate flow id`);
    flowIds.add(flow.id);
    for (const k of ['title', 'trigger', 'nodes', 'edges', 'happyPath']) {
      if (!flow[k]) errors.push(`${where}: missing ${k}`);
    }
    if (!flow.nodes || !flow.edges) continue;

    const nodes = new Map();
    for (const n of flow.nodes) {
      const w = `${where} node "${n.id}"`;
      if (!n.id || !ID_RE.test(n.id)) errors.push(`${w}: id must be kebab-case`);
      if (nodes.has(n.id)) errors.push(`${w}: duplicate node id`);
      nodes.set(n.id, n);
      if (!NODE_TYPES.has(n.type)) errors.push(`${w}: unknown type "${n.type}"`);
      if (!n.label) errors.push(`${w}: missing label`);
      if (n.type === 'decision' && !n.rule) errors.push(`${w}: decisions need a rule`);
      if (n.type === 'outcome' && !RESULTS.has(n.result)) errors.push(`${w}: outcome.result must be success | rejected | error`);
      if (n.type === 'data' && !['read', 'write', 'delete'].includes(n.data?.op)) errors.push(`${w}: data.op must be read | write | delete`);
      if (n.type !== 'start') {
        if (!Array.isArray(n.anchors) || n.anchors.length === 0) warnings.push(`${w}: no code anchor`);
        if (!CONFIDENCE.has(n.confidence)) warnings.push(`${w}: confidence should be high | medium | low`);
      }
      if (n.calls !== undefined) {
        if (!Array.isArray(n.calls)) errors.push(`${w}: calls must be an array`);
        else n.calls.forEach((c, i) => {
          if (!c.fn || !c.file || !Number.isInteger(c.line)) errors.push(`${w}: calls[${i}] needs fn, file and line`);
          if (c.endLine !== undefined && !(Number.isInteger(c.endLine) && c.endLine >= c.line)) errors.push(`${w}: calls[${i}].endLine must be >= line`);
          if (c.depth !== undefined && !(Number.isInteger(c.depth) && c.depth >= 0)) errors.push(`${w}: calls[${i}].depth must be an integer >= 0`);
          if (c.kind !== undefined && !CALL_KINDS.has(c.kind)) errors.push(`${w}: calls[${i}].kind must be one of ${[...CALL_KINDS].join(' | ')}`);
        });
      } else if (n.type !== 'outcome') warnings.push(`${w}: no calls (function order unknown)`);
      if (n.emits !== undefined) {
        if (!Array.isArray(n.emits)) errors.push(`${w}: emits must be an array`);
        else n.emits.forEach((e, i) => { if (!CHANNEL_RE.test(e.channel || '')) errors.push(`${w}: emits[${i}].channel must look like queue:<name>, event:<name>, command:<name> or schedule:<name>`); });
      }
      if (n.fanout !== undefined && (!FANOUT_MODES.has(n.fanout?.mode) || !n.fanout?.over)) errors.push(`${w}: fanout needs mode (parallel | batch | each) and over (what is split)`);
      if (n.join !== undefined && !JOIN_MODES.has(n.join?.mode)) errors.push(`${w}: join.mode must be all | any | first`);
      if (n.implicit !== undefined && typeof n.implicit !== 'boolean') errors.push(`${w}: implicit must be true or false`);
      if (n.stale) warnings.push(`${w}: needs re-check after code changes (${(n.stale.reasons || []).join('; ')})`);
    }
    if (flow.trigger?.channel !== undefined && !CHANNEL_RE.test(flow.trigger.channel)) errors.push(`${where}: trigger.channel must look like queue:<name>, event:<name>, command:<name> or schedule:<name>`);
    const starts = flow.nodes.filter((n) => n.type === 'start');
    if (starts.length !== 1) errors.push(`${where}: needs exactly one start node (has ${starts.length})`);

    const out = new Map([...nodes.keys()].map((id) => [id, []]));
    for (const e of flow.edges) {
      if (!nodes.has(e.from)) errors.push(`${where}: edge from unknown node "${e.from}"`);
      if (!nodes.has(e.to)) errors.push(`${where}: edge to unknown node "${e.to}"`);
      if (out.has(e.from)) out.get(e.from).push(e);
    }
    for (const [id, n] of nodes) {
      const edges = out.get(id);
      if (n.type === 'outcome' && edges.length) errors.push(`${where}: outcome "${id}" must not have outgoing edges`);
      if (n.type !== 'outcome' && edges.length === 0) errors.push(`${where}: "${id}" is a dead end (not an outcome, no outgoing edge)`);
      if (n.type === 'decision') {
        if (edges.length < 2) errors.push(`${where}: decision "${id}" needs 2+ outgoing edges`);
        if (edges.some((e) => !e.label)) errors.push(`${where}: every edge leaving decision "${id}" needs a label`);
      }
    }

    // reachability + cycles
    if (starts.length === 1) {
      const state = new Map();
      const visit = (id) => {
        state.set(id, 1);
        for (const e of out.get(id) || []) {
          if (e.loop) continue; // repetition is declared, not a cycle
          const s = state.get(e.to);
          if (s === 1) errors.push(`${where}: cycle through "${e.from}" → "${e.to}" (mark the edge that repeats with "loop": true)`);
          else if (!s && nodes.has(e.to)) visit(e.to);
        }
        state.set(id, 2);
      };
      visit(starts[0].id);
      for (const id of nodes.keys()) if (!state.has(id)) errors.push(`${where}: "${id}" is not reachable from start`);
      // A loop edge must go back to a step that leads to it (retry, next page, next batch).
      const reaches = (from, to) => { const seen = new Set([from]); const st = [from]; while (st.length) { const x = st.pop(); if (x === to) return true; for (const e of out.get(x) || []) if (!e.loop && !seen.has(e.to)) { seen.add(e.to); st.push(e.to); } } return false; };
      for (const e of flow.edges) if (e.loop && nodes.has(e.from) && nodes.has(e.to) && !reaches(e.to, e.from)) errors.push(`${where}: loop edge "${e.from}" → "${e.to}" must point back to an earlier step`);
    }

    const outcomes = flow.nodes.filter((n) => n.type === 'outcome').map((n) => n.id);
    if (flow.happyPath && !outcomes.includes(flow.happyPath)) errors.push(`${where}: happyPath "${flow.happyPath}" is not an outcome node`);
    for (const o of outcomes) {
      if (o !== flow.happyPath && !flow.outcomes?.[o]) warnings.push(`${where}: outcome "${o}" has no name in "outcomes"`);
    }
  }
  // Hand-offs between flows: every emitted channel should start some flow.
  const consumers = new Set((map.flows || []).map((f) => f.trigger?.channel).filter(Boolean));
  for (const f of map.flows || []) for (const n of f.nodes || []) for (const e of n.emits || []) {
    if (e.channel && !consumers.has(e.channel)) warnings.push(`flow "${f.id}" node "${n.id}": emits ${e.channel} but no flow starts from it`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------- diff

const NODE_FIELDS = ['type', 'label', 'rule', 'result', 'response', 'system', 'implicit'];
const edgeKey = (e) => `${e.from}→${e.to}${e.label ? ` [${e.label}]` : ''}${e.loop ? ' (repeats)' : ''}${e.implicit ? ' (not handled in code)' : ''}`;

export function diff(base, head) {
  const bFlows = new Map(base.flows.map((f) => [f.id, f]));
  const hFlows = new Map(head.flows.map((f) => [f.id, f]));
  const result = { added: [], removed: [], changed: {}, unchanged: [] };

  for (const [id, f] of hFlows) if (!bFlows.has(id)) result.added.push(id);
  for (const [id, f] of bFlows) if (!hFlows.has(id)) result.removed.push(id);

  for (const [id, hf] of hFlows) {
    const bf = bFlows.get(id);
    if (!bf) continue;
    const bn = new Map(bf.nodes.map((n) => [n.id, n]));
    const hn = new Map(hf.nodes.map((n) => [n.id, n]));
    const d = { nodes: { added: [], removed: [], changed: [], implChanged: [] }, edges: { added: [], removed: [] }, fields: {} };
    for (const k of ['title', 'summary', 'happyPath']) {
      if (JSON.stringify(bf[k]) !== JSON.stringify(hf[k])) d.fields[k] = [bf[k], hf[k]];
    }
    if (bf.trigger?.signature !== hf.trigger?.signature) d.fields.trigger = [bf.trigger?.signature, hf.trigger?.signature];
    if ((bf.trigger?.channel ?? null) !== (hf.trigger?.channel ?? null)) d.fields.channel = [bf.trigger?.channel ?? null, hf.trigger?.channel ?? null];
    for (const [nid] of hn) if (!bn.has(nid)) d.nodes.added.push(nid);
    for (const [nid] of bn) if (!hn.has(nid)) d.nodes.removed.push(nid);
    for (const [nid, h] of hn) {
      const b = bn.get(nid);
      if (!b) continue;
      const fields = {};
      for (const k of NODE_FIELDS) if ((b[k] ?? null) !== (h[k] ?? null)) fields[k] = [b[k] ?? null, h[k] ?? null];
      if (JSON.stringify(b.data ?? null) !== JSON.stringify(h.data ?? null)) fields.data = [b.data ?? null, h.data ?? null];
      for (const k of ['fanout', 'join']) if (JSON.stringify(b[k] ?? null) !== JSON.stringify(h[k] ?? null)) fields[k] = [b[k] ?? null, h[k] ?? null];
      const em = (n) => (n.emits || []).map((e) => e.channel).sort().join(', ') || null;
      if (em(b) !== em(h)) fields.emits = [em(b), em(h)];
      if (Object.keys(fields).length) d.nodes.changed.push({ id: nid, fields });
      // Same business step, different functions: an implementation change reviewers should see.
      else if (Array.isArray(b.calls) && Array.isArray(h.calls)) {
        const seq = (n) => n.calls.map((c) => `${c.depth ?? 0}:${c.fn}`).join('>');
        if (seq(b) !== seq(h)) d.nodes.implChanged.push(nid);
      }
    }
    const be = new Set(bf.edges.map(edgeKey));
    const he = new Set(hf.edges.map(edgeKey));
    for (const k of he) if (!be.has(k)) d.edges.added.push(k);
    for (const k of be) if (!he.has(k)) d.edges.removed.push(k);

    const empty = !Object.keys(d.fields).length && !d.nodes.added.length && !d.nodes.removed.length &&
      !d.nodes.changed.length && !d.nodes.implChanged.length && !d.edges.added.length && !d.edges.removed.length;
    if (empty) result.unchanged.push(id);
    else result.changed[id] = d;
  }
  return result;
}

export function printDiff(d, base, head) {
  const title = (map, id) => map.flows.find((f) => f.id === id)?.title || id;
  const label = (map, fid, nid) => map.flows.find((f) => f.id === fid)?.nodes.find((n) => n.id === nid)?.label || nid;
  const lines = [];
  for (const id of d.added) lines.push(`+ New flow: ${title(head, id)}`);
  for (const id of d.removed) lines.push(`- Removed flow: ${title(base, id)}`);
  for (const [id, c] of Object.entries(d.changed)) {
    lines.push(`~ ${title(head, id)}`);
    for (const [k, [a, b]] of Object.entries(c.fields)) lines.push(`    ${k}: "${a}" → "${b}"`);
    for (const n of c.nodes.added) lines.push(`    + ${label(head, id, n)}`);
    for (const n of c.nodes.removed) lines.push(`    - ${label(base, id, n)}`);
    for (const n of c.nodes.changed) {
      for (const [k, [a, b]] of Object.entries(n.fields)) {
        if (k === 'data') continue;
        lines.push(`    ~ ${label(head, id, n.id)} (${k}): "${a ?? '—'}" → "${b ?? '—'}"`);
      }
    }
    for (const n of c.nodes.implChanged) lines.push(`    · ${label(head, id, n)}: code path changed, same business rule`);
    // Rewired paths are implied by added/removed steps; list them only when nothing else changed.
    if (!c.nodes.added.length && !c.nodes.removed.length) {
      for (const e of c.edges.added) lines.push(`    + path ${e}`);
      for (const e of c.edges.removed) lines.push(`    - path ${e}`);
    }
  }
  if (!lines.length) lines.push('No business behavior changed.');
  lines.push(`(${d.unchanged.length} flow(s) unchanged)`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- render

// The template is an HTML fragment. By default it is wrapped into a full document;
// `fragment: true` leaves it bare for hosts that add their own skeleton.
export function render(head, base, { served = false, fragment = false } = {}) {
  const template = fs.readFileSync(VIEWER, 'utf8');
  const payload = { head, base: base || null, diff: base ? diff(base, head) : null, served };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const marker = '/*__IM_A_PM_DATA__*/null';
  if (!template.includes(marker)) fail('viewer template is missing the data marker');
  const title = `<title>${String(head.app?.name || 'App').replace(/[<&]/g, '')} business map</title>`;
  const body = template.replace(marker, () => json).replace('<title>Business map</title>', () => title);
  if (fragment) return body;
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

// ---------------------------------------------------------------- trace

// Nodes on any route from start to `outcomeId`, in execution (topological) order.
export function pathNodes(flow, outcomeId) {
  const out = new Map(flow.nodes.map((n) => [n.id, []]));
  const inn = new Map(flow.nodes.map((n) => [n.id, []]));
  for (const e of flow.edges) { if (e.loop) continue; out.get(e.from)?.push(e.to); inn.get(e.to)?.push(e.from); }
  const reach = (from, adj) => { const seen = new Set([from]); const st = [from]; while (st.length) for (const x of adj.get(st.pop()) || []) if (!seen.has(x)) { seen.add(x); st.push(x); } return seen; };
  const fwd = reach('start', out), back = reach(outcomeId, inn);
  const on = new Set([...fwd].filter((x) => back.has(x)));
  // A path also runs the body of every loop that starts on it (retries, next page, next batch).
  for (const e of flow.edges) if (e.loop && on.has(e.to)) {
    const body = reach(e.to, out), toSource = reach(e.from, inn);
    for (const x of body) if (toSource.has(x)) on.add(x);
  }
  const indeg = new Map([...on].map((x) => [x, inn.get(x).filter((p) => on.has(p)).length]));
  const order = [], q = [...on].filter((x) => indeg.get(x) === 0);
  while (q.length) { const x = q.shift(); order.push(x); for (const y of out.get(x)) if (on.has(y)) { indeg.set(y, indeg.get(y) - 1); if (!indeg.get(y)) q.push(y); } }
  const byId = (id) => flow.nodes.find((n) => n.id === id);
  // Outcomes last: when a loop exits to the outcome, the loop body still runs first.
  return [...order.filter((id) => byId(id).type !== 'outcome'), ...order.filter((id) => byId(id).type === 'outcome')].map(byId);
}

export function printTrace(map, flowId, outcomeId, follow = false, seen = new Set(), indent = '') {
  const flow = map.flows.find((f) => f.id === flowId);
  if (!flow) fail(`no flow "${flowId}"`);
  seen.add(flowId);
  const target = outcomeId || flow.happyPath;
  const lines = [`${indent}${flow.title} → ${flow.nodes.find((n) => n.id === target)?.label || target}${flow.trigger?.channel ? `   (starts from ${flow.trigger.channel})` : ''}`];
  const handoffs = [];
  let step = 0;
  for (const n of pathNodes(flow, target)) {
    const tags = [n.fanout && `splits ${n.fanout.mode === 'parallel' ? 'in parallel' : n.fanout.mode === 'batch' ? 'into batches' : 'for each'}: ${n.fanout.over}`, n.join && `waits for ${n.join.mode}`, n.implicit && 'not handled in code'].filter(Boolean);
    lines.push(`\n[${n.type}] ${n.label}${tags.length ? `   (${tags.join('; ')})` : ''}`);
    for (const c of n.calls || []) {
      step++;
      const where = `${c.file}:${c.line}${c.endLine && c.endLine !== c.line ? `-${c.endLine}` : ''}`;
      lines.push(`  ${String(step).padStart(2)}. ${'  '.repeat(c.depth || 0)}${c.fn}${c.kind && c.kind !== 'call' ? ` (${c.kind})` : ''}  ${where}${c.note ? `  — ${c.note}` : ''}`);
    }
    if (!n.calls?.length && n.type !== 'outcome') lines.push('     (no functions recorded)');
    for (const e of flow.edges.filter((x) => x.loop && x.from === n.id)) lines.push(`     ↺ repeats from "${flow.nodes.find((x) => x.id === e.to)?.label || e.to}"${e.label ? ` (${e.label})` : ''}`);
    for (const e of n.emits || []) {
      const next = map.flows.filter((f) => f.trigger?.channel === e.channel);
      lines.push(`     ↳ ${e.channel} → ${next.length ? next.map((f) => f.title).join(', ') : 'no flow starts from it'}`);
      handoffs.push(...next.map((f) => f.id));
    }
  }
  let out = lines.join('\n'.concat(indent));
  if (follow) for (const id of handoffs) if (!seen.has(id)) out += `\n\n${indent}── continues asynchronously ──\n` + printTrace(map, id, undefined, true, seen, indent);
  return out;
}

// ---------------------------------------------------------------- sync

// Markers that usually mean a new or changed entrypoint (see reference/entrypoints.md).
const ENTRY_MARKERS = /@(RestController|Controller|(Get|Post|Put|Patch|Delete|Request)Mapping|KafkaListener|RabbitListener|SqsListener|Scheduled|EventListener|TransactionalEventListener|Get|Post|Put|Patch|Delete|Resolver|Mutation|MessagePattern|EventPattern|Cron|Processor|OnEvent|CommandHandler|EventsHandler|Saga|WorkflowMethod|shared_task|task)\b|\b(app|router|fastify|server)\.(get|post|put|patch|delete|route)\(|urlpatterns|^\s*(resources?|get|post|put|patch|delete)\s+['":]|new Worker\(|cron\.schedule|\.subscribe\(|\.consume\(|['"]use server['"]/;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function parseUnifiedDiff(text) {
  const files = [];
  let f = null, h = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      f = { oldPath: m?.[1], newPath: m?.[2], status: 'M', hunks: [] };
      files.push(f); h = null;
    } else if (!f) continue;
    else if (line.startsWith('new file mode')) f.status = 'A';
    else if (line.startsWith('deleted file mode')) f.status = 'D';
    else if (line.startsWith('rename from ')) { f.status = 'R'; f.oldPath = line.slice(12); }
    else if (line.startsWith('rename to ')) f.newPath = line.slice(10);
    else if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      h = { a: +m[1], b: m[2] === undefined ? 1 : +m[2], c: +m[3], d: m[4] === undefined ? 1 : +m[4], added: [] };
      f.hunks.push(h);
    } else if (h && line.startsWith('+')) h.added.push({ line: h.c + h.added.length, text: line.slice(1) });
  }
  return files;
}

// Old line → new line, given a file's hunks (-U0). Lines inside a changed block map to its new start.
export function shiftLine(hunks, L) {
  let delta = 0;
  for (const h of hunks) {
    if (h.b > 0) {
      if (L > h.a + h.b - 1) delta += h.d - h.b;
      else if (L >= h.a) return h.c;
      else break;
    } else if (L > h.a) delta += h.d;
    else break;
  }
  return L + delta;
}
export function touches(hunks, s, e) {
  return hunks.some((h) => (h.b > 0 ? h.a <= e && h.a + h.b - 1 >= s : h.a >= s && h.a < e));
}

export function sync(map, { cwd, since }) {
  const root = git(['rev-parse', '--show-toplevel'], cwd).trim();
  const from = since || map.app?.commit;
  if (!from) fail('the map has no app.commit. Run `stamp` once the map matches HEAD, or pass --since <commit>.');
  try { git(['cat-file', '-e', `${from}^{commit}`], root); }
  catch { fail(`commit ${from} is not in this clone (shallow clone or rewritten history). Fetch more history (git fetch --deepen=200) or rebuild the map with /im-a-pm build.`); }
  const head = git(['rev-parse', 'HEAD'], root).trim();
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root).trim();
  const dirty = git(['status', '--porcelain', '--', '.', ':(exclude).im-a-pm'], root).split('\n').filter(Boolean).map((l) => l.slice(3));
  const report = { from, to: head, upToDate: false, flows: {}, renamed: [], unmapped: [], entrypointCandidates: [], uncommitted: dirty };

  const files = parseUnifiedDiff(git(['diff', '-U0', '-M', '--no-color', '--no-ext-diff', from, head, '--', '.', ':(exclude).im-a-pm'], root));
  if (!files.length) report.upToDate = true;
  const byOld = new Map(files.filter((f) => f.oldPath).map((f) => [f.oldPath, f]));
  const referenced = new Set();

  // Re-point every anchor and call at the new code; mark the steps whose code changed.
  const visit = (entry, owner, label) => {
    const f = byOld.get(entry.file);
    if (!f) { referenced.add(entry.file); return; }
    if (f.status === 'D') { owner.reasons.add(`${label}: file deleted`); return; }
    const s = entry.line, e = entry.endLine ?? entry.line;
    if (touches(f.hunks, s, e)) owner.reasons.add(`${label} changed`);
    entry.line = shiftLine(f.hunks, s);
    if (entry.endLine !== undefined) entry.endLine = Math.max(entry.line, shiftLine(f.hunks, e));
    if (f.status === 'R') { entry.file = f.newPath; report.renamed.push([f.oldPath, f.newPath]); }
    referenced.add(entry.file);
  };
  for (const flow of map.flows) {
    const fr = { stale: [], trigger: [] };
    const trig = { reasons: new Set() };
    for (const a of flow.trigger?.anchors || []) visit(a, trig, `entrypoint ${flow.trigger.signature}`);
    if (trig.reasons.size) { flow.stale = { reasons: [...trig.reasons], since: from }; fr.trigger = [...trig.reasons]; }
    for (const n of flow.nodes) {
      const own = { reasons: new Set(n.stale?.reasons || []) };
      for (const c of n.calls || []) visit(c, own, c.fn);
      for (const a of n.anchors || []) visit(a, own, `rule at ${a.file.split('/').pop()}:${a.line}`);
      if (own.reasons.size) { n.stale = { reasons: [...own.reasons], since: n.stale?.since || from }; fr.stale.push({ node: n.id, label: n.label, reasons: [...own.reasons] }); }
    }
    if (fr.stale.length || fr.trigger.length) report.flows[flow.id] = { title: flow.title, ...fr };
  }

  for (const f of files) {
    if (f.status === 'D') continue;
    if (!referenced.has(f.newPath)) report.unmapped.push({ file: f.newPath, status: f.status });
    for (const h of f.hunks) for (const a of h.added) {
      if (ENTRY_MARKERS.test(a.text)) report.entrypointCandidates.push({ file: f.newPath, line: a.line, text: a.text.trim().slice(0, 160) });
    }
  }
  report.renamed = [...new Map(report.renamed.map((r) => [r.join('→'), r])).values()];

  map.app.commit = head;
  map.app.ref = branch;
  map.app.syncedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return report;
}

function printSync(r) {
  const lines = [];
  if (r.upToDate) lines.push(`Up to date: no code changes since ${r.from.slice(0, 7)}.`);
  else lines.push(`Changes ${r.from.slice(0, 7)} → ${r.to.slice(0, 7)}. Line numbers in the map now point at ${r.to.slice(0, 7)}.`);
  const ids = Object.keys(r.flows);
  if (ids.length) {
    lines.push(`\nSteps to re-check (${ids.length} flow${ids.length > 1 ? 's' : ''}):`);
    for (const id of ids) {
      const f = r.flows[id];
      lines.push(`  ${f.title} [${id}]`);
      for (const t of f.trigger) lines.push(`    ! entrypoint: ${t}`);
      for (const s of f.stale) lines.push(`    ! ${s.label} [${s.node}]: ${s.reasons.join('; ')}`);
    }
  } else if (!r.upToDate) lines.push('\nNo mapped step was touched.');
  if (r.entrypointCandidates.length) {
    lines.push('\nPossible new or changed entrypoints:');
    for (const c of r.entrypointCandidates) lines.push(`  ${c.file}:${c.line}  ${c.text}`);
  }
  if (r.unmapped.length) {
    lines.push('\nChanged files the map does not reference (check for new rules, wiring or entrypoints):');
    for (const u of r.unmapped) lines.push(`  ${u.status} ${u.file}`);
  }
  for (const [a, b] of r.renamed) lines.push(`Renamed: ${a} → ${b}`);
  if (r.uncommitted.length) lines.push(`\nNot synced (uncommitted): ${r.uncommitted.join(', ')}. Commit them, then sync again.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- serve & open

// What the served page shows: written by `render`, read on every request, so the open tab
// always reflects the last render (with or without a base map to compare against).
function viewState(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'view.json'), 'utf8')); }
  catch { return { flows: path.join(dir, 'flows.json'), base: null }; }
}
function version(dir) {
  const v = viewState(dir);
  return [path.join(dir, 'view.json'), v.flows, v.base].filter(Boolean)
    .map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join('-');
}

export function serve({ dir, port, quiet = false }) {
  dir = path.resolve(dir);
  let lastSeen = 0;
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && url === '/') {
      try {
        const v = viewState(dir);
        const head = JSON.parse(fs.readFileSync(v.flows, 'utf8'));
        const base = v.base && fs.existsSync(v.base) ? JSON.parse(fs.readFileSync(v.base, 'utf8')) : null;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(render(head, base, { served: true }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(`im-a-pm: cannot render the map: ${e.message}`);
      }
    }
    if (req.method === 'GET' && url === '/api/ping') return json(res, 200, { app: 'im-a-pm', dir, pid: process.pid, viewerSeenMsAgo: lastSeen ? Date.now() - lastSeen : null });
    if (req.method === 'GET' && url === '/api/version') { lastSeen = Date.now(); return json(res, 200, { version: version(dir) }); }
    if (req.method === 'POST' && url === '/api/requests') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const r = JSON.parse(body);
          if (!['ask', 'change', 'flag'].includes(r.kind) || !r.text) throw new Error('kind and text are required');
          const reqDir = path.join(dir, 'requests');
          fs.mkdirSync(reqDir, { recursive: true });
          const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${r.kind}.json`;
          const record = { kind: r.kind, flow: r.flow || null, node: r.node || null, text: String(r.text), createdAt: new Date().toISOString() };
          fs.writeFileSync(path.join(reqDir, name), JSON.stringify(record, null, 2));
          json(res, 201, { ok: true, file: path.join('.im-a-pm', 'requests', name) });
        } catch (e) { json(res, 400, { ok: false, error: e.message }); }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      if (!quiet) {
        console.log(`im-a-pm viewer: http://127.0.0.1:${port}/`);
        console.log(`questions and change requests land in ${path.join(dir, 'requests')}/ (run /im-a-pm inbox)`);
      }
      resolve(server);
    });
  });
}

function ping(port, dir) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 600 }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { try { const j = JSON.parse(b); resolve(j.app === 'im-a-pm' && (!dir || j.dir === path.resolve(dir)) ? j : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
function portFree(port) {
  return new Promise((resolve) => {
    const t = net.createServer().once('error', () => resolve(false)).once('listening', () => t.close(() => resolve(true)));
    t.listen(port, '127.0.0.1');
  });
}

// Start (or reuse) a background viewer server for this .im-a-pm folder.
export async function ensureServer(dir) {
  dir = path.resolve(dir);
  const stateFile = path.join(dir, 'server.json');
  try {
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const alive = await ping(st.port, dir);
    if (alive) return { port: st.port, info: alive, started: false };
  } catch { /* no running server */ }
  for (let port = 4178; port < 4228; port++) {
    const other = await ping(port);
    if (other) { if (other.dir === dir) { fs.writeFileSync(stateFile, JSON.stringify({ port, pid: other.pid }) + '\n'); return { port, info: other, started: false }; } continue; }
    if (!(await portFree(port))) continue;
    const log = fs.openSync(path.join(dir, 'server.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--dir', dir, '--port', String(port)], { detached: true, stdio: ['ignore', log, log] });
    child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const info = await ping(port, dir);
      if (info) { fs.writeFileSync(stateFile, JSON.stringify({ port, pid: child.pid }) + '\n'); return { port, info, started: true }; }
    }
    fail(`the viewer server did not start; see ${path.join(dir, 'server.log')}`);
  }
  fail('no free port between 4178 and 4227 for the viewer');
}

export function openBrowser(url) {
  if (process.env.IM_A_PM_NO_OPEN || process.env.CI) return false;
  let cmd, args;
  if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '""', url]; }
  else if (process.env.WSL_DISTRO_NAME) { cmd = 'cmd.exe'; args = ['/c', 'start', '""', url]; }
  else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) { cmd = 'xdg-open'; args = [url]; }
  else return false;
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); return true; }
  catch { return false; }
}

// Render index.html, point the served view at it, and make sure a browser shows it.
async function renderAndShow(file, baseFile, { open = true, out } = {}) {
  const head = readJson(file);
  const { errors } = validate(head);
  if (errors.length) fail(`${file} is invalid (${errors.length} errors). Run validate first.`);
  const base = baseFile ? readJson(baseFile) : null;
  const dir = path.dirname(path.resolve(file));
  const target = out || path.join(dir, 'index.html');
  fs.writeFileSync(target, render(head, base));
  console.log(`✓ wrote ${target}${base ? ' (with the diff against the base map)' : ''}`);
  if (out) return; // a custom output path is an export, not the project's view
  fs.writeFileSync(path.join(dir, 'view.json'), JSON.stringify({ flows: path.resolve(file), base: baseFile ? path.resolve(baseFile) : null }) + '\n');
  if (!open) return;
  const { port, info } = await ensureServer(dir);
  const url = `http://127.0.0.1:${port}/`;
  if (info.viewerSeenMsAgo !== null && info.viewerSeenMsAgo < 5000) console.log(`✓ viewer: ${url} (already open; it reloads itself)`);
  else if (openBrowser(url)) console.log(`✓ viewer: ${url} (opened in your browser)`);
  else console.log(`✓ viewer: ${url} (no browser can be opened from here; open this address yourself)`);
}

function stopServer(dir) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'server.json'), 'utf8'));
    process.kill(st.pid);
    fs.rmSync(path.join(dir, 'server.json'));
    console.log(`✓ stopped the viewer on port ${st.port}`);
  } catch { console.log('no viewer server is running for this project'); }
}

// ---------------------------------------------------------------- install

// Where each agent looks for skills (user level, project level). `.claude/skills` and
// `.agents/skills` together cover Claude Code, Codex, Copilot, Cursor and Gemini CLI.
const AGENT_DIRS = {
  claude: ['.claude/skills', '.claude/skills'],
  codex: ['.agents/skills', '.agents/skills'],
  copilot: ['.copilot/skills', '.github/skills'],
  cursor: ['.cursor/skills', '.cursor/skills'],
  gemini: ['.gemini/skills', '.gemini/skills'],
  all: [['.claude/skills', '.agents/skills'], ['.claude/skills', '.agents/skills']],
};
const SKILL_NAMES = ['im-a-pm', 'imapm'];

function installTargets(args) {
  if (typeof args.dir === 'string') return [path.resolve(args.dir)];
  const agent = typeof args.agent === 'string' ? args.agent : 'all';
  if (!AGENT_DIRS[agent]) fail(`unknown agent "${agent}". Use one of: ${Object.keys(AGENT_DIRS).join(', ')}`);
  const project = args.project !== undefined;
  const root = project ? path.resolve(typeof args.project === 'string' ? args.project : '.') : os.homedir();
  const rel = [AGENT_DIRS[agent][project ? 1 : 0]].flat();
  return [...new Set(rel.map((r) => path.join(root, r)))];
}

function install(args, remove = false) {
  const src = path.dirname(SKILL_DIR);
  for (const name of SKILL_NAMES) if (!fs.existsSync(path.join(src, name, 'SKILL.md'))) fail(`run install from a full copy of the repository (missing skills/${name})`);
  for (const dir of installTargets(args)) {
    for (const name of SKILL_NAMES) {
      const dest = path.join(dir, name);
      if (fs.existsSync(dest)) {
        const md = path.join(dest, 'SKILL.md');
        if (!fs.existsSync(md) || !new RegExp(`^name:\\s*${name}\\s*$`, 'm').test(fs.readFileSync(md, 'utf8'))) fail(`${dest} exists and is not this skill; not touching it`);
        fs.rmSync(dest, { recursive: true, force: true });
      }
      if (!remove) { fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(src, name), dest, { recursive: true }); }
    }
    console.log(`${remove ? '✓ removed from' : '✓ installed in'} ${dir}  (${SKILL_NAMES.join(', ')})`);
  }
}

// ---------------------------------------------------------------- cli

const USAGE = `im-a-pm: business-flow maps of a codebase, for product managers

usage (run from the repository root; the map lives in .im-a-pm/flows.json):
  im-a-pm validate [flows.json]
  im-a-pm render   [flows.json] [--base base.json] [--no-open] [--out file.html] [--fragment]
  im-a-pm view     [flows.json]                  open the viewer (starts a local server)
  im-a-pm sync     [flows.json] [--since <commit>] [--json] [--no-open]
  im-a-pm stamp    [flows.json]
  im-a-pm trace    <flow-id> [<outcome-id>] [--follow] [--file flows.json]
  im-a-pm diff     <base.json> <head.json> [--json]
  im-a-pm serve    [--dir .im-a-pm] [--port 4178]   foreground server
  im-a-pm stop                                     stop the background viewer server
  im-a-pm install   [--agent all|claude|codex|copilot|cursor|gemini] [--project [dir]] [--dir <skills-dir>]
  im-a-pm uninstall [same options]

render, view and sync open the map in your browser (served at http://127.0.0.1:4178 or the next
free port). An open tab reloads itself after each render. Set IM_A_PM_NO_OPEN=1 to never open one.`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const file = args._[0] || '.im-a-pm/flows.json';
  const open = !args['no-open'];

  if (cmd === 'validate') {
    const map = readJson(file);
    const { errors, warnings } = validate(map);
    warnings.forEach((w) => console.log(`warning: ${w}`));
    errors.forEach((e) => console.log(`error:   ${e}`));
    const decisions = map.flows?.reduce((s, f) => s + (f.nodes || []).filter((n) => n.type === 'decision').length, 0);
    console.log(errors.length
      ? `✗ ${errors.length} error(s), ${warnings.length} warning(s)`
      : `✓ valid: ${map.flows.length} flows, ${decisions} decisions, ${warnings.length} warning(s)`);
    process.exit(errors.length ? 1 : 0);
  }

  if (cmd === 'diff') {
    if (args._.length < 2) fail('usage: diff <base.json> <head.json> [--json]');
    const base = readJson(args._[0]);
    const head = readJson(args._[1]);
    const d = diff(base, head);
    console.log(args.json ? JSON.stringify(d, null, 2) : printDiff(d, base, head));
    return;
  }

  if (cmd === 'render') {
    if (args.fragment) {
      const head = readJson(file);
      if (validate(head).errors.length) fail(`${file} is invalid. Run validate first.`);
      const out = args.out || path.join(path.dirname(file), 'index.fragment.html');
      fs.writeFileSync(out, render(head, args.base ? readJson(args.base) : null, { fragment: true }));
      console.log(`✓ wrote ${out}`);
      return;
    }
    await renderAndShow(file, typeof args.base === 'string' ? args.base : null, { open, out: args.out });
    return;
  }

  if (cmd === 'view' || cmd === 'open') {
    const dir = path.dirname(path.resolve(file));
    const v = viewState(dir);
    await renderAndShow(file, v.base && fs.existsSync(v.base) ? v.base : null, { open: true });
    return;
  }

  if (cmd === 'sync') {
    const map = readJson(file);
    const report = sync(map, { cwd: path.dirname(path.resolve(file)), since: args.since });
    fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
    fs.writeFileSync(path.join(path.dirname(file), 'sync.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(args.json ? JSON.stringify(report, null, 2) : printSync(report));
    if (!args.json) await renderAndShow(file, null, { open });
    return;
  }

  if (cmd === 'stamp') {
    const map = readJson(file);
    const cwd = git(['rev-parse', '--show-toplevel'], path.dirname(path.resolve(file))).trim();
    map.app.commit = git(['rev-parse', 'HEAD'], cwd).trim();
    map.app.ref = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
    map.app.syncedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    fs.writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
    const dirty = git(['status', '--porcelain', '--', '.', ':(exclude).im-a-pm'], cwd).trim();
    console.log(`✓ map stamped at ${map.app.commit.slice(0, 7)} (${map.app.ref})`);
    if (dirty) console.log(`warning: uncommitted code changes exist. The map should describe committed code only:\n${dirty}`);
    return;
  }

  if (cmd === 'trace') {
    const flowId = args._[0];
    if (!flowId) fail('usage: trace <flow-id> [<outcome-id>] [--follow] [--file flows.json]');
    console.log(printTrace(readJson(args.file || '.im-a-pm/flows.json'), flowId, args._[1], !!args.follow));
    return;
  }

  if (cmd === 'serve') {
    await serve({ dir: typeof args.dir === 'string' ? args.dir : path.dirname(file), port: Number(args.port) || 4178 });
    return;
  }

  if (cmd === 'stop') { stopServer(path.dirname(path.resolve(file))); return; }
  if (cmd === 'install') { install(args); return; }
  if (cmd === 'uninstall') { install(args, true); return; }

  console.log(USAGE);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0);
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); }
  catch { return false; }
})();
if (invokedDirectly) main().catch((e) => fail(e?.message || String(e)));
