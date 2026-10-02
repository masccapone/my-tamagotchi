/* 공통 유틸. 전역 네임스페이스 BM 아래에 모은다. */
(function (g) {
  'use strict';
  var BM = g.BM = g.BM || {};

  BM.num = function (x) {
    if (typeof x === 'number') return isFinite(x) ? x : 0;
    if (typeof x === 'string') {
      var n = parseFloat(x.replace(/[,\s]/g, ''));
      return isFinite(n) ? n : 0;
    }
    return 0;
  };
  BM.sum = function (a, f) { return a.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); };
  BM.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  BM.won = function (x) { return Math.round(x).toLocaleString('ko-KR') + '원'; };
  BM.mil = function (x) { return Math.round(x / 1e6).toLocaleString('ko-KR'); };
  BM.eok = function (x) { return (x / 1e8).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '억'; };
  BM.fmtN = function (x, d) { return x.toLocaleString('ko-KR', { maximumFractionDigits: d == null ? 0 : d }); };

  /* 날짜: 내부 표현은 ISO 문자열 'YYYY-MM-DD' 와 UTC 밀리초(t) */
  BM.parseDate = function (v) {
    var y, m, d;
    if (v instanceof Date && !isNaN(v)) {
      y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate();
    } else if (typeof v === 'number' && v > 20000 && v < 80000) {
      var dt = new Date(Math.round((v - 25569) * 86400000));
      y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
    } else if (typeof v === 'string') {
      var mm = /^\s*(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(v);
      if (!mm) return null;
      y = +mm[1]; m = +mm[2]; d = +mm[3];
    } else return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var iso = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
    return { iso: iso, t: Date.UTC(y, m - 1, d), ym: iso.slice(0, 7) };
  };
  BM.dayDiff = function (t1, t2) { return Math.round((t1 - t2) / 86400000); };
  BM.addDays = function (t, n) { return t + n * 86400000; };
  BM.isoOf = function (t) { return new Date(t).toISOString().slice(0, 10); };
  BM.ymLabel = function (ym) { return ym.slice(0, 4) + '년 ' + (+ym.slice(5)) + '월'; };

  /* 거래처명 표기 통일: 법인 형태, 괄호 내용, 공백 제거 */
  BM.normName = function (s) {
    if (!s) return '';
    return String(s)
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/주식회사|유한회사|유한책임회사|㈜|㈔|\(주\)|\(유\)/g, '')
      .replace(/[\s \-_.,·]/g, '')
      .toLowerCase();
  };
})(typeof window !== 'undefined' ? window : globalThis);
