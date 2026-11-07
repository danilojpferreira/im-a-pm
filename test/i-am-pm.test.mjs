import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validate, diff, render, sync, parseUnifiedDiff, shiftLine, touches, pathNodes, printTrace, serve,
} from '../skills/i-am-pm/scripts/i-am-pm.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'skills/i-am-pm/scripts/i-am-pm.mjs');
const EXAMPLE = path.join(ROOT, 'examples/video-api');
const load = (f) => JSON.parse(fs.readFileSync(path.join(EXAMPLE, f), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'i-am-pm-'));

// A tiny two-flow map with an asynchronous hand-off: checkout queues an invoice job.
function miniMap() {
  return {
    version: 1,
    app: { name: 'Shop', commit: null },
    flows: [
      {
        id: 'checkout', title: 'Check out', trigger: { kind: 'http', signature: 'POST /checkout' },
        nodes: [
          { id: 'start', type: 'start', label: 'Customer checks out', calls: [{ fn: 'route', file: 'src/app.js', line: 1, depth: 0 }] },
          { id: 'in-stock', type: 'decision', label: 'Is it in stock?', rule: 'Stock must be above zero.', anchors: [{ file: 'src/app.js', line: 3 }], confidence: 'high', calls: [{ fn: 'checkStock', file: 'src/app.js', line: 2, endLine: 4, depth: 1 }] },
          { id: 'queue-invoice', type: 'action', label: 'Queue the invoice', anchors: [{ file: 'src/app.js', line: 6 }], confidence: 'high', calls: [{ fn: 'queueInvoice', file: 'src/app.js', line: 5, endLine: 7, depth: 1 }], emits: [{ channel: 'queue:invoice' }] },
          { id: 'done', type: 'outcome', label: 'Order placed', result: 'success', anchors: [{ file: 'src/app.js', line: 8 }], confidence: 'high' },
          { id: 'sold-out', type: 'outcome', label: 'Sold out', result: 'rejected', anchors: [{ file: 'src/app.js', line: 3 }], confidence: 'high' },
        ],
        edges: [
          { from: 'start', to: 'in-stock' },
          { from: 'in-stock', to: 'queue-invoice', label: 'Yes' },
          { from: 'in-stock', to: 'sold-out', label: 'No' },
          { from: 'queue-invoice', to: 'done' },
        ],
        happyPath: 'done', outcomes: { 'sold-out': 'Sold out' },
      },
      {
        id: 'send-invoice', title: 'Send the invoice', trigger: { kind: 'job', signature: 'worker invoice', channel: 'queue:invoice' },
        nodes: [
          { id: 'start', type: 'start', label: 'Invoice job runs', calls: [{ fn: 'worker', file: 'src/jobs.js', line: 1, depth: 0 }] },
          { id: 'email', type: 'external', label: 'Email the invoice', system: 'Email', anchors: [{ file: 'src/jobs.js', line: 2 }], confidence: 'high', calls: [{ fn: 'sendEmail', file: 'src/jobs.js', line: 2, endLine: 3, depth: 1 }] },
          { id: 'sent', type: 'outcome', label: 'Invoice sent', result: 'success', anchors: [{ file: 'src/jobs.js', line: 3 }], confidence: 'high' },
        ],
        edges: [{ from: 'start', to: 'email' }, { from: 'email', to: 'sent' }],
        happyPath: 'sent', outcomes: {},
      },
    ],
  };
}

test('the example map is valid', () => {
  const { errors, warnings } = validate(load('flows.json'));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('validate catches structural mistakes', () => {
  const m = miniMap();
  const f = m.flows[0];
  f.edges.push({ from: 'done', to: 'start' });
  f.nodes.push({ id: 'Bad Id', type: 'decision', label: 'x' });
  m.flows[1].id = 'checkout';
  const { errors } = validate(m);
  for (const needle of ['kebab-case', 'decisions need a rule', 'must not have outgoing edges', 'cycle', 'not reachable', 'duplicate flow id']) {
    assert.ok(errors.some((e) => e.includes(needle)), `expected an error about "${needle}"`);
  }
});

test('hand-offs: channels are checked and every emitted channel needs a consumer', () => {
  const m = miniMap();
  assert.deepEqual(validate(m).errors, []);
  m.flows[1].trigger.channel = 'queue:other';
  assert.ok(validate(m).warnings.some((w) => w.includes('emits queue:invoice but no flow starts from it')));
  m.flows[0].nodes[2].emits = [{ channel: 'not a channel' }];
  assert.ok(validate(m).errors.some((e) => e.includes('emits[0].channel')));
});

test('trace lists functions in path order and follows hand-offs', () => {
  const m = miniMap();
  assert.deepEqual(pathNodes(m.flows[0], 'done').map((n) => n.id), ['start', 'in-stock', 'queue-invoice', 'done']);
  assert.deepEqual(pathNodes(m.flows[0], 'sold-out').map((n) => n.id), ['start', 'in-stock', 'sold-out']);
  const out = printTrace(m, 'checkout', undefined, true);
  const order = ['route', 'checkStock', 'queueInvoice', 'queue:invoice → Send the invoice', 'continues asynchronously', 'worker', 'sendEmail'];
  let at = -1;
  for (const s of order) { const i = out.indexOf(s); assert.ok(i > at, `"${s}" out of order`); at = i; }
});

test('diff reports the business change between two versions of the example', () => {
  const d = diff(load('base.json'), load('flows.json'));
  assert.deepEqual(d.added, ['unpublish-video']);
  assert.deepEqual(d.removed, []);
  const pub = d.changed['publish-video'];
  assert.ok(pub.nodes.changed.some((c) => c.id === 'details-complete' && c.fields.rule));
  assert.equal(d.unchanged.length, 6);
});

test('diff separates implementation changes from business changes', () => {
  const a = miniMap(), b = miniMap();
  b.flows[0].nodes[1].calls.push({ fn: 'checkWarehouse', file: 'src/app.js', line: 9, depth: 2 });
  const d = diff(a, b);
  assert.deepEqual(d.changed.checkout.nodes.changed, []);
  assert.deepEqual(d.changed.checkout.nodes.implChanged, ['in-stock']);
});

test('unified diff parsing, line shifting and overlap', () => {
  const files = parseUnifiedDiff([
    'diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js',
    '@@ -2,0 +3,2 @@', '+x', '+y',
    '@@ -10,2 +12,1 @@', '-p', '-q', '+r',
    'diff --git a/old.js b/new.js', 'similarity index 90%', 'rename from old.js', 'rename to new.js',
  ].join('\n'));
  assert.equal(files.length, 2);
  const h = files[0].hunks;
  assert.deepEqual(h.map((x) => [x.a, x.b, x.c, x.d]), [[2, 0, 3, 2], [10, 2, 12, 1]]);
  assert.equal(shiftLine(h, 1), 1);
  assert.equal(shiftLine(h, 5), 7);
  assert.equal(shiftLine(h, 20), 21);
  assert.ok(touches(h, 9, 11));
  assert.ok(!touches(h, 3, 8));
  assert.ok(touches(h, 1, 4), 'insertion inside a range touches it');
  assert.deepEqual([files[1].status, files[1].oldPath, files[1].newPath], ['R', 'old.js', 'new.js']);
});

test('sync shifts lines, marks changed steps stale and stamps HEAD', () => {
  const dir = tmp();
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/app.js'), ['route', 'checkStock {', '  stock > 0', '}', 'queueInvoice {', '  add', '}', 'ok'].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'src/jobs.js'), ['worker', 'sendEmail {', '}'].join('\n') + '\n');
  git('add', '.'); git('commit', '-qm', 'one');
  const map = miniMap();
  map.app.commit = git('rev-parse', 'HEAD');
  // Two lines added above everything, and the stock rule changed.
  fs.writeFileSync(path.join(dir, 'src/app.js'), ['// header', '// header', 'route', 'checkStock {', '  stock > 1', '}', 'queueInvoice {', '  add', '}', 'ok'].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'src/routes.js'), "app.post('/refund', refund)\n");
  git('add', '.'); git('commit', '-qm', 'two');
  const report = sync(map, { cwd: dir });
  assert.equal(map.app.commit, git('rev-parse', 'HEAD'));
  assert.deepEqual(Object.keys(report.flows), ['checkout']);
  assert.deepEqual(report.flows.checkout.stale.map((s) => s.node), ['in-stock', 'sold-out']); // both cite the changed rule line
  const q = map.flows[0].nodes.find((n) => n.id === 'queue-invoice');
  assert.deepEqual([q.calls[0].line, q.calls[0].endLine, q.stale], [7, 9, undefined]);
  assert.equal(map.flows[1].nodes[1].stale, undefined);
  assert.ok(report.entrypointCandidates.some((c) => c.file === 'src/routes.js'));
  assert.ok(report.unmapped.some((u) => u.file === 'src/routes.js'));
  assert.equal(sync(map, { cwd: dir }).upToDate, true);
});

test('render escapes map text and fills the title', () => {
  const m = miniMap();
  m.app.name = 'Shop';
  m.flows[0].nodes[1].label = 'Is it </script><b>in stock?';
  const html = render(m, null);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<title>Shop business map</title>'));
  assert.equal(html.split('</script>').length - 1, 1, 'only the real closing script tag');
  assert.ok(!render(m, null, { fragment: true }).includes('<!doctype'));
});

test('install copies both skills, refuses foreign folders, uninstall removes them', () => {
  const dir = path.join(tmp(), 'skills');
  const run = (...a) => execFileSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
  run('install', '--dir', dir);
  for (const s of ['i-am-pm', 'iampm']) assert.ok(fs.existsSync(path.join(dir, s, 'SKILL.md')), `${s} installed`);
  assert.ok(fs.existsSync(path.join(dir, 'i-am-pm/scripts/i-am-pm.mjs')));
  run('install', '--dir', dir); // updating in place works
  run('uninstall', '--dir', dir);
  assert.ok(!fs.existsSync(path.join(dir, 'i-am-pm')));
  fs.mkdirSync(path.join(dir, 'iampm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'iampm/SKILL.md'), '---\nname: something-else\n---\n');
  assert.throws(() => run('install', '--dir', dir, '--quiet'), /not this skill/);
});

test('the server renders the map and reports a new version after a render', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'flows.json'), JSON.stringify(miniMap()));
  const server = await serve({ dir, port: 0, quiet: true });
  const { port } = server.address();
  const get = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  }).on('error', reject));
  try {
    const page = await get('/');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('"served":true'));
    const ping = JSON.parse((await get('/api/ping')).body);
    assert.equal(ping.dir, path.resolve(dir));
    const v1 = JSON.parse((await get('/api/version')).body).version;
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(path.join(dir, 'view.json'), JSON.stringify({ flows: path.join(dir, 'flows.json'), base: null }));
    const v2 = JSON.parse((await get('/api/version')).body).version;
    assert.notEqual(v1, v2);
    assert.ok(JSON.parse((await get('/api/ping')).body).viewerSeenMsAgo < 5000);
  } finally {
    server.close();
  }
});
