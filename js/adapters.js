/* 입력 어댑터: 엑셀 → 표준 모델.  journal(분개장), trades(거래내역), vendors(업체마스터) */
(function (g) {
  'use strict';
  var BM = g.BM;

  function sheetRows(ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }); }
  function norm(h) { return String(h == null ? '' : h).replace(/\s/g, ''); }

  /* ---------- 분개장 ---------- */
  BM.isJournal = function (wb) {
    var rows = sheetRows(wb.Sheets[wb.SheetNames[0]]).slice(0, 8);
    return rows.some(function (r) { var h = r.map(norm); return h.indexOf('전표일자') >= 0 && h.indexOf('계정과목') >= 0 && h.indexOf('차변') >= 0; });
  };

  BM.parseJournal = function (wb) {
    var rows = sheetRows(wb.Sheets[wb.SheetNames[0]]);
    var hi = -1, h;
    for (var i = 0; i < Math.min(rows.length, 8); i++) {
      h = rows[i].map(norm);
      if (h.indexOf('전표일자') >= 0 && h.indexOf('계정과목') >= 0) { hi = i; break; }
    }
    if (hi < 0) return null;
    h = rows[hi].map(norm);
    var ix = function (n) { return h.indexOf(n); };
    var iAcct = ix('계정과목');
    var iCode = iAcct > 0 && /^code/i.test(h[iAcct - 1]) ? iAcct - 1 : -1;
    var c = { date: ix('전표일자'), no: ix('전표번호'), side: ix('구분'), dr: ix('차변'), cr: ix('대변'), vendor: ix('거래처'), memo: ix('적요') };
    var out = [], skipped = 0;
    for (var r = hi + 1; r < rows.length; r++) {
      var row = rows[r];
      var d = BM.parseDate(row[c.date]);
      if (!d) { if (row[c.date]) skipped++; continue; }
      var side = norm(row[c.side]);
      out.push({
        date: d.iso, t: d.t, ym: d.ym,
        no: String(row[c.no] == null ? '' : row[c.no]).trim(),
        side: side,
        closing: side.indexOf('결') === 0,
        code: iCode >= 0 ? String(row[iCode] == null ? '' : row[iCode]).trim() : '',
        acct: String(row[iAcct] == null ? '' : row[iAcct]).trim(),
        dr: BM.num(row[c.dr]), cr: BM.num(row[c.cr]),
        vendor: row[c.vendor] == null ? '' : String(row[c.vendor]).trim(),
        memo: row[c.memo] == null ? '' : String(row[c.memo]).trim()
      });
    }
    return { rows: out, skipped: skipped };
  };

  /* ---------- 거래내역 템플릿 ---------- */
  BM.isTrades = function (wb) {
    if (wb.SheetNames.indexOf('거래내역') < 0) return false;
    var rows = sheetRows(wb.Sheets['거래내역']).slice(0, 3);
    return rows.some(function (r) { var h = r.map(norm); return h.indexOf('일자') >= 0 && h.indexOf('방향') >= 0 && h.indexOf('거래처') >= 0; });
  };

  BM.parseTrades = function (wb) {
    // 설정: 방향 → 매출/비용
    var flow = { '반입': '매출', '반출': '비용' };
    if (wb.Sheets['설정']) {
      flow = {};
      sheetRows(wb.Sheets['설정']).slice(1).forEach(function (r) {
        var n = norm(r[0]), f = norm(r[1]);
        if (n && (f === '매출' || f === '비용')) flow[n] = f;
      });
    }
    var rows = sheetRows(wb.Sheets['거래내역']);
    var hi = -1, h;
    for (var i = 0; i < Math.min(rows.length, 3); i++) {
      h = rows[i].map(norm);
      if (h.indexOf('일자') >= 0 && h.indexOf('방향') >= 0) { hi = i; break; }
    }
    if (hi < 0) return null;
    h = rows[hi].map(norm);
    var ix = function (n) { return h.indexOf(n); };
    var out = [], warn = { badDate: 0, unknownDir: 0 };
    for (var r = hi + 1; r < rows.length; r++) {
      var row = rows[r];
      var vendor = row[ix('거래처')] == null ? '' : String(row[ix('거래처')]).trim();
      var note = row[ix('비고')] == null ? '' : String(row[ix('비고')]);
      if (!vendor && row[ix('수량')] == null && row[ix('일자')] == null) continue;
      if (note.indexOf('예시') >= 0 || vendor.indexOf('(예시)') === 0) continue;
      var d = BM.parseDate(row[ix('일자')]);
      if (!d) { if (vendor) warn.badDate++; continue; }
      var dir = norm(row[ix('방향')]);
      if (!flow[dir]) { warn.unknownDir++; continue; }
      var qty = BM.num(row[ix('수량')]), price = BM.num(row[ix('단가')]);
      var amt = row[ix('금액')];
      amt = (amt === null || amt === '' || amt === undefined) ? qty * price : BM.num(amt);
      var bill = ix('청구처') >= 0 && row[ix('청구처')] != null ? String(row[ix('청구처')]).trim() : '';
      out.push({
        date: d.iso, t: d.t, ym: d.ym, dir: dir, flow: flow[dir], vendor: vendor, billTo: bill || vendor,
        item: row[ix('품목')] == null ? '' : String(row[ix('품목')]).trim(),
        qty: qty, unit: row[ix('단위')] == null ? '' : String(row[ix('단위')]).trim(),
        kind: row[ix('단가종류')] == null ? '' : String(row[ix('단가종류')]).trim(),
        price: price, amt: amt
      });
    }
    return { rows: out, flow: flow, warn: warn };
  };


  /* ---------- 반입/반출 현황 (현장 장부) → 거래내역 ----------
     월별 시트(4월, 5월 …)에 반입(거래처·반입량·단가·매출금액)과 반출(거래처·품목·반출량·단가·비용)이
     한 줄에 나란히 있고, 처리비 줄 아래에 운반비 줄이 따로 붙는 형식을 한 행 한 거래로 풀어 쓴다. */
  BM.isStatusBook = function (wb) {
    var ms = wb.SheetNames.filter(function (n) { return /^\d{1,2}월$/.test(n.trim()); });
    if (!ms.length) return false;
    var rows = sheetRows(wb.Sheets[ms[0]]).slice(0, 4);
    var txt = rows.map(function (r) { return r.map(norm).join('|'); }).join('|');
    return txt.indexOf('반입') >= 0 && txt.indexOf('반출') >= 0 && txt.indexOf('거래처') >= 0;
  };

  BM.parseStatusBook = function (wb) {
    var out = [];
    function isNum(x) { return typeof x === 'number' && isFinite(x); }
    function push(d, dir, vendor, item, qty, unit, kind, price, amt) {
      out.push({ date: d.iso, t: d.t, ym: d.ym, dir: dir, flow: dir === '반입' ? '매출' : '비용', vendor: vendor, billTo: vendor,
        item: item || '', qty: qty, unit: unit, kind: kind, price: price, amt: amt });
    }
    wb.SheetNames.filter(function (n) { return /^\d{1,2}월$/.test(n.trim()); }).forEach(function (name) {
      var rows = sheetRows(wb.Sheets[name]);
      var cur = null, li = '', lo = '', lkgi = 0, lkgo = 0;
      for (var r = 3; r < rows.length; r++) {
        var row = rows[r].concat([null, null, null, null, null, null, null, null, null, null, null, null]);
        var d0 = BM.parseDate(row[0]);
        if (d0) cur = d0;
        var b = String(row[1] == null ? '' : row[1]), g = String(row[6] == null ? '' : row[6]);
        if (/소\s*계|합\s*계/.test(b) || /소\s*계|합\s*계/.test(g) || !cur) continue;
        if (row[1]) li = String(row[1]).trim();
        var kind = String(row[3] == null ? '' : row[3]), kg = isNum(row[2]) ? row[2] : 0, price = isNum(row[4]) ? row[4] : 0, amt = isNum(row[5]) ? row[5] : null;
        if (kind && amt !== null && li) {
          if (kind.indexOf('처리') >= 0 && kg) { lkgi = kg; push(cur, '반입', li, '', kg, 'kg', '처리비', price || amt / kg, amt); }
          else if (kind.indexOf('운') >= 0 && lkgi) push(cur, '반입', li, '', lkgi, 'kg', '운반비', price || amt / lkgi, amt);
        }
        var ko = String(row[9] == null ? '' : row[9]), kgo = isNum(row[8]) ? row[8] : 0, po = isNum(row[10]) ? row[10] : 0, ao = isNum(row[11]) ? row[11] : null;
        if (row[6]) lo = String(row[6]).trim();
        if (ko && ao !== null && lo) {
          if (ko.indexOf('처리') >= 0 && kgo) { lkgo = kgo; push(cur, '반출', lo, row[7] == null ? '' : String(row[7]).trim(), kgo, 'kg', '처리비', po, ao); }
          else if (ko.indexOf('운') >= 0) {
            if (ko.indexOf('회당') >= 0) push(cur, '반출', '운반-' + lo, '', 1, '회', '운반비', ao, ao);
            else if (lkgo) push(cur, '반출', '운반-' + lo, '', lkgo, 'kg', '운반비', ao / lkgo, ao);
          }
        }
        if (kgo) lkgo = kgo;
      }
    });
    return { rows: out, flow: { '반입': '매출', '반출': '비용' }, warn: { badDate: 0, unknownDir: 0 }, converted: true };
  };


  /* ---------- ERP 보고서(월별 손익계산서, 월별 제조원가명세서): 계산 검증용 ---------- */
  var ROMAN = /^[\u2160-\u217F]+\.\s*(.*)$/;
  BM.isErpReport = function (wb) {
    var rows = sheetRows(wb.Sheets[wb.SheetNames[0]]).slice(0, 6);
    return rows.some(function (r) { return norm(r[0]) === '과목' && r.some(function (c) { return /\d{4}\s*년\s*\d{1,2}\s*월/.test(String(c || '')); }); });
  };
  BM.parseErpReport = function (wb) {
    var rows = sheetRows(wb.Sheets[wb.SheetNames[0]]), hi = -1;
    for (var i = 0; i < Math.min(rows.length, 8); i++) if (norm(rows[i][0]) === '과목') { hi = i; break; }
    if (hi < 0) return null;
    var cols = {};
    rows[hi].forEach(function (c, idx) { var m = /(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(String(c || '')); if (m) cols[m[1] + '-' + ('0' + m[2]).slice(-2)] = idx; });
    var out = [], group = '';
    for (var r = hi + 1; r < rows.length; r++) {
      var name = String(rows[r][0] == null ? '' : rows[r][0]).trim();
      if (!name) continue;
      var rm = ROMAN.exec(name), vals = {};
      Object.keys(cols).forEach(function (k) { vals[k] = BM.num(rows[r][cols[k]]); });
      if (rm) { group = rm[1].replace(/\s/g, ''); out.push({ header: true, name: group, group: group, vals: vals }); }
      else out.push({ header: false, name: name, group: group, vals: vals });
    }
    var hasRev = out.some(function (x) { return x.header && x.name.indexOf('매출액') >= 0; });
    var hasCost = out.some(function (x) { return x.header && /노무비|공사원가/.test(x.name); });
    return { type: hasRev ? 'pl' : hasCost ? 'cost' : 'unknown', rows: out, months: Object.keys(cols).sort() };
  };

  /* ---------- 업체마스터 ---------- */
  BM.isVendorMaster = function (wb) {
    if (wb.SheetNames.indexOf('업체마스터') < 0) return false;
    var rows = sheetRows(wb.Sheets['업체마스터']).slice(0, 2);
    return rows.some(function (r) { return r.map(norm).indexOf('업체명(대표)') >= 0; });
  };

  BM.parseVendorMaster = function (wb) {
    var rows = sheetRows(wb.Sheets['업체마스터']);
    var list = [];
    rows.slice(1).forEach(function (r) {
      var name = r[0] == null ? '' : String(r[0]).trim();
      if (!name || name.indexOf('(예시)') === 0) return;
      var aliases = [r[1], r[2], r[3]].filter(function (x) { return x; }).map(String);
      var days = r[4] == null || r[4] === '' ? null : BM.num(r[4]);
      list.push({ name: name, aliases: aliases, payDays: days, note: r[5] == null ? '' : String(r[5]) });
    });
    return { list: list };
  };

  /* 파일 한 개를 읽어 종류를 판별 */
  BM.readWorkbook = function (file) {
    return file.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array', cellDates: true });
      if (BM.isTrades(wb)) return { kind: 'trades', data: BM.parseTrades(wb), vendors: BM.isVendorMaster(wb) ? BM.parseVendorMaster(wb) : null };
      if (BM.isStatusBook(wb)) return { kind: 'trades', data: BM.parseStatusBook(wb) };
      if (BM.isVendorMaster(wb) && wb.SheetNames.indexOf('거래내역') < 0) return { kind: 'vendors', data: BM.parseVendorMaster(wb) };
      if (BM.isJournal(wb)) return { kind: 'journal', data: BM.parseJournal(wb) };
      if (BM.isErpReport(wb)) { var rep = BM.parseErpReport(wb); if (rep && rep.type !== 'unknown') return { kind: 'report', data: rep }; }
      return { kind: null };
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
