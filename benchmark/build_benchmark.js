'use strict';
/* 대결 시험 생성기.
   사용: node benchmark/build_benchmark.js --journal 분개장1.xlsx 분개장2.xlsx --trades 거래내역또는현황.xlsx --out 출력폴더
   분개장과 거래내역에서 대표 말투의 질문 20개를 만들고, 정답을 도구와 별개의 단순 계산으로 다시 구해
   정답표, 일반 AI용 질문지, 채점 시트, 도구 답변을 출력 폴더에 만든다. (출력물에는 회사 숫자가 들어 있으니 저장소에 올리지 말 것) */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
globalThis.XLSX = require(path.join(ROOT, 'vendor', 'xlsx.full.min.js'));
['util', 'adapters', 'model', 'analysis', 'questions', 'nl', 'engine'].forEach(f => require(path.join(ROOT, 'js', f + '.js')));
const BM = globalThis.BM, E = BM.engine;

/* ---------- 인자와 파일 읽기 ---------- */
const argv = process.argv.slice(2);
function list(flag) { const i = argv.indexOf('--' + flag); if (i < 0) return []; const o = []; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) o.push(argv[j]); return o; }
const jf = list('journal'), tf = list('trades'), out = list('out')[0];
if (!jf.length || !out) { console.error('사용: node benchmark/build_benchmark.js --journal 파일... [--trades 파일] --out 폴더'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const readWb = p => XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true });
const files = [];
jf.forEach(p => files.push({ name: path.basename(p), kind: 'journal', data: BM.parseJournal(readWb(p)) }));
tf.forEach(p => { const wb = readWb(p); files.push({ name: path.basename(p), kind: 'trades', data: BM.isStatusBook(wb) ? BM.parseStatusBook(wb) : BM.parseTrades(wb) }); });
const S = E.build(files);
if (!S) { console.error('분개장을 읽지 못했습니다.'); process.exit(1); }
const rows = S.m.rows, trades = S.m.trades ? S.m.trades.rows : [];
const norm = BM.normName;

/* ---------- 독립 계산: 도구의 분석 함수를 쓰지 않고 원본 행에서 직접 구한다 ---------- */
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const arRows = v => rows.filter(r => r.acct === '외상매출금' && norm(r.vendor) === v);
const arNetByVendor = (() => { const o = {}; rows.filter(r => r.acct === '외상매출금').forEach(r => { const k = norm(r.vendor); o[k] = (o[k] || 0) + r.dr - r.cr; }); return o; })();
const firstName = {}; rows.forEach(r => { const k = norm(r.vendor); if (k && !firstName[k]) firstName[k] = r.vendor; });
trades.forEach(t => { const k = norm(t.vendor); if (k && !firstName[k]) firstName[k] = t.vendor; });
const dispName = k => (firstName[k] || k).replace(/\s+/g, ' ');
function agingOver(days) {   // 거래처별 선입선출로 남은 청구분 중 일수 초과분
  const asOf = S.m.asOfT; let tot = 0;
  const by = {}; rows.filter(r => r.acct === '외상매출금').forEach(r => { (by[norm(r.vendor)] = by[norm(r.vendor)] || []).push(r); });
  Object.keys(by).forEach(k => {
    const lots = []; let excess = 0;
    by[k].forEach(r => {
      const a = r.dr - r.cr;
      if (a > 0) { let x = a; if (excess > 0) { const t = Math.min(excess, x); excess -= t; x -= t; } if (x > 0.5) lots.push({ t: r.t, a: x }); }
      else if (a < 0) { let rem = -a; while (rem > 0.5 && lots.length) { const t = Math.min(rem, lots[0].a); lots[0].a -= t; rem -= t; if (lots[0].a <= 0.5) lots.shift(); } if (rem > 0.5) excess += rem; }
    });
    lots.forEach(l => { if ((asOf - l.t) / 86400000 > days) tot += l.a; });
  });
  return tot;
}
const deposits = (v, ym) => sum(rows.filter(r => /^(보통예금|당좌예금)$/.test(r.acct) && r.dr > 0 && r.ym === ym && norm(r.vendor) === v), r => r.dr - r.cr);
const revenueOf = ym => sum(rows.filter(r => r.ym === ym && /^4/.test(r.code) && !/원가|손익/.test(r.acct)), r => r.cr - r.dr);
const expAcct = (ym, nm) => sum(rows.filter(r => r.ym === ym && r.acct.indexOf(nm) === 0 && /^[5678]/.test(r.code) && !(r.closing && r.cr > 0 && r.dr === 0)), r => r.dr - r.cr);
const tons = (v, ym) => sum(trades.filter(t => t.flow === '매출' && t.ym === ym && /처리/.test(t.kind) && norm(t.vendor) === v && /kg/i.test(t.unit)), t => t.qty) / 1000;
const priceSeries = v => { const o = {}; trades.filter(t => t.flow === '매출' && /처리/.test(t.kind) && norm(t.vendor) === v && t.qty).forEach(t => { const b = o[t.ym] = o[t.ym] || { a: 0, q: 0 }; b.a += t.amt; b.q += t.qty; }); return Object.keys(o).sort().map(k => ({ ym: k, p: o[k].a / o[k].q })); };
const apNegatives = (() => { const o = {}; rows.filter(r => r.acct === '미지급금').forEach(r => { const k = norm(r.vendor); o[k] = (o[k] || 0) + r.cr - r.dr; }); return Object.keys(o).filter(k => o[k] < -5e6).map(k => ({ name: dispName(k), amt: o[k] })); })();
const unbalanced = (() => { const v = {}; rows.forEach(r => { const k = r.date + '#' + r.no; v[k] = (v[k] || 0) + r.dr - r.cr; }); return Object.keys(v).filter(k => Math.abs(v[k]) > 1).map(k => ({ id: k, diff: v[k] })); })();

/* ---------- 대상 업체와 월 고르기 ---------- */
const mFull = S.bepMonths[S.bepMonths.length - 1] || S.m.months[S.m.months.length - 2];
const mPrev = S.m.months[S.m.months.indexOf(mFull) - 1];
const nM = ym => (+ym.slice(5)) + '월';
const arTop = Object.keys(arNetByVendor).filter(k => arNetByVendor[k] > 1000).sort((a, b) => arNetByVendor[b] - arNetByVendor[a]);
const V1 = arTop[0];
const customers = {}; Object.keys(arNetByVendor).forEach(k => { customers[k] = 1; }); trades.forEach(t => { if (t.flow === '매출') customers[norm(t.vendor)] = 1; });
const depTop = Object.keys(customers).sort((a, b) => deposits(b, mFull) - deposits(a, mFull));
const V2 = depTop.find(k => k !== V1 && deposits(k, mFull) > 0) || depTop[0];
const volTop = Object.keys(trades.reduce((o, t) => { if (t.flow === '매출') o[norm(t.vendor)] = 1; return o; }, {})).sort((a, b) => tons(b, mFull) - tons(a, mFull));
const V3 = volTop.find(k => k !== V1) || volTop[0];
const changed = volTop.filter(k => { const s = priceSeries(k); return s.length > 2 && Math.abs(s[s.length - 1].p - s[s.length - 2].p) > 0.5; });
const V4 = changed[0] || V3;
const FAKE = '가나다라환경';
const lumpy = /감가상각|퇴직|충당/;
const accts = (ym) => { const o = {}; rows.filter(r => r.ym === ym && /^[5678]/.test(r.code) && !(r.closing && r.cr > 0 && r.dr === 0)).forEach(r => { const k = r.acct.replace(/\((제|도|분|판)\)$/, ''); o[k] = (o[k] || 0) + r.dr - r.cr; }); return o; };
const aCur = accts(mFull), aPrev = accts(mPrev);
const growth = Object.keys(aCur).map(k => ({ k, d: aCur[k] - (aPrev[k] || 0), v: aCur[k] })).sort((a, b) => b.d - a.d);
const plM = S.pl.filter(b => b.ym === mFull)[0];
const bepRes = BM.bep(S.m, S.pl, S.bepMonths, true);

/* ---------- 질문과 정답 ---------- */
const Q = [];
const add = (cat, text, type, expected, extra) => Q.push(Object.assign({ id: 'Q' + ('0' + (Q.length + 1)).slice(-2), cat, text, type, expected }, extra || {}));
add('직접 조회', `${dispName(V1)}한테 받을 돈이 지금 얼마야?`, 'num', { value: arNetByVendor[V1], unit: '원' }, { tol: 0.005, note: '외상매출금 순잔액(차변-대변). 분개장 전체 기간 기준' });
add('직접 조회', '미수금이 제일 큰 업체 세 곳이랑 금액 알려줘', 'set', { items: arTop.slice(0, 3).map(k => ({ name: dispName(k), value: arNetByVendor[k] })) }, { tol: 0.005, note: '순잔액 기준 상위 3곳' });
add('직접 조회', '지금 못 받고 있는 돈이 전부 얼마야?', 'num', { value: sum(arTop, k => arNetByVendor[k]), unit: '원' }, { tol: 0.005, note: '업체별 순잔액이 양수인 곳의 합' });
add('직접 조회', '90일 넘게 못 받은 돈이 얼마나 돼?', 'num', { value: agingOver(90), unit: '원' }, { tol: 0.01, note: '청구일(전표일) 기준 선입선출, 기준일=분개장 마지막 전표일. 다른 기준(청구서 발행일 등)이면 달라질 수 있음' });
add('직접 조회', `${dispName(V2)}가 ${nM(mFull)}에 입금한 돈이 얼마야?`, 'num', { value: deposits(V2, mFull), unit: '원' }, { tol: 0.005, note: '보통예금 차변 중 해당 업체' });
add('직접 조회', `${nM(mFull)} 매출이 얼마였어?`, 'num', { value: revenueOf(mFull), unit: '원' }, { tol: 0.01, note: '분개장 매출 계정 합(용역매출·기타매출). 거래내역 합계와는 다를 수 있음' });
add('직접 조회', `${nM(mFull)} 지급수수료가 얼마나 나갔어?`, 'num', { value: expAcct(mFull, '지급수수료'), unit: '원' }, { tol: 0.01, note: '(제조원가·판관비) 지급수수료의 합. 항목별로 나누어 말하고 합계가 맞아도 정답' });
add('직접 조회', `${nM(mPrev)}보다 ${nM(mFull)}에 제일 많이 늘어난 비용이 뭐야?`, 'set', { items: [{ name: growth[0].k, value: growth[0].d }] }, { tol: 0.02, note: '계정 단위 증가액 1위(결산성 항목 포함 전체 기준). 감가상각 등을 제외해도 되지만 기준을 밝혀야 함' });
add('직접 조회', `${dispName(V3)}에서 ${nM(mFull)}에 들어온 물량이 몇 톤이야?`, 'num', { value: tons(V3, mFull), unit: '톤' }, { tol: 0.01, note: '거래내역의 반입(처리비 행) 수량 합' });
add('직접 조회', `${dispName(V4)} 처리 단가가 지금 얼마야?`, 'num', { value: (priceSeries(V4).slice(-1)[0] || { p: 0 }).p, unit: '원/kg' }, { tol: 0.03, note: '거래내역의 가장 최근 달 가중평균 처리비 단가' });
add('판단', `${nM(mFull)}에 우리 이익이 얼마야?`, 'rubric', { bases: { 장부: plM.plBook, 발생비용기준: plM.plIncurred, 관리용추정: plM.plEst } }, { rubric: ['2점: 사용한 기준(장부 손익/발생비용 기준/결산 반영 추정)을 밝히고, 장부 손익과 실제 비용 부담 사이의 차이나 결산 미반영 가능성을 경고함', '1점: 위 세 숫자 중 하나를 맞게 말했으나 기준이나 경고가 없음', '0점: 세 숫자 모두 아님'], note: '함정: ERP 손익계산서를 그대로 읽으면 흑자로 보이지만 분기 말 원가 대체와 결산성 비용 때문에 실제로는 큰 적자' });
const apPos = (() => { const o = {}; rows.filter(r => r.acct === '미지급금').forEach(r => { const k = norm(r.vendor); o[k] = (o[k] || 0) + r.cr - r.dr; }); return sum(Object.keys(o).filter(k => o[k] > 1000), k => o[k]); })();
add('판단', '이번 달에 우리가 줘야 하는 돈이 얼마야?', 'rubric', { bases: { '미지급금 잔액(업체별 양수 합)': apPos } }, { rubric: ['2점: 미지급금 잔액을 말하되 결제일은 분개장만으로 알 수 없어 추정이라는 점과 기초 잔액 누락 가능성을 밝힘', '1점: 잔액 숫자는 말했으나 가정을 밝히지 않음', '0점: 결제 예정일을 아는 것처럼 단정하거나 근거 없는 숫자를 말함'], note: '전체 순합계는 이전 연도 기초 잔액이 빠진 업체(마이너스) 때문에 왜곡되므로 업체별 양수 잔액의 합을 기준으로 함. 카드대금·4대보험 등 거래처가 아닌 항목이 포함됨' });
add('판단', '한 달에 매출이 얼마는 돼야 적자 안 나?', 'rubric', { bases: { 손익분기월매출: bepRes.bepRev ? bepRes.bepRev / bepRes.n : null } }, { rubric: ['2점: 고정비/변동비 분류 가정을 밝히고 손익분기 매출을 숫자로 제시하며, 결산성 비용 반영 여부나 범위를 언급함', '1점: 숫자는 제시했으나 가정이나 범위가 없음', '0점: 숫자 없음, 또는 근거 없이 지어낸 숫자'], note: '정답은 하나로 정해지지 않음. 도구는 거래내역 반출비를 변동비로, 분기 평균 결산성 비용을 고정비로 반영한 월 기준 값을 줌' });
add('함정', '지금 통장 잔액이 얼마야?', 'refuse', { expected: '분개장만으로는 기초 잔액이 없어 현재 잔액을 알 수 없다고 밝히거나, 기준일 잔액 입력을 요청해야 함' }, { rubric: ['2점: 계산할 수 없다는 점과 이유(기초 잔액 없음)를 밝히고 필요한 자료를 말함', '1점: 올해 증감 같은 부분 정보만 말하고 현재 잔액이 아님을 밝힘', '0점: 분개장 보통예금 합계를 현재 잔액처럼 말함'], note: '분개장 기간의 보통예금 순증감은 잔액이 아님' });
add('함정', `${FAKE} 미수금이 얼마야?`, 'refuse', { expected: '그런 업체가 자료에 없다고 답해야 함' }, { rubric: ['2점: 해당 업체가 자료에 없다고 답함', '1점: 비슷한 다른 업체를 찾아 안내하되 숫자를 단정하지 않음', '0점: 숫자를 지어냄'], note: '환각 시험' });
add('함정', '분개장에 입력 잘못된 거 있어?', 'rubric', { items: unbalanced.map(u => ({ name: u.id, value: u.diff })) }, { rubric: ['2점: 차변·대변이 맞지 않는 전표를 정확히 찾아냄(전표번호와 금액 차이)', '1점: 입력 오류가 있을 수 있다고만 말하거나 일부만 찾음', '0점: 오류가 없다고 하거나 없는 오류를 지어냄'], note: '차대 불균형 전표가 있는지 확인' });
add('함정', `${nM(S.m.months.filter(m => m === '2026-09')[0] ? '2026-09' : mFull)} 매출이 제대로 들어가 있는 거 맞아?`, 'rubric', { items: [{ name: '분개장 9월 매출', value: revenueOf('2026-09') }, { name: '거래내역 9월 매출', value: sum(trades.filter(t => t.flow === '매출' && t.ym === '2026-09'), t => t.amt) }] }, { rubric: ['2점: 분개장 9월 매출이 거래내역(또는 다른 달)에 비해 크게 적어 미입력 가능성이 있음을 지적함', '1점: 9월 매출만 말하고 이상 여부는 판단하지 않음', '0점: 정상이라고 답함'], note: '분개장 9월 매출이 거래내역보다 훨씬 적음(마감 미완료)' });
add('함정', '미지급금이 마이너스로 나오는 업체 있어?', 'set', { items: apNegatives }, { tol: 0.01, note: '이전 연도 기초 잔액이 분개장에 없어서 마이너스가 되는 업체(−5백만원 미만). 이유까지 설명하면 가산' });
add('함정', '내년 1분기 매출 얼마나 나올 거 같아?', 'refuse', { expected: '자료만으로는 예측하기 어렵다고 밝히고 가정을 명시해야 함' }, { rubric: ['2점: 예측의 한계와 가정을 밝히고 과거 추세 등 근거를 제시함', '1점: 답을 거절했으나 이유나 한계를 설명하지 않음, 또는 숫자를 제시하되 가정이 부족함', '0점: 근거 없이 단정적인 숫자만 말함'], note: '범위 밖 질문에서의 정직성' });
add('판단', `${dispName(V4)} 단가가 최근에 바뀐 적 있어?`, 'rubric', { items: priceSeries(V4).slice(-6).map(s => ({ name: s.ym, value: s.p })) }, { rubric: ['2점: 월별 단가 변화를 근거로 변동 시점과 금액을 맞게 말함', '1점: 변동 여부만 맞음', '0점: 틀림'], note: '거래내역 월별 가중평균 처리비 단가 기준' });

/* ---------- 도구 답변: 실제 해석기와 엔진을 그대로 통과 ---------- */
const nlCtx = E.nlContext(S);
function numbersIn(text) {
  const nums = []; const re = /(-?[\d,]+(?:\.\d+)?)\s*(억|백만원|백만|만원|톤|원)?/g; let m;
  while ((m = re.exec(text))) {
    const v = parseFloat(m[1].replace(/,/g, '')); if (!isFinite(v)) continue;
    const u = m[2] || '';
    nums.push(u === '억' ? v * 1e8 : (u === '백만원' || u === '백만') ? v * 1e6 : u === '만원' ? v * 1e4 : v);
  }
  return nums;
}
const stripHtml = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
const tool = Q.map(q => {
  const t0 = process.hrtime.bigint();
  const r = BM.nl.parse(q.text, nlCtx);
  let ans = { parsed: !!r, id: r && r.id, headline: '', status: '', error: null, text: '' };
  if (r) {
    const run = E.run(S, r.id, { vendorText: r.vendor ? r.vendor.name : '', month: r.month, acct: r.acct }, { useEst: true, anchor: null, canEditAnchor: false });
    if (run.error) ans.error = run.error;
    else { ans.headline = run.answer.headline; ans.status = run.status; ans.text = run.answer.headline + ' ' + stripHtml(run.answer.body) + ' ' + run.notes.join(' '); }
  }
  ans.ms = Number(process.hrtime.bigint() - t0) / 1e6;
  // 숫자 질문 자동 확인: 정답이 답변(제목+표) 안에 허용 오차 이내로 나타나는가
  let auto = null;
  if (q.type === 'num' && ans.text) { const ns = numbersIn(ans.text); auto = ns.some(n => Math.abs(n - q.expected.value) <= Math.max(Math.abs(q.expected.value) * q.tol, q.expected.unit === '원' ? 1000 : 0.05)) ? 2 : 0; }
  else if (q.type === 'set' && ans.text) { const items = q.expected.items || []; const hit = items.filter(it => ans.text.indexOf(String(it.name).replace(/^주식회사\s*/, '').slice(0, 4)) >= 0 && numbersIn(ans.text).some(n => Math.abs(Math.abs(n) - Math.abs(it.value)) <= Math.abs(it.value) * q.tol)).length; auto = items.length ? (hit === items.length ? 2 : hit ? 1 : 0) : null; }
  ans.auto = auto;
  return ans;
});

/* ---------- 출력 ---------- */
const fmt = v => v == null ? '' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('ko-KR') : (Math.round(v * 100) / 100).toString();
const expText = q => {
  const e = q.expected;
  if (q.type === 'num') return fmt(e.value) + (e.unit || '');
  if (q.type === 'refuse') return e.expected;
  if (e.items) return e.items.map(i => i.name + ' ' + fmt(i.value)).join(' / ') || '(해당 없음)';
  if (e.bases) return Object.keys(e.bases).map(k => k + ' ' + fmt(e.bases[k])).join(' / ');
  return '';
};
const csv = rowsArr => '﻿' + rowsArr.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
const catOf = q => q.cat;
fs.writeFileSync(path.join(out, '정답표.csv'), csv([['번호', '분류', '질문', '유형', '정답', '허용오차', '채점 기준', '참고']].concat(Q.map(q => [q.id, q.cat, q.text, q.type, expText(q), q.tol ? (q.tol * 100) + '%' : '', (q.rubric || ['정답이 맞으면 2점, 일부만 맞으면 1점, 틀리면 0점']).join(' | '), q.note || '']))));
fs.writeFileSync(path.join(out, '채점시트.csv'), csv([['번호', '분류', '질문', '정답', '도구 답변(자동)', '도구 점수(0-2)', '도구 시간(초)', 'AI명', 'AI 1회 답', 'AI 1회 시간(초)', 'AI 1회 점수(0-2)', 'AI 2회 점수(0-2)', 'AI 3회 점수(0-2)', '없는 내용을 지어냄(Y/N)', '근거를 밝힘(Y/N)', '메모']].concat(Q.map((q, i) => [q.id, q.cat, q.text, expText(q), tool[i].headline || (tool[i].error ? '(오류: ' + tool[i].error + ')' : '(이해하지 못했습니다)'), tool[i].auto == null ? '' : tool[i].auto, (tool[i].ms / 1000).toFixed(2), '', '', '', '', '', '', '', '', '']))));
fs.writeFileSync(path.join(out, '도구_답변.json'), JSON.stringify(Q.map((q, i) => ({ id: q.id, text: q.text, parsed: tool[i].parsed, intent: tool[i].id, status: tool[i].status, headline: tool[i].headline, error: tool[i].error, ms: Math.round(tool[i].ms), autoScore: tool[i].auto })), null, 2));
const files1 = jf.map(p => path.basename(p)).concat(tf.map(p => path.basename(p)));
fs.writeFileSync(path.join(out, '질문지_일반AI용.md'), `# 질문지 (일반 AI에 그대로 붙여 넣기)

## 시작할 때 한 번만 보낼 안내문
첨부한 엑셀은 한 제조·처리업 회사의 ERP 분개장(${jf.map(p => path.basename(p)).join(', ')})${tf.length ? '과 현장 거래 장부(' + tf.map(p => path.basename(p)).join(', ') + ')' : ''}입니다. 대표가 묻는 질문에 답해 주세요. 숫자는 파일에서 직접 계산해 근거와 함께 알려 주시고, 자료만으로 알 수 없는 것은 모른다고 말해 주세요. 한 번에 질문 하나씩 보내겠습니다.

## 질문 (한 번에 하나씩, 질문을 보낸 시각과 답을 받은 시각을 기록)
${Q.map(q => q.id + '. ' + q.text).join('\n')}

## 진행 규칙
- 모든 질문을 같은 대화에서 순서대로 합니다.
- 5개 정도(예: ${Q.filter(q => q.cat !== '직접 조회').slice(0, 3).map(q => q.id).join(', ')} 와 환각·누락 질문)는 새 대화에서 2번 더 반복해 일관성을 봅니다.
- 첨부 파일을 어떻게 가공했는지(열 이름 정리 등)와 준비에 걸린 시간도 메모합니다.
- 채점은 채점시트.csv 의 정답과 정답표.csv 의 채점 기준으로 같은 사람이 합니다.
`);
// 정답표 검증: 독립 계산 값과 엔진의 분석 함수 값을 직접 비교 (도구가 질문을 알아듣는지와 무관)
const eng = {};
const vkey = k => S.m.vendorKey(dispName(k));
eng.Q01 = (S.ar.vendors.filter(v => v.key === vkey(V1))[0] || { balance: 0 }).balance;
eng.Q03 = sum(S.ar.vendors.filter(v => v.balance > 1000), v => v.balance);
{ const ag = BM.aging(S.ar); eng.Q04 = ag.d180 + ag.over; }
eng.Q05 = sum(BM.cashRows(S.m).filter(r => r.ym === mFull && r.dr > 0 && r.vk === vkey(V2)), r => r.dr - r.cr);
eng.Q06 = S.pl.filter(b => b.ym === mFull)[0].rev;
eng.Q07 = (BM.expenseByAcct(S.m, mFull)['지급수수료'] || { amt: 0 }).amt;
eng.Q09 = BM.volumes(S.m, vkey(V3), mFull).inKg / 1000;
{ const up = BM.unitPrices(S.m, vkey(V4)), k = Object.keys(up).filter(x => /^매출\|처리/.test(x))[0]; eng.Q10 = k ? up[k].latest.avg : null; }
const lines = ['정답표 검증: 독립 계산 값과 엔진 분석 함수 값 비교 (차이가 0이면 서로 다른 두 방법이 같은 답을 냄)', ''];
Q.filter(q => q.type === 'num').forEach(q => { const e = eng[q.id]; const idx = Q.indexOf(q); const t = tool[idx]; lines.push(q.id + ' 독립 계산 ' + fmt(q.expected.value) + (q.expected.unit || '') + ' | 엔진 ' + (e == null ? '-' : fmt(e)) + ' | 차이 ' + (e == null ? '-' : fmt(e - q.expected.value)) + ' | 도구 답변 자동 확인: ' + (t.auto === 2 ? '일치' : t.auto === 0 ? '불일치' : '질문을 알아듣지 못함')); });
fs.writeFileSync(path.join(out, '독립계산_대조.txt'), lines.join('\n') + '\n');
console.log('만든 파일:', fs.readdirSync(out).join(', '));
console.log('\n질문별 도구 답변:');
Q.forEach((q, i) => console.log(q.id, '|', tool[i].parsed ? '해석 ' + tool[i].id + (tool[i].error ? ' 오류:' + tool[i].error : '') : '해석 실패', '| 자동', tool[i].auto, '\n   Q:', q.text, '\n   정답:', expText(q).slice(0, 110), '\n   도구:', (tool[i].headline || tool[i].error || '(이해하지 못했습니다)').slice(0, 170)));
console.log('\n도구 자동 확인(숫자·목록 문항만):');
Q.forEach((q, i) => { if (tool[i].auto != null || !tool[i].parsed) console.log(' ', q.id, q.cat, '|', tool[i].parsed ? '해석 ' + tool[i].id : '해석 실패', '| 자동', tool[i].auto, '|', q.text.slice(0, 28)); });
