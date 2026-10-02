'use strict';
/* 전수 검증: 모든 업체 × 모든 월 조합에 대해 도구의 답변(한 줄 제목)에 나온 숫자가
   분개장·거래내역 원본 행에서 따로 계산한 값과 같은지 확인한다. (자연어 해석은 거치지 않고 질문 실행 단계만 검증)
   사용: node tools/sweep_verify.js --journal 분개장1.xlsx 분개장2.xlsx [--trades 거래내역.xlsx]
   하나라도 다르면 종료 코드 1 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
globalThis.XLSX = require(path.join(ROOT, 'vendor', 'xlsx.full.min.js'));
['util', 'adapters', 'model', 'analysis', 'questions', 'nl', 'engine'].forEach(f => require(path.join(ROOT, 'js', f + '.js')));
const BM = globalThis.BM, E = BM.engine;
const argv = process.argv.slice(2);
function list(flag) { const i = argv.indexOf('--' + flag); if (i < 0) return []; const o = []; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) o.push(argv[j]); return o; }
const jf = list('journal'), tf = list('trades');
if (!jf.length) { console.error('사용: node tools/sweep_verify.js --journal 파일... [--trades 파일]'); process.exit(1); }
const rd = p => XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true });
const files = jf.map(p => ({ name: path.basename(p), kind: 'journal', data: BM.parseJournal(rd(p)) }));
tf.forEach(p => { const wb = rd(p); files.push({ name: path.basename(p), kind: 'trades', data: BM.isStatusBook(wb) ? BM.parseStatusBook(wb) : BM.parseTrades(wb) }); });
const S = E.build(files);
const rows = S.m.rows, trades = S.m.trades ? S.m.trades.rows : [];
const norm = BM.normName, sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const nameOf = {}; rows.forEach(r => { const k = norm(r.vendor); if (k && !nameOf[k]) nameOf[k] = r.vendor; }); trades.forEach(t => { const k = norm(t.vendor); if (k && !nameOf[k]) nameOf[k] = t.vendor; });
const numsIn = text => (text.match(/-?[\d,]+(?:\.\d+)?/g) || []).map(s => parseFloat(s.replace(/,/g, ''))).filter(isFinite);
const hasNum = (t, v, tol) => numsIn(t).some(n => Math.abs(n - v) <= tol);
const stats = {}; const bad = [];
function check(kind, label, ok, detail) { const s = stats[kind] = stats[kind] || { n: 0, bad: 0 }; s.n++; if (!ok) { s.bad++; bad.push(kind + ' ' + label + ' ' + detail); } }
const run = (qid, p) => E.run(S, qid, p, { useEst: true });
const head = r => (r.answer ? r.answer.headline : '(' + r.error + ')');

// 독립 계산
const arNet = v => sum(rows.filter(r => r.acct === '외상매출금' && norm(r.vendor) === v), r => r.dr - r.cr);
const apNet = v => sum(rows.filter(r => r.acct === '미지급금' && norm(r.vendor) === v), r => r.cr - r.dr);
// 입금: 고객 계정 대변 중 같은 전표에서 현금 계정이 차변에 오른 것(도구와 다른 방식으로 계산). 보조 확인으로 외상매출금 대변 합과도 비교한다.
const cashVouchers = (() => { const o = {}; rows.forEach(r => { if (/^(보통예금|당좌예금)$/.test(r.acct) && r.dr > 0) o[r.date + '|' + r.no] = 1; }); return o; })();
const deposit = (v, ym) => sum(rows.filter(r => r.ym === ym && norm(r.vendor) === v && r.cr > 0 && r.dr === 0 && /^(외상매출금|선수금|미수금|받을어음)$/.test(r.acct) && cashVouchers[r.date + '|' + r.no]), r => r.cr);
const arCollected = (v, ym) => sum(rows.filter(r => r.ym === ym && r.acct === '외상매출금' && norm(r.vendor) === v && r.cr > 0), r => r.cr - r.dr);
const isExpense = r => /^[5678]/.test(r.code) || (/^9/.test(r.code) && !/수익|이익|환입|보증금|할인차금/.test(r.acct));
const revenue = ym => sum(rows.filter(r => r.ym === ym && /^4/.test(r.code) && !/원가|손익/.test(r.acct)), r => r.cr - r.dr);
const expense = (ym, base) => sum(rows.filter(r => r.ym === ym && isExpense(r) && r.acct.replace(/\((제|도|분|판)\)$/, '') === base && !(r.closing && r.dr === 0 && r.cr !== 0 && /^[5678]/.test(r.code))), r => r.dr - r.cr);
const tons = (v, ym) => sum(trades.filter(t => t.flow === '매출' && t.ym === ym && /처리/.test(t.kind) && /kg/i.test(t.unit) && norm(t.vendor) === v), t => t.qty) / 1000;
const latestPrice = v => { const o = {}; trades.filter(t => t.flow === '매출' && /처리/.test(t.kind) && norm(t.vendor) === v && t.qty).forEach(t => { const b = o[t.ym] = o[t.ym] || { a: 0, q: 0 }; b.a += t.amt; b.q += t.qty; }); const ks = Object.keys(o).sort(); return ks.length ? o[ks[ks.length - 1]].a / o[ks[ks.length - 1]].q : null; };

// 1) 미수금·미지급금: 거래처 전부
const arV = [...new Set(rows.filter(r => r.acct === '외상매출금' && r.vendor).map(r => norm(r.vendor)))];
const apV = [...new Set(rows.filter(r => r.acct === '미지급금' && r.vendor).map(r => norm(r.vendor)))];
arV.forEach(v => { const bal = arNet(v), r = run('q12', { vendorText: nameOf[v] }), h = head(r); check('미수금 잔액(q12)', nameOf[v], bal > 1000 ? hasNum(h, bal, 1) : /없습니다/.test(h) || !r.answer, h.slice(0, 60)); });
apV.forEach(v => { const bal = apNet(v), r = run('q13', { vendorText: nameOf[v] }), h = head(r); check('미지급금 잔액(q13)', nameOf[v], bal > 1000 ? hasNum(h, bal, 1) : /없습니다/.test(h), h.slice(0, 60)); });
// 2) 월별 매출·비용 계정
S.m.months.forEach(ym => {
  const rev = revenue(ym); if (Math.abs(rev) > 1) { const h = head(run('q14', { month: ym })); check('월 매출(q14)', ym, hasNum(h, rev, 1), h.slice(0, 70)); }
  const accts = [...new Set(rows.filter(r => r.ym === ym && isExpense(r)).map(r => r.acct.replace(/\((제|도|분|판)\)$/, '')))];
  accts.forEach(a => { const exp = expense(ym, a); if (Math.abs(exp) <= 1) return; const h = head(run('q4', { month: ym, acct: a })); check('월 비용 항목(q4)', ym + ' ' + a, hasNum(h, exp, 1), h.slice(0, 70)); });
});
// 3) 업체 × 월 입금
const custs = [...new Set(arV.concat(trades.filter(t => t.flow === '매출').map(t => norm(t.vendor))))];
custs.forEach(v => S.m.months.forEach(ym => { const d = deposit(v, ym); if (d <= 1) return; const h = head(run('q2', { vendorText: nameOf[v], month: ym })); check('업체×월 입금(q2)', nameOf[v] + ' ' + ym, hasNum(h, d, 1), h.slice(0, 70)); const ac = arCollected(v, ym); if (ac > 1) check('입금 ≥ 외상매출금 대변(교차 확인)', nameOf[v] + ' ' + ym, d >= ac - 1 - 0.0001 * ac, '입금 ' + d + ' 외상대변 ' + ac); }));
// 4) 업체 × 월 물량, 업체 단가
if (trades.length) {
  const tv = [...new Set(trades.filter(t => t.flow === '매출').map(t => norm(t.vendor)))];
  tv.forEach(v => { S.m.months.forEach(ym => { const t = tons(v, ym); if (t <= 0) return; const h = head(run('q11', { vendorText: nameOf[v], month: ym })); check('업체×월 물량(q11)', nameOf[v] + ' ' + ym, hasNum(h, t, 0.06), h.slice(0, 70)); });
    const p = latestPrice(v); if (p != null) { const h = head(run('q10', { vendorText: nameOf[v] })); check('업체 단가(q10)', nameOf[v], hasNum(h, p, 0.06), h.slice(0, 70)); } });
}
// 5) 전체 합계 일관성
{ const tot = sum(arV, v => Math.max(0, arNet(v))), h = head(run('q12', {})); check('미수금 전체 합계(q12)', '전체', hasNum(h, tot, 1), h.slice(0, 70)); }
console.log('전수 검증 결과 (독립 계산 값이 답변 제목에 그대로 나오는지)\n');
Object.keys(stats).forEach(k => console.log((stats[k].bad ? '✗ ' : '✓ ') + k + ': ' + (stats[k].n - stats[k].bad) + '/' + stats[k].n + ' 일치'));
const total = Object.values(stats).reduce((a, s) => a + s.n, 0), wrong = Object.values(stats).reduce((a, s) => a + s.bad, 0);
console.log('\n총 ' + total + '개 조합 검사, 불일치 ' + wrong + '개');
bad.slice(0, 15).forEach(b => console.log('  - ' + b));
process.exit(wrong ? 1 : 0);
