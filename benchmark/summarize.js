'use strict';
/* 채점이 끝난 채점시트.csv 를 읽어 도구와 일반 AI의 결과를 비교한다.
   사용: node benchmark/summarize.js 채점시트.csv */
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('사용: node benchmark/summarize.js 채점시트.csv'); process.exit(1); }
function parseCsv(t) {
  t = t.replace(/^﻿/, ''); const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const rows = parseCsv(fs.readFileSync(file, 'utf8')).filter(r => r.length > 3);
const head = rows[0], data = rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i]; }); return o; });
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const col = { 도구: '도구 점수(0-2)', AI1: 'AI 1회 점수(0-2)', AI2: 'AI 2회 점수(0-2)', AI3: 'AI 3회 점수(0-2)' };
function pct(list) { const s = list.filter(x => x != null); return s.length ? (s.reduce((a, b) => a + b, 0) / (2 * s.length) * 100).toFixed(0) + '% (' + s.length + '문항)' : '-'; }
function avg(list) { const s = list.filter(x => x != null); return s.length ? (s.reduce((a, b) => a + b, 0) / s.length).toFixed(1) : '-'; }
const cats = [...new Set(data.map(d => d['분류']))];
console.log('\n## 정답률 (만점 대비)\n');
console.log('| 분류 | 도구 | 일반 AI(1회차) |\n|---|---|---|');
cats.forEach(c => { const d = data.filter(x => x['분류'] === c); console.log('| ' + c + ' | ' + pct(d.map(x => num(x[col.도구]))) + ' | ' + pct(d.map(x => num(x[col.AI1]))) + ' |'); });
console.log('| **전체** | ' + pct(data.map(x => num(x[col.도구]))) + ' | ' + pct(data.map(x => num(x[col.AI1]))) + ' |');
const cons = data.filter(x => [col.AI1, col.AI2, col.AI3].every(k => num(x[k]) != null));
console.log('\n## 일관성 (같은 질문 3번 반복했을 때 점수가 같은 비율)\n');
console.log(cons.length ? '일반 AI: ' + (cons.filter(x => num(x[col.AI1]) === num(x[col.AI2]) && num(x[col.AI2]) === num(x[col.AI3])).length) + '/' + cons.length + ' 문항 일관됨 (도구는 계산이 결정적이라 항상 같음)' : '3회 반복한 문항이 없습니다.');
console.log('\n## 시간\n');
console.log('도구 평균 ' + avg(data.map(x => num(x['도구 시간(초)']))) + '초 / 일반 AI 평균 ' + avg(data.map(x => num(x['AI 1회 시간(초)']))) + '초');
const hall = data.filter(x => /^y/i.test(x['없는 내용을 지어냄(Y/N)'] || ''));
console.log('\n## 지어낸 내용\n\n일반 AI가 없는 내용을 지어낸 문항: ' + hall.length + '개' + (hall.length ? ' (' + hall.map(x => x['번호']).join(', ') + ')' : ''));
const basis = data.filter(x => x['근거를 밝힘(Y/N)']);
console.log('근거를 밝힌 비율(일반 AI): ' + (basis.length ? (basis.filter(x => /^y/i.test(x['근거를 밝힘(Y/N)'])).length + '/' + basis.length) : '-'));
console.log('\n## 도구가 진 문항 (일반 AI 점수가 더 높음)\n');
data.filter(x => num(x[col.AI1]) != null && num(x[col.도구]) != null && num(x[col.AI1]) > num(x[col.도구])).forEach(x => console.log('- ' + x['번호'] + ' ' + x['질문'] + ' (도구 ' + x[col.도구] + ' / AI ' + x[col.AI1] + ')'));
