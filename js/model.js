/* 표준 모델: 분개장 + 거래내역 + 업체마스터 → 분석용 모델 */
(function (g) {
  'use strict';
  var BM = g.BM;

  /* 계정 분류 (더존 계정코드 체계 우선, 코드가 없으면 계정명으로 추정) */
  BM.acctClass = function (code, name) {
    var c = String(code || '').trim().charAt(0), n = name || '';
    if (/손익/.test(n)) return 'other';
    if (/매출원가/.test(n)) return 'cogs';
    if (c === '4') return 'revenue';
    if (c === '5' || c === '6' || c === '7') return 'prod';
    if (c === '8') return 'sga';
    if (c === '9') {
      if (/보증금|할인차금/.test(n)) return 'other';
      return /수익|이익|환입/.test(n) ? 'nonop_in' : 'nonop_out';
    }
    if (c === '1' || c === '2' || c === '3') return 'bs';
    if (/\((제|도|분)\)/.test(n)) return 'prod';
    if (/\(판\)/.test(n)) return 'sga';
    if (/매출/.test(n) && !/채권|미수|원가/.test(n)) return 'revenue';
    return 'other';
  };

  var AR_ACCTS = /^(외상매출금|매출채권)$/;
  var AP_ACCTS = /^(미지급금|외상매입금)$/;
  var CASH_ACCTS = /^(보통예금|당좌예금|현금|현금및현금성자산)$/;
  BM.AR_ACCTS = AR_ACCTS; BM.AP_ACCTS = AP_ACCTS; BM.CASH_ACCTS = CASH_ACCTS;

  BM.buildModel = function (inp) {
    var m = { journalFiles: inp.journals.length, trades: inp.trades || null, master: inp.vendors || null };

    // 거래처명 통일
    var alias = {}, display = {};
    if (m.master) m.master.list.forEach(function (v) {
      [v.name].concat(v.aliases).forEach(function (a) { var k = BM.normName(a); if (k) alias[k] = BM.normName(v.name); });
      display[BM.normName(v.name)] = v.name;
    });
    m.vendorKey = function (raw) {
      var k = BM.normName(raw);
      if (!k) return '';
      k = alias[k] || k;
      if (!display[k]) display[k] = String(raw).replace(/\s+/g, ' ').trim();
      return k;
    };
    m.vendorName = function (k) { return display[k] || k || '(거래처 없음)'; };
    m.payDaysOf = function (k) {
      if (!m.master) return null;
      for (var i = 0; i < m.master.list.length; i++) {
        if (BM.normName(m.master.list[i].name) === k && m.master.list[i].payDays != null) return m.master.list[i].payDays;
      }
      return null;
    };

    // 분개장 합치기: 파일 간에 겹치는 전표만 제거한다(같은 파일 안의 동일 행은 정상 전표일 수 있어 유지)
    var prevKeys = {}, rows = [], dup = 0;
    inp.journals.forEach(function (j) {
      var cur = {};
      j.rows.forEach(function (r) {
        var key = [r.date, r.no, r.side, r.acct, r.dr, r.cr, r.vendor, r.memo].join('|');
        cur[key] = (cur[key] || 0) + 1;
        if (prevKeys[key]) { dup++; return; }
        rows.push(r);
      });
      Object.keys(cur).forEach(function (k) { prevKeys[k] = 1; });
    });
    rows.sort(function (a, b) { return a.t - b.t || (a.no < b.no ? -1 : a.no > b.no ? 1 : 0); });
    rows.forEach(function (r) { r.cls = BM.acctClass(r.code, r.acct); r.vk = m.vendorKey(r.vendor); });
    m.rows = rows; m.dupRows = dup;
    m.firstT = rows.length ? rows[0].t : null;
    m.asOfT = rows.length ? rows[rows.length - 1].t : null;
    m.asOf = m.asOfT == null ? null : BM.isoOf(m.asOfT);
    var yms = {}; rows.forEach(function (r) { yms[r.ym] = 1; });
    m.months = Object.keys(yms).sort();

    if (m.trades) m.trades.rows.forEach(function (r) { r.vk = m.vendorKey(r.vendor); r.bk = m.vendorKey(r.billTo || r.vendor); });
    return m;
  };
})(typeof window !== 'undefined' ? window : globalThis);
