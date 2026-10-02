'use strict';
/* 계산 검증: 분개장에서 다시 계산한 월별·계정별 금액을 ERP가 직접 낸 월별 손익계산서, 제조원가명세서와 비교한다.
   사용: node tools/verify_against_erp.js --journal 분개장1.xlsx 분개장2.xlsx --report 손익계산서.xlsx 원가명세서.xlsx [--through 2026-08]
   --through: 이 달까지만 비교 (ERP 보고서를 받은 뒤 분개장에 전표가 더 들어왔다면 그 이전 달까지만 비교)
   차이가 하나라도 있으면 종료 코드 1 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
globalThis.XLSX = require(path.join(ROOT, 'vendor', 'xlsx.full.min.js'));
['util', 'adapters', 'model', 'analysis'].forEach(f => require(path.join(ROOT, 'js', f + '.js')));
const BM = globalThis.BM;
const argv = process.argv.slice(2);
function list(flag) { const i = argv.indexOf('--' + flag); if (i < 0) return []; const o = []; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) o.push(argv[j]); return o; }
const jf = list('journal'), rf = list('report'), through = list('through')[0] || '9999-12';
if (!jf.length || !rf.length) { console.error('사용: node tools/verify_against_erp.js --journal 파일... --report 파일... [--through YYYY-MM]'); process.exit(1); }
const rd = p => XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true });
const m = BM.buildModel({ journals: jf.map(p => BM.parseJournal(rd(p))) });
const acc = BM.accountMonthly(m);
const strip = a => a.replace(/\((제|도|분|판)\)$/, '');
const fmt = v => Math.round(v).toLocaleString('ko-KR');
let lines = 0, diffs = 0;
function side(cls, keep) {   // 분개장 쪽: 계정명(접미사 제거) → 월 → 금액
  const o = {};
  Object.keys(acc[cls]).forEach(a => { if (keep && !keep(a)) return; const k = strip(a); o[k] = o[k] || {}; Object.keys(acc[cls][a]).forEach(ym => { o[k][ym] = (o[k][ym] || 0) + acc[cls][a][ym]; }); });
  return o;
}
function compare(label, rows, groupNames, mine) {
  const found = {}; let n = 0, d = 0; const bad = [];
  rows.filter(x => !x.header && groupNames.includes(x.group)).forEach(x => {
    found[x.name] = 1;
    Object.keys(x.vals).filter(ym => ym <= through).forEach(ym => {
      const a = x.vals[ym], b = (mine[x.name] || {})[ym] || 0; n++;
      if (Math.abs(a - b) > 1) { d++; bad.push([x.name, ym, a, b]); }
    });
  });
  // ERP 보고서에 없는 계정이 분개장에 금액이 있는지
  const extra = [];
  Object.keys(mine).forEach(k => { if (found[k]) return; Object.keys(mine[k]).filter(ym => ym <= through).forEach(ym => { if (Math.abs(mine[k][ym]) > 1) extra.push([k, ym, mine[k][ym]]); }); });
  lines += n; diffs += d;
  console.log((d ? '✗ ' : '✓ ') + label + ': ' + n + '개 항목(계정×월) 중 ' + (n - d) + '개 일치' + (d ? ', ' + d + '개 불일치' : ''));
  bad.forEach(x => console.log('    불일치 ' + x[0] + ' ' + x[1] + ' ERP ' + fmt(x[2]) + ' / 계산 ' + fmt(x[3]) + ' / 차이 ' + fmt(x[3] - x[2])));
  if (extra.length) { console.log('  ※ ERP 보고서에는 없는데 분개장에 금액이 있는 계정 ' + extra.length + '건:'); extra.slice(0, 8).forEach(x => console.log('    ' + x[0] + ' ' + x[1] + ' ' + fmt(x[2]))); }
}
rf.forEach(p => {
  const rep = BM.parseErpReport(rd(p));
  if (!rep) { console.log('읽지 못한 보고서: ' + path.basename(p)); return; }
  console.log('\n[' + path.basename(p) + '] 종류: ' + (rep.type === 'pl' ? '월별 손익계산서' : rep.type === 'cost' ? '월별 제조원가명세서' : '알 수 없음') + ', 비교 기간 ~' + (through < '9999' ? through : rep.months[rep.months.length - 1]));
  if (rep.type === 'pl') {
    compare('매출', rep.rows, ['매출액'], side('revenue'));
    compare('매출원가', rep.rows, ['매출원가'], side('cogs'));
    compare('판매비와관리비', rep.rows, ['판매비와관리비'], side('sga'));
    compare('영업외수익', rep.rows, ['영업외수익'], side('nonop_in'));
    compare('영업외비용', rep.rows, ['영업외비용'], side('nonop_out'));
  } else if (rep.type === 'cost') {
    compare('제조원가명세서(도급 계정)', rep.rows, ['공사원재료비', '노무비', '외주비', '경비'], side('prod', a => /\(도\)$/.test(a)));
    const other = side('prod', a => !/\(도\)$/.test(a)); const keys = Object.keys(other).filter(k => Object.keys(other[k]).some(ym => ym <= through && Math.abs(other[k][ym]) > 1));
    if (keys.length) console.log('  ※ 도급(도) 외 제조 계정((제)·(분))에 입력된 금액 ' + keys.length + '개 계정: 원가명세서에 반영되지 않는 금액입니다. 계정 선택이 맞는지 확인하세요.');
  }
});
console.log('\n총 ' + lines + '개 항목 비교, 불일치 ' + diffs + '개');
process.exit(diffs ? 1 : 0);
