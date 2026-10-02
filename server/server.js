'use strict';
/* 로컬 서버: 경리가 올린 자료를 회사 PC 폴더에 저장하고, 대표가 질문하면 같은 분석 엔진으로 답한다.
   외부 패키지 없이 Node.js 기본 모듈만 쓴다. 실행: node server/server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DATA = path.resolve(arg('data', process.env.BM_DATA || path.join(ROOT, 'data')));
const PORT = +arg('port', process.env.BM_PORT || 3000);
const HOST = arg('host', process.env.BM_HOST || '0.0.0.0');
const MAX_JSON = 120 * 1024 * 1024, MAX_UPLOAD = 60 * 1024 * 1024;
const SESSION_MS = 8 * 3600 * 1000;

/* ---------- 분석 엔진 불러오기 (브라우저와 같은 코드) ---------- */
const JS_FILES = ['util', 'adapters', 'model', 'analysis', 'questions', 'nl', 'engine'];
JS_FILES.forEach(f => require(path.join(ROOT, 'js', f + '.js')));
const BM = globalThis.BM, E = BM.engine;
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
const LOGIC = crypto.createHash('sha256').update(JS_FILES.map(f => fs.readFileSync(path.join(ROOT, 'js', f + '.js'))).join('\n')).digest('hex').slice(0, 12);

/* ---------- 데이터 폴더 ---------- */
['', 'uploads', 'snapshots', 'logs'].forEach(d => fs.mkdirSync(path.join(DATA, d), { recursive: true }));
const P = n => path.join(DATA, n);
const now = () => new Date().toISOString();
function slog(msg) { const line = now() + ' ' + msg; console.log(line); try { fs.appendFileSync(P('logs/server.log'), line + '\n'); } catch (e) { /* 로그 실패는 무시 */ } }

/* ---------- 비밀번호 ---------- */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomPw = () => Array.from(crypto.randomBytes(10), b => ALPHABET[b % ALPHABET.length]).join('');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function mkPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hashPw(pw, salt) }; }
function checkPw(pw, rec) {
  if (!rec) return false;
  const a = Buffer.from(hashPw(pw, rec.salt), 'hex'), b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function loadConfig() { try { return JSON.parse(fs.readFileSync(P('config.json'), 'utf8')); } catch (e) { return null; } }
function saveConfig(c) { fs.writeFileSync(P('config.json'), JSON.stringify(c, null, 2), { mode: 0o600 }); }

let config = loadConfig();
const setIdx = args.indexOf('--set-password');
if (setIdx >= 0) {
  const role = args[setIdx + 1], pw = args[setIdx + 2];
  if (!['boss', 'accountant'].includes(role) || !pw || pw.length < 8) { console.error('사용법: node server/server.js --set-password <boss|accountant> <8자 이상 비밀번호>'); process.exit(1); }
  config = config || { passwords: {} };
  const other = role === 'boss' ? 'accountant' : 'boss';
  if (config.passwords[other] && checkPw(pw, config.passwords[other])) { console.error('대표와 경리의 비밀번호는 서로 달라야 합니다.'); process.exit(1); }
  config.passwords[role] = mkPw(pw); saveConfig(config); console.log((role === 'boss' ? '대표' : '경리') + ' 비밀번호를 바꿨습니다.'); process.exit(0);
}
if (!config || args.includes('--reset-passwords')) {
  const boss = randomPw(), acc = randomPw();
  config = { createdAt: now(), passwords: { boss: mkPw(boss), accountant: mkPw(acc) } };
  saveConfig(config);
  fs.writeFileSync(P('초기비밀번호.txt'), '대표 계정 비밀번호: ' + boss + '\n경리 계정 비밀번호: ' + acc + '\n\n※ 비밀번호를 전달한 뒤 이 파일을 삭제하세요.\n※ 바꾸려면: node server/server.js --set-password boss 새비밀번호\n', { mode: 0o600 });
  console.log('\n=== 처음 실행: 비밀번호를 만들었습니다 ===\n 대표: ' + boss + '\n 경리: ' + acc + '\n (data/초기비밀번호.txt 에도 저장했습니다. 전달 후 삭제하세요.)\n');
}

/* ---------- 감사 로그 ---------- */
function audit(ev, req, role, extra) {
  const rec = Object.assign({ t: now(), ev, role: role || null, ip: req ? req.socket.remoteAddress : null, v: VERSION, logic: LOGIC, dataVersion: dataset ? dataset.meta.version : 0 }, extra || {});
  try { fs.appendFileSync(P('logs/audit-' + now().slice(0, 7) + '.jsonl'), JSON.stringify(rec) + '\n'); } catch (e) { slog('감사 로그 기록 실패: ' + e.message); }
}

/* ---------- 데이터셋 저장본 ---------- */
let dataset = null, engineCache = { version: -1, S: null };
try { dataset = JSON.parse(fs.readFileSync(P('current.json'), 'utf8')); } catch (e) { dataset = null; }
function getS() {
  if (!dataset) return null;
  if (engineCache.version !== dataset.meta.version) engineCache = { version: dataset.meta.version, S: E.build(dataset.files) };
  return engineCache.S;
}
function validFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 60) return '파일 목록이 올바르지 않습니다';
  let journals = 0;
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || f.name.length > 300 || !['journal', 'trades', 'vendors'].includes(f.kind) || !f.data || typeof f.data !== 'object') return '파일 항목이 올바르지 않습니다';
    if (f.kind === 'journal') { journals++; if (!Array.isArray(f.data.rows) || (f.data.rows[0] && (typeof f.data.rows[0].date !== 'string' || typeof f.data.rows[0].acct !== 'string'))) return '분개장 형식이 올바르지 않습니다'; }
    if (f.kind === 'trades' && !Array.isArray(f.data.rows)) return '거래내역 형식이 올바르지 않습니다';
    if (f.kind === 'vendors' && !Array.isArray(f.data.list)) return '업체마스터 형식이 올바르지 않습니다';
  }
  return journals ? null : '분개장이 한 개 이상 필요합니다';
}
function saveDataset(files, role) {
  const version = (dataset ? dataset.meta.version : 0) + 1;
  const meta = { version, savedAt: now(), savedBy: role, fileCount: files.length, files: files.map(f => ({ name: f.name, kind: f.kind, rows: (f.data.rows || f.data.list || []).length })) };
  const next = { meta, files };
  if (dataset) fs.writeFileSync(P('snapshots/dataset-' + dataset.meta.savedAt.replace(/[:.]/g, '-') + '-v' + dataset.meta.version + '.json'), JSON.stringify(dataset));
  const tmp = P('current.json.tmp'); fs.writeFileSync(tmp, JSON.stringify(next)); fs.renameSync(tmp, P('current.json'));
  dataset = next;
  const snaps = fs.readdirSync(P('snapshots')).filter(n => n.startsWith('dataset-')).sort();
  snaps.slice(0, Math.max(0, snaps.length - 30)).forEach(n => { try { fs.unlinkSync(P('snapshots/' + n)); } catch (e) { /* 정리 실패는 무시 */ } });
  return meta;
}
function loadSettings() { try { return JSON.parse(fs.readFileSync(P('settings.json'), 'utf8')); } catch (e) { return {}; } }

/* ---------- 세션 / 로그인 제한 ---------- */
const sessions = new Map(), fails = new Map();
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return o; }
function sessionOf(req) {
  const t = cookies(req).bm_session, s = t && sessions.get(t);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(t); return null; }
  return s;
}
const lockedUntil = ip => (fails.get(ip) || { until: 0 }).until;

/* ---------- HTTP 보조 ---------- */
function send(res, status, body, headers) {
  const h = Object.assign({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }, headers || {});
  res.writeHead(status, h); res.end(body);
}
function sendJson(req, res, status, obj, extra) {
  let buf = Buffer.from(JSON.stringify(obj));
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {});
  if (buf.length > 4096 && /gzip/.test(req.headers['accept-encoding'] || '')) { buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; }
  send(res, status, buf, h);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const top = rel.split('/')[1];
  if (!['index.html', 'js', 'vendor', 'templates'].includes(top)) return send(res, 404, 'not found');
  let file;
  try { file = path.join(ROOT, decodeURIComponent(rel)); } catch (e) { return send(res, 400, 'bad request'); }
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'not found');
  const ext = path.extname(file).toLowerCase();
  const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
  if (ext === '.html') h['Content-Security-Policy'] = CSP;
  send(res, 200, fs.readFileSync(file), h);
}

/* ---------- API ---------- */
async function handleApi(req, res, u) {
  const p = u.pathname, method = req.method;
  if (p === '/api/health') return sendJson(req, res, 200, { ok: true, version: VERSION, logic: LOGIC, dataVersion: dataset ? dataset.meta.version : 0, uptimeSec: Math.round(process.uptime()) });
  if (method !== 'GET' && req.headers['x-requested-with'] !== 'bm') return sendJson(req, res, 403, { error: 'forbidden' });

  if (p === '/api/login' && method === 'POST') {
    const ip = req.socket.remoteAddress;
    if (lockedUntil(ip) > Date.now()) { audit('login-locked', req, null); return sendJson(req, res, 429, { error: 'locked' }); }
    let pw = '';
    try { pw = String(JSON.parse((await readBody(req, 4096)).toString() || '{}').password || ''); } catch (e) { /* 잘못된 본문은 실패로 처리 */ }
    const role = checkPw(pw, config.passwords.boss) ? 'boss' : checkPw(pw, config.passwords.accountant) ? 'accountant' : null;
    if (!role) {
      const f = fails.get(ip) || { n: 0, until: 0 }; f.n++; if (f.n >= 5) { f.until = Date.now() + 5 * 60 * 1000; f.n = 0; } fails.set(ip, f);
      audit('login-fail', req, null);
      await new Promise(r => setTimeout(r, 400));
      return sendJson(req, res, 401, { error: 'bad-password' });
    }
    fails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { role, exp: Date.now() + SESSION_MS });
    audit('login', req, role);
    return sendJson(req, res, 200, { role }, { 'Set-Cookie': 'bm_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + SESSION_MS / 1000 });
  }

  const s = sessionOf(req);
  if (p === '/api/me') return s ? sendJson(req, res, 200, { role: s.role }) : sendJson(req, res, 401, { error: 'login-required' });
  if (!s) return sendJson(req, res, 401, { error: 'login-required' });
  const role = s.role, isAcc = role === 'accountant';

  if (p === '/api/logout' && method === 'POST') { sessions.delete(cookies(req).bm_session); audit('logout', req, role); return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': 'bm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }

  if (p === '/api/dataset' && method === 'GET') {
    if (!dataset) return send(res, 204, '');
    audit('dataset-view', req, role);
    return sendJson(req, res, 200, dataset);
  }
  if (p === '/api/dataset' && method === 'POST') {
    if (!isAcc) return sendJson(req, res, 403, { error: 'forbidden' });
    let body;
    try { body = JSON.parse((await readBody(req, MAX_JSON)).toString()); } catch (e) { return sendJson(req, res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'too-large' : 'bad-json' }); }
    const err = validFiles(body.files);
    if (err) return sendJson(req, res, 400, { error: err });
    const meta = saveDataset(body.files, role);
    audit('dataset-save', req, role, { fileCount: meta.fileCount, files: meta.files });
    slog('데이터 저장: 버전 ' + meta.version + ', 파일 ' + meta.fileCount + '개');
    return sendJson(req, res, 200, { meta });
  }

  if (p === '/api/upload' && method === 'POST') {
    if (!isAcc) return sendJson(req, res, 403, { error: 'forbidden' });
    const name = (u.searchParams.get('name') || 'upload.xlsx').replace(/[^\w가-힣.() \-]/g, '_').slice(0, 120);
    if (!/\.(xlsx|xls)$/i.test(name)) return sendJson(req, res, 400, { error: 'bad-extension' });
    let buf;
    try { buf = await readBody(req, MAX_UPLOAD); } catch (e) { return sendJson(req, res, 413, { error: 'too-large' }); }
    const isZip = buf.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), isOle = buf.slice(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    if (!isZip && !isOle) return sendJson(req, res, 400, { error: 'not-excel' });
    const saved = now().replace(/[:.]/g, '-') + '_' + name;
    fs.writeFileSync(P('uploads/' + saved), buf);
    audit('upload', req, role, { file: saved, bytes: buf.length });
    return sendJson(req, res, 200, { ok: true });
  }

  if (p === '/api/settings' && method === 'GET') return sendJson(req, res, 200, loadSettings());
  if (p === '/api/settings' && method === 'POST') {
    if (!isAcc) return sendJson(req, res, 403, { error: 'forbidden' });
    let b; try { b = JSON.parse((await readBody(req, 4096)).toString()); } catch (e) { return sendJson(req, res, 400, { error: 'bad-json' }); }
    const a = b && b.anchor;
    if (!a || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) || typeof a.amt !== 'number' || !isFinite(a.amt)) return sendJson(req, res, 400, { error: 'bad-anchor' });
    const st = loadSettings(); st.anchor = { date: a.date, amt: a.amt }; fs.writeFileSync(P('settings.json'), JSON.stringify(st));
    audit('settings-save', req, role, { anchorDate: a.date });
    return sendJson(req, res, 200, st);
  }

  if (p === '/api/event' && method === 'POST') {
    let b; try { b = JSON.parse((await readBody(req, 4096)).toString()); } catch (e) { return sendJson(req, res, 400, { error: 'bad-json' }); }
    if (b && b.type === 'ask') audit('ask', req, role, { source: String(b.source || '').slice(0, 10), id: b.id ? String(b.id).slice(0, 4) : null, text: b.text ? String(b.text).slice(0, 200) : undefined });
    return sendJson(req, res, 200, { ok: true });
  }

  if (p === '/api/ask' && method === 'GET') {
    const q = (u.searchParams.get('q') || '').slice(0, 300), S = getS();
    if (!S) return sendJson(req, res, 200, { understood: false, text: '서버에 저장된 데이터가 없습니다. 경리 담당자가 먼저 파일을 올려야 합니다.' });
    const r = BM.nl.parse(q, E.nlContext(S));
    if (!r) { audit('ask', req, role, { source: 'api', id: null, text: q }); return sendJson(req, res, 200, { understood: false, text: '질문을 이해하지 못했습니다. 업체명과 월을 넣어 다시 물어보세요.' }); }
    const run = E.run(S, r.id, { vendorText: r.vendor ? r.vendor.name : '', month: r.month, acct: r.acct }, { useEst: true, anchor: loadSettings().anchor, canEditAnchor: false });
    audit('ask', req, role, { source: 'api', id: r.id, text: q });
    if (run.error) {
      const msg = { 'vendor-required': '어느 업체인지 알려주세요.', 'vendor-not-found': '일치하는 업체를 찾지 못했습니다.', 'acct-required': '어느 비용 항목인지 알려주세요.' }[run.error] || '질문을 처리하지 못했습니다.';
      return sendJson(req, res, 200, { understood: true, id: r.id, needs: run.error, text: msg });
    }
    return sendJson(req, res, 200, { understood: true, id: r.id, label: run.q.label, vendor: r.vendor ? r.vendor.name : null, month: r.month, acct: r.acct, status: run.status, asOf: run.asOf, headline: run.answer.headline, notes: run.notes, text: E.toText(run) });
  }

  if (p === '/api/audit' && method === 'GET') {
    if (!isAcc) return sendJson(req, res, 403, { error: 'forbidden' });
    const limit = Math.min(500, +u.searchParams.get('limit') || 100);
    const files = fs.readdirSync(P('logs')).filter(n => n.startsWith('audit-')).sort().reverse();
    let lines = [];
    for (const f of files) { lines = fs.readFileSync(P('logs/' + f), 'utf8').split('\n').filter(Boolean).concat(lines); if (lines.length >= limit) break; }
    return sendJson(req, res, 200, { entries: lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) });
  }

  return sendJson(req, res, 404, { error: 'not-found' });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const done = (e) => { slog('요청 처리 오류 ' + req.method + ' ' + u.pathname + ': ' + (e && e.message)); if (!res.headersSent) send(res, 500, '서버 오류'); else res.end(); };
  try {
    if (u.pathname.startsWith('/api/')) handleApi(req, res, u).catch(done);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, u.pathname);
    else send(res, 405, 'method not allowed');
  } catch (e) { done(e); }
});
process.on('uncaughtException', e => slog('예상하지 못한 오류: ' + (e && e.stack || e)));
server.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  slog('서버 시작 v' + VERSION + ' (분석 로직 ' + LOGIC + ') 데이터 폴더: ' + DATA);
  console.log('\n접속 주소:\n  이 PC에서:  http://localhost:' + PORT + '\n' + ips.map(a => '  사내 다른 PC: http://' + a + ':' + PORT).join('\n') + '\n');
});
