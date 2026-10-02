/* 화면: 파일 업로드 → 모델 구성 → 요약 / 질문 / 월별 추이 */
(function (g) {
  'use strict';
  var BM = g.BM, esc = BM.esc;
  function $(id) { return document.getElementById(id); }

  var files = [];                 // {name, kind, data}
  var S = null;                   // 현재 분석 상태
  var curQ = null, chart = null, useEst = true;

  /* ---------- 업로드 ---------- */
  function handleFiles(list) {
    var arr = Array.prototype.slice.call(list);
    Promise.all(arr.map(function (f) {
      return BM.readWorkbook(f).then(function (r) { r.name = f.name; return r; }, function () { return { name: f.name, kind: null }; });
    })).then(function (res) {
      var bad = res.filter(function (r) { return !r.kind || !r.data; });
      res.forEach(function (r) {
        if (!r.kind || !r.data) return;
        if (r.data.converted) r.name += ' (현황→거래내역 변환 ' + r.data.rows.length.toLocaleString('ko-KR') + '건)';
        files = files.filter(function (x) { return x.name !== r.name; });
        files.push(r);
        if (r.kind === 'trades' && r.vendors) files.push({ name: r.name + ' (업체마스터)', kind: 'vendors', data: r.vendors });
      });
      $('msg').innerHTML = bad.length ? '<div class="callout warn">읽지 못한 파일: ' + bad.map(function (b) { return esc(b.name); }).join(', ') +
        '<br>분개장(ERP 내보내기), 거래내역 템플릿, 업체마스터 템플릿 형식만 지원합니다.</div>' : '';
      refresh();
    });
  }

  function refresh() {
    renderChips();
    var journals = files.filter(function (f) { return f.kind === 'journal'; }).map(function (f) { return f.data; });
    if (!journals.length) { $('app').classList.add('hidden'); S = null; return; }
    var tradeFiles = files.filter(function (f) { return f.kind === 'trades'; });
    var trades = null;
    if (tradeFiles.length) {
      trades = { rows: [], flow: tradeFiles[0].data.flow, warn: { badDate: 0, unknownDir: 0 } };
      tradeFiles.forEach(function (f) { trades.rows = trades.rows.concat(f.data.rows); trades.warn.badDate += f.data.warn.badDate; trades.warn.unknownDir += f.data.warn.unknownDir; });
    }
    var vlist = [];
    files.filter(function (f) { return f.kind === 'vendors'; }).forEach(function (f) { vlist = vlist.concat(f.data.list); });
    var m = BM.buildModel({ journals: journals, trades: trades, vendors: vlist.length ? { list: vlist } : null });
    var pl = BM.monthlyPL(m), rc = BM.reconcile(m, pl);
    S = { m: m, pl: pl, rc: rc, ar: BM.openItems(m, 'AR'), ap: BM.openItems(m, 'AP'), bepMonths: BM.defaultMonths(m, pl, rc) };
    var keys = {};
    S.ar.vendors.concat(S.ap.vendors).forEach(function (v) { keys[v.key] = 1; });
    if (trades) trades.rows.forEach(function (t) { if (t.vk) keys[t.vk] = 1; });
    m.rows.forEach(function (r) { if (r.vk && (r.cls === 'revenue' || BM.CASH_ACCTS.test(r.acct))) keys[r.vk] = 1; });
    S.vendorKeys = Object.keys(keys).filter(function (k) { return k && k !== '__none__'; }).sort(function (a, b) { return m.vendorName(a) < m.vendorName(b) ? -1 : 1; });
    $('app').classList.remove('hidden');
    renderSummary(); renderQuestionList(); renderTrend();
    if (curQ) selectQ(curQ.id);
  }

  function renderChips() {
    var cnt = function (k) { return files.filter(function (f) { return f.kind === k; }).length; };
    [['chip-j', 'journal'], ['chip-t', 'trades'], ['chip-v', 'vendors']].forEach(function (p) { $(p[0]).classList.toggle('on', cnt(p[1]) > 0); });
    $('chip-j').textContent = '분개장' + (cnt('journal') ? ' ' + cnt('journal') + '개' : '');
    $('loaded').innerHTML = files.filter(function (f) { return f.kind !== 'vendors' || f.name.indexOf('(업체마스터)') < 0; }).map(function (f) { return '<span class="file">' + esc(f.name) + '</span>'; }).join('');
  }

  /* ---------- 요약 ---------- */
  function renderSummary() {
    var m = S.m, ar = S.ar, ap = S.ap;
    var arOpen = BM.sum(ar.vendors, function (v) { return v.open; }), apOpen = BM.sum(ap.vendors, function (v) { return v.open; });
    var ag = BM.aging(ar), over90 = ag.d180 + ag.over;
    var last = S.bepMonths.length ? S.pl.filter(function (b) { return b.ym === S.bepMonths[S.bepMonths.length - 1]; })[0] : null;
    var est = S.pl.estimate, hasEst = est && est.available && est.quarters.length;
    var lastVal = last ? (useEst ? last.plEst : last.plIncurred) : 0;
    var tiles = [
      tile('매출채권 잔액', BM.eok(arOpen), '90일 초과 ' + BM.eok(over90) + ' · ' + ar.vendors.filter(function (v) { return v.open > 0; }).length + '개 업체'),
      tile('미지급금 잔액', BM.eok(apOpen), ap.vendors.filter(function (v) { return v.open > 0; }).length + '개 거래처 · 카드대금 등 포함'),
      last ? tile(BM.ymLabel(last.ym) + ' 손익' + (useEst && last.estAdj > 0 ? ' (관리용 추정)' : ' (발생비용 기준)'), '<span class="' + (lastVal < 0 ? 'neg' : '') + '">' + BM.eok(lastVal) + '</span>', last.estAdj > 0 && useEst ? '추정 · 범위 ' + BM.eok(last.plEstLow) + ' ~ ' + BM.eok(last.plEstHigh) + ' · 결산성 비용 ' + BM.eok(last.estAdj) + ' 포함' : '잠정 · 마감이 확인된 가장 최근 달') : ''
    ].join('');
    var estBox = '';
    if (hasEst) {
      estBox = '<div class="estbox"><label><input type="checkbox" id="use-est"' + (useEst ? ' checked' : '') + '> 결산성 비용 예상 반영 (추정)</label>' +
        '<details><summary>어떻게 추정했나요?</summary><div>분기 말에만 입력되는 감가상각·퇴직급여·충당부채·주식보상·이자 정산 비용은 ' +
        est.basis.map(function (x) { return x.replace('Q', '년 ') + '분기'; }).join(', ') + ' 평균(분기 ' + BM.eok(est.perQuarterTotal) + ')으로 추정합니다. ' +
        est.quarters.map(function (x) { return x.q.replace('Q', '년 ') + '분기는 ' + (x.frac >= 0.99 ? '' : '경과분 ') + BM.eok(x.total) + ' 추가 (' + Object.keys(x.missing).map(function (k) { return k + ' ' + BM.eok(x.missing[k]); }).join(', ') + ')'; }).join('. ') +
        '. ' + (est.backtest ? '과거 검증(' + est.backtest.actualQ.replace('Q', '년 ') + '분기를 직전 분기 값으로 추정): 감가상각·퇴직급여 등은 오차 ' + pct(est.backtest.core.err) + ', 이자 정산은 ' + pct(est.backtest.interest.err) + '라서 이자는 범위로 표시합니다. ' : '') + '3분기 중 신규 설비 완공 등으로 실제 감가상각이 달라지면 오차가 생깁니다. 결산 전표가 분개장에 들어오면 자동으로 실제 값으로 대체됩니다.</div></details></div>';
    }
    var w = S.rc.warnings.map(function (x) { return '<li class="' + x.lvl + '">' + esc(x.t) + '</li>'; }).join('');
    $('summary').innerHTML = '<div class="asof">기준일: <b>' + m.asOf + '</b> (분개장 마지막 전표일). 이 날짜 이후의 입금·지급은 반영되지 않았습니다.</div>' +
      '<div class="tiles">' + tiles + '</div>' + estBox +
      (w ? '<div class="callout warn"><b>데이터 점검 ' + S.rc.warnings.length + '건</b><ul class="wl">' + w + '</ul></div>' : '<div class="callout ok">데이터 점검에서 발견된 문제가 없습니다.</div>');
    bindEst();
  }
  function pct(x) { return x == null ? '산정 불가' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }
  function bindEst() {
    var cb = $('use-est');
    if (!cb) return;
    cb.addEventListener('change', function () { useEst = cb.checked; renderSummary(); renderTrend(); if (curQ) runQ(); });
  }
  function tile(l, v, n) { return '<div class="card tile"><div class="label">' + esc(l) + '</div><div class="value">' + v + '</div>' + (n ? '<div class="note">' + esc(n) + '</div>' : '') + '</div>'; }

  /* ---------- 질문 ---------- */
  function renderQuestionList() {
    $('qlist').innerHTML = BM.questions.map(function (q) { return '<button class="qchip' + (curQ && curQ.id === q.id ? ' on' : '') + '" data-q="' + q.id + '">' + esc(q.label) + '</button>'; }).join('');
    Array.prototype.forEach.call($('qlist').querySelectorAll('button'), function (b) { b.addEventListener('click', function () { selectQ(b.getAttribute('data-q')); }); });
  }

  function resolveVendor(text) {
    var t = (text || '').trim();
    if (!t) return null;
    var m = S.m, nk = BM.normName(t), hit = null, many = [];
    S.vendorKeys.forEach(function (k) { if (m.vendorName(k) === t || k === nk) hit = k; });
    if (hit) return { key: hit };
    S.vendorKeys.forEach(function (k) { if (nk && (k.indexOf(nk) >= 0 || nk.indexOf(k) >= 0)) many.push(k); });
    if (many.length) return { key: many[0], many: many };
    return { key: null };
  }

  function selectQ(id) {
    curQ = BM.questions.filter(function (q) { return q.id === id; })[0];
    renderQuestionList();
    var needs = curQ.needs, h = '';
    var months = S.m.months.slice().reverse();
    var defM = S.m.asOf.slice(0, 7);
    if (needs.indexOf('vendor') >= 0 || needs.indexOf('vendor?') >= 0) {
      h += '<label>업체 <input id="p-vendor" list="vlist" placeholder="' + (needs.indexOf('vendor?') >= 0 ? '비워 두면 전체' : '업체명 입력') + '" value="' + esc(curVendorText()) + '"></label>' +
        '<datalist id="vlist">' + S.vendorKeys.map(function (k) { return '<option value="' + esc(S.m.vendorName(k)) + '">'; }).join('') + '</datalist>';
    }
    if (needs.indexOf('month') >= 0) h += '<label>월 <select id="p-month">' + months.map(function (x) { return '<option value="' + x + '"' + (x === (curMonth() || defM) ? ' selected' : '') + '>' + BM.ymLabel(x) + '</option>'; }).join('') + '</select></label>';
    if (needs.indexOf('acct') >= 0 || needs.indexOf('acct?') >= 0) h += '<label>비용 항목 <select id="p-acct"></select></label>';
    $('params').innerHTML = h;
    if ($('p-acct')) fillAcct();
    Array.prototype.forEach.call($('params').querySelectorAll('input,select'), function (el) {
      el.addEventListener('change', function () { if (el.id === 'p-month' && $('p-acct')) fillAcct(); runQ(); });
    });
    runQ();
  }
  var lastVendorText = '', lastMonth = '';
  function curVendorText() { return lastVendorText; }
  function curMonth() { return lastMonth; }
  function fillAcct() {
    var ym = $('p-month').value, e = BM.expenseByAcct(S.m, ym);
    var keys = Object.keys(e).sort(function (a, b) { return e[b].amt - e[a].amt; });
    var prev = $('p-acct').value;
    var opt = curQ.needs.indexOf('acct?') >= 0 ? '<option value="">전체 (항목별 비교)</option>' : '';
    $('p-acct').innerHTML = opt + keys.map(function (k) { return '<option value="' + esc(k) + '"' + (k === prev ? ' selected' : '') + '>' + esc(k) + ' (' + BM.mil(e[k].amt) + '백만)</option>'; }).join('');
  }

  function runQ() {
    var needs = curQ.needs, c = { m: S.m, pl: S.pl, ar: S.ar, ap: S.ap, rc: S.rc, bepMonths: S.bepMonths };
    var notes = [];
    if ($('p-month')) { c.month = $('p-month').value; lastMonth = c.month; }
    if ($('p-acct')) c.acct = $('p-acct').value;
    if ($('p-vendor')) {
      lastVendorText = $('p-vendor').value;
      var rv = resolveVendor(lastVendorText);
      if (rv && rv.key) {
        c.vk = rv.key; c.vname = S.m.vendorName(rv.key);
        if (rv.many && rv.many.length > 1) notes.push('비슷한 이름이 여러 개입니다: ' + rv.many.slice(0, 5).map(function (k) { return S.m.vendorName(k); }).join(', ') + ' — 첫 번째로 이해했습니다.');
      } else if (rv) { $('answer').innerHTML = '<div class="callout warn">"' + esc(lastVendorText) + '"과(와) 일치하는 업체를 찾지 못했습니다.</div>'; return; }
      else if (needs.indexOf('vendor') >= 0) { $('answer').innerHTML = '<div class="hint">업체를 입력하거나 목록에서 고르세요.</div>'; return; }
    }
    try { c.anchor = JSON.parse(localStorage.getItem('bm-cash-anchor') || 'null'); } catch (e) { c.anchor = null; }
    var a;
    try { a = curQ.run(c); } catch (e) { $('answer').innerHTML = '<div class="callout bad">이 질문을 계산하는 중 오류가 났습니다: ' + esc(e.message) + '</div>'; return; }
    var allNotes = (a.notes || []).concat(notes);
    var meta = metaFor(curQ.id, c, a);
    $('answer').innerHTML = '<div class="card ans">' + meta + '<div class="headline">' + esc(a.headline) + '</div>' + (a.body || '') +
      (allNotes.length ? '<ul class="notes">' + allNotes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    if (a.after) a.after($('answer'), runQ);
  }

  /* 모든 답변에 기준일, 확정·잠정·추정 구분, 근거를 붙인다 */
  var BASE_STATUS = { q1: '추정', q2: '잠정', q3: '추정', q4: '확정', q5: '확정', q6: '잠정', q7: '확정', q8: '추정', q9: '추정', q10: '확정', q11: '확정' };
  var BASE_SRC = { q1: '분개장(미지급금) + 결제 이력', q2: '분개장(보통예금)', q3: '분개장(채권·채무) + 결제 이력', q4: '분개장', q5: '분개장', q6: '분개장', q7: '분개장', q8: '분개장 + 거래내역', q9: '분개장(보통예금) + 입력한 기준 잔액', q10: '거래내역 + 분개장', q11: '거래내역' };
  function metaFor(id, c, a) {
    var st = a.status || BASE_STATUS[id] || '잠정';
    var b = c.month ? S.pl.filter(function (x) { return x.ym === c.month; })[0] : null;
    if (b && st === '확정' && b.flags.some(function (f) { return f.k === 'partial' || f.k === 'drop'; })) st = '잠정';
    var cls = st === '확정' ? 'fixed' : st === '잠정' ? 'prov' : 'est';
    var bad = S.rc.warnings.filter(function (w) { return w.lvl === 'bad'; }).slice(0, 2);
    return '<div class="meta"><span class="st ' + cls + '">' + st + '</span> 기준일 ' + S.m.asOf + ' · 근거: ' + esc(BASE_SRC[id] || '분개장') +
      (bad.length ? '<div class="metawarn">데이터 경고: ' + bad.map(function (w) { return esc(w.t); }).join(' / ') + '</div>' : '') + '</div>';
  }

  /* ---------- 월별 추이 ---------- */
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function renderTrend() {
    var rows = S.pl.filter(function (b) { return b.rev !== 0 || b.incurred > 1e6; }).slice(-12);
    $('trendtbl').innerHTML = BM.tbl(['월', '매출', '발생비용', '발생비용 기준', '관리용 추정', '장부 손익', '점검'], rows.map(function (b) {
      var cls = function (v) { return v < 0 ? 'neg' : ''; };
      return [BM.ymLabel(b.ym), BM.won(b.rev), BM.won(b.incurred), '<span class="' + cls(b.plIncurred) + '">' + BM.won(b.plIncurred) + '</span>',
        '<span class="' + cls(b.plEst) + '">' + (b.estAdj > 0 ? BM.won(b.plEst) : '-') + '</span>', '<span class="' + cls(b.plBook) + '">' + BM.won(b.plBook) + '</span>',
        b.flags.map(function (f) { return '<span class="badge warn">' + esc(f.t) + '</span>'; }).join('')];
    }), [1, 2, 3, 4, 5]);
    if (!g.Chart) return;
    if (chart) chart.destroy();
    var txt = cssVar('--text-secondary'), grid = cssVar('--grid');
    chart = new Chart($('chart').getContext('2d'), {
      type: 'bar',
      data: { labels: rows.map(function (b) { return b.ym.slice(2).replace('-', '.'); }), datasets: [
        { label: '매출', stack: 'rev', data: rows.map(function (b) { return Math.round(b.rev / 1e6); }), backgroundColor: cssVar('--series-1'), borderRadius: 4, maxBarThickness: 26 },
        { label: '발생비용', stack: 'cost', data: rows.map(function (b) { return Math.round(b.incurred / 1e6); }), backgroundColor: cssVar('--series-2'), borderRadius: 4, maxBarThickness: 26 },
        { label: '결산 예상 추가(추정)', stack: 'cost', data: rows.map(function (b) { return useEst ? Math.round(b.estAdj / 1e6) : 0; }), backgroundColor: cssVar('--series-2') + '73', borderRadius: 4, maxBarThickness: 26 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + c.parsed.y.toLocaleString('ko-KR') + '백만원'; } } } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { color: txt } }, y: { stacked: true, grid: { color: grid }, ticks: { color: txt, callback: function (v) { return v.toLocaleString('ko-KR'); } }, title: { display: true, text: '백만원', color: txt } } } }
    });
  }

  /* ---------- 이벤트 ---------- */
  $('pick').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function (e) { handleFiles(e.target.files); e.target.value = ''; });
  $('reset').addEventListener('click', function () { files = []; curQ = null; $('answer').innerHTML = ''; $('params').innerHTML = ''; refresh(); });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
  if (g.matchMedia) g.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (S) renderTrend(); });
})(typeof window !== 'undefined' ? window : globalThis);
