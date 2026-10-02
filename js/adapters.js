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
      if (BM.isVendorMaster(wb) && wb.SheetNames.indexOf('거래내역') < 0) return { kind: 'vendors', data: BM.parseVendorMaster(wb) };
      if (BM.isJournal(wb)) return { kind: 'journal', data: BM.parseJournal(wb) };
      return { kind: null };
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
