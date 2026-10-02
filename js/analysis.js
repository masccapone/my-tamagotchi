/* 분석 모듈: 표준 모델 위에서 동작하는 순수 계산 함수들 */
(function (g) {
  'use strict';
  var BM = g.BM;

  function monthKeys(m) { return m.months; }

  /* ---------- 월별 손익 ---------- */
  var LUMPY = [
    ['감가상각', /감가상각/],
    ['퇴직급여', /퇴직급여/],
    ['충당부채전입', /충당부채전입/],
    ['주식보상비용', /주식보상/],
    ['이자비용', /^이자비용$/]
  ];
  function lumpyCat(acct) {
    for (var i = 0; i < LUMPY.length; i++) if (LUMPY[i][1].test(acct)) return LUMPY[i][0];
    return null;
  }
  function qOf(ym) { return ym.slice(0, 4) + 'Q' + Math.ceil(+ym.slice(5) / 3); }
  function qMonths(q) { var y = q.slice(0, 4), n = +q.slice(5); return [0, 1, 2].map(function (i) { return y + '-' + ('0' + (n * 3 - 2 + i)).slice(-2); }); }

  /* 계정별 월 금액의 단일 출처. 월별 손익, 비용 조회, ERP 보고서 대조가 모두 이 함수를 쓴다.
     결산 전표 중 제조원가·판관비 계정의 대변(재공품·원가 대체 줄)은 발생비용이 아니므로 뺀다.
     반환: { revenue|cogs|prod|sga|nonop_out|nonop_in : { 계정명: { 'YYYY-MM': 금액 } } }
     금액 부호: 수익은 대변-차변, 비용은 차변-대변 */
  BM.accountMonthly = function (m) {
    var out = { revenue: {}, cogs: {}, prod: {}, sga: {}, nonop_out: {}, nonop_in: {} };
    m.rows.forEach(function (r) {
      var o = out[r.cls];
      if (!o) return;
      var transfer = r.closing && r.dr === 0 && r.cr !== 0 && (r.cls === 'prod' || r.cls === 'sga');
      if (transfer) return;
      var v = (r.cls === 'revenue' || r.cls === 'nonop_in') ? r.cr - r.dr : r.dr - r.cr;
      var a = o[r.acct] = o[r.acct] || {};
      a[r.ym] = (a[r.ym] || 0) + v;
    });
    return out;
  };

  BM.monthlyPL = function (m) {
    var by = {}, acc = BM.accountMonthly(m);
    m.months.forEach(function (ym) { by[ym] = { ym: ym, rev: 0, prod: 0, sga: 0, nonopOut: 0, nonopIn: 0, cogsBook: 0, lumpy: 0, lumpyCat: {} }; });
    var field = { revenue: 'rev', cogs: 'cogsBook', prod: 'prod', sga: 'sga', nonop_out: 'nonopOut', nonop_in: 'nonopIn' };
    Object.keys(field).forEach(function (cls) {
      Object.keys(acc[cls]).forEach(function (acct) {
        Object.keys(acc[cls][acct]).forEach(function (ym) {
          var b = by[ym], v = acc[cls][acct][ym];
          b[field[cls]] += v;
          if (cls === 'prod' || cls === 'sga' || cls === 'nonop_out') {
            var lc = lumpyCat(acct);
            if (lc) { b.lumpy += v; b.lumpyCat[lc] = (b.lumpyCat[lc] || 0) + v; }
          }
        });
      });
    });
    var list = m.months.map(function (ym) {
      var b = by[ym];
      b.incurred = b.prod + b.sga + b.nonopOut;
      b.plBook = b.rev - b.cogsBook - b.sga + b.nonopIn - b.nonopOut;      // 손익계산서 기준
      b.plIncurred = b.rev - b.incurred + b.nonopIn;                       // 발생비용 기준
      b.estAdj = 0; b.estAdjLow = 0; b.estAdjHigh = 0; b.plEst = b.plIncurred; b.plEstLow = b.plIncurred; b.plEstHigh = b.plIncurred;
      b.flags = [];
      return b;
    });
    list.estimate = estimateSettlement(m, list);
    var revs = list.map(function (b) { return b.rev; }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    var med = revs.length ? revs[Math.floor(revs.length / 2)] : 0;
    var lastYm = m.asOf ? m.asOf.slice(0, 7) : null;
    list.forEach(function (b) {
      if (b.rev > 0 && b.prod > 0 && b.cogsBook === 0) b.flags.push({ k: 'cogs', t: '원가 미결산' });
      if (b.rev < 0 || b.incurred < 0) b.flags.push({ k: 'adj', t: '결산 조정(마이너스) 포함' });
      if (b.rev > 0 && med > 0 && b.rev < med * 0.3) b.flags.push({ k: 'drop', t: '매출 급감(마감 확인)' });
      if (b.estAdj > 0) b.flags.push({ k: 'est', t: '결산성 비용 예상 반영' });
      if (b.ym === lastYm && +m.asOf.slice(8) < 25) b.flags.push({ k: 'partial', t: '진행 중인 달' });
    });
    return list;
  };

  /* 분기 말에만 반영되는 결산성 비용(감가상각, 퇴직급여, 충당부채, 주식보상, 이자 정산)이 아직 입력되지 않은 분기를
     직전 결산 완료 분기(최대 2개)의 평균으로 추정한다. 진행 중인 분기는 경과 일수만큼만 반영한다. */
  var CORE = ['감가상각', '퇴직급여', '충당부채전입', '주식보상비용'];
  function estimateSettlement(m, list) {
    var q = {};
    list.forEach(function (b) {
      var k = qOf(b.ym), o = q[k] = q[k] || { q: k, tot: {}, dep: 0 };
      Object.keys(b.lumpyCat).forEach(function (c) { o.tot[c] = (o.tot[c] || 0) + b.lumpyCat[c]; });
      o.dep = o.tot['감가상각'] || 0;
    });
    var qs = Object.keys(q).sort();
    var settled = qs.filter(function (k) { return q[k].dep > 0 && qEnded(m, k); });
    var out = { available: false, basis: [], quarters: [], perQuarter: {}, perQuarterTotal: 0, backtest: null, confidence: { '이자비용': '낮음' } };
    if (!settled.length) return out;
    var basis = settled.slice(-2);
    var avg = {};
    basis.forEach(function (k) { Object.keys(q[k].tot).forEach(function (c) { avg[c] = (avg[c] || 0) + q[k].tot[c] / basis.length; }); });
    out.available = true; out.basis = basis; out.perQuarter = avg;
    out.perQuarterTotal = BM.sum(Object.keys(avg), function (c) { return avg[c]; });

    // 역검증: 가장 최근 결산 분기를 그 직전 결산 분기 값으로 추정했다면 얼마나 틀렸는가
    if (settled.length >= 2) {
      var lastQ = settled[settled.length - 1], prevQ = settled[settled.length - 2];
      var grp = function (cats, tot) { return BM.sum(cats, function (c) { return tot[c] || 0; }); };
      var core = { actual: grp(CORE, q[lastQ].tot), est: grp(CORE, q[prevQ].tot) };
      var intr = { actual: q[lastQ].tot['이자비용'] || 0, est: q[prevQ].tot['이자비용'] || 0 };
      [core, intr].forEach(function (x) { x.err = x.actual > 0 && x.est > 0 ? (x.est - x.actual) / x.actual : null; });
      out.backtest = { actualQ: lastQ, basisQ: prevQ, core: core, interest: intr };
    }

    var lastSettled = settled[settled.length - 1];
    qs.filter(function (k) { return k > lastSettled && q[k].dep <= 0; }).forEach(function (k) {
      var frac = qFrac(m, k);
      if (frac < 0.15) return;
      var miss = {}, tot = 0, lo = 0, hi = 0;
      Object.keys(avg).forEach(function (c) {
        var booked = q[k].tot[c] || 0, mid = Math.max(0, avg[c] * frac - booked), l = mid, h = mid;
        if (c === '이자비용') {
          var vals = basis.map(function (b) { return q[b].tot[c] || 0; });
          l = Math.max(0, Math.min.apply(null, vals) * frac - booked);
          h = Math.max(0, Math.max.apply(null, vals) * frac - booked);
        }
        if (mid > 0 || h > 0) { miss[c] = mid; tot += mid; lo += l; hi += h; }
      });
      if (tot <= 0) return;
      var ms = qMonths(k).filter(function (ym) { return by(list, ym); });
      ms.forEach(function (ym) {
        var b = by(list, ym);
        b.estAdj = tot / ms.length; b.estAdjLow = lo / ms.length; b.estAdjHigh = hi / ms.length;
        b.plEst = b.plIncurred - b.estAdj; b.plEstLow = b.plIncurred - b.estAdjHigh; b.plEstHigh = b.plIncurred - b.estAdjLow;
      });
      out.quarters.push({ q: k, frac: frac, missing: miss, total: tot, low: lo, high: hi, booked: q[k].tot });
    });
    return out;
  }
  function by(list, ym) { for (var i = 0; i < list.length; i++) if (list[i].ym === ym) return list[i]; return null; }
  function qEnded(m, k) { var e = qMonths(k)[2]; return m.asOf.slice(0, 7) > e || (m.asOf.slice(0, 7) === e && +m.asOf.slice(8) >= 28); }
  function qFrac(m, k) {
    var ms = qMonths(k), s = Date.UTC(+ms[0].slice(0, 4), +ms[0].slice(5) - 1, 1), e = Date.UTC(+ms[2].slice(0, 4), +ms[2].slice(5), 1);
    return Math.max(0, Math.min(1, (m.asOfT + 86400000 - s) / (e - s)));
  }
  BM.qOf = qOf;

  /* ---------- 채권/채무 (FIFO) ---------- */
  BM.openItems = function (m, kind) {
    var re = kind === 'AR' ? BM.AR_ACCTS : BM.AP_ACCTS;
    var sign = kind === 'AR' ? 1 : -1;       // AR: 차변-대변, AP: 대변-차변
    var perV = {};
    m.rows.forEach(function (r) {
      if (!re.test(r.acct)) return;
      var amt = sign * (r.dr - r.cr);
      if (!amt) return;
      var k = r.vk || '__none__';
      (perV[k] = perV[k] || []).push({ r: r, amt: amt });
    });
    var all = [], allHist = { n: 0, w: 0, amt: 0 };
    Object.keys(perV).forEach(function (k) {
      var lots = [], excess = 0, hist = { n: 0, w: 0, amt: 0 }, bal = 0;
      perV[k].forEach(function (e) {
        bal += e.amt;
        if (e.amt > 0) {
          var a = e.amt;
          if (excess > 0) { var t = Math.min(excess, a); excess -= t; a -= t; }
          if (a > 0.5) lots.push({ t: e.r.t, iso: e.r.date, amt: a, memo: e.r.memo, no: e.r.no });
        } else {
          var rem = -e.amt;
          while (rem > 0.5 && lots.length) {
            var take = Math.min(rem, lots[0].amt);
            var days = BM.dayDiff(e.r.t, lots[0].t);
            hist.n++; hist.w += days * take; hist.amt += take;
            lots[0].amt -= take; rem -= take;
            if (lots[0].amt <= 0.5) lots.shift();
          }
          if (rem > 0.5) excess += rem;
        }
      });
      var v = { key: k, name: m.vendorName(k === '__none__' ? '' : k), balance: bal, lots: lots,
        histDays: hist.amt ? hist.w / hist.amt : null, histN: hist.n, opening: bal < -5e6 };
      all.push(v);
      allHist.n += hist.n; allHist.w += hist.w; allHist.amt += hist.amt;
    });
    var globalDays = allHist.amt ? allHist.w / allHist.amt : 30;
    all.forEach(function (v) {
      var md = m.payDaysOf(v.key), src, days;
      if (md != null) { days = md; src = '업체마스터 결제기한'; }
      else if (v.histN >= 2 && v.histDays != null) { days = v.histDays; src = '과거 평균 ' + Math.round(v.histDays) + '일(' + v.histN + '건)'; }
      else { days = globalDays; src = '전체 평균 ' + Math.round(globalDays) + '일'; }
      v.payDays = days; v.paySrc = src;
      v.lots.forEach(function (l) {
        l.expT = BM.addDays(l.t, Math.round(days)); l.expIso = BM.isoOf(l.expT);
        l.age = BM.dayDiff(m.asOfT, l.t); l.overdue = l.expT < m.asOfT;
      });
      v.open = BM.sum(v.lots, function (l) { return l.amt; });
    });
    all.sort(function (a, b) { return b.open - a.open; });
    return { vendors: all, globalDays: globalDays };
  };

  BM.aging = function (items) {
    var b = { d30: 0, d60: 0, d90: 0, d180: 0, over: 0 };
    items.vendors.forEach(function (v) {
      v.lots.forEach(function (l) {
        var k = l.age <= 30 ? 'd30' : l.age <= 60 ? 'd60' : l.age <= 90 ? 'd90' : l.age <= 180 ? 'd180' : 'over';
        b[k] += l.amt;
      });
    });
    return b;
  };

  /* ---------- 입금(수금) ----------
     고객이 돈을 보내면 전표에는 보통예금 차변(거래처는 은행 계좌)과 외상매출금 등 대변(거래처는 고객)이 함께 입력된다.
     그래서 입금은 "현금 계정이 차변에 오른 전표의 매출 관련 대변 줄"을 그 거래처의 입금으로 센다. */
  var RECEIPT_ACCT = /^(외상매출금|선수금|미수금|받을어음|부가세예수금)$/;
  BM.receipts = function (m) {
    var groups = {}, out = [];
    m.rows.forEach(function (r) { var k = r.date + '|' + r.no; (groups[k] = groups[k] || []).push(r); });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (!g.some(function (r) { return BM.CASH_ACCTS.test(r.acct) && r.dr > 0; })) return;
      g.forEach(function (r) {
        if (BM.CASH_ACCTS.test(r.acct) || !(r.cr > 0 && r.dr === 0)) return;
        if (!(RECEIPT_ACCT.test(r.acct) || r.cls === 'revenue')) return;
        out.push({ date: r.date, ym: r.ym, t: r.t, no: r.no, vk: r.vk, vendor: r.vendor, acct: r.acct, amt: r.cr, memo: r.memo });
      });
    });
    return out;
  };

  /* ---------- 현금(통장) ---------- */
  BM.cashRows = function (m) { return m.rows.filter(function (r) { return BM.CASH_ACCTS.test(r.acct); }); };

  /* ---------- 거래내역 기반: 물량, 단가 ---------- */
  function toKg(t) { return /톤|ton/i.test(t.unit) ? t.qty * 1000 : /^kg$/i.test(t.unit) ? t.qty : null; }
  BM.toKg = toKg;

  BM.volumes = function (m, vk, ym) {
    var out = { inKg: 0, outKg: 0, n: 0 };
    if (!m.trades) return out;
    m.trades.rows.forEach(function (t) {
      if (t.vk !== vk || (ym && t.ym !== ym)) return;
      var kg = toKg(t);
      if (kg == null || !/처리/.test(t.kind || '처리비')) return;     // 수량은 처리비 행에만 센다(운반비 행과 이중 집계 방지)
      if (t.flow === '매출') out.inKg += kg; else out.outKg += kg;
      out.n++;
    });
    return out;
  };

  BM.unitPrices = function (m, vk) {
    var res = {};
    if (!m.trades) return res;
    m.trades.rows.forEach(function (t) {
      if (t.vk !== vk || !t.qty) return;
      var k = t.flow + '|' + (t.kind || '단가') + '|' + (t.unit || '');
      var o = res[k] = res[k] || { flow: t.flow, kind: t.kind || '단가', unit: t.unit, months: {} };
      var b = o.months[t.ym] = o.months[t.ym] || { amt: 0, qty: 0, last: 0, lastT: 0, min: Infinity, max: -Infinity };
      b.amt += t.amt; b.qty += t.qty;
      if (t.price) { b.min = Math.min(b.min, t.price); b.max = Math.max(b.max, t.price); }
      if (t.t >= b.lastT) { b.lastT = t.t; b.last = t.price; }
    });
    Object.keys(res).forEach(function (k) {
      var o = res[k], yms = Object.keys(o.months).sort();
      o.series = yms.map(function (ym) { var b = o.months[ym]; return { ym: ym, avg: b.qty ? b.amt / b.qty : 0, last: b.last, min: b.min, max: b.max }; });
      o.latest = o.series[o.series.length - 1];
      o.changed = o.series.length > 1 && Math.abs(o.series[o.series.length - 1].avg - o.series[o.series.length - 2].avg) > 0.5;
    });
    return res;
  };

  /* ---------- 대조 / 데이터 점검 ---------- */
  BM.reconcile = function (m, pl) {
    var out = { months: [], warnings: [] };
    if (m.trades && m.trades.rows.length) {
      var tr = {}, firstT = Infinity;
      m.trades.rows.forEach(function (t) { if (t.flow === '매출') tr[t.ym] = (tr[t.ym] || 0) + t.amt; if (t.t < firstT) firstT = t.t; });
      var firstIso = BM.isoOf(firstT), firstYm = firstIso.slice(0, 7);
      var jr = {};
      m.rows.forEach(function (r) { if (r.cls === 'revenue' && /용역|처리|운반/.test(r.acct)) jr[r.ym] = (jr[r.ym] || 0) + r.cr - r.dr; });
      var asOfYm = m.asOf.slice(0, 7), partialAsOf = +m.asOf.slice(8) < 25;
      var cumT = 0, cumJ = 0, lastEval = null;
      Object.keys(tr).sort().forEach(function (ym) {
        var a = tr[ym], b = jr[ym] || 0;
        var row = { ym: ym, trades: a, journal: b, diff: a - b, note: '' };
        var skip = (ym === firstYm && +firstIso.slice(8) > 3) || (ym === asOfYm && partialAsOf);
        if (ym === firstYm && +firstIso.slice(8) > 3) row.note = '거래내역이 ' + (+firstIso.slice(5, 7)) + '/' + (+firstIso.slice(8)) + '부터 있음';
        if (ym === asOfYm && partialAsOf) row.note = '진행 중인 달';
        if (!skip) {
          cumT += a; cumJ += b;
          row.cumDiff = cumT - cumJ;
          row.cumT = cumT; row.cumJ = cumJ;
          row.flag = Math.abs(row.cumDiff) > Math.max(0.05 * cumT, 20e6);
          lastEval = row;
        }
        out.months.push(row);
      });
      if (lastEval && lastEval.flag) {
        out.warnings.push({ lvl: 'bad', t: BM.ymLabel(lastEval.ym) + '까지 누적 매출이 거래내역 ' + BM.eok(lastEval.cumT) + ' vs 분개장 ' + BM.eok(lastEval.cumJ) + ' (차이 ' + BM.eok(Math.abs(lastEval.cumDiff)) + '). ' + (lastEval.cumDiff > 0 ? '분개장에 매출이 덜 입력됐을 수 있습니다.' : '거래내역에 누락이 있을 수 있습니다.') });
      }
    }
    // 거래내역: 수량 × 단가 ≠ 금액
    if (m.trades && m.trades.rows.length) {
      var bad = m.trades.rows.filter(function (r) { return r.qty && r.price && Math.abs(r.qty * r.price - r.amt) > Math.max(0.01 * Math.abs(r.amt), 1000); });
      if (bad.length) out.warnings.push({ lvl: 'warn', t: '거래내역 ' + bad.length + '건은 수량×단가가 금액과 다릅니다 (예: ' + bad[0].date + ' ' + bad[0].vendor + '). 금액을 직접 적은 경우일 수 있으니 확인하세요.' });
    }
    // 분개장: 다른 전표번호로 같은 날·같은 거래처·같은 금액·같은 적요가 반복된 경비(중복 입력 의심)
    var dupK = {};
    m.rows.forEach(function (r) {
      if ((r.cls !== 'prod' && r.cls !== 'sga') || r.closing || !r.memo || !r.vk) return;
      var amt = r.dr - r.cr; if (amt <= 0) return;
      var k = [r.date, r.vk, amt, r.memo].join('|');
      (dupK[k] = dupK[k] || {})[r.no] = 1;
    });
    var dupN = Object.keys(dupK).filter(function (k) { return Object.keys(dupK[k]).length > 1; });
    if (dupN.length) out.warnings.push({ lvl: 'warn', t: '다른 전표번호로 날짜·거래처·금액·적요가 모두 같은 경비 ' + dupN.length + '건이 있습니다 (중복 입력 의심, 예: ' + dupN[0].split('|')[0] + ' ' + (m.vendorName(dupN[0].split('|')[1])) + ').' });
    // 차대 불균형 전표
    var v = {};
    m.rows.forEach(function (r) { var k = r.date + '|' + r.no; v[k] = (v[k] || 0) + r.dr - r.cr; });
    Object.keys(v).forEach(function (k) {
      if (Math.abs(v[k]) > 1) out.warnings.push({ lvl: 'bad', t: '전표 ' + k.replace('|', ' #') + ' 의 차변·대변이 ' + BM.won(Math.abs(v[k])) + ' 차이납니다 (입력 오류 확인 필요).' });
    });
    // 기초 잔액 누락 의심 (채무/채권이 음수인 업체)
    ['AR', 'AP'].forEach(function (kind) {
      var it = BM.openItems(m, kind);
      var bad = it.vendors.filter(function (x) { return x.opening; });
      if (bad.length) out.warnings.push({ lvl: 'warn', t: (kind === 'AR' ? '매출채권' : '미지급금') + ' 잔액이 마이너스인 업체 ' + bad.length + '곳 (' + bad.slice(0, 3).map(function (x) { return x.name; }).join(', ') + (bad.length > 3 ? ' 등' : '') + '): 이전 연도 기초 잔액이 분개장에 없는 것으로 보입니다. 이 업체의 잔액은 계산에서 제외합니다.' });
    });
    // 원가 미결산: 마지막으로 매출원가가 결산된 달 이후
    var settled = pl.filter(function (b) { return b.cogsBook > 0; }).map(function (b) { return b.ym; });
    var lastSettled = settled.length ? settled[settled.length - 1] : null;
    var after = pl.filter(function (b) { return (!lastSettled || b.ym > lastSettled) && (b.rev > 0 || b.prod > 0); });
    var est = pl.estimate;
    if (after.length) {
      var tail = est && est.available && est.quarters.length
        ? ' 감가상각·퇴직급여·이자 정산 등 결산성 비용 약 ' + BM.eok(BM.sum(est.quarters, function (x) { return x.total; })) + '(직전 결산 분기 평균 기준 추정)을 "결산 예상 반영" 손익에 더했습니다.'
        : ' 발생비용 기준 손익에는 분기 말 결산성 비용(감가상각 등)이 빠져 있습니다.';
      out.warnings.push({ lvl: 'warn', t: '손익계산서상 매출원가는 ' + (lastSettled ? BM.ymLabel(lastSettled) + '까지만' : '아직') + ' 결산되어 있습니다. 이후 ' + after.map(function (b) { return (+b.ym.slice(5)) + '월'; }).join('·') + '의 손익계산서 손익은 원가가 빠져 있습니다.' + tail });
    }
    if (m.dupRows) out.warnings.push({ lvl: 'warn', t: '분개장 파일 간 겹치는 전표 ' + m.dupRows + '행은 한 번만 반영했습니다.' });
    return out;
  };

  /* ---------- BEP ---------- */
  var VAR_RE = /운반비|전력비|지급수수료|수선비|소모품비|차량유지비|수도광열비|외주|원재료|충당부채전입/;
  BM.bep = function (m, pl, months, useEst) {
    var set = {}; months.forEach(function (x) { set[x] = 1; });
    var sel = pl.filter(function (b) { return set[b.ym]; });
    var out = { months: months, notes: [], monthly: [] };
    var inc = BM.sum(sel, function (b) { return b.incurred; });
    var est = pl.estimate, smooth = useEst !== false && est && est.available;
    var n = months.length;
    // 결산성 비용 항목별 합계(선택 기간): 분기 말에 몰아 입력되므로 추정 반영 시 분기 평균을 월할로 쓴다
    function lump(cat) {
      return smooth ? n * (est.perQuarter[cat] || 0) / 3 : BM.sum(sel, function (b) { return b.lumpyCat[cat] || 0; });
    }
    if (smooth) {
      var booked = BM.sum(sel, function (b) { return b.lumpy; });
      inc = inc - booked + months.length * est.perQuarterTotal / 3;
      out.smoothed = months.length * est.perQuarterTotal / 3;
      out.notes.push('감가상각·퇴직급여·충당부채·이자 정산 등 분기 말 결산성 비용은 직전 결산 분기(' + est.basis.map(function (x) { return x.replace('Q', '년 ') + '분기'; }).join(', ') + ') 평균을 월할로 반영한 추정입니다.');
    }
    var nonopIn = BM.sum(sel, function (b) { return b.nonopIn; });
    var interest = lump('이자비용');
    var nonopOut = BM.sum(sel, function (b) { return b.nonopOut; }) - BM.sum(sel, function (b) { return b.lumpyCat['이자비용'] || 0; }) + interest;
    var acc = BM.accountMonthly(m), amort = 0;
    Object.keys(acc.prod).concat(Object.keys(acc.sga)).forEach(function (k) { /무형자산상각/.test(k) && months.forEach(function (ym) { amort += (acc.prod[k] && acc.prod[k][ym]) || (acc.sga[k] && acc.sga[k][ym]) || 0; }); });
    out.comp = { nonopIn: nonopIn, nonopOut: nonopOut, interest: interest, dep: lump('감가상각') + amort, noncash: lump('퇴직급여') + lump('충당부채전입') + lump('주식보상비용') };
    var byYm = {};
    if (m.trades) {
      var R = 0, V = 0;
      m.trades.rows.forEach(function (t) {
        if (!set[t.ym]) return;
        var o = byYm[t.ym] = byYm[t.ym] || { R: 0, V: 0 };
        if (t.flow === '매출') { R += t.amt; o.R += t.amt; } else { V += t.amt; o.V += t.amt; }
      });
      out.mode = 'trades'; out.R = R; out.V = V; out.F = inc - V - nonopIn;
      out.notes.push('매출과 변동비는 거래내역 기준(반출 처리·운반비를 변동비로 봄), 고정비는 분개장 발생비용에서 변동비와 영업외수익을 뺀 값입니다.');
      if (out.F < 0) out.notes.push('분개장 발생비용이 거래내역의 변동비보다 작습니다. 분개장 입력이 덜 된 달이 포함됐을 수 있습니다.');
    } else {
      var R2 = BM.sum(sel, function (b) { return b.rev; }), V2 = 0;
      sel.forEach(function (b) { byYm[b.ym] = { R: b.rev, V: 0 }; });
      m.rows.forEach(function (r) {
        if (!set[r.ym] || (r.cls !== 'prod' && r.cls !== 'sga' && r.cls !== 'nonop_out')) return;
        if (r.closing && r.dr === 0 && r.cr !== 0 && r.cls !== 'nonop_out') return;
        if (VAR_RE.test(r.acct)) { V2 += r.dr - r.cr; byYm[r.ym].V += r.dr - r.cr; }
      });
      out.mode = 'accounts'; out.R = R2; out.V = V2; out.F = inc - V2 - nonopIn;
      out.notes.push('거래내역이 없어 계정과목 이름으로 변동비를 추정한 초안입니다. 거래내역을 올리면 실제 반출비 기준으로 계산합니다.');
    }
    months.forEach(function (ym) { var o = byYm[ym] || { R: 0, V: 0 }; out.monthly.push({ ym: ym, R: o.R, V: o.V }); });
    out.n = months.length;
    out.cm = out.R - out.V;
    out.cmr = out.R > 0 ? out.cm / out.R : 0;
    out.bepRev = out.cmr > 0.05 ? out.F / out.cmr : null;
    out.achieve = out.bepRev ? out.R / out.bepRev : null;
    out.gap = out.bepRev ? out.bepRev - out.R : null;
    return out;
  };

  /* 손익분기 3기준(세전이익·EBITDA·현금). 매출이 늘 때 변동비가 늘어나는 비율은
     "월별 매출 증감 대비 변동비 증감"을 인접한 달끼리 구해 평균한다(매출 변화가 작은 달은 제외). */
  BM.bep3 = function (b) {
    var n = b.n || 1, c = b.comp, mean = b.R / n;
    var pairs = [];
    for (var i = 1; i < b.monthly.length; i++) {
      var p = b.monthly[i - 1], q = b.monthly[i];
      if ((+q.ym.slice(0, 4)) * 12 + (+q.ym.slice(5)) - (+p.ym.slice(0, 4)) * 12 - (+p.ym.slice(5)) !== 1) continue;
      var dR = q.R - p.R, dV = q.V - p.V;
      pairs.push({ from: p.ym, to: q.ym, dR: dR, dV: dV, ratio: dR !== 0 ? dV / dR : null, used: Math.abs(dR) >= 0.1 * mean });
    }
    var used = pairs.filter(function (x) { return x.used && x.ratio != null; });
    var avgRatio = b.R > 0 ? b.V / b.R : 0, v, vSrc, notes = [];
    if (used.length >= 2) {
      v = BM.sum(used, function (x) { return x.ratio; }) / used.length; vSrc = 'incr';
      var rs = used.map(function (x) { return x.ratio; });
      if (Math.max.apply(null, rs) - Math.min.apply(null, rs) > 0.5) notes.push('월별 변동비 증감 비율이 ' + (Math.min.apply(null, rs) * 100).toFixed(0) + '%~' + (Math.max.apply(null, rs) * 100).toFixed(0) + '%로 들쭉날쭉합니다. 평균은 참고용입니다.');
      if (!(v > 0 && v < 0.95)) { v = avgRatio; vSrc = 'avg'; notes.push('월별 증감으로 구한 변동비율이 비정상 범위라 기간 평균 변동비율을 썼습니다.'); }
    } else { v = avgRatio; vSrc = 'avg'; notes.push('매출이 충분히 변한 달 쌍이 2개 미만이라 증감 방식으로 구할 수 없어 기간 평균 변동비율을 썼습니다.'); }
    var Fop = b.F + c.nonopIn - c.nonopOut;
    var Febitda = Fop - c.dep;
    var Fcash = Febitda - c.noncash + c.interest;
    var cmr = 1 - v;
    var bases = [
      { key: 'pt', name: '세전이익 기준', F: b.F, def: '매출 - 변동비 - 고정비(감가상각·이자 포함) + 영업외수익 = 0' },
      { key: 'ebitda', name: 'EBITDA 기준', F: Febitda, def: '영업이익 + 감가상각 = 0 (감가상각·이자·영업외손익 제외)' },
      { key: 'cash', name: '현금 기준', F: Fcash, def: 'EBITDA 고정비에서 비현금 비용(퇴직급여·충당부채·주식보상)을 빼고 이자 지급을 더한 현금 고정비. 원금상환·설비투자·운전자본·세금 제외' }
    ].map(function (x) {
      var per = x.F / n;
      x.perMonthF = per;
      x.bepMonth = cmr > 0.05 ? Math.max(0, per / cmr) : null;
      x.profitNow = (b.R - b.V - x.F) / n;
      x.gapMonth = x.bepMonth == null ? null : x.bepMonth - mean;
      return x;
    });
    return { n: n, meanR: mean, v: v, vSrc: vSrc, cmr: cmr, avgRatio: avgRatio, pairs: pairs, usedN: used.length, bases: bases, notes: notes };
  };

  /* BEP·분석에 쓸 기본 기간: 거래내역이 있고 분개장이 마감된 달 */
  BM.defaultMonths = function (m, pl, rc) {
    var recon = {}; (rc.months || []).forEach(function (r) { recon[r.ym] = r; });
    var asOfYm = m.asOf.slice(0, 7), partial = +m.asOf.slice(8) < 25;
    var ok = pl.filter(function (b) {
      if (b.rev <= 0 && b.incurred <= 0) return false;
      if (b.ym === asOfYm && partial) return false;
      if (m.trades) {
        var r = recon[b.ym];
        if (!r || r.note) return false;
        if (r.trades > 0 && r.journal < 0.3 * r.trades) return false;
      }
      return true;
    }).map(function (b) { return b.ym; });
    return ok.slice(-6);
  };

  /* 비용 분석(4, 5, 7번): 계정/업체별 */
  BM.expenseByAcct = function (m, ym) {
    var acc = BM.accountMonthly(m), o = {};
    ['prod', 'sga', 'nonop_out'].forEach(function (cls) {
      Object.keys(acc[cls]).forEach(function (acct) {
        var v = acc[cls][acct][ym];
        if (v == null) return;
        var k = acct.replace(/\((제|도|분|판)\)$/, '');
        var b = o[k] = o[k] || { name: k, amt: 0, n: 0 };
        b.amt += v; b.n++;
      });
    });
    return o;
  };
})(typeof window !== 'undefined' ? window : globalThis);
