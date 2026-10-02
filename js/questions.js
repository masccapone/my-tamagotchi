/* 질문 → 한 줄 답 + 근거 표. 숫자는 모두 분석 모듈이 계산하고, 여기서는 문장과 표만 만든다. */
(function (g) {
  'use strict';
  var BM = g.BM, esc = BM.esc;

  function tbl(head, rows, right) {
    right = right || [];
    var h = '<tr>' + head.map(function (x, i) { return '<th' + (right.indexOf(i) >= 0 ? ' class="r"' : '') + '>' + esc(x) + '</th>'; }).join('') + '</tr>';
    var b = rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) { return '<td' + (right.indexOf(i) >= 0 ? ' class="r"' : '') + '>' + c + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="tablewrap"><table>' + h + b + '</table></div>';
  }
  BM.tbl = tbl;
  function neg(x, text) { return x < 0 ? '<span class="neg">' + text + '</span>' : text; }
  function monthRange(ym) {
    var y = +ym.slice(0, 4), mo = +ym.slice(5);
    return { s: Date.UTC(y, mo - 1, 1), e: Date.UTC(y, mo, 0) };
  }
  function short(s, n) { s = s || ''; return s.length > n ? s.slice(0, n) + '…' : s; }

  var Q = BM.questions = [];

  /* 1. 업체에 이번 달 얼마, 언제 줘야 하나 */
  Q.push({ id: 'q1', label: '이 업체에 이번 달 얼마, 언제 줘야 해?', needs: ['vendor', 'month'], run: function (c) {
    var v = c.ap.vendors.filter(function (x) { return x.key === c.vk; })[0];
    if (!v || (v.open <= 0 && !v.opening)) return { headline: c.vname + '에 줄 미지급금이 없습니다 (' + BM.fmtAsOf(c) + ' 기준).', body: '', notes: [] };
    var r = monthRange(c.month), due = 0, over = 0, later = 0;
    var rows = v.lots.map(function (l) {
      var st;
      if (l.expT < r.s) { over += l.amt; st = '<span class="badge bad">기한 경과</span>'; }
      else if (l.expT <= r.e) { due += l.amt; st = '<span class="badge warn">이번 달 도래</span>'; }
      else { later += l.amt; st = '이후'; }
      return [l.iso, esc(short(l.memo, 40)), BM.won(l.amt), l.expIso, st];
    });
    var notes = ['예정일은 "' + v.paySrc + '" 기준으로 추정한 값입니다. 계약상 기한이나 실제 지급 결정과 다를 수 있습니다.'];
    if (v.opening) notes.push('이 업체는 이전 연도 기초 잔액이 분개장에 없어 잔액을 정확히 계산할 수 없습니다.');
    return {
      headline: c.vname + ': 미지급금 잔액 ' + BM.won(v.open) + '. ' + BM.ymLabel(c.month) + ' 도래 ' + BM.won(due) + (over ? ', 이미 기한이 지난 금액 ' + BM.won(over) : '') + (later ? ', 이후 ' + BM.won(later) : '') + '.',
      body: tbl(['발생일', '적요', '금액', '예상 지급일', '상태'], rows, [2]), notes: notes };
  } });

  /* 2. 업체 돈 들어왔어? */
  Q.push({ id: 'q2', label: '이 업체 이번 달에 돈 들어왔어?', needs: ['vendor?', 'month'], run: function (c) {
    var r = monthRange(c.month);
    var rows = BM.cashRows(c.m).filter(function (x) { return x.ym === c.month && x.dr > 0 && x.vk; });
    var notes = ['분개장 입력 기준입니다. 실제 입금일과 전표 입력일 사이에 시차가 있을 수 있습니다.'];
    if (!c.vk) {
      var by = {};
      rows.forEach(function (x) { var b = by[x.vk] = by[x.vk] || { amt: 0, n: 0 }; b.amt += x.dr - x.cr; b.n++; });
      var list = Object.keys(by).map(function (k) { return { k: k, b: by[k] }; }).sort(function (a, b) { return b.b.amt - a.b.amt; }).slice(0, 15);
      return { headline: BM.ymLabel(c.month) + ' 입금이 확인된 업체 ' + Object.keys(by).length + '곳, 합계 ' + BM.won(BM.sum(list, function (x) { return x.b.amt; })) + ' (상위 15곳).',
        body: tbl(['업체', '입금 건수', '입금액'], list.map(function (x) { return [esc(c.m.vendorName(x.k)), x.b.n, BM.won(x.b.amt)]; }), [1, 2]), notes: notes };
    }
    var mine = rows.filter(function (x) { return x.vk === c.vk; });
    var ar = c.ar.vendors.filter(function (x) { return x.key === c.vk; })[0];
    if (!mine.length) {
      return { headline: c.vname + ': ' + BM.ymLabel(c.month) + ' 입금 기록이 없습니다.' + (ar && ar.open > 0 ? ' 현재 미수금 ' + BM.won(ar.open) + '이 남아 있습니다.' : ''), body: '', notes: notes };
    }
    var tot = BM.sum(mine, function (x) { return x.dr - x.cr; });
    return { headline: c.vname + ': ' + BM.ymLabel(c.month) + ' 입금 ' + mine.length + '건, 합계 ' + BM.won(tot) + ' (마지막 입금 ' + mine[mine.length - 1].date + ').' + (ar && ar.open > 0 ? ' 남은 미수금 ' + BM.won(ar.open) + '.' : ''),
      body: tbl(['일자', '적요', '금액'], mine.map(function (x) { return [x.date, esc(short(x.memo, 50)), BM.won(x.dr - x.cr)]; }), [2]), notes: notes };
  } });

  /* 3. 이번 달 나갈 돈과 들어올 돈 */
  Q.push({ id: 'q3', label: '이번 달에 나갈 돈과 들어올 돈이 얼마야?', needs: ['month'], run: function (c) {
    var r = monthRange(c.month);
    function agg(items) {
      var due = 0, over = 0, list = [];
      items.vendors.forEach(function (v) {
        var d = 0, o = 0;
        v.lots.forEach(function (l) { if (l.expT < r.s) o += l.amt; else if (l.expT <= r.e) d += l.amt; });
        due += d; over += o;
        if (d + o > 0) list.push({ name: v.name, d: d, o: o, src: v.paySrc });
      });
      list.sort(function (a, b) { return (b.d + b.o) - (a.d + a.o); });
      return { due: due, over: over, list: list.slice(0, 8) };
    }
    var ar = agg(c.ar), ap = agg(c.ap);
    function t(a) { return tbl(['업체', '이번 달 도래', '기한 경과', '예상 근거'], a.list.map(function (x) { return [esc(x.name), BM.won(x.d), BM.won(x.o), esc(x.src)]; }), [1, 2]); }
    return {
      headline: BM.ymLabel(c.month) + ' 들어올 돈 ' + BM.won(ar.due) + ' (기한 경과 ' + BM.won(ar.over) + ' 별도), 나갈 돈 ' + BM.won(ap.due) + ' (기한 경과 ' + BM.won(ap.over) + ' 별도).',
      body: '<h4>들어올 돈 (매출채권) 상위</h4>' + t(ar) + '<h4>나갈 돈 (미지급금) 상위</h4>' + t(ap),
      notes: ['예정일은 업체마스터의 결제기한 또는 과거 결제 이력 평균으로 추정한 값입니다. 실제 지급은 내부 결정에 따릅니다.', '미지급금에는 카드대금·4대보험 등 거래처가 아닌 항목도 포함됩니다.'] };
  } });

  /* 4. 이 비용은 뭐야 */
  Q.push({ id: 'q4', label: '이 비용은 뭐야?', needs: ['month', 'acct'], run: function (c) {
    var rows = c.m.rows.filter(function (x) {
      return x.ym === c.month && (x.cls === 'prod' || x.cls === 'sga' || x.cls === 'nonop_out') && x.acct.replace(/\((제|도|분|판)\)$/, '') === c.acct && !(x.closing && x.cr > 0 && x.dr === 0);
    });
    if (!rows.length) return { headline: BM.ymLabel(c.month) + ' ' + c.acct + ' 내역이 없습니다.', body: '', notes: [] };
    var tot = BM.sum(rows, function (x) { return x.dr - x.cr; });
    var by = {}; rows.forEach(function (x) { var k = x.vk || '(거래처 없음)'; by[k] = (by[k] || 0) + x.dr - x.cr; });
    var top = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, 3).map(function (k) { return (k === '(거래처 없음)' ? k : c.m.vendorName(k)) + ' ' + BM.won(by[k]); });
    var sorted = rows.slice().sort(function (a, b) { return Math.abs(b.dr - b.cr) - Math.abs(a.dr - a.cr); }).slice(0, 15);
    return { headline: BM.ymLabel(c.month) + ' ' + c.acct + ': 합계 ' + BM.won(tot) + ' (' + rows.length + '건). 큰 거래처: ' + top.join(', ') + '.',
      body: tbl(['일자', '거래처', '적요', '금액'], sorted.map(function (x) { return [x.date, esc(c.m.vendorName(x.vk)), esc(short(x.memo, 50)), BM.won(x.dr - x.cr)]; }), [3]),
      notes: ['금액이 큰 순서로 최대 15건입니다. 계정과목·거래처·적요는 전표 입력 내용 그대로입니다.'] };
  } });

  /* 5. 이번 달 왜 이렇게 많이 나갔어 */
  Q.push({ id: 'q5', label: '이 비용은 이번 달에 왜 이렇게 많이 나갔어?', needs: ['month', 'acct?'], run: function (c) {
    var idx = c.m.months.indexOf(c.month), prev = c.m.months.slice(Math.max(0, idx - 3), idx);
    if (!prev.length) return { headline: '비교할 이전 달 데이터가 없습니다.', body: '', notes: [] };
    var lumpy = /감가상각|퇴직|충당/;
    if (c.acct) {
      var series = c.m.months.slice(Math.max(0, idx - 5), idx + 1).map(function (ym) { var e = BM.expenseByAcct(c.m, ym)[c.acct]; return { ym: ym, a: e ? e.amt : 0 }; });
      var cur = series[series.length - 1].a, bs = series.slice(0, -1).filter(function (x) { return prev.indexOf(x.ym) >= 0; });
      var avg = bs.length ? BM.sum(bs, function (x) { return x.a; }) / bs.length : 0;
      var rows = c.m.rows.filter(function (x) { return x.ym === c.month && (x.cls === 'prod' || x.cls === 'sga' || x.cls === 'nonop_out') && x.acct.replace(/\((제|도|분|판)\)$/, '') === c.acct && !(x.closing && x.cr > 0 && x.dr === 0); })
        .sort(function (a, b) { return Math.abs(b.dr - b.cr) - Math.abs(a.dr - a.cr); }).slice(0, 8);
      return { headline: c.acct + ': ' + BM.ymLabel(c.month) + ' ' + BM.won(cur) + '으로 직전 ' + bs.length + '개월 평균(' + BM.won(avg) + ')보다 ' + BM.won(Math.abs(cur - avg)) + (cur >= avg ? ' 많습니다.' : ' 적습니다.'),
        body: '<h4>월별 추이</h4>' + tbl(['월', '금액'], series.map(function (x) { return [BM.ymLabel(x.ym), BM.won(x.a)]; }), [1]) +
          '<h4>이번 달 큰 거래</h4>' + tbl(['일자', '거래처', '적요', '금액'], rows.map(function (x) { return [x.date, esc(c.m.vendorName(x.vk)), esc(short(x.memo, 45)), BM.won(x.dr - x.cr)]; }), [3]),
        notes: lumpy.test(c.acct) ? ['이 항목은 분기·반기에 한 번 반영되는 경우가 많아 달마다 들쭉날쭉합니다.'] : [] };
    }
    var curE = BM.expenseByAcct(c.m, c.month), base = {};
    prev.forEach(function (ym) { var e = BM.expenseByAcct(c.m, ym); Object.keys(e).forEach(function (k) { base[k] = (base[k] || 0) + e[k].amt / prev.length; }); });
    var keys = {}; Object.keys(curE).concat(Object.keys(base)).forEach(function (k) { if (!lumpy.test(k)) keys[k] = 1; });
    var list = Object.keys(keys).map(function (k) { var a = curE[k] ? curE[k].amt : 0, b = base[k] || 0; return { k: k, a: a, b: b, d: a - b }; }).sort(function (x, y) { return y.d - x.d; });
    var totA = BM.sum(list, function (x) { return x.a; }), totB = BM.sum(list, function (x) { return x.b; });
    var up = list.filter(function (x) { return x.d > 0; }).slice(0, 8);
    return { headline: BM.ymLabel(c.month) + ' 비용(감가상각·퇴직급여 제외) ' + BM.won(totA) + '은 직전 ' + prev.length + '개월 평균(' + BM.won(totB) + ')보다 ' + BM.won(Math.abs(totA - totB)) + (totA >= totB ? ' 많습니다.' : ' 적습니다.') + (up.length ? ' 가장 늘어난 항목: ' + up.slice(0, 3).map(function (x) { return x.k + ' +' + BM.won(x.d); }).join(', ') + '.' : ''),
      body: tbl(['항목', BM.ymLabel(c.month), '직전 평균', '증감'], up.map(function (x) { return [esc(x.k), BM.won(x.a), BM.won(x.b), BM.won(x.d)]; }), [1, 2, 3]),
      notes: ['분기·반기에 한 번 반영되는 감가상각비·퇴직급여·충당부채는 비교에서 제외했습니다. 특정 항목이 궁금하면 위에서 비용 항목을 고르세요.'] };
  } });

  /* 6. 이번 달 이익 */
  Q.push({ id: 'q6', label: '이번 달 이익(손실)이 얼마야?', needs: ['month'], run: function (c) {
    var b = c.pl.filter(function (x) { return x.ym === c.month; })[0];
    if (!b) return { headline: '해당 월 데이터가 없습니다.', body: '', notes: [] };
    var notes = [], useEst = c.useEst !== false && b.estAdj > 0, est = c.pl.estimate;
    b.flags.forEach(function (f) {
      if (f.k === 'cogs') notes.push('이 달은 손익계산서의 매출원가가 아직 결산되지 않아 "장부 손익"이 실제보다 좋게 보입니다.');
      if (f.k === 'drop') notes.push('이 달 매출이 다른 달에 비해 매우 적습니다. 매출 전표가 아직 다 입력되지 않았을 수 있습니다.');
      if (f.k === 'partial') notes.push('아직 진행 중인 달이라 숫자가 확정이 아닙니다.');
    });
    var eq = useEst ? (est.quarters || []).filter(function (x) { return x.q === BM.qOf(c.month); })[0] : null;
    var estTable = '';
    if (eq) {
      notes.push('"결산성 비용 예상"은 분기 말에 입력되는 비용이 아직 없는 분기를 직전 결산 분기(' + est.basis.map(function (x) { return x.replace('Q', '년 '); }).join(', ') + '분기) 평균으로 추정해 그 분기의 달에 균등하게 나눈 값입니다. 실제 결산 전표가 입력되면 자동으로 확정 숫자로 바뀝니다.');
      estTable = '<h4>결산성 비용 예상 내역 (' + eq.q.replace('Q', '년 ') + '분기)</h4>' + tbl(['항목', '직전 결산 분기 평균', '이미 반영', '예상 추가', '신뢰도'], Object.keys(eq.missing).map(function (k) {
        return [esc(k), BM.won(est.perQuarter[k] || 0), BM.won(eq.booked[k] || 0), BM.won(eq.missing[k]), est.confidence[k] || '높음'];
      }), [1, 2, 3]);
      if (est.backtest) {
        var bt = est.backtest, pct = function (x) { return x == null ? '산정 불가' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; };
        notes.push('과거 검증: ' + bt.actualQ.replace('Q', '년 ') + '분기를 ' + bt.basisQ.replace('Q', '년 ') + '분기 값으로 추정했다면 감가상각·퇴직급여·충당부채·주식보상 합계 오차는 ' + pct(bt.core.err) + ', 이자 정산은 ' + pct(bt.interest.err) + '였습니다. 이자는 오차가 커서 범위로 표시합니다.');
      }
    }
    var rng = function (lo, hi) { return BM.won(lo) + ' ~ ' + BM.won(hi); };
    var bridge = [
      ['장부 손익 (손익계산서)', BM.won(b.plBook), '<span class="st fixed">확정</span>', '전표와 결산 전표를 그대로 반영한 값'],
      ['원가 시점 조정', BM.won(b.plIncurred - b.plBook), '<span class="st fixed">확정</span>', '분기 말에 한꺼번에 대체되는 제조원가를 발생한 달에 반영'],
      ['= 발생비용 기준 손익', BM.won(b.plIncurred), '<span class="st prov">잠정</span>', '아직 입력되지 않은 결산성 비용 제외']
    ];
    if (eq) {
      bridge.push(['결산성 비용 예상 추가', BM.won(-b.estAdj), '<span class="st est">추정</span>', '감가상각·퇴직급여·이자 정산 등. 범위 ' + rng(-b.estAdjHigh, -b.estAdjLow)]);
      bridge.push(['= 관리용 추정 손익', BM.won(b.plEst), '<span class="st est">추정</span>', '범위 ' + rng(b.plEstLow, b.plEstHigh)]);
    }
    var shown = useEst ? b.plEst : b.plIncurred;
    var head = BM.ymLabel(c.month) + ' 손익: ' + (useEst ? '관리용 추정 약 ' + BM.won(b.plEst) + ' (범위 ' + rng(b.plEstLow, b.plEstHigh) + '), 장부 손익 ' + BM.won(b.plBook) : '발생비용 기준 ' + BM.won(b.plIncurred) + ', 장부 손익 ' + BM.won(b.plBook)) + '.';
    var last = c.pl.slice(-7);
    return { headline: head, status: useEst ? '추정' : (b.flags.some(function (f) { return f.k === 'partial' || f.k === 'drop'; }) ? '잠정' : '잠정'),
      body: '<div class="tiles">' + tile('매출', BM.won(b.rev)) + tile('발생비용', BM.won(b.incurred), '제조원가 ' + BM.eok(b.prod) + ' · 판관비 ' + BM.eok(b.sga) + ' · 영업외 ' + BM.eok(b.nonopOut)) + tile(useEst ? '관리용 추정 손익' : '발생비용 기준 손익', neg(shown, BM.won(shown))) + '</div>' +
        '<h4>장부 손익에서 관리용 추정 손익까지</h4>' + tbl(['단계', '금액', '구분', '설명'], bridge, [1]) + estTable +
        '<h4>최근 월별</h4>' + tbl(['월', '매출', '발생비용', '발생비용 기준', '관리용 추정', '장부 손익', '점검'], last.map(function (x) { return [BM.ymLabel(x.ym), BM.won(x.rev), BM.won(x.incurred), neg(x.plIncurred, BM.won(x.plIncurred)), neg(x.plEst, BM.won(x.plEst)), neg(x.plBook, BM.won(x.plBook)), x.flags.map(function (f) { return '<span class="badge warn">' + esc(f.t) + '</span>'; }).join('')]; }), [1, 2, 3, 4, 5]),
      notes: notes };
  } });

  /* 7. 줄일 수 있는 비용 */
  Q.push({ id: 'q7', label: '지금 줄일 수 있는 비용 항목이 뭐가 있을까?', needs: ['month'], run: function (c) {
    var idx = c.m.months.indexOf(c.month), ms = c.m.months.slice(Math.max(0, idx - 2), idx + 1);
    var acc = {};
    ms.forEach(function (ym) { var e = BM.expenseByAcct(c.m, ym); Object.keys(e).forEach(function (k) { acc[k] = (acc[k] || 0) + e[k].amt / ms.length; }); });
    var hard = /감가상각|이자|퇴직|급여|상여|세금|리스|충당/;
    var list = Object.keys(acc).map(function (k) { return { k: k, a: acc[k], hard: hard.test(k) }; }).sort(function (a, b) { return b.a - a.a; });
    var cand = list.filter(function (x) { return !x.hard && x.a > 0; }).slice(0, 8);
    var fixed = list.filter(function (x) { return x.hard && x.a > 0; }).slice(0, 5);
    return { headline: '최근 ' + ms.length + '개월 월평균 기준, 금액이 큰 비용 항목은 ' + cand.slice(0, 3).map(function (x) { return x.k + ' ' + BM.won(x.a); }).join(', ') + ' 순입니다.',
      body: '<h4>검토 후보 (월평균)</h4>' + tbl(['항목', '월평균'], cand.map(function (x) { return [esc(x.k), BM.won(x.a)]; }), [1]) +
        '<h4>줄이기 어려운 항목 (감가상각·이자·인건비 등)</h4>' + tbl(['항목', '월평균'], fixed.map(function (x) { return [esc(x.k), BM.won(x.a)]; }), [1]),
      notes: ['금액 순위일 뿐 절감 가능 여부를 판단한 것이 아닙니다. "이 비용은 뭐야?"에서 거래처·적요를 확인한 뒤 계약·운영 사정에 맞게 판단하세요.'] };
  } });

  /* 8. BEP */
  Q.push({ id: 'q8', label: '이익으로 전환하려면 매출이 얼마나 더 필요해?', needs: [], run: function (c) {
    var b = BM.bep(c.m, c.pl, c.bepMonths, c.useEst);
    var n = b.n || 1;
    if (!b.n || b.R <= 0) return { headline: '손익분기를 계산할 기간 데이터가 부족합니다.', body: '', notes: b.notes };
    var notes = b.notes.slice();
    notes.push('계산 기간: ' + c.bepMonths.map(function (x) { return BM.ymLabel(x); }).join(', ') + ' (거래내역이 있고 분개장이 마감된 달).');
    if (b.bepRev == null) return { headline: '변동비가 매출의 ' + (b.V / b.R * 100).toFixed(0) + '%라 공헌이익률이 낮아 손익분기점을 계산할 수 없습니다.', body: '', notes: notes };
    function bepWith(F, cmr) { return cmr > 0.05 ? F / cmr : null; }
    var sens = [
      ['현재', b.F, b.cmr],
      ['고정비 10% 절감', b.F * 0.9, b.cmr],
      ['변동비율 5%p 절감', b.F, b.cmr + 0.05],
      ['매출 단가 5% 인상', b.F, (b.R * 1.05 - b.V) / (b.R * 1.05)]
    ].map(function (x) { var v = bepWith(x[1], x[2]); return [x[0], v ? BM.eok(v / n) : '-', v ? BM.eok(v / n - b.R / n) : '-']; });
    return { headline: '손익분기 매출은 월 ' + BM.eok(b.bepRev / n) + ', 현재 월 평균 ' + BM.eok(b.R / n) + ' → 달성률 ' + (b.achieve * 100).toFixed(0) + '%, 월 ' + BM.eok(Math.max(0, b.gap) / n) + ' 더 필요합니다.',
      body: '<div class="tiles">' + tile('월 평균 매출', BM.eok(b.R / n)) + tile('월 평균 고정비', BM.eok(b.F / n)) + tile('변동비율', (b.V / b.R * 100).toFixed(0) + '%', '공헌이익률 ' + (b.cmr * 100).toFixed(0) + '%') + '</div>' +
        '<h4>비용·단가를 바꾸면 (월 기준)</h4>' + tbl(['시나리오', '손익분기 매출', '현재 대비 추가 필요'], sens, [1, 2]),
      notes: notes };
  } });

  /* 9. 현재 통장 잔액 */
  Q.push({ id: 'q9', label: '우리 현재 현금이 얼마나 있어? (통장 잔액)', needs: ['cash'], run: function (c) {
    var rows = BM.cashRows(c.m);
    var by = {};
    rows.forEach(function (x) { var k = x.vendor || '(미지정)'; by[k] = (by[k] || 0) + x.dr - x.cr; });
    var anchor = c.anchor, notes = ['분개장에는 기초 잔액이 없어서 증감만 알 수 있습니다. 기준일의 실제 통장 잔액을 한 번 입력하면 그 이후 증감을 반영해 계산합니다.'];
    var head, body = '';
    if (anchor && anchor.date && isFinite(anchor.amt)) {
      var mv = BM.sum(rows.filter(function (x) { return x.date > anchor.date; }), function (x) { return x.dr - x.cr; });
      head = BM.fmtAsOf(c) + ' 기준 추정 통장 잔액 ' + BM.won(anchor.amt + mv) + ' (기준일 ' + anchor.date + ' 잔액 ' + BM.won(anchor.amt) + ' + 이후 증감 ' + BM.won(mv) + ').';
    } else {
      head = '기준 잔액이 없어 현재 잔액은 계산하지 못했습니다. 분개장 기간 중 보통예금 증감은 ' + BM.won(BM.sum(rows, function (x) { return x.dr - x.cr; })) + '입니다.';
    }
    var edit = c.canEditAnchor !== false;
    body = (edit ? '<div class="row"><label>기준일 <input type="date" id="anchor-date" value="' + esc(anchor ? anchor.date : '') + '"></label><label>잔액(원) <input type="text" id="anchor-amt" value="' + esc(anchor && isFinite(anchor.amt) ? anchor.amt : '') + '" placeholder="예: 350000000"></label><button class="btn small" id="anchor-save">저장</button></div>' : '<div class="hint">기준 잔액은 경리 담당자가 입력합니다.</div>') +
      '<h4>계좌별 증감</h4>' + tbl(['계좌', '분개장 기간 증감'], Object.keys(by).map(function (k) { return [esc(k), BM.won(by[k])]; }), [1]);
    return { headline: head, body: body, notes: notes, after: function (root, rerun) {
      var btn = root.querySelector('#anchor-save');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var d = root.querySelector('#anchor-date').value, a = BM.num(root.querySelector('#anchor-amt').value);
        var val = { date: d, amt: a };
        if (BM.saveAnchor) BM.saveAnchor(val);
        else { try { localStorage.setItem('bm-cash-anchor', JSON.stringify(val)); } catch (e) { /* 저장 불가 시 이번 화면에서만 사용 */ } }
        c.anchor = val; rerun();
      });
    } };
  } });

  /* 10. 단가 */
  Q.push({ id: 'q10', label: '이 업체 단가가 얼마고, 지금 그대로 들어오고 있어?', needs: ['vendor'], run: function (c) {
    if (!c.m.trades) return { headline: '단가는 거래내역 파일이 있어야 확인할 수 있습니다.', body: '', notes: ['거래내역 템플릿을 작성해 올려주세요.'] };
    var up = BM.unitPrices(c.m, c.vk), keys = Object.keys(up);
    if (!keys.length) return { headline: c.vname + '의 거래내역이 없습니다.', body: '', notes: [] };
    var lines = [], rows = [];
    keys.forEach(function (k) {
      var o = up[k], s = o.series.slice(-6);
      var cur = o.latest;
      lines.push((o.flow === '매출' ? '받는 ' : '주는 ') + o.kind + ' ' + BM.fmtN(cur.avg, 1) + '원/' + (o.unit || '단위') + (o.changed ? ' (최근 변동)' : ''));
      rows.push([o.flow === '매출' ? '받는 단가' : '주는 단가', esc(o.kind), s.map(function (x) { return (+x.ym.slice(5)) + '월 ' + BM.fmtN(x.avg, 1); }).join(' → '), o.changed ? '<span class="badge warn">변동</span>' : '변동 없음']);
    });
    // 거래내역(청구처 기준) vs 분개장 매출
    var tr = {}, jr = {}, bills = {};
    c.m.trades.rows.forEach(function (t) {
      if (t.flow !== '매출') return;
      if (t.bk === c.vk) tr[t.ym] = (tr[t.ym] || 0) + t.amt;
      if (t.vk === c.vk && t.bk !== c.vk) bills[t.bk] = 1;
    });
    c.m.rows.forEach(function (r) { if (r.vk === c.vk && r.cls === 'revenue') jr[r.ym] = (jr[r.ym] || 0) + r.cr - r.dr; });
    var ms = Object.keys(tr).sort().slice(-6);
    var cmpRows = ms.map(function (ym) {
      var a = tr[ym], b = jr[ym] || 0, d = a - b, ok = Math.abs(d) <= Math.max(0.03 * a, 10000);
      var st = ok ? '일치' : (!b ? '<span class="badge warn">이 업체 명의 매출 전표 없음</span>' : '<span class="badge warn">' + (d > 0 ? '분개장 부족 ' : '분개장 초과 ') + BM.won(Math.abs(d)) + '</span>');
      return [BM.ymLabel(ym), BM.won(a), BM.won(b), st];
    });
    var notes = ['단가는 거래내역의 월별 가중평균(금액÷수량)입니다. 거래마다 단가가 다르면 평균값이 소수로 나옵니다.', '"그대로 들어오는지"는 거래내역 매출과 분개장 매출의 월별 대조로 봅니다. 월 정산 시점이 다르면 한 달씩 어긋날 수 있습니다.'];
    var billNames = Object.keys(bills).map(function (k) { return c.m.vendorName(k); });
    if (billNames.length) notes.push('이 업체의 물량은 ' + billNames.join(', ') + ' 명의로 청구되도록 거래내역에 표시되어 있어, 아래 대조는 이 업체 명의 청구분만 비교합니다.');
    else if (cmpRows.some(function (r) { return r[3].indexOf('전표 없음') >= 0; })) notes.push('이 업체 명의의 매출 전표가 없는 달이 있습니다. 다른 업체(운송사·중개사 등) 명의로 청구되고 있다면 거래내역의 "청구처" 칸에 정산 업체를 적어 주세요.');
    return { headline: c.vname + ' 현재 적용 단가: ' + lines.join(', ') + '.',
      body: '<h4>단가 추이</h4>' + tbl(['구분', '종류', '최근 월별 평균 단가(원)', '상태'], rows) +
        (cmpRows.length ? '<h4>거래내역 매출 vs 분개장 매출 (청구처 기준)</h4>' + tbl(['월', '거래내역', '분개장', '대조'], cmpRows, [1, 2]) : ''),
      notes: notes };
  } });

  /* 11. 물량 */
  Q.push({ id: 'q11', label: '이 업체 이번 달 물량이 얼마나 들어왔어?', needs: ['vendor?', 'month'], run: function (c) {
    if (!c.m.trades) return { headline: '물량은 거래내역 파일이 있어야 확인할 수 있습니다.', body: '', notes: ['거래내역 템플릿을 작성해 올려주세요.'] };
    var ton = function (kg) { return BM.fmtN(kg / 1000, 1) + '톤'; };
    if (!c.vk) {
      var by = {};
      c.m.trades.rows.forEach(function (t) {
        if (t.ym !== c.month || t.flow !== '매출') return;
        var kg = BM.toKg(t); if (kg == null || !/처리/.test(t.kind || '처리비')) return;
        var b = by[t.vk] = by[t.vk] || { kg: 0, n: 0 }; b.kg += kg; b.n++;
      });
      var list = Object.keys(by).sort(function (a, b) { return by[b].kg - by[a].kg; });
      var total = BM.sum(list, function (k) { return by[k].kg; });
      return { headline: BM.ymLabel(c.month) + ' 반입 ' + ton(total) + ' (' + list.length + '개 업체). 가장 많은 곳은 ' + (list[0] ? c.m.vendorName(list[0]) + ' ' + ton(by[list[0]].kg) : '-') + '.',
        body: tbl(['업체', '반입량', '건수'], list.slice(0, 15).map(function (k) { return [esc(c.m.vendorName(k)), ton(by[k].kg), by[k].n]; }), [1, 2]), notes: ['반입량은 거래내역의 방향이 "받을 돈(매출)"인 거래 기준입니다.'] };
    }
    var v = BM.volumes(c.m, c.vk, c.month), idx = c.m.months.indexOf(c.month);
    var prev = idx > 0 ? BM.volumes(c.m, c.vk, c.m.months[idx - 1]) : null;
    var hist = c.m.months.slice(Math.max(0, idx - 5), idx + 1).map(function (ym) { var x = BM.volumes(c.m, c.vk, ym); return [BM.ymLabel(ym), ton(x.inKg), ton(x.outKg), x.n]; });
    return { headline: c.vname + ' ' + BM.ymLabel(c.month) + ' 반입 ' + ton(v.inKg) + ' (' + v.n + '건)' + (prev && prev.inKg ? ', 전월 ' + ton(prev.inKg) + ' 대비 ' + ((v.inKg / prev.inKg - 1) * 100).toFixed(0) + '%' : '') + '.',
      body: tbl(['월', '반입', '반출', '건수'], hist, [1, 2, 3]), notes: [] };
  } });

  function tile(l, v, n) { return '<div class="card tile"><div class="label">' + esc(l) + '</div><div class="value">' + v + '</div>' + (n ? '<div class="note">' + esc(n) + '</div>' : '') + '</div>'; }
  BM.fmtAsOf = function (c) { return c.m.asOf + ' 분개장'; };
})(typeof window !== 'undefined' ? window : globalThis);
