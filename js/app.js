/* 화면: 서버 연결(로그인·저장본 불러오기·저장) 또는 단독 실행(파일 직접 올리기) → 요약 / 질문 / 월별 추이 */
(function (g) {
  'use strict';
  var BM = g.BM, E = BM.engine, esc = BM.esc;
  function $(id) { return document.getElementById(id); }

  var files = [];                 // {name, kind, data, raw?}
  var S = null;                   // 현재 분석 상태
  var curQ = null, chart = null, useEst = true;
  var mode = 'standalone', role = null, dirty = false, serverMeta = null;
  var settings = { anchor: null };
  var lastVendorText = '', lastMonth = '', extra = {};
  var JSON_H = { 'Content-Type': 'application/json' };

  /* ---------- 서버 통신 ---------- */
  function api(path, opt) {
    opt = opt || {};
    var headers = { 'X-Requested-With': 'bm' };
    Object.keys(opt.headers || {}).forEach(function (k) { headers[k] = opt.headers[k]; });
    return fetch(path, { method: opt.method || 'GET', headers: headers, body: opt.body, credentials: 'same-origin' });
  }
  function logEvent(ev) { if (mode === 'server') api('/api/event', { method: 'POST', headers: JSON_H, body: JSON.stringify(ev) }).catch(function () { /* 로그 실패는 무시 */ }); }
  BM.saveAnchor = function (val) {
    settings.anchor = val;
    if (mode === 'server') api('/api/settings', { method: 'POST', headers: JSON_H, body: JSON.stringify({ anchor: val }) }).catch(function () { /* 저장 실패 시 이번 화면에서만 사용 */ });
    else { try { localStorage.setItem('bm-cash-anchor', JSON.stringify(val)); } catch (e) { /* 저장 불가 */ } }
  };

  /* ---------- 시작: 서버가 있으면 로그인, 없으면 단독 실행 ---------- */
  function boot() {
    // 서버가 없거나(파일로 직접 열었거나 단독 페이지) 응답이 JSON이 아니면 단독 실행으로 간다.
    // 화면 코드의 오류가 단독 실행으로 조용히 넘어가지 않도록 네트워크 실패만 따로 처리한다.
    if (g.location && g.location.protocol === 'file:') { enterStandalone(); return; }
    fetch('/api/me', { credentials: 'same-origin', headers: { 'X-Requested-With': 'bm' } }).then(function (res) {
      if ((res.headers.get('content-type') || '').indexOf('application/json') < 0) return 'none';
      if (res.status === 401) return 'login';
      return res.json().catch(function () { return 'none'; });
    }, function () { return 'none'; }).then(function (r) {
      if (r === 'none') enterStandalone();
      else if (r === 'login') { mode = 'server'; showLogin(); }
      else enterServer(r.role);
    });
  }

  function enterStandalone() {
    mode = 'standalone';
    try { settings.anchor = JSON.parse(localStorage.getItem('bm-cash-anchor') || 'null'); } catch (e) { settings.anchor = null; }
    $('drop').classList.remove('hidden');
    refresh();
  }

  function showLogin() {
    $('login').classList.remove('hidden'); $('drop').classList.add('hidden'); $('app').classList.add('hidden'); $('userbar').classList.add('hidden');
    $('loginpw').focus();
  }
  function doLogin() {
    var pw = $('loginpw').value;
    $('loginerr').textContent = '';
    api('/api/login', { method: 'POST', headers: JSON_H, body: JSON.stringify({ password: pw }) }).then(function (res) {
      if (res.status === 429) { $('loginerr').textContent = '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.'; return null; }
      if (!res.ok) { $('loginerr').textContent = '비밀번호가 맞지 않습니다.'; return null; }
      return res.json().then(function (j) { $('loginpw').value = ''; enterServer(j.role); });
    }).catch(function () { $('loginerr').textContent = '서버에 연결하지 못했습니다.'; });
  }

  function enterServer(r) {
    mode = 'server'; role = r;
    $('login').classList.add('hidden');
    $('userbar').classList.remove('hidden');
    $('who').textContent = (role === 'boss' ? '대표' : '경리') + ' 계정으로 접속 중';
    $('drop').classList.toggle('hidden', role !== 'accountant');
    $('reset').textContent = '저장본으로 되돌리기';
    loadServer();
  }

  function loadServer() {
    api('/api/dataset').then(function (res) {
      if (res.status === 204) { files = []; serverMeta = null; return null; }
      if (!res.ok) throw new Error('dataset');
      return res.json();
    }).then(function (j) {
      if (j) { files = j.files || []; serverMeta = j.meta || null; }
      dirty = false;
      return api('/api/settings').then(function (r) { return r.ok ? r.json() : {}; }).then(function (s) { settings = s && typeof s === 'object' ? s : {}; });
    }).then(function () { refresh(); }).catch(function () { $('msg').innerHTML = '<div class="callout bad">서버에서 데이터를 불러오지 못했습니다.</div>'; });
  }

  function logout() {
    api('/api/logout', { method: 'POST' }).catch(function () { /* 이미 만료 */ }).then(function () { files = []; S = null; curQ = null; role = null; $('answer').innerHTML = ''; $('params').innerHTML = ''; showLogin(); });
  }

  /* ---------- 업로드 / 저장 ---------- */
  function handleFiles(list) {
    var arr = Array.prototype.slice.call(list);
    Promise.all(arr.map(function (f) {
      return BM.readWorkbook(f).then(function (r) { r.name = f.name; r.raw = f; return r; }, function () { return { name: f.name, kind: null }; });
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
        '<br>분개장(ERP 내보내기), 거래내역 템플릿, 반입/반출 현황, 업체마스터 템플릿 형식만 지원합니다.</div>' : '';
      if (res.some(function (r) { return r.kind; })) dirty = true;
      refresh();
    });
  }

  function removeFile(name) {
    files = files.filter(function (f) { return f.name !== name && f.name !== name + ' (업체마스터)'; });
    dirty = true; refresh();
  }

  function saveToServer() {
    var btn = $('savebtn'); btn.disabled = true; $('saveerr').textContent = '';
    var payload = { files: files.map(function (f) { return { name: f.name, kind: f.kind, data: f.data }; }) };
    api('/api/dataset', { method: 'POST', headers: JSON_H, body: JSON.stringify(payload) }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 413 ? '파일이 너무 큽니다' : '저장 실패(' + res.status + ')');
      return res.json();
    }).then(function (j) {
      serverMeta = j.meta;
      var raws = files.filter(function (f) { return f.raw && !f.rawSent; });
      return raws.reduce(function (p, f) {
        return p.then(function () {
          return api('/api/upload?name=' + encodeURIComponent(f.raw.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f.raw }).then(function (r) { if (r.ok) f.rawSent = true; });
        });
      }, Promise.resolve());
    }).then(function () { dirty = false; btn.disabled = false; renderServerBar(); })
      .catch(function (e) { btn.disabled = false; $('saveerr').textContent = '저장하지 못했습니다: ' + e.message; });
  }

  function renderServerBar() {
    if (mode !== 'server') { $('serverinfo').innerHTML = ''; $('savebar').classList.add('hidden'); return; }
    var info = serverMeta ? '서버 저장본: ' + esc(new Date(serverMeta.savedAt).toLocaleString('ko-KR')) + ' · ' + (serverMeta.savedBy === 'boss' ? '대표' : '경리') + ' 저장 · 파일 ' + serverMeta.fileCount + '개 (버전 ' + serverMeta.version + ')' : '서버에 저장된 데이터가 없습니다.' + (role === 'boss' ? ' 경리 담당자가 파일을 올려 저장해야 질문할 수 있습니다.' : ' 파일을 올린 뒤 "서버에 저장"을 누르세요.');
    $('serverinfo').innerHTML = '<div class="asof">' + info + '</div>';
    $('savebar').classList.toggle('hidden', !(role === 'accountant' && dirty));
  }

  /* ---------- 화면 갱신 ---------- */
  function refresh() {
    renderChips();
    renderServerBar();
    S = E.build(files);
    if (!S) { $('app').classList.add('hidden'); return; }
    $('app').classList.remove('hidden');
    renderSummary(); renderQuestionList(); renderTrend();
    if (curQ) selectQ(curQ.id, null, 'refresh');
  }

  function renderChips() {
    var cnt = function (k) { return files.filter(function (f) { return f.kind === k; }).length; };
    [['chip-j', 'journal'], ['chip-t', 'trades'], ['chip-v', 'vendors']].forEach(function (p) { $(p[0]).classList.toggle('on', cnt(p[1]) > 0); });
    $('chip-j').textContent = '분개장' + (cnt('journal') ? ' ' + cnt('journal') + '개' : '');
    var canEdit = mode === 'standalone' || role === 'accountant';
    $('loaded').innerHTML = files.filter(function (f) { return f.kind !== 'vendors' || f.name.indexOf('(업체마스터)') < 0; }).map(function (f) {
      return '<span class="file">' + esc(f.name) + (canEdit ? ' <button class="x" data-name="' + esc(f.name) + '" title="이 파일 빼기">×</button>' : '') + '</span>';
    }).join('');
    Array.prototype.forEach.call($('loaded').querySelectorAll('button.x'), function (b) { b.addEventListener('click', function () { removeFile(b.getAttribute('data-name')); }); });
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
    $('qlist').innerHTML = BM.questions.filter(function (q) { return !q.hidden; }).map(function (q) { return '<button class="qchip' + (curQ && curQ.id === q.id ? ' on' : '') + '" data-q="' + q.id + '">' + esc(q.label) + '</button>'; }).join('');
    Array.prototype.forEach.call($('qlist').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { $('understood').textContent = ''; selectQ(b.getAttribute('data-q'), null, 'chip'); });
    });
  }

  /* preset: {vendorText, month, acct} 가 있으면 그 값으로 채우고, 없으면 직전 값을 이어서 쓴다 */
  function selectQ(id, preset, source) {
    curQ = E.question(id);
    renderQuestionList();
    var needs = curQ.needs, h = '';
    var months = S.m.months.slice().reverse(), defM = S.m.asOf.slice(0, 7);
    if (preset) { lastVendorText = preset.vendorText || ''; lastMonth = preset.month || defM; extra = { days: preset.days, topN: preset.topN, view: preset.view, focus: preset.focus, baseMonth: preset.baseMonth }; }
    else if (source === 'chip') extra = {};
    if (source === 'chip') logEvent({ type: 'ask', source: 'chip', id: id });
    if (needs.indexOf('vendor') >= 0 || needs.indexOf('vendor?') >= 0) {
      h += '<label>업체 <input id="p-vendor" list="vlist" placeholder="' + (needs.indexOf('vendor?') >= 0 ? '비워 두면 전체' : '업체명 입력') + '" value="' + esc(lastVendorText) + '"></label>' +
        '<datalist id="vlist">' + S.vendorKeys.map(function (k) { return '<option value="' + esc(S.m.vendorName(k)) + '">'; }).join('') + '</datalist>';
    }
    if (needs.indexOf('days?') >= 0) h += '<label>며칠 넘은 것만 <input id="p-days" type="number" min="0" style="width:5em" value="' + esc(extra.days || '') + '" placeholder="전체"></label>';
    if (needs.indexOf('topn?') >= 0) h += '<label>상위 몇 곳 <input id="p-topn" type="number" min="1" max="50" style="width:4em" value="' + esc(extra.topN || '') + '" placeholder="5"></label>';
    if (needs.indexOf('month') >= 0 || needs.indexOf('month?') >= 0) h += '<label>월 <select id="p-month">' + months.map(function (x) { return '<option value="' + x + '"' + (x === (lastMonth || defM) ? ' selected' : '') + '>' + BM.ymLabel(x) + '</option>'; }).join('') + '</select></label>';
    if (needs.indexOf('acct') >= 0 || needs.indexOf('acct?') >= 0) h += '<label>비용 항목 <select id="p-acct"></select></label>';
    $('params').innerHTML = h;
    if ($('p-acct')) { fillAcct(); if (preset && preset.acct) $('p-acct').value = preset.acct; }
    Array.prototype.forEach.call($('params').querySelectorAll('input,select'), function (el) {
      el.addEventListener('change', function () { if (el.id === 'p-month' && $('p-acct')) fillAcct(); runQ(); });
    });
    runQ();
  }
  function fillAcct() {
    var ym = $('p-month').value, e = BM.expenseByAcct(S.m, ym);
    var keys = Object.keys(e).sort(function (a, b) { return e[b].amt - e[a].amt; });
    var prev = $('p-acct').value;
    var opt = curQ.needs.indexOf('acct?') >= 0 ? '<option value="">전체 (항목별 비교)</option>' : '';
    $('p-acct').innerHTML = opt + keys.map(function (k) { return '<option value="' + esc(k) + '"' + (k === prev ? ' selected' : '') + '>' + esc(k) + ' (' + BM.mil(e[k].amt) + '백만)</option>'; }).join('');
  }

  function runQ() {
    var p = { view: extra.view, focus: extra.focus, baseMonth: extra.baseMonth };
    if ($('p-days')) p.days = +$('p-days').value || null;
    if ($('p-topn')) p.topN = +$('p-topn').value || null;
    if ($('p-month')) { p.month = $('p-month').value; lastMonth = p.month; }
    if ($('p-acct')) p.acct = $('p-acct').value;
    if ($('p-vendor')) { lastVendorText = $('p-vendor').value; p.vendorText = lastVendorText; }
    var res;
    try { res = E.run(S, curQ.id, p, { useEst: useEst, anchor: settings.anchor, canEditAnchor: mode === 'standalone' || role === 'accountant' }); }
    catch (e) { $('answer').innerHTML = '<div class="callout bad">이 질문을 계산하는 중 오류가 났습니다: ' + esc(e.message) + '</div>'; return; }
    if (res.error === 'vendor-required') { $('answer').innerHTML = '<div class="hint">업체를 입력하거나 목록에서 고르세요.</div>'; return; }
    if (res.error === 'acct-required') { $('answer').innerHTML = '<div class="hint">비용 항목을 고르세요.</div>'; return; }
    if (res.error === 'vendor-not-found') { $('answer').innerHTML = '<div class="callout warn">"' + esc(res.text) + '"과(와) 일치하는 업체를 찾지 못했습니다.</div>'; return; }
    if (res.error) { $('answer').innerHTML = '<div class="callout bad">질문을 처리하지 못했습니다.</div>'; return; }
    var cls = res.status === '확정' ? 'fixed' : res.status === '잠정' ? 'prov' : 'est';
    var meta = '<div class="meta"><span class="st ' + cls + '">' + res.status + '</span> 기준일 ' + esc(res.asOf) + ' · 근거: ' + esc(res.source) +
      (res.warnings.length ? '<div class="metawarn">데이터 경고: ' + res.warnings.map(esc).join(' / ') + '</div>' : (res.warnTotal ? '<div class="metanote">데이터 점검 ' + res.warnTotal + '건이 있습니다. 위 요약에서 확인하세요.</div>' : '')) + '</div>';
    $('answer').innerHTML = '<div class="card ans">' + meta + '<div class="headline">' + esc(res.answer.headline) + '</div>' + (res.answer.body || '') +
      (res.notes.length ? '<ul class="notes">' + res.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    if (res.answer.after) res.answer.after($('answer'), runQ);
  }

  /* 자연어 질문: 문장에서 질문 종류·업체·월·항목을 뽑아 같은 질문 화면으로 연결한다 */
  function ask(text) {
    text = text.trim();
    if (!text || !S) return;
    var r = BM.nl.parse(text, E.nlContext(S));
    if (r && r.unknownVendor) {
      $('understood').textContent = '';
      $('answer').innerHTML = '<div class="callout warn">"' + esc(r.unknownVendor) + '"과(와) 일치하는 업체를 찾지 못했습니다. 업체 이름을 다시 확인해 주세요.</div>';
      logEvent({ type: 'ask', source: 'nl', id: r.id, text: text.slice(0, 200) });
      return;
    }
    if (!r) {
      $('understood').textContent = '';
      $('answer').innerHTML = '<div class="callout warn">질문을 이해하지 못했습니다. 아래 질문 중에서 고르거나, 업체명과 월을 넣어 다시 물어보세요. (예: "○○환경 이번 달 줄 돈 얼마야?")</div>';
      logEvent({ type: 'ask', source: 'nl', id: null, text: text.slice(0, 200) });
      return;
    }
    var q = E.question(r.id), parts = [q.label];
    if (r.vendor) parts.push('업체: ' + r.vendor.name);
    if (r.month) parts.push('월: ' + BM.ymLabel(r.month));
    if (r.acct) parts.push('항목: ' + r.acct);
    $('understood').textContent = '이렇게 이해했습니다 → ' + parts.join(' · ') + ' (틀리면 아래에서 바꾸세요)';
    logEvent({ type: 'ask', source: 'nl', id: r.id, text: text.slice(0, 200) });
    selectQ(r.id, { vendorText: r.vendor ? r.vendor.name : '', month: r.month, acct: r.acct, days: r.days, topN: r.topN, view: r.view, focus: r.focus, baseMonth: r.baseMonth }, 'nl');
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
  $('reset').addEventListener('click', function () {
    if (mode === 'server') { loadServer(); return; }
    files = []; curQ = null; $('answer').innerHTML = ''; $('params').innerHTML = ''; $('understood').textContent = ''; refresh();
  });
  $('askform').addEventListener('submit', function (e) { e.preventDefault(); ask($('askq').value); });
  $('loginform').addEventListener('submit', function (e) { e.preventDefault(); doLogin(); });
  $('logout').addEventListener('click', logout);
  $('savebtn').addEventListener('click', saveToServer);
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
  if (g.matchMedia) g.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (S) renderTrend(); });
  boot();
})(typeof window !== 'undefined' ? window : globalThis);
