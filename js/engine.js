/* 엔진: 업로드된 파일 묶음(files)로 분석 상태 S를 만들고, 질문을 실행한다.
   브라우저 화면(app.js)과 로컬 서버(server/server.js)가 같은 코드를 쓴다. */
(function (g) {
  'use strict';
  var BM = g.BM;
  var E = BM.engine = {};

  var BASE_STATUS = { q12: '확정', q13: '추정', q14: '잠정', q15: '잠정', q16: '잠정', q17: '확정', q18: '잠정', q1: '추정', q2: '잠정', q3: '추정', q4: '확정', q5: '확정', q6: '잠정', q7: '확정', q8: '추정', q9: '추정', q10: '확정', q11: '확정' };
  var BASE_SRC = { q12: '분개장(외상매출금)', q13: '분개장(미지급금) + 결제 이력', q14: '분개장 + 거래내역', q15: '분개장', q16: '분개장', q17: '분개장 + 거래내역 대조', q18: '분개장(과거 평균)', q1: '분개장(미지급금) + 결제 이력', q2: '분개장(보통예금)', q3: '분개장(채권·채무) + 결제 이력', q4: '분개장', q5: '분개장', q6: '분개장', q7: '분개장', q8: '분개장 + 거래내역', q9: '분개장(보통예금) + 입력한 기준 잔액', q10: '거래내역 + 분개장', q11: '거래내역' };

  /* files: [{name, kind:'journal'|'trades'|'vendors', data}] → S | null */
  E.build = function (files) {
    var journals = files.filter(function (f) { return f.kind === 'journal'; }).map(function (f) { return f.data; });
    if (!journals.length) return null;
    var tradeFiles = files.filter(function (f) { return f.kind === 'trades'; }), trades = null;
    if (tradeFiles.length) {
      trades = { rows: [], flow: tradeFiles[0].data.flow, warn: { badDate: 0, unknownDir: 0 } };
      tradeFiles.forEach(function (f) { trades.rows = trades.rows.concat(f.data.rows); trades.warn.badDate += f.data.warn.badDate; trades.warn.unknownDir += f.data.warn.unknownDir; });
    }
    var vlist = [];
    files.filter(function (f) { return f.kind === 'vendors'; }).forEach(function (f) { vlist = vlist.concat(f.data.list); });
    var m = BM.buildModel({ journals: journals, trades: trades, vendors: vlist.length ? { list: vlist } : null });
    var pl = BM.monthlyPL(m), rc = BM.reconcile(m, pl);
    var S = { m: m, pl: pl, rc: rc, ar: BM.openItems(m, 'AR'), ap: BM.openItems(m, 'AP'), bepMonths: BM.defaultMonths(m, pl, rc) };
    var keys = {};
    S.ar.vendors.concat(S.ap.vendors).forEach(function (v) { keys[v.key] = 1; });
    if (trades) trades.rows.forEach(function (t) { if (t.vk) keys[t.vk] = 1; });
    m.rows.forEach(function (r) { if (r.vk && (r.cls === 'revenue' || BM.CASH_ACCTS.test(r.acct))) keys[r.vk] = 1; });
    S.vendorKeys = Object.keys(keys).filter(function (k) { return k && k !== '__none__'; }).sort(function (a, b) { return m.vendorName(a) < m.vendorName(b) ? -1 : 1; });
    return S;
  };

  E.resolveVendor = function (S, text) {
    var t = (text || '').trim();
    if (!t) return null;
    var nk = BM.normName(t), hit = null, many = [];
    S.vendorKeys.forEach(function (k) { if (S.m.vendorName(k) === t || k === nk) hit = k; });
    if (hit) return { key: hit };
    S.vendorKeys.forEach(function (k) { if (nk && (k.indexOf(nk) >= 0 || nk.indexOf(k) >= 0)) many.push(k); });
    if (many.length) return { key: many[0], many: many };
    return { key: null };
  };

  E.nlContext = function (S) {
    var accts = {};
    S.m.months.slice(-14).forEach(function (ym) { Object.keys(BM.expenseByAcct(S.m, ym)).forEach(function (k) { accts[k] = 1; }); });
    return { vendors: S.vendorKeys.map(function (k) { return { key: k, name: S.m.vendorName(k) }; }), accts: Object.keys(accts).concat(Object.keys(BM.ACCT_GROUPS)), asOf: S.m.asOf, months: S.m.months };
  };

  /* 질문마다 필요한 자료가 올라와 있는지 */
  var DATA_LABEL = { journal: '분개장', trades: '거래내역' };
  E.availability = function (S) {
    var o = {};
    BM.questions.forEach(function (q) {
      var miss = [];
      (q.requires || []).forEach(function (r) { if (r === 'trades' && !S.m.trades) miss.push(DATA_LABEL[r]); });
      o[q.id] = { available: !miss.length, missing: miss };
    });
    return o;
  };
  E.question = function (id) { return BM.questions.filter(function (q) { return q.id === id; })[0]; };

  /* p = { vendorText, month, acct }, opt = { useEst, anchor, canEditAnchor }
     → { error } 또는 { q, c, answer, status, source, asOf, warnings, notes } */
  E.run = function (S, qid, p, opt) {
    p = p || {}; opt = opt || {};
    var q = E.question(qid);
    if (!q) return { error: 'unknown-question' };
    var av = E.availability(S)[qid];
    if (!av.available) return { error: 'missing-data', q: q, missing: av.missing, text: '이 질문에는 ' + av.missing.join(', ') + ' 파일이 필요합니다.' };
    var needs = q.needs, notes = [];
    var c = { m: S.m, pl: S.pl, ar: S.ar, ap: S.ap, rc: S.rc, bepMonths: S.bepMonths, useEst: opt.useEst !== false, anchor: opt.anchor || null, canEditAnchor: !!opt.canEditAnchor };
    if (needs.indexOf('month') >= 0 || needs.indexOf('month?') >= 0) c.month = p.month || (needs.indexOf('month') >= 0 ? S.m.asOf.slice(0, 7) : null);
    c.days = p.days || null; c.topN = p.topN || null; c.view = p.view || null; c.focus = p.focus || null; c.baseMonth = p.baseMonth || null;
    if (needs.indexOf('acct') >= 0 || needs.indexOf('acct?') >= 0) {
      c.acct = p.acct || '';
      if (needs.indexOf('acct') >= 0 && !c.acct) return { error: 'acct-required', q: q };
    }
    if (needs.indexOf('vendor') >= 0 || needs.indexOf('vendor?') >= 0) {
      var rv = E.resolveVendor(S, p.vendorText);
      if (rv && rv.key) {
        c.vk = rv.key; c.vname = S.m.vendorName(rv.key);
        if (rv.many && rv.many.length > 1) notes.push('비슷한 이름이 여러 개입니다: ' + rv.many.slice(0, 5).map(function (k) { return S.m.vendorName(k); }).join(', ') + ' — 첫 번째로 이해했습니다.');
      } else if (rv) return { error: 'vendor-not-found', q: q, text: p.vendorText };
      else if (needs.indexOf('vendor') >= 0) return { error: 'vendor-required', q: q };
    }
    var PERIOD = ['q2', 'q4', 'q5', 'q6', 'q7', 'q11', 'q14', 'q15', 'q16'];
    var a;
    if (c.month && PERIOD.indexOf(qid) >= 0 && S.m.months.indexOf(c.month) < 0) {
      var last = S.m.months[S.m.months.length - 1];
      a = { headline: BM.ymLabel(c.month) + '은 분개장에 입력된 전표가 없습니다. 0원이 아니라 자료가 없는 것입니다. 분개장의 마지막 달은 ' + BM.ymLabel(last) + '입니다.', body: '', notes: ['경리 담당자가 해당 월 분개장을 올린 뒤 다시 물어보세요.'], status: '잠정' };
    } else {
      a = q.run(c);
      var day = +S.m.asOf.slice(8);
      if (c.month && PERIOD.indexOf(qid) >= 0 && c.month === S.m.asOf.slice(0, 7) && day < 25) {
        a.headline = '※ ' + BM.ymLabel(c.month) + '은 ' + day + '일까지만 입력된 진행 중인 달이라 금액이 적게 나옵니다. ' + a.headline;
      }
    }
    var st = a.status || BASE_STATUS[qid] || '잠정';
    var b = c.month ? S.pl.filter(function (x) { return x.ym === c.month; })[0] : null;
    if (b && st === '확정' && b.flags.some(function (f) { return f.k === 'partial' || f.k === 'drop'; })) st = '잠정';
    return { q: q, c: c, answer: a, status: st, source: BASE_SRC[qid] || '분개장', asOf: S.m.asOf,
      // 매출·이익·점검처럼 데이터 오류가 숫자에 직접 영향을 주는 질문에만 경고 내용을 붙이고, 나머지는 건수만 알린다
      warnings: ['q6', 'q8', 'q14', 'q17', 'q15', 'q16'].indexOf(qid) >= 0 ? S.rc.warnings.filter(function (w) { return w.lvl === 'bad'; }).slice(0, 2).map(function (w) { return w.t; }) : [],
      warnTotal: S.rc.warnings.length,
      notes: (a.notes || []).concat(notes) };
  };

  /* 문장 → 해석 결과. 화면, 서버, 시험이 모두 이 함수를 쓴다.
     { kind: 'refuse', reason, message } 이면 답하지 않는다. { kind: 'ok', r } 이면 E.runParsed 로 실행한다. */
  E.interpret = function (S, text) {
    var r = BM.nl.parse(text, E.nlContext(S));
    if (!r) return { kind: 'refuse', reason: 'unknown', message: '질문을 이해하지 못했습니다. 업체명과 월을 넣어 다시 물어보세요. (예: "○○환경 이번 달 줄 돈 얼마야?")' };
    if (r.unsupported && r.unsupported.length) return { kind: 'refuse', reason: 'unsupported', r: r, message: '"' + r.unsupported[0].phrase + '"처럼 ' + r.unsupported[0].reason + '은(는) 아직 지원하지 않아 답하지 않았습니다. 틀린 숫자를 드리지 않기 위해서입니다. 월 단위로 물어보세요. (예: "8월 매출")' };
    if (r.unsure && r.unsure.length) return { kind: 'refuse', reason: 'unsure', r: r, message: '"' + r.unsure.join('", "') + '"이(가) 무슨 뜻인지 정확히 알 수 없어 답하지 않았습니다. 틀린 숫자를 드리지 않기 위해서입니다. 다른 말로 물어보세요. (예: "90일 넘게 못 받은 돈")' };
    if (r.unknownVendor) return { kind: 'refuse', reason: 'vendor-not-found', r: r, message: '"' + r.unknownVendor + '"과(와) 일치하는 업체를 찾지 못했습니다. 자료에 없는 업체이거나 이름이 다릅니다.' };
    var av = E.availability(S)[r.id];
    if (av && !av.available) return { kind: 'refuse', reason: 'missing-data', r: r, message: '이 질문에는 ' + av.missing.join(', ') + ' 파일이 필요합니다. 파일을 올린 뒤 다시 물어보세요.' };
    return { kind: 'ok', r: r };
  };

  /* 해석 결과 실행. 업체가 둘 이상이면 각각 계산해 한 줄로 이어 붙인다. */
  E.runParsed = function (S, r, opt) {
    var base = { month: r.month, acct: r.acct, days: r.days, topN: r.topN, view: r.view, focus: r.focus, baseMonth: r.baseMonth };
    if (!(r.vendors && r.vendors.length > 1)) return E.run(S, r.id, Object.assign({ vendorText: r.vendor ? r.vendor.name : '' }, base), opt);
    var runs = r.vendors.slice(0, 4).map(function (v) { return E.run(S, r.id, Object.assign({ vendorText: v.name }, base), opt); });
    var bad = runs.filter(function (x) { return x.error; })[0];
    if (bad) return bad;
    var weakest = runs.some(function (x) { return x.status === '추정'; }) ? '추정' : runs.some(function (x) { return x.status === '잠정'; }) ? '잠정' : '확정';
    var notes = []; runs.forEach(function (x) { x.notes.forEach(function (n) { if (notes.indexOf(n) < 0) notes.push(n); }); });
    return { q: runs[0].q, c: runs[0].c, answer: { headline: runs.map(function (x) { return x.answer.headline; }).join(' / '), body: runs.map(function (x) { return x.answer.body || ''; }).join('') }, status: weakest, source: runs[0].source, asOf: runs[0].asOf, warnings: runs[0].warnings, warnTotal: runs[0].warnTotal, notes: notes, multi: true };
  };

  /* 메신저(카카오톡 등)로 보낼 짧은 글: 숫자 표는 보내지 않고 한 줄 답과 구분·기준일·주의만 */
  E.toText = function (res) {
    if (res.error) return null;
    var lines = ['[' + res.status + '] ' + res.asOf + ' 기준', res.answer.headline];
    if (res.warnings.length) lines.push('※ 데이터 경고: ' + res.warnings.join(' / '));
    else if (res.warnTotal) lines.push('※ 데이터 점검 ' + res.warnTotal + '건이 있습니다.');
    return lines.join('\n');
  };
})(typeof window !== 'undefined' ? window : globalThis);
