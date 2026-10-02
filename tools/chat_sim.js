'use strict';
/* 카카오톡 대화 시뮬레이터: 문장을 한 줄씩 넣으면 챗봇이 돌려줄 답을 그대로 보여준다.
   사용: node tools/chat_sim.js --journal 분개장1.xlsx 분개장2.xlsx [--trades 파일] [--report ERP보고서...] --phrases 문장.txt
   (문장.txt 는 한 줄에 질문 하나. 출력에는 회사 숫자가 들어 있으니 저장소에 올리지 말 것) */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
globalThis.XLSX = require(path.join(ROOT, 'vendor', 'xlsx.full.min.js'));
['util', 'adapters', 'model', 'analysis', 'questions', 'nl', 'engine'].forEach(f => require(path.join(ROOT, 'js', f + '.js')));
const BM = globalThis.BM, E = BM.engine;
const argv = process.argv.slice(2);
const list = flag => { const i = argv.indexOf('--' + flag); const o = []; if (i < 0) return o; for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) o.push(argv[j]); return o; };
const rd = p => XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true });
const files = [];
list('journal').forEach(p => files.push({ name: path.basename(p), kind: 'journal', data: BM.parseJournal(rd(p)) }));
list('trades').forEach(p => { const wb = rd(p); files.push({ name: path.basename(p), kind: 'trades', data: BM.isStatusBook(wb) ? BM.parseStatusBook(wb) : BM.parseTrades(wb) }); });
list('report').forEach(p => { const wb = rd(p); const rep = BM.isErpReport(wb) ? BM.parseErpReport(wb) : null; if (rep) files.push({ name: path.basename(p), kind: 'report', data: rep }); });
const S = E.build(files);
const phrases = fs.readFileSync(list('phrases')[0], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
let ok = 0, refused = 0;
phrases.forEach(t => {
  console.log('\n대표: ' + t);
  const it = E.interpret(S, t);
  if (it.kind === 'refuse') { refused++; console.log('챗봇(답 안 함, 이유=' + it.reason + '): ' + it.message); return; }
  const run = E.runParsed(S, it.r, { useEst: true });
  if (run.error) { refused++; console.log('챗봇(되묻기): ' + (run.text || run.error)); return; }
  ok++;
  console.log('챗봇(해석: ' + run.q.label + (it.r.month ? ', ' + it.r.month : '') + '):\n' + E.toText(run));
});
console.log('\n== 총 ' + phrases.length + '문장: 답변 ' + ok + ', 답 안 함/되묻기 ' + refused);
