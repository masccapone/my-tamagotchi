/* 질문 → 한 줄 답 + 근거 표. 숫자는 모두 분석 모듈이 계산하고, 여기서는 문장과 표만 만든다. */
(function (g) {
  'use strict';
  var BM = g.BM, esc = BM.esc;

  function tbl(head, rows, right, wide) {
    right = right || [];
    var h = '<tr>' + head.map(function (x, i) { return '<th' + (right.indexOf(i) >= 0 ? ' class="r"' : '') + '>' + esc(x) + '</th>'; }).join('') + '</tr>';
    var b = rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) { return '<td' + (right.indexOf(i) >= 0 ? ' class="r"' : '') + '>' + c + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="tablewrap"><table' + (wide ? ' class="wide"' : '') + '>' + h + b + '</table></div>';
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
  Q.push({ id: 'q1', label: '[업체]에 [월] 지급할 금액과 예정일은?', needs: ['vendor', 'month'], run: function (c) {
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
  Q.push({ id: 'q2', label: '[업체]의 [월] 입금액은?', needs: ['vendor?', 'month'], run: function (c) {
    var rows = BM.receipts(c.m).filter(function (x) { return x.ym === c.month && x.vk; });
    var notes = ['전표 입력 기준입니다. 실제 입금일과 전표 입력일 사이에 시차가 있을 수 있습니다.', '입금은 보통예금·당좌예금이 차변에 오른 전표에서 외상매출금·선수금·매출 등 대변 줄의 거래처로 셉니다. (은행 수수료 차감 전 금액)'];
    if (!c.vk) {
      var by = {};
      rows.forEach(function (x) { var b = by[x.vk] = by[x.vk] || { amt: 0, n: 0 }; b.amt += x.amt; b.n++; });
      var list = Object.keys(by).map(function (k) { return { k: k, b: by[k] }; }).sort(function (a, b) { return b.b.amt - a.b.amt; });
      var tot = BM.sum(list, function (x) { return x.b.amt; });
      if (!list.length) return { headline: BM.ymLabel(c.month) + ' 입금이 확인된 업체가 없습니다.', body: '', notes: notes };
      return { headline: BM.ymLabel(c.month) + ' 입금이 확인된 업체 ' + list.length + '곳, 합계 ' + BM.won(tot) + '. 큰 곳: ' + list.slice(0, 3).map(function (x) { return c.m.vendorName(x.k) + ' ' + BM.won(x.b.amt); }).join(', ') + '.',
        body: tbl(['업체', '입금 건수', '입금액'], list.slice(0, 15).map(function (x) { return [esc(c.m.vendorName(x.k)), x.b.n, BM.won(x.b.amt)]; }), [1, 2]), notes: notes };
    }
    var mine = rows.filter(function (x) { return x.vk === c.vk; }).sort(function (a, b) { return a.t - b.t; });
    var ar = c.ar.vendors.filter(function (x) { return x.key === c.vk; })[0];
    if (!mine.length) {
      return { headline: c.vname + ': ' + BM.ymLabel(c.month) + ' 입금 기록이 없습니다.' + (ar && ar.open > 0 ? ' 현재 미수금 ' + BM.won(ar.open) + '이 남아 있습니다.' : ''), body: '', notes: notes };
    }
    var tot2 = BM.sum(mine, function (x) { return x.amt; });
    return { headline: c.vname + ': ' + BM.ymLabel(c.month) + ' 입금 ' + mine.length + '건, 합계 ' + BM.won(tot2) + ' (마지막 입금 ' + mine[mine.length - 1].date + ').' + (ar && ar.open > 0 ? ' 남은 미수금 ' + BM.won(ar.open) + '.' : ''),
      body: tbl(['일자', '적요', '계정', '금액'], mine.map(function (x) { return [x.date, esc(short(x.memo, 50)), esc(x.acct), BM.won(x.amt)]; }), [3]), notes: notes };
  } });

  /* 3. 이번 달 나갈 돈과 들어올 돈 */
  Q.push({ id: 'q3', label: '[월]에 나갈 돈(미지급)과 들어올 돈(미수)은?', needs: ['month'], run: function (c) {
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
  Q.push({ id: 'q4', label: '[비용 항목]의 [월] 내역(거래처·적요·금액)은?', needs: ['month', 'acct'], run: function (c) {
    var rows = c.m.rows.filter(function (x) {
      return x.ym === c.month && (x.cls === 'prod' || x.cls === 'sga' || x.cls === 'nonop_out') && BM.acctIs(x.acct, c.acct) && !(x.closing && x.dr === 0 && x.cr !== 0);
    });
    if (!rows.length) return { headline: BM.ymLabel(c.month) + ' ' + c.acct + ' 내역이 없습니다.', body: '', notes: [] };
    var tot = BM.sum(rows, function (x) { return x.dr - x.cr; });
    var by = {}; rows.forEach(function (x) { var k = x.vk || '(거래처 없음)'; by[k] = (by[k] || 0) + x.dr - x.cr; });
    var top = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, 3).map(function (k) { return (k === '(거래처 없음)' ? k : c.m.vendorName(k)) + ' ' + BM.won(by[k]); });
    var sorted = rows.slice().sort(function (a, b) { return Math.abs(b.dr - b.cr) - Math.abs(a.dr - a.cr); }).slice(0, 15);
    var grp = BM.ACCT_GROUPS[c.acct], parts = {};
    if (grp) { rows.forEach(function (x) { parts[x.acct] = (parts[x.acct] || 0) + x.dr - x.cr; }); }
    var partTxt = grp ? ' 구성: ' + Object.keys(parts).sort(function (a, b) { return parts[b] - parts[a]; }).map(function (k) { return k + ' ' + BM.won(parts[k]); }).join(', ') + '.' : '';
    return { headline: BM.ymLabel(c.month) + ' ' + c.acct + ': 합계 ' + BM.won(tot) + ' (' + rows.length + '건).' + partTxt + (grp ? '' : ' 큰 거래처: ' + top.join(', ') + '.'),
      body: tbl(['일자', '거래처', '적요', '금액'], sorted.map(function (x) { return [x.date, esc(c.m.vendorName(x.vk)), esc(short(x.memo, 50)), BM.won(x.dr - x.cr)]; }), [3]),
      notes: ['금액이 큰 순서로 최대 15건입니다. 계정과목·거래처·적요는 전표 입력 내용 그대로입니다.'].concat(grp ? [grp.note] : []) };
  } });

  /* 5. 이번 달 왜 이렇게 많이 나갔어 */
  Q.push({ id: 'q5', label: '[비용 항목]이 [월]에 평소보다 많았다면 어떤 거래 때문인가?', needs: ['month', 'acct?'], run: function (c) {
    var idx = c.m.months.indexOf(c.month), prev = c.m.months.slice(Math.max(0, idx - 3), idx);
    if (!prev.length) return { headline: '비교할 이전 달 데이터가 없습니다.', body: '', notes: [] };
    var lumpy = /감가상각|퇴직|충당/;
    if (c.acct) {
      var series = c.m.months.slice(Math.max(0, idx - 5), idx + 1).map(function (ym) { return { ym: ym, a: BM.expenseOne(c.m, ym, c.acct) }; });
      var cur = series[series.length - 1].a, bs = series.slice(0, -1).filter(function (x) { return prev.indexOf(x.ym) >= 0; });
      var avg = bs.length ? BM.sum(bs, function (x) { return x.a; }) / bs.length : 0;
      var rows = c.m.rows.filter(function (x) { return x.ym === c.month && (x.cls === 'prod' || x.cls === 'sga' || x.cls === 'nonop_out') && BM.acctIs(x.acct, c.acct) && !(x.closing && x.dr === 0 && x.cr !== 0); })
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
  Q.push({ id: 'q6', label: '[월] 손익은?', needs: ['month'], run: function (c) {
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
  Q.push({ id: 'q7', label: '월평균 비용이 큰 항목 순위는? (절감 검토 후보)', needs: ['month'], run: function (c) {
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
  Q.push({ id: 'q8', label: '손익분기 매출은 얼마이고, 지금 매출은 거기서 얼마나 모자라거나 남아?', needs: [], run: function (c) {
    var b = BM.bep(c.m, c.pl, c.bepMonths, c.useEst);
    var n = b.n || 1;
    if (!b.n || b.R <= 0) return { headline: '손익분기를 계산할 기간 데이터가 부족합니다.', body: '', notes: b.notes };
    var notes = b.notes.slice();
    notes.push('계산 기간: ' + c.bepMonths.map(function (x) { return BM.ymLabel(x); }).join(', ') + ' (거래내역이 있고 분개장이 마감된 달).');
    var t = BM.bep3(b);
    notes = notes.concat(t.notes);
    if (t.cmr <= 0.05) return { headline: '변동비율이 ' + (t.v * 100).toFixed(0) + '%라 공헌이익률이 낮아 손익분기점을 계산할 수 없습니다.', body: '', notes: notes };
    var pt = t.bases[0];
    function cell(x) { return x == null ? '-' : BM.eok(x); }
    function sgn(x) { return x == null ? '-' : (x >= 0 ? '+' : '-') + BM.eok(Math.abs(x)); }
    var rows = t.bases.map(function (x) {
      return [x.name, BM.eok(x.perMonthF), cell(x.bepMonth), sgn(x.profitNow), x.gapMonth == null ? '-' : (x.gapMonth > 0 ? '매출 ' + BM.eok(x.gapMonth) + ' 더 필요' : '매출 ' + BM.eok(-x.gapMonth) + ' 여유')];
    });
    var grow = [0, 0.1, 0.2, 0.3].map(function (g) {
      var R2 = t.meanR * (1 + g);
      return ['+' + (g * 100) + '% (월 ' + BM.eok(R2) + ')'].concat(t.bases.map(function (x) {
        var prof = x.profitNow + (R2 - t.meanR) * t.cmr;
        return sgn(prof);
      }));
    });
    var pairRows = t.pairs.map(function (x) {
      return [BM.ymLabel(x.from) + ' → ' + BM.ymLabel(x.to), sgn(x.dR), sgn(x.dV), x.ratio == null ? '-' : (x.ratio * 100).toFixed(0) + '%', x.used ? '반영' : '제외(매출 변화 작음)'];
    });
    var vtxt = t.vSrc === 'incr' ? '매출이 1원 늘면 변동비가 약 ' + (t.v * 100).toFixed(0) + '원 늘어남(월별 증감 ' + t.usedN + '쌍 평균)' : '변동비율 ' + (t.v * 100).toFixed(0) + '% (기간 평균)';
    return { headline: '세전이익 기준 손익분기 매출은 월 ' + BM.eok(pt.bepMonth) + '(현재 월 평균 ' + BM.eok(t.meanR) + '). EBITDA 기준 ' + cell(t.bases[1].bepMonth) + ', 현금 기준 ' + cell(t.bases[2].bepMonth) + '.',
      body: '<div class="tiles">' + tile('월 평균 매출', BM.eok(t.meanR)) + tile('월 평균 변동비', BM.eok(b.V / n), vtxt) + tile('적용 공헌이익률', (t.cmr * 100).toFixed(0) + '%', '매출 증가분에 적용') + '</div>' +
        '<h4>기준별 손익분기 (월 기준)</h4>' + tbl(['기준', '월 고정비', '손익분기 매출', '현재 월 이익', '현재 대비'], rows, [1, 2, 3]) +
        '<h4>매출이 늘면 월 이익은 (현재 대비 증가분 × 공헌이익률)</h4>' + tbl(['매출', t.bases[0].name, t.bases[1].name, t.bases[2].name], grow, [1, 2, 3]) +
        '<h4>변동비율을 구한 근거 (월별 증감)</h4>' + tbl(['구간', '매출 증감', '변동비 증감', '변동비 ÷ 매출 증감', '구분'], pairRows, [1, 2, 3]) +
        '<h4>기준 정의</h4>' + tbl(['기준', '정의'], t.bases.map(function (x) { return [x.name, esc(x.def)]; }), []),
      notes: notes.concat(['비용 절감 효과는 "월 고정비"를 줄인 만큼 손익분기 매출이 (줄인 금액 ÷ 공헌이익률)만큼 낮아지는 것으로 직접 계산해 보세요. 어떤 비용을 줄일 수 있는지는 "줄일 수 있는 비용 항목"에서 확인합니다.']) };
  } });

  /* 9. 현재 통장 잔액 */
  Q.push({ id: 'q9', label: '현재 통장 잔액은?', needs: ['cash'], run: function (c) {
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
  Q.push({ id: 'q10', label: '[업체]의 월별 실제 단가와 최근 변동은?', needs: ['vendor'], run: function (c) {
    if (!c.m.trades) return { headline: '단가는 거래내역 파일이 있어야 확인할 수 있습니다.', body: '', notes: ['거래내역 템플릿을 작성해 올려주세요.'] };
    var up = BM.unitPrices(c.m, c.vk), keys = Object.keys(up);
    if (!keys.length) return { headline: c.vname + '의 거래내역이 없습니다.', body: '', notes: [] };
    var lines = [], rows = [];
    keys.forEach(function (k) {
      var o = up[k], s = o.series.slice(-6);
      var cur = o.latest;
      var pv = o.series.length > 1 ? o.series[o.series.length - 2] : null;
      lines.push((o.flow === '매출' ? '받는 ' : '주는 ') + o.kind + ' ' + BM.fmtN(cur.avg, 1) + '원/' + (o.unit || '단위') + (o.changed && pv ? ' (' + (+cur.ym.slice(5)) + '월에 변동: ' + (+pv.ym.slice(5)) + '월 ' + BM.fmtN(pv.avg, 1) + '원 → ' + (+cur.ym.slice(5)) + '월 ' + BM.fmtN(cur.avg, 1) + '원)' : ''));
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
  Q.push({ id: 'q11', label: '[업체]의 [월] 처리 물량은?', needs: ['vendor?', 'month'], run: function (c) {
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
    var parts = [];
    if (v.inKg) parts.push('반입 ' + ton(v.inKg));
    if (v.outKg) parts.push('반출 ' + ton(v.outKg));
    var chg = prev && prev.inKg && v.inKg ? ', 전월 반입 ' + ton(prev.inKg) + ' 대비 ' + ((v.inKg / prev.inKg - 1) * 100).toFixed(0) + '%' : (prev && prev.outKg && v.outKg ? ', 전월 반출 ' + ton(prev.outKg) + ' 대비 ' + ((v.outKg / prev.outKg - 1) * 100).toFixed(0) + '%' : '');
    return { headline: c.vname + ' ' + BM.ymLabel(c.month) + ' ' + (parts.length ? parts.join(', ') + ' (' + v.n + '건)' + chg : '처리 물량 기록이 없습니다(운반비 행은 수량을 세지 않습니다)') + '.',
      body: tbl(['월', '반입', '반출', '건수'], hist, [1, 2, 3]), notes: [] };
  } });

  /* ---------- 조회형 질문: 항목 × 업체 × 기간으로 묻는 질문 ---------- */
  function sumBy(a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); }
  function agingTable(vendors) {
    return tbl(['업체', '잔액', '30일 이내', '31~60일', '61~90일', '91~180일', '180일 초과'], vendors.map(function (v) {
      var b = [0, 0, 0, 0, 0];
      v.lots.forEach(function (l) { var i = l.age <= 30 ? 0 : l.age <= 60 ? 1 : l.age <= 90 ? 2 : l.age <= 180 ? 3 : 4; b[i] += l.amt; });
      return [esc(v.name), BM.won(v.open)].concat(b.map(function (x) { return x ? BM.won(x) : '-'; }));
    }), [1, 2, 3, 4, 5, 6]);
  }
  function lotsTable(v) {
    return tbl(['청구일', '적요', '금액', '경과일', '예상 지급·입금일'], v.lots.map(function (l) { return [l.iso, esc(short(l.memo, 40)), BM.won(l.amt), l.age + '일', l.expIso]; }), [2, 3]);
  }
  function negativeNote(items) {
    var bad = items.vendors.filter(function (x) { return x.opening; });
    return bad.length ? [bad.length + '곳은 이전 연도 기초 잔액이 분개장에 없어 잔액이 마이너스이므로 합계에서 뺐습니다: ' + bad.slice(0, 3).map(function (x) { return x.name; }).join(', ') + (bad.length > 3 ? ' 등' : '')] : [];
  }

  /* 12. 미수금(받을 돈) 잔액, 연령 */
  Q.push({ id: 'q12', label: '미수금(받을 돈)이 얼마야?', needs: ['vendor?', 'days?', 'topn?'], run: function (c) {
    var days = c.days || null, topN = c.topN || 5, asOf = c.m.asOf;
    if (c.vk) {
      var v = c.ar.vendors.filter(function (x) { return x.key === c.vk; })[0];
      if (!v || v.open <= 0) return { headline: c.vname + '의 미수금은 없습니다 (' + asOf + ' 분개장 기준).', body: '', notes: [] };
      var over = days ? sumBy(v.lots.filter(function (l) { return l.age > days; }), function (l) { return l.amt; }) : 0;
      var oldest = Math.max.apply(null, v.lots.map(function (l) { return l.age; }));
      var head = days ? (over > 0 ? c.vname + ': ' + days + '일 넘게 못 받은 돈 ' + BM.won(over) + ' (전체 미수금 잔액 ' + BM.won(v.open) + ').' : c.vname + ': ' + days + '일 넘은 미수금은 없습니다. 전체 미수금 잔액 ' + BM.won(v.open) + ' (가장 오래된 청구 ' + oldest + '일 경과).')
        : c.vname + ' 미수금 잔액 ' + BM.won(v.open) + ' (' + v.lots.length + '건, 가장 오래된 청구 ' + oldest + '일 경과).';
      return { headline: head, body: lotsTable(v), notes: ['청구일은 매출 전표일 기준이고 선입선출로 입금을 맞춘 값입니다. 예상 입금일은 "' + v.paySrc + '" 기준 추정입니다.'] };
    }
    var list = c.ar.vendors.filter(function (x) { return x.open > 0; });
    var scoped = days ? list.map(function (x) { return { v: x, amt: sumBy(x.lots.filter(function (l) { return l.age > days; }), function (l) { return l.amt; }) }; }).filter(function (x) { return x.amt > 0; })
      : list.map(function (x) { return { v: x, amt: x.open }; });
    scoped.sort(function (a, b) { return b.amt - a.amt; });
    var total = sumBy(scoped, function (x) { return x.amt; });
    var tops = scoped.slice(0, topN);
    if (days && !scoped.length) return { headline: days + '일 넘게 못 받은 돈은 없습니다 (전체 미수금 잔액 ' + BM.won(sumBy(list, function (x) { return x.open; })) + ').', body: agingTable(list.slice(0, topN)), notes: negativeNote(c.ar) };
    return { headline: (days ? days + '일 넘게 못 받은 돈 ' + BM.won(total) + ' (' + scoped.length + '개 업체)' : '미수금 잔액 합계 ' + BM.won(total) + ' (' + scoped.length + '개 업체)') + '. 큰 곳: ' + tops.slice(0, c.topN ? Math.min(c.topN, 8) : 3).map(function (x) { return x.v.name + ' ' + BM.won(x.amt); }).join(', ') + '.',
      body: (days ? '' : '') + agingTable(tops.map(function (x) { return x.v; })), notes: negativeNote(c.ar).concat(['청구일은 매출 전표일 기준이고 선입선출로 입금을 맞춘 값입니다.']) };
  } });

  /* 13. 미지급금(줄 돈) 잔액, 마이너스 잔액 점검 */
  Q.push({ id: 'q13', label: '미지급금(줄 돈)이 얼마야?', needs: ['vendor?', 'topn?'], run: function (c) {
    var topN = c.topN || 5, ap = c.ap, asOf = c.m.asOf, ym = asOf.slice(0, 7), r = monthRange(ym);
    function split(v) { var d = 0, o = 0; v.lots.forEach(function (l) { if (l.expT < r.s) o += l.amt; else if (l.expT <= r.e) d += l.amt; }); return { due: d, over: o }; }
    if (c.view === 'negative') {
      var bad = ap.vendors.filter(function (x) { return x.opening; }).sort(function (a, b) { return a.balance - b.balance; });
      if (!bad.length) return { headline: '미지급금이 마이너스인 업체는 없습니다.', body: '', notes: [] };
      return { headline: '미지급금이 마이너스인 업체 ' + bad.length + '곳: ' + bad.slice(0, 5).map(function (x) { return x.name + ' ' + BM.won(x.balance); }).join(', ') + '.',
        body: tbl(['업체', '미지급금 잔액'], bad.map(function (x) { return [esc(x.name), BM.won(x.balance)]; }), [1]),
        notes: ['이전 연도에 발생한 채무를 올해 갚아서, 발생 전표가 이 분개장에 없을 때 생깁니다. 기초 잔액이 있어야 정확한 잔액을 알 수 있습니다.'] };
    }
    if (c.vk) {
      var v = ap.vendors.filter(function (x) { return x.key === c.vk; })[0];
      if (!v || v.open <= 0) return { headline: c.vname + '에 줄 미지급금은 없습니다 (' + asOf + ' 분개장 기준).' + (v && v.opening ? ' (이전 연도 기초 잔액이 없어 잔액이 마이너스입니다)' : ''), body: '', notes: [] };
      var sp = split(v);
      return { headline: c.vname + ' 미지급금 잔액 ' + BM.won(v.open) + ' (' + v.lots.length + '건). ' + BM.ymLabel(ym) + ' 도래 추정 ' + BM.won(sp.due) + ', 이미 기한이 지난 추정 ' + BM.won(sp.over) + '.', body: lotsTable(v),
        notes: ['예정일은 "' + v.paySrc + '" 기준 추정이며 실제 지급 결정과 다를 수 있습니다.'] };
    }
    var list = ap.vendors.filter(function (x) { return x.open > 0; }).sort(function (a, b) { return b.open - a.open; });
    var total = sumBy(list, function (x) { return x.open; }), due = 0, over = 0;
    list.forEach(function (x) { var s = split(x); due += s.due; over += s.over; });
    return { headline: '미지급금 잔액 합계 ' + BM.won(total) + ' (' + list.length + '개 거래처). 이 중 ' + BM.ymLabel(ym) + ' 도래 추정 ' + BM.won(due) + ', 이미 기한이 지난 추정 ' + BM.won(over) + '. 큰 곳: ' + list.slice(0, 3).map(function (x) { return x.name + ' ' + BM.won(x.open); }).join(', ') + '.',
      body: tbl(['업체', '잔액', BM.ymLabel(ym) + ' 도래(추정)', '기한 경과(추정)', '예상 근거'], list.slice(0, topN).map(function (x) { var s = split(x); return [esc(x.name), BM.won(x.open), BM.won(s.due), BM.won(s.over), esc(x.paySrc)]; }), [1, 2, 3]),
      notes: ['예정일은 업체마스터 결제기한 또는 과거 결제 이력으로 추정한 값이라 실제 지급 결정과 다를 수 있습니다.', '미지급금 계정만 센 값입니다. 미지급비용(예: 이자 계상분), 예수금(4대보험 등), 차입금은 포함하지 않습니다. 카드대금 등 거래처가 아닌 항목은 포함됩니다.'].concat(negativeNote(ap)) };
  } });

  /* 14. 매출 조회 */
  Q.push({ id: 'q14', label: '이 달 매출이 얼마야?', needs: ['vendor?', 'month'], run: function (c) {
    var b = c.pl.filter(function (x) { return x.ym === c.month; })[0];
    if (!b) return { headline: '해당 월 데이터가 없습니다.', body: '', notes: [] };
    var idx = c.pl.indexOf(b), prev = idx > 0 ? c.pl[idx - 1] : null, notes = [];
    var trade = c.m.trades ? sumBy(c.m.trades.rows.filter(function (t) { return t.ym === c.month && t.flow === '매출' && (!c.vk || t.bk === c.vk); }), function (t) { return t.amt; }) : null;
    var rows = c.m.rows.filter(function (x) { return x.ym === c.month && x.cls === 'revenue' && (!c.vk || x.vk === c.vk); });
    var total = c.vk ? sumBy(rows, function (x) { return x.cr - x.dr; }) : b.rev;
    var by = {}; rows.forEach(function (x) { by[x.acct] = (by[x.acct] || 0) + x.cr - x.dr; });
    var head = BM.ymLabel(c.month) + (c.vk ? ' ' + c.vname : '') + ' 매출(분개장 기준) ' + BM.won(total) + (!c.vk && prev && prev.rev > 0 ? ' (전월 ' + BM.won(prev.rev) + ' 대비 ' + ((total / prev.rev - 1) * 100).toFixed(0) + '%)' : '') + '.' + (trade != null ? ' 거래내역 기준은 ' + BM.won(trade) + '입니다.' : '');
    if (trade != null && total > 0 && Math.abs(trade - total) > Math.max(0.05 * trade, 1e7)) notes.push('거래내역과 분개장 매출이 ' + BM.won(Math.abs(trade - total)) + ' 차이납니다. ' + (trade > total ? '분개장에 매출이 덜 입력됐을 수 있습니다.' : '거래내역에 누락이 있을 수 있습니다.'));
    b.flags.forEach(function (f) { if (f.k === 'drop') notes.push('이 달 매출이 다른 달보다 매우 적어 미입력일 수 있습니다.'); if (f.k === 'partial') notes.push('아직 진행 중인 달입니다.'); });
    var byV = {}; if (!c.vk) rows.forEach(function (x) { var k = x.vk || '(거래처 없음)'; byV[k] = (byV[k] || 0) + x.cr - x.dr; });
    var vList = Object.keys(byV).sort(function (a, b2) { return byV[b2] - byV[a]; }).slice(0, 8);
    return { headline: head, body: tbl(['계정', '금액'], Object.keys(by).map(function (k) { return [esc(k), BM.won(by[k])]; }), [1]) + (vList.length ? '<h4>업체별 상위</h4>' + tbl(['업체', '매출'], vList.map(function (k) { return [esc(k === '(거래처 없음)' ? k : c.m.vendorName(k)), BM.won(byV[k])]; }), [1]) : ''), notes: notes };
  } });

  /* 15. 비용 합계와 큰 항목 */
  Q.push({ id: 'q15', label: '이 달 비용이 얼마야? 큰 항목은?', needs: ['month'], run: function (c) {
    var e = BM.expenseByAcct(c.m, c.month), keys = Object.keys(e).sort(function (a, b) { return e[b].amt - e[a].amt; });
    if (!keys.length) return { headline: '해당 월 비용 내역이 없습니다.', body: '', notes: [] };
    var total = sumBy(keys, function (k) { return e[k].amt; });
    return { headline: BM.ymLabel(c.month) + ' 발생비용 합계 ' + BM.won(total) + '. 가장 큰 항목은 ' + keys.slice(0, 3).map(function (k) { return k + ' ' + BM.won(e[k].amt); }).join(', ') + ' 순입니다.',
      body: tbl(['항목', '금액', '비중'], keys.slice(0, 10).map(function (k) { return [esc(k), BM.won(e[k].amt), (e[k].amt / total * 100).toFixed(0) + '%']; }), [1, 2]),
      notes: ['제조원가, 판관비, 영업외비용을 합친 발생비용입니다. 분기 말에만 입력되는 감가상각 등이 아직 없는 달은 실제보다 작게 보입니다.'] };
  } });

  /* 16. 전월 대비 늘어난 비용 */
  Q.push({ id: 'q16', label: '지난달보다 어떤 비용이 늘었어?', needs: ['month'], run: function (c) {
    var idx = c.m.months.indexOf(c.month);
    if (idx < 1) return { headline: '비교할 이전 달 데이터가 없습니다.', body: '', notes: [] };
    var prevYm = c.baseMonth && c.m.months.indexOf(c.baseMonth) >= 0 && c.baseMonth < c.month ? c.baseMonth : c.m.months[idx - 1], cur = BM.expenseByAcct(c.m, c.month), prev = BM.expenseByAcct(c.m, prevYm), keys = {};
    Object.keys(cur).concat(Object.keys(prev)).forEach(function (k) { keys[k] = 1; });
    var list = Object.keys(keys).map(function (k) { var a = cur[k] ? cur[k].amt : 0, b = prev[k] ? prev[k].amt : 0; return { k: k, a: a, b: b, d: a - b }; }).sort(function (x, y) { return y.d - x.d; });
    var up = list.filter(function (x) { return x.d > 0; }).slice(0, 8);
    if (!up.length) return { headline: BM.ymLabel(c.month) + '에 ' + BM.ymLabel(prevYm) + '보다 늘어난 비용 항목은 없습니다.', body: '', notes: [] };
    return { headline: BM.ymLabel(prevYm) + ' 대비 ' + BM.ymLabel(c.month) + '에 가장 늘어난 비용은 ' + up.slice(0, 3).map(function (x) { return x.k + ' +' + BM.won(x.d); }).join(', ') + ' 순입니다.',
      body: tbl(['항목', BM.ymLabel(prevYm), BM.ymLabel(c.month), '증감'], up.map(function (x) { return [esc(x.k), BM.won(x.b), BM.won(x.a), BM.won(x.d)]; }), [1, 2, 3]),
      notes: ['감가상각비·퇴직급여·충당부채처럼 분기 말에 한 번 반영되는 항목은 해당 달에 크게 늘어 보일 수 있습니다.'] };
  } });

  /* 17. 데이터 점검 (입력 오류, 매출 누락 등) */
  Q.push({ id: 'q17', label: '입력이 잘못되거나 빠진 데이터가 있어?', needs: ['month?'], run: function (c) {
    var ws = c.rc.warnings, notes = [];
    var lines = ws.map(function (w) { return w.t; });
    var rev = null;
    if (c.month && c.focus === 'revenue') {
      var b = c.pl.filter(function (x) { return x.ym === c.month; })[0];
      var recon = (c.rc.months || []).filter(function (x) { return x.ym === c.month; })[0];
      if (b) {
        var med = (function () { var a = c.pl.map(function (x) { return x.rev; }).filter(function (x) { return x > 0; }).sort(function (x, y) { return x - y; }); return a.length ? a[Math.floor(a.length / 2)] : 0; })();
        var parts = [BM.ymLabel(c.month) + ' 매출은 분개장에 ' + BM.won(b.rev) + '입니다.'];
        if (recon && recon.trades > 0) parts.push('거래내역 기준은 ' + BM.won(recon.trades) + '으로 분개장이 ' + BM.won(Math.max(0, recon.trades - recon.journal)) + (recon.trades > recon.journal ? ' 적어 매출 전표가 덜 입력된 것으로 보입니다.' : ' 많거나 같습니다.'));
        else if (med > 0 && b.rev < med * 0.3) parts.push('다른 달 중앙값(' + BM.won(med) + ')보다 매우 적어 미입력일 수 있습니다.');
        else parts.push('다른 달과 비교해 이상 징후는 보이지 않습니다.');
        rev = parts.join(' ');
      }
    }
    if (!lines.length && !rev) return { headline: '데이터 점검에서 발견된 문제가 없습니다.', body: '', notes: [] };
    var errRe = /(전표|중복|수량×단가)/, errs = lines.filter(function (t) { return errRe.test(t); }), rest = lines.filter(function (t) { return !errRe.test(t); });
    var ordered = c.focus === 'revenue' ? lines : errs.concat(rest);
    var headLines = (c.focus === 'revenue' ? ordered : (errs.length ? errs : ordered)).slice(0, 3);
    return { headline: rev || (errs.length && c.focus !== 'revenue' ? '입력이 잘못됐을 수 있는 항목 ' + errs.length + '건: ' + headLines.join(' / ') : '데이터 점검 ' + lines.length + '건: ' + headLines.join(' / ')),
      body: '<ul class="wl">' + ordered.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>', notes: rev ? ['아래는 전체 점검 결과입니다.'] : [] };
  } });

  /* 19. 통장 출금·입금 */
  Q.push({ id: 'q19', label: '[월]에 통장에서 실제 나간 돈과 들어온 돈은?', needs: ['month'], run: function (c) {
    var f = BM.cashFlow(c.m, c.month);
    if (!f.vouchers) return { headline: BM.ymLabel(c.month) + '에 통장(보통예금·당좌예금) 입출금 전표가 없습니다.', body: '', notes: [] };
    var b = c.pl.filter(function (x) { return x.ym === c.month; })[0];
    function top(by, n) { return Object.keys(by).filter(function (k) { return by[k] > 0; }).sort(function (a, b) { return by[b] - by[a]; }).slice(0, n); }
    var oT = top(f.outBy, 8), iT = top(f.inBy, 8);
    var apV = Object.keys(f.apVendors).sort(function (a, b) { return f.apVendors[b] - f.apVendors[a]; }).slice(0, 8);
    var net = f.inn - f.out;
    var head = BM.ymLabel(c.month) + ' 통장 출금 ' + BM.won(f.out) + ', 입금 ' + BM.won(f.inn) + ' (순증감 ' + (net >= 0 ? '+' : '-') + BM.won(Math.abs(net)) + '). 큰 출금: ' + oT.slice(0, 3).map(function (k) { return k + ' ' + BM.won(f.outBy[k]); }).join(', ') + '.';
    return { headline: head,
      body: '<div class="tiles">' + tile('통장 출금', BM.won(f.out)) + tile('통장 입금', BM.won(f.inn)) + tile('발생비용(손익 기준)', b ? BM.won(b.incurred) : '-', '지급 시점과 무관한 비용') + '</div>' +
        '<h4>출금 내역 (상대 계정별)</h4>' + tbl(['계정', '금액'], oT.map(function (k) { return [esc(k), BM.won(f.outBy[k])]; }), [1]) +
        (apV.length ? '<h4>미지급금 결제 상위 업체</h4>' + tbl(['업체', '금액'], apV.map(function (k) { return [esc(k ? c.m.vendorName(k) : '(거래처 없음)'), BM.won(f.apVendors[k])]; }), [1]) : '') +
        '<h4>입금 내역 (상대 계정별)</h4>' + tbl(['계정', '금액'], iT.map(function (k) { return [esc(k), BM.won(f.inBy[k])]; }), [1]),
      notes: ['전표일 기준이라 실제 이체일과 다를 수 있습니다. 대출 상환, 외상대금 결제, 보증금 등 비용이 아닌 출금도 포함됩니다.', '"비용"과 다릅니다: 비용은 발생 시점, 이 답은 통장에서 실제로 돈이 움직인 기준입니다.'] };
  } });

  /* 20. 손익계산서 */
  Q.push({ id: 'q20', label: '[기간]의 손익계산서는? (월별 + 누계)', needs: ['month'], run: function (c) {
    var to = c.month, from = c.from || (to.slice(0, 4) + '-01');
    var st = BM.incomeStatement(c.m, c.pl, from, to);
    if (!st.months.length) return { headline: '해당 기간 분개장 자료가 없습니다.', body: '', notes: [] };
    var n = st.months.length;
    function tot(a) { return BM.sum(a, function (x) { return x; }); }
    var T = { rev: tot(st.rev), cogs: tot(st.cogs), gross: tot(st.gross), sga: tot(st.sga), op: tot(st.op), nIn: tot(st.nIn), nOut: tot(st.nOut), pre: tot(st.pre), inc: tot(st.incurred), est: tot(st.est) };
    var span = n === 1 ? BM.ymLabel(to) : BM.ymLabel(st.months[0]) + '~' + BM.ymLabel(to) + ' 누계';
    function num(v, bold) { var t = BM.fmtN(Math.round(v)); if (v < 0) t = '<span class="neg">' + t + '</span>'; return bold ? '<b>' + t + '</b>' : t; }
    function line(label, vals, bold) { return [bold ? '<b>' + esc(label) + '</b>' : '&nbsp;&nbsp;' + esc(label)].concat(vals.map(function (v) { return num(v, bold); })).concat([num(tot(vals), bold)]); }
    function lines(rows, limit) {
      var out = rows.slice(0, limit).map(function (r) { return line(r.name, r.vals, false); });
      if (rows.length > limit) { var rest = rows.slice(limit); out.push(line('기타 ' + rest.length + '개 항목', st.months.map(function (x, i) { return BM.sum(rest, function (r) { return r.vals[i]; }); }), false)); }
      return out;
    }
    var rows = [line('Ⅰ. 매출액', st.rev, true)].concat(lines(st.sec.rev, 6))
      .concat([line('Ⅱ. 매출원가', st.cogs, true)]).concat(lines(st.sec.cogs, 4))
      .concat([line('Ⅲ. 매출총이익', st.gross, true), line('Ⅳ. 판매비와관리비', st.sga, true)]).concat(lines(st.sec.sga, 12))
      .concat([line('Ⅴ. 영업이익', st.op, true), line('Ⅵ. 영업외수익', st.nIn, true)]).concat(lines(st.sec.nIn, 4))
      .concat([line('Ⅶ. 영업외비용', st.nOut, true)]).concat(lines(st.sec.nOut, 6))
      .concat([line('Ⅷ. 법인세차감전순이익 (장부 기준)', st.pre, true), line('참고: 발생비용 기준 손익', st.incurred, false), line('참고: 관리용 추정 손익', st.est, false)]);
    var head = [''].concat(st.months.map(function (ym) { return n > 1 ? (+ym.slice(5)) + '월' : BM.ymLabel(ym); })).concat(['누계']);
    var cols = []; for (var i = 1; i <= n + 1; i++) cols.push(i);
    var notes = [];
    if (st.unsettled.length) notes.push('매출원가가 아직 결산되지 않은 달: ' + st.unsettled.map(function (ym) { return (+ym.slice(5)) + '월'; }).join('·') + '. 이 달들의 제조원가 발생액(' + BM.won(st.months.reduce(function (a, ym, i) { return a + (st.unsettled.indexOf(ym) >= 0 ? st.prod[i] : 0); }, 0)) + ')은 장부 기준 손익에 아직 들어가지 않아 장부 기준 이익이 실제보다 높게 나옵니다. 발생비용 기준 손익을 같이 보세요.');
    if (st.partial.length) notes.push(BM.ymLabel(st.partial[0]) + '은 진행 중인 달이라 일부만 입력됐습니다.');
    if (st.estAdj > 0) notes.push('관리용 추정 손익은 입력되지 않은 결산성 비용(감가상각·퇴직급여·이자 정산 등) 약 ' + BM.won(st.estAdj) + '을 직전 결산 분기 평균으로 추정해 반영한 값입니다.');
    notes.push('계정별 금액은 분개장 그대로입니다(결산 전표 포함). 제조원가명세서가 아닌 손익계산서 형식이며, 제조원가 계정 [(제)(도)(분)]은 매출원가 결산 전표를 통해서만 이 표에 들어옵니다.');
    return { headline: span + ' (장부 기준): 매출 ' + BM.won(T.rev) + ', 매출원가 ' + BM.won(T.cogs) + ', 판관비 ' + BM.won(T.sga) + ', 영업외손익 ' + BM.won(T.nIn - T.nOut) + ' → 세전이익 ' + BM.won(T.pre) + '. 발생비용 기준 ' + BM.won(T.inc) + (st.estAdj > 0 ? ', 관리용 추정 ' + BM.won(T.est) : '') + '.' + (st.unsettled.length ? ' ※ 원가 미결산 월이 있어 장부 이익은 높게 나옵니다.' : ''),
      body: '<div class="hint">단위: 원</div>' + tbl(head, rows, cols, true), notes: notes, status: st.unsettled.length || st.partial.length ? '잠정' : (st.estAdj > 0 ? '추정' : '확정') };
  } });

  /* 21. 매출이익률(매출총이익률) */
  Q.push({ id: 'q21', label: '[기간]의 매출이익률(매출총이익률)은?', needs: ['month'], run: function (c) {
    var to = c.month, from = c.from || (to.slice(0, 4) + '-01'), widened = [];
    // 결산은 분기 단위로만 이뤄지므로, 이미 결산된 분기에 걸친 기간은 그 분기 전체로 넓혀 계산한다
    function qStart(ym) { return ym.slice(0, 4) + '-' + ('0' + (Math.ceil(+ym.slice(5) / 3) * 3 - 2)).slice(-2); }
    function qEndYm(ym) { return ym.slice(0, 4) + '-' + ('0' + (Math.ceil(+ym.slice(5) / 3) * 3)).slice(-2); }
    function settledQ(ym) { var e = qEndYm(ym), b = c.pl.filter(function (x) { return x.ym === e; })[0]; return !!(b && b.cogsBook > 0); }
    if (settledQ(from) && qStart(from) < from) { widened.push(BM.ymLabel(from) + '→' + BM.ymLabel(qStart(from))); from = qStart(from); }
    if (settledQ(to) && qEndYm(to) > to) { widened.push(BM.ymLabel(to) + '→' + BM.ymLabel(qEndYm(to))); to = qEndYm(to); }
    var st = BM.incomeStatement(c.m, c.pl, from, to), n = st.months.length;
    if (!n) return { headline: '해당 기간 분개장 자료가 없습니다.', body: '', notes: [] };
    function pct(x, r) { return r > 0 ? (x / r * 100).toFixed(1) + '%' : '-'; }
    function inQ(ym) { var y = ym.slice(0, 4), q = Math.ceil(+ym.slice(5) / 3), k = 0; for (var i = 1; i <= 3; i++) if (st.months.indexOf(y + '-' + ('0' + (q * 3 - 3 + i)).slice(-2)) >= 0) k++; return k === 3; }
    var info = st.months.map(function (ym, i) {
      var book = st.unsettled.indexOf(ym) < 0 && inQ(ym);
      var cost = book ? st.cogs[i] : st.prod[i] + st.estAdjProd[i];
      return { i: i, ym: ym, rev: st.rev[i], cost: cost, book: book, adj: book ? 0 : st.estAdjProd[i] };
    });
    function agg(list) { var R = BM.sum(list, function (x) { return x.rev; }), C = BM.sum(list, function (x) { return x.cost; }); return { R: R, C: C, gp: R - C, m: pct(R - C, R) }; }
    var B = info.filter(function (x) { return x.book && x.rev > 0; }), E = info.filter(function (x) { return !x.book && x.rev > 0; }), A = info.filter(function (x) { return x.rev > 0; });
    function span(list) { return list.length ? (list.length === 1 ? (+list[0].ym.slice(5)) + '월' : (+list[0].ym.slice(5)) + '~' + (+list[list.length - 1].ym.slice(5)) + '월') : ''; }
    var rows = info.map(function (x) {
      return [BM.ymLabel(x.ym), BM.won(x.rev), BM.won(x.cost), x.rev > 0 ? pct(x.rev - x.cost, x.rev) : '-', x.book ? '<span class="st fixed">장부(결산 완료)</span>' : '<span class="st est">추정</span>'];
    });
    var bAgg = agg(B), eAgg = agg(E), aAgg = agg(A);
    if (B.length) rows.push(['<b>결산 완료 합계 (' + span(B) + ')</b>', BM.won(bAgg.R), BM.won(bAgg.C), '<b>' + bAgg.m + '</b>', '장부']);
    if (E.length) rows.push(['<b>결산 전 합계 (' + span(E) + ')</b>', BM.won(eAgg.R), BM.won(eAgg.C), '<b>' + eAgg.m + '</b>', '추정']);
    if (B.length && E.length) rows.push(['<b>전체 합계</b>', BM.won(aAgg.R), BM.won(aAgg.C), '<b>' + aAgg.m + '</b>', '장부+추정']);
    var parts = [];
    if (B.length) parts.push('결산 완료 ' + span(B) + ' 장부 기준 매출총이익률 ' + bAgg.m + ' (매출 ' + BM.won(bAgg.R) + ', 매출원가 ' + BM.won(bAgg.C) + ')');
    if (E.length) parts.push('결산 전 ' + span(E) + '은 발생 제조원가로 추정한 매출총이익률 ' + eAgg.m + ' (매출 ' + BM.won(eAgg.R) + ', 추정 매출원가 ' + BM.won(eAgg.C) + ')');
    var head = (widened.length ? '(원가는 분기 단위로 결산되어 분기 전체로 계산) ' : '') + (parts.length ? parts.join('. ') + '.' : '이 기간은 매출이 없어 이익률을 계산할 수 없습니다.') + (B.length && E.length ? ' 전체 ' + aAgg.m + '.' : '');
    // 역검증: 결산이 끝난 분기에서 "발생 제조원가"가 실제 장부 매출원가와 얼마나 달랐는가
    var qs = {};
    c.pl.forEach(function (b) { var k = BM.qOf(b.ym), o = qs[k] = qs[k] || { rev: 0, prod: 0, cogs: 0 }; o.rev += b.rev; o.prod += b.prod; o.cogs += b.cogsBook; });
    var bt = Object.keys(qs).sort().filter(function (k) { return qs[k].cogs > 0 && qs[k].rev > 0; }).map(function (k) { var o = qs[k]; return k.replace('Q', '년 ') + '분기 원가 ' + (((o.prod - o.cogs) / o.cogs) * 100 >= 0 ? '+' : '') + (((o.prod - o.cogs) / o.cogs) * 100).toFixed(1) + '%(이익률 ' + (((o.cogs - o.prod) / o.rev) * 100).toFixed(1) + '%p)'; });
    var notes = (widened.length ? ['매출원가는 분기 단위로 결산되어 이미 결산된 분기는 분기 전체로 넓혀 계산했습니다(' + widened.join(', ') + ').'] : []).concat(['매출총이익률 = (매출-매출원가)÷매출. 매출은 분개장 입력액입니다.',
      '제조원가는 분기 말에만 매출원가로 대체됩니다. 결산 전 달은 그 달 발생 제조원가(감가상각 등 분기 말 비용이 아직 입력되지 않았으면 직전 결산 분기 평균으로 추정한 몫 포함)를 매출원가로 보고 계산했습니다.']);
    if (bt.length) notes.push('이 추정 방식을 이미 결산된 분기에 적용해 보면 실제 장부 매출원가와 다음만큼 차이가 났습니다: ' + bt.join(', ') + '. 결산된 분기가 ' + bt.length + '개뿐이라 오차의 신뢰 범위는 좁게 봐야 합니다.');
    var adj = BM.sum(E, function (x) { return x.adj; });
    if (adj > 0) notes.push('결산 전 원가에는 아직 입력되지 않은 결산성 제조원가 약 ' + BM.won(adj) + '의 추정이 들어 있습니다.');
    if (st.partial.length) notes.push(BM.ymLabel(st.partial[0]) + '은 진행 중인 달입니다.');
    var low = info.filter(function (x) { return x.rev > 0 && x.rev < 0.3 * (aAgg.R / Math.max(1, A.length)); });
    if (low.length) notes.push('매출이 평소보다 매우 적은 달(' + low.map(function (x) { return BM.ymLabel(x.ym); }).join(', ') + ')은 매출이 덜 입력됐을 수 있어 그 달 이익률이 낮게 나올 수 있습니다.');
    if (!B.length && n === 1) notes.push('한 달만 물으면 분기 말 비용이 그 달에 몰려 있을 수 있습니다. 분기 전체로 보려면 "4월부터 6월까지 매출이익률"처럼 물어보세요.');
    return { headline: head,
      body: '<div class="hint">단위: 원</div>' + tbl(['기간', '매출', '매출원가', '매출총이익률', '구분'], rows, [1, 2, 3]),
      notes: notes, status: E.length ? '추정' : (st.partial.length ? '잠정' : '확정') };
  } });

  /* 22. 유형자산 잔액 */
  Q.push({ id: 'q22', label: '[자산 계정] 잔액(취득원가·감가상각누계액·장부가액)은?', needs: ['month?', 'asset?'], run: function (c) {
    var asOfYm = c.m.asOf.slice(0, 7), endDate = c.month && c.month !== asOfYm ? (function () { var y = +c.month.slice(0, 4), mo = +c.month.slice(5); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); })() : c.m.asOf;
    var all = BM.assets(c.m, endDate);
    if (!all.length) return { headline: '분개장에서 유형자산 계정(기계장치 등)을 찾지 못했습니다. 계정코드가 더존 체계(206 기계장치 등)여야 합니다.', body: '', notes: [] };
    var sel = c.asset ? all.filter(function (a) { return a.name === c.asset; }) : all.filter(function (a) { return !a.incomplete; });
    var skipped = c.asset ? [] : all.filter(function (a) { return a.incomplete; });
    if (!sel.length) return { headline: (c.asset || '') + ' 계정에 ' + endDate + '까지 입력된 금액이 없습니다.', body: '', notes: [] };
    var T = { cost: BM.sum(sel, function (a) { return a.cost; }), accum: BM.sum(sel, function (a) { return a.accum; }) };
    var lastAcc = sel.reduce(function (t, a) { return a.lastAccum > t ? a.lastAccum : t; }, '');
    var label = c.asset || '유형자산 합계';
    var bad = c.asset && sel[0].incomplete;
    var head;
    if (bad) head = label + ': 분개장에 기초 잔액이 없어 금액을 확정할 수 없습니다. 분개장 기간 안의 증감만 보면 취득원가 ' + BM.won(T.cost) + ', 감가상각누계액 ' + BM.won(T.accum) + '입니다.';
    else head = label + ' (' + endDate + ' 분개장 기준): 취득원가 ' + BM.won(T.cost) + ', 감가상각누계액 ' + BM.won(T.accum) + (lastAcc ? '(' + lastAcc + '까지 반영)' : '') + ', 장부가액 ' + BM.won(T.cost - T.accum) + '.';
    // 감가상각이 분기 단위로만 입력되므로, 마지막 반영일 이후 지난 분기 수만큼 직전 분기 상각액을 더 빼 본 추정치를 함께 준다
    var qEnds = []; if (lastAcc) { var y0 = +lastAcc.slice(0, 4); for (var yy = y0; yy <= +endDate.slice(0, 4); yy++) ['03-31', '06-30', '09-30', '12-31'].forEach(function (d) { var dt = yy + '-' + d; if (dt > lastAcc && dt <= endDate) qEnds.push(dt); }); }
    var estNote = '';
    if (!bad && qEnds.length && sel.length === 1 && sel[0].lastDep > 0) {
      var estBook = Math.max(0, sel[0].book - sel[0].lastDep * qEnds.length);
      head += ' 결산 전 ' + qEnds.length + '개 분기(' + qEnds.map(function (d) { return d.slice(0, 7); }).join(', ') + ') 감가상각을 직전 분기 상각액 ' + BM.won(sel[0].lastDep) + '으로 추정해 빼면 장부가액 약 ' + BM.won(estBook) + '(추정' + (sel[0].book - sel[0].lastDep * qEnds.length < 0 ? ', 상각 완료로 0원이 하한' : '') + ').';
    } else if (!bad && qEnds.length) estNote = '결산되지 않은 ' + qEnds.length + '개 분기(' + qEnds.map(function (d) { return d.slice(0, 7); }).join(', ') + ')의 감가상각은 반영되지 않았습니다. 자산별로 물으면 직전 분기 상각액 기준 추정치를 함께 알려 드립니다.';
    var rows = all.map(function (a) { return [esc(a.name) + (a.incomplete ? ' <span class="badge warn">기초 잔액 누락</span>' : ''), BM.won(a.cost), BM.won(a.accum), BM.won(a.book), a.lastDate || '-', a.lastAccum || '-']; });
    var okAll = all.filter(function (a) { return !a.incomplete; });
    if (!c.asset) rows.push(['<b>합계 (기초 잔액 누락 계정 제외)</b>', '<b>' + BM.won(BM.sum(okAll, function (a) { return a.cost; })) + '</b>', '<b>' + BM.won(BM.sum(okAll, function (a) { return a.accum; })) + '</b>', '<b>' + BM.won(BM.sum(okAll, function (a) { return a.book; })) + '</b>', '', '']);
    var j0 = c.m.rows.reduce(function (t, r) { return r.date < t ? r.date : t; }, '9999');
    var notes = ['분개장 시작일(' + j0 + ') 이전의 기초 잔액이 분개장에 없어, 이 숫자는 분개장 기간 안의 취득·처분·상각만 반영합니다. 그 이전에 취득한 자산이 있으면 실제보다 적게 나옵니다.'];
    sel.forEach(function (a) { if (!a.incomplete && a.firstDate > j0) notes.push(a.name + '의 첫 취득일은 ' + a.firstDate + '로 분개장 기간 안입니다. 그 이전부터 보유한 ' + a.name + '이 없다면 이 숫자가 전체입니다.'); });
    if (skipped.length) notes.push('기초 잔액이 분개장에 없어 합계에서 뺀 계정: ' + skipped.map(function (a) { return a.name; }).join(', ') + '. (취득원가가 없거나 마이너스인데 감가상각누계액만 있는 계정입니다.)');
    notes.push('감가상각누계액은 자산 계정 바로 다음 코드의 계정(예: 206 기계장치 ↔ 207)으로 짝지었습니다. 정부보조금 같은 차감 계정은 반영하지 않았습니다.');
    if (estNote) notes.push(estNote);
    return { headline: head, body: '<div class="hint">단위: 원</div>' + tbl(['계정', '취득원가', '감가상각누계액', '장부가액', '최근 변동일', '누계액 최근 반영일'], rows, [1, 2, 3]), notes: notes, status: qEnds.length ? '추정' : '잠정' };
  } });

  /* 18. 범위 밖(예측) 질문: 정직하게 한계를 밝힌다 */
  Q.push({ id: 'q18', hidden: true, label: '앞으로 매출은 어떻게 될까?', needs: [], run: function (c) {
    var last = c.pl.filter(function (b) { return b.rev > 0; }).slice(-4, -1), avg = last.length ? sumBy(last, function (b) { return b.rev; }) / last.length : 0;
    return { headline: '이 도구는 장부에 기록된 과거 자료를 분석하며 미래 매출은 예측하지 않습니다.' + (avg ? ' 참고로 최근 ' + last.length + '개월(' + last.map(function (b) { return (+b.ym.slice(5)) + '월'; }).join('·') + ') 월평균 매출은 ' + BM.won(avg) + '입니다.' : ''), status: '잠정',
      body: '', notes: ['예측에는 거래처별 계약 물량, 단가 변경, 계절성 같은 가정이 필요하고 이 도구에는 그런 정보가 없습니다. 위 평균은 예측이 아니라 과거 평균입니다.'] };
  } });


  /* ---------- 질문 카탈로그: 질문마다 필요한 자료와 계산 정의를 선언한다 ----------
     새 질문을 추가할 때는 (1) 필요한 자료, (2) 정의, (3) 결과 구분을 반드시 여기에 적고,
     (4) tools/sweep_verify.js 에 독립 계산 검증을 추가해야 한다. */
  var META = {
    q1:  { group: '지급·입금', requires: ['journal'], optional: ['업체마스터(결제기한)'], status: '추정', def: '미지급금 계정의 업체별 미결 잔액(선입선출). 예정일 = 발생일 + (업체마스터 결제기한, 없으면 그 업체의 과거 평균 결제일).' },
    q2:  { group: '지급·입금', requires: ['journal'], optional: [], status: '잠정', def: '보통예금·당좌예금이 차변에 오른 전표에서, 외상매출금·선수금·미수금·받을어음·부가세예수금·매출 계정의 대변 줄 중 해당 업체·해당 월의 합(은행 수수료 차감 전 금액). 전표 입력일 기준이라 실제 입금일과 다를 수 있음.' },
    q3:  { group: '지급·입금', requires: ['journal'], optional: ['업체마스터(결제기한)'], status: '추정', def: '외상매출금·미지급금 미결 항목 중 예정일이 해당 월인 금액과 이미 기한이 지난 금액.' },
    q4:  { group: '비용', requires: ['journal'], optional: [], status: '확정', def: '해당 월 계정과목의 차변-대변 합. 제조·판관비·영업외비용의 (제)(도)(분)(판) 구분은 합산. 결산 대체 줄은 제외.' },
    q5:  { group: '비용', requires: ['journal'], optional: [], status: '확정', def: '해당 월 비용을 직전 3개월 평균과 비교. 감가상각·퇴직급여·충당부채는 제외.' },
    q6:  { group: '손익', requires: ['journal'], optional: [], status: '추정', def: '장부 손익, 발생비용 기준 손익, 결산성 비용을 더한 관리용 추정 손익을 연결표로 제시.' },
    q7:  { group: '비용', requires: ['journal'], optional: [], status: '확정', def: '최근 3개월 월평균 비용 항목 순위. 절감 가능 여부를 판단하지 않음.' },
    q8:  { group: '손익', requires: ['journal'], optional: ['거래내역(변동비 기준, 권장)'], status: '추정', def: '변동비 = 거래내역의 반출 처리·운반비(없으면 계정 이름으로 추정한 초안). 변동비율 = 월별 매출 증감 대비 변동비 증감의 평균(매출 변화가 평균의 10% 미만인 달 쌍 제외, 2쌍 미만이면 기간 평균). 고정비 = 발생비용 - 변동비 - 영업외수익 + 결산성 비용 분기 평균 월할. 손익분기 매출 = 고정비 ÷ 공헌이익률을 세전이익·EBITDA(감가상각·이자·영업외 제외)·현금(비현금 비용 제외, 이자 포함) 3기준으로 제시. 원금상환·설비투자·운전자본·세금은 제외.' },
    q9:  { group: '통장', requires: ['journal'], optional: ['기준일 통장 잔액(입력)'], status: '추정', def: '입력한 기준일 잔액 + 이후 보통예금 증감. 기준 잔액이 없으면 증감만 표시.' },
    q10: { group: '업체별', requires: ['journal', 'trades'], optional: [], status: '확정', def: '거래내역 월별 가중평균 단가(금액÷수량). 분개장 매출과 월별 대조.' },
    q11: { group: '업체별', requires: ['journal', 'trades'], optional: [], status: '확정', def: '거래내역 중 처리비 행의 수량 합(kg·톤).' },
    q12: { group: '미수·미지급', requires: ['journal'], optional: [], status: '확정', def: '외상매출금의 업체별 순잔액(차변-대변). 연령은 청구일(전표일) 기준 선입선출. 마이너스 업체는 기초 잔액 누락으로 보고 제외.' },
    q13: { group: '미수·미지급', requires: ['journal'], optional: ['업체마스터(결제기한)'], status: '추정', def: '미지급금의 업체별 순잔액. 도래·경과 구분은 결제 이력 기반 추정.' },
    q14: { group: '매출', requires: ['journal'], optional: ['거래내역(대조)'], status: '잠정', def: '매출 계정(4xx, 매출원가 제외)의 대변-차변 합. 거래내역 매출과 대조.' },
    q15: { group: '비용', requires: ['journal'], optional: [], status: '잠정', def: '해당 월 제조원가·판관비·영업외비용 합계와 큰 항목 순위.' },
    q16: { group: '비용', requires: ['journal'], optional: [], status: '잠정', def: '직전 달(또는 지정한 기준 달) 대비 계정별 증가액 순위.' },
    q17: { group: '점검', requires: ['journal'], optional: ['거래내역(매출 대조)'], status: '확정', def: '차대 불균형 전표, 중복 입력 의심, 수량×단가 불일치, 기초 잔액 누락, 거래내역과의 매출 대조 결과.' },
    q19: { group: '통장', requires: ['journal'], optional: [], status: '잠정', def: '보통예금·당좌예금(·현금)의 전표별 순증감을 구해 감소한 전표는 출금, 증가한 전표는 입금으로 합산하고, 상대 계정별 순액으로 구성을 나눔. 전표일 기준(실제 이체일과 다를 수 있음). 비용이 아닌 출금(대출 상환, 외상대금 결제)을 포함.' },
    q20: { group: '손익', requires: ['journal'], optional: [], status: '잠정', def: '분개장 계정별 월 금액(결산 전표 포함)으로 손익계산서 형식(매출-매출원가-판관비-영업외)을 구성하고 월별과 누계를 표시. 매출원가가 결산되지 않은 달이 있으면 장부 이익이 높게 나오므로 발생비용 기준·관리용 추정 손익을 참고로 함께 표시.' },
    q21: { group: '손익', requires: ['journal'], optional: [], status: '추정', def: '매출이익률=매출총이익률=(매출-매출원가)÷매출. 결산이 끝난 분기는 장부 매출원가, 결산 전 달은 그 달 발생 제조원가(+아직 입력되지 않은 결산성 제조원가의 직전 결산 분기 평균 추정)를 매출원가로 대용. 결산된 분기에 같은 방식을 적용한 오차를 함께 표시.' },
    q22: { group: '자산', requires: ['journal'], optional: [], status: '잠정', def: '더존 계정코드 쌍(206 기계장치↔207 감가상각누계액 등)으로 분개장 기간 안의 (차변-대변) 합을 취득원가, 누계액의 (대변-차변) 합을 감가상각누계액으로 하고 장부가액 = 취득원가 - 누계액. 기초 잔액과 결산 전 감가상각은 반영되지 않음.' },
    q18: { group: '범위 밖', requires: ['journal'], optional: [], status: '잠정', def: '예측하지 않음. 최근 3개월 평균 매출만 참고로 제시.' }
  };
  Q.forEach(function (q) { var m = META[q.id]; if (m) { q.group = m.group; q.requires = m.requires; q.optional = m.optional; q.baseStatus = m.status; q.def = m.def; } });

  function tile(l, v, n) { return '<div class="card tile"><div class="label">' + esc(l) + '</div><div class="value">' + v + '</div>' + (n ? '<div class="note">' + esc(n) + '</div>' : '') + '</div>'; }
  BM.fmtAsOf = function (c) { return c.m.asOf + ' 분개장'; };
})(typeof window !== 'undefined' ? window : globalThis);
