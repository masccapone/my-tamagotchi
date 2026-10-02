'use strict';
/* 질문 카탈로그 문서 생성: 코드에 선언된 질문별 필요 자료와 정의를 docs/질문_카탈로그.md 로 만든다. 실행: node tools/gen_catalog.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
globalThis.XLSX = {};
['util', 'adapters', 'model', 'analysis', 'questions', 'nl', 'engine'].forEach(f => require(path.join(ROOT, 'js', f + '.js')));
const BM = globalThis.BM;
const verified = { q1: '전수 검증(미수·미지급 잔액)', q2: '전수 검증(업체×월)', q4: '전수 검증(월×계정)', q10: '전수 검증(업체)', q11: '전수 검증(업체×월)', q12: '전수 검증(업체·합계)', q13: '전수 검증(업체)', q14: '전수 검증(월)', q6: 'ERP 보고서 대조(손익계산서·원가명세서)', q15: 'ERP 보고서 대조(계정 합)', q16: 'ERP 보고서 대조(계정 합)' };
const lines = ['# 질문 카탈로그', '', '질문마다 필요한 자료, 계산 정의, 결과 구분(확정·잠정·추정), 검증 방법을 적은 표입니다. 이 문서는 `node tools/gen_catalog.js` 로 코드에서 만들어지므로 직접 고치지 말고 `js/questions.js` 의 META 를 고치세요.', '', '| 번호 | 질문 | 분류 | 필요한 자료 | 있으면 좋은 자료 | 결과 구분 | 검증 |', '|---|---|---|---|---|---|---|'];
const dl = { journal: '분개장', trades: '거래내역' };
BM.questions.forEach(q => lines.push('| ' + q.id + ' | ' + q.label + ' | ' + q.group + ' | ' + q.requires.map(r => dl[r] || r).join(', ') + ' | ' + (q.optional.join(', ') || '-') + ' | ' + q.baseStatus + ' | ' + (verified[q.id] || '단위 검증 없음(수동 확인)') + ' |'));
lines.push('', '## 계산 정의', '');
BM.questions.forEach(q => lines.push('- **' + q.id + ' ' + q.label + '**: ' + q.def));
lines.push('', '## 지원하지 않는 조건 (이런 말이 있으면 답하지 않고 이유를 알려 줍니다)', '', '- 월 단위가 아닌 기간(분기, 반기, 올해, 누적, 전년 비교)', '- 주·일 단위 기간(이번 주, 어제 등)', '- 항목을 제외한 계산("○○ 빼고")', '- 비율 계산(매출 대비 비용, 퍼센트 등)', '- 평균 계산', '- 업체 간 단가·물량 순위 비교', '', '## 새 질문을 추가할 때 지켜야 할 것', '', '1. `js/questions.js` 의 META 에 **필요한 자료, 있으면 좋은 자료, 결과 구분, 계산 정의**를 적는다.', '2. 정의는 회계적으로 맞는지 **계정 흐름(전표에서 어느 줄을 세는지)**까지 확인한다. 같은 방법을 두 번 구현하면 정의가 틀려도 검증이 통과하므로, 검증은 반드시 **다른 방법**(다른 계정, ERP 보고서 등)으로 한다.',
  '3. `tools/sweep_verify.js` 에 모든 업체·월·계정 조합에 대한 전수 검증을 추가한다.', '4. ERP 보고서와 직접 대조할 수 있으면 `tools/verify_against_erp.js` 로 대조한다.', '5. `benchmark/build_benchmark.js` 에 새 표현의 질문을 추가하고, 지원하지 않는 변형(기간 범위, 비교, 제외 등)에는 답하지 않는지 확인한다.', '6. 자료가 없을 때 질문 버튼이 비활성화되고 필요한 자료가 안내되는지 확인한다.', '');
fs.writeFileSync(path.join(ROOT, 'docs', '질문_카탈로그.md'), lines.join('\n'));
console.log('docs/질문_카탈로그.md 생성 (' + BM.questions.length + '개 질문)');
