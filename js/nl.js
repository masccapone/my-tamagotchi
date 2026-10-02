/* 자연어 질문 해석기 (규칙 기반). 질문 문장에서 질문 종류, 업체, 월, 비용 항목을 뽑는다.
   계산은 하지 않는다. 나중에 AI 해석기로 바꿔도 이 함수의 입출력 형태만 지키면 된다.
   parse(text, ctx) → { id, vendor:{key,name,many}, month, acct, understood, ambiguous } | null
   ctx = { vendors:[{key,name}], accts:[계정명], asOf:'YYYY-MM-DD', months:['YYYY-MM',…] } */
(function (g) {
  'use strict';
  var BM = g.BM;

  var STOP = ['이번', '지난', '저번', '얼마', '언제', '회사', '업체', '우리', '현재', '지금', '들어', '나갈', '줘야', '해줘', '알려', '어떻게', '있어', '있나', '뭐야', '얼마나', '비용', '단가', '물량', '이익', '손실', '손익', '계약', '그대로', '들어왔', '입금', '이번달', '지난달', '이번달에', '대한', '관련', '정도', '내역', '항목', '금액', '합계', '전체', '모두', '요즘', '최근', '올해', '작년', '기준', '확인', '궁금'];

  function tokens(text) {
    return (text.match(/[가-힣A-Za-z0-9]{2,}/g) || []).map(function (t) {
      return t.replace(/(은|는|이|가|을|를|의|에|에서|에게|께|도|만|으로|로|이랑|랑|하고|과|와)$/, '');
    }).filter(function (t) { return t.length >= 2 && STOP.indexOf(t) < 0; });
  }

  function findMonth(text, ctx) {
    var asOfYm = ctx.asOf.slice(0, 7), y = +asOfYm.slice(0, 4), mo = +asOfYm.slice(5);
    function ym(yy, mm) { return yy + '-' + ('0' + mm).slice(-2); }
    var m;
    if ((m = /(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(text))) return ym(+m[1], +m[2]);
    if (/(이번\s*달|금월|당월)/.test(text)) return asOfYm;
    if (/(지난\s*달|저번\s*달|전월|지난달)/.test(text)) return mo === 1 ? ym(y - 1, 12) : ym(y, mo - 1);
    if ((m = /(\d{1,2})\s*월/.exec(text))) {
      var n = +m[1];
      if (n < 1 || n > 12) return null;
      var cand = (ctx.months || []).filter(function (x) { return +x.slice(5) === n; }).sort();
      if (cand.length) {
        var ok = cand.filter(function (x) { return x <= asOfYm; });
        return (ok.length ? ok : cand)[(ok.length ? ok : cand).length - 1];
      }
      return n <= mo ? ym(y, n) : ym(y - 1, n);
    }
    return null;
  }

  function findVendor(text, ctx) {
    var nq = BM.normName(text), toks = tokens(text);
    var best = [], bestScore = 0;
    (ctx.vendors || []).forEach(function (v) {
      var k = v.key; if (!k || k.length < 2) return;
      var score = 0;
      if (nq.indexOf(k) >= 0) score = 100 + k.length;
      else toks.forEach(function (t) { var nt = BM.normName(t); if (nt.length >= 2 && k.indexOf(nt) >= 0) score = Math.max(score, nt.length); });
      if (score > bestScore) { bestScore = score; best = [v]; }
      else if (score === bestScore && score > 0) best.push(v);
    });
    if (!best.length) return null;
    return { key: best[0].key, name: best[0].name, many: best.length > 1 ? best.slice(0, 5) : null };
  }

  function findAcct(text, ctx) {
    var toks = tokens(text), best = null, score = 0;
    (ctx.accts || []).forEach(function (a) {
      var s = 0;
      if (text.indexOf(a) >= 0) s = 100 + a.length;
      else toks.forEach(function (t) { if (t.length >= 3 && a.indexOf(t) >= 0) s = Math.max(s, t.length); });
      if (s > score) { score = s; best = a; }
    });
    return best;
  }

  var RULES = [
    ['q8', /(BEP|손익\s*분기|이익.{0,6}전환|흑자.{0,6}(전환|되려|나려)|적자.{0,6}(탈출|벗어)|매출.{0,12}(더|얼마).{0,8}(필요|해야))/i],
    ['q9', /(통장|계좌|보유\s*현금|현금.{0,6}(얼마|있|보유)|잔고)/],
    ['q10', /단가/],
    ['q11', /(물량|반입량|반출량|들어온\s*양|몇\s*톤|톤수|몇\s*kg)/],
    ['q2', /(들어\s*왔|들어\s*와|입금.{0,6}(됐|되었|됬|했|확인|여부)|받았)/],
    ['q1', /(줘야|줄\s*돈|지급\s*(할|해야|예정|일|해|하|금)|내야|결제.{0,6}(언제|얼마)|나갈\s*돈)/],
    ['q3', /(나갈\s*돈|들어올\s*돈|자금\s*수지|현금\s*흐름|받을\s*돈|줄\s*돈)/],
    ['q7', /(줄\s*수\s*있|줄일\s*수|절감|비용.{0,6}(줄|아낄)|줄여|줄이)/],
    ['q5', /(왜|이유|원인).{0,14}(많|늘|증가|올)|(많이|늘어|증가|올랐).{0,10}(나갔|왜|이유)/],
    ['q6', /(이익|손실|손익|적자|흑자)/],
    ['q4', /((뭐야|무슨|무엇|뭔가|어떤|내역).{0,8}비용|비용.{0,8}(뭐야|무슨|무엇|내역|뭔가))/]
  ];

  BM.nl = {
    parse: function (text, ctx) {
      text = String(text || '').trim();
      if (!text) return null;
      var vendor = findVendor(text, ctx), acct = findAcct(text, ctx), month = findMonth(text, ctx);
      var id = null, i, hit = [];
      // 비용 항목 이름(예: 지급수수료)에 들어 있는 단어가 질문 종류 판단을 흐리지 않도록 뺀다
      var rt = acct ? text.replace(acct, ' ') : text;
      for (i = 0; i < RULES.length; i++) if (RULES[i][1].test(rt)) hit.push(RULES[i][0]);
      var money = /(미수|받을\s*돈|채권)/.test(rt), pay = /(미지급|줄\s*돈|채무)/.test(rt);
      // 업체 유무에 따라 같은 표현의 질문이 달라진다
      if (hit.indexOf('q1') >= 0 || hit.indexOf('q3') >= 0 || money || pay) {
        if (hit.indexOf('q2') >= 0) id = 'q2';
        else if (vendor) id = (money && !pay) ? 'q2' : 'q1';
        else if (hit.indexOf('q3') >= 0 || money || pay) id = 'q3';
        else id = 'q3';
      }
      if (!id) id = hit[0] || null;
      if (acct && /(뭐야|뭔가|무슨|무엇|내역|이게|어떤)/.test(rt) && ['q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11'].indexOf(id) < 0 && !vendor) id = 'q4';
      if (id === 'q4' && !acct) id = null;
      if (id === 'q5' && !acct && !/비용|지출|나갔/.test(text)) id = hit.filter(function (x) { return x !== 'q5'; })[0] || 'q5';
      if (!id && vendor) id = null;
      if (!id) return null;
      var needsVendor = ['q1', 'q10'].indexOf(id) >= 0;
      var ambiguous = [];
      if (needsVendor && !vendor) ambiguous.push('업체');
      if (vendor && vendor.many) ambiguous.push('업체가 여러 곳');
      if (id === 'q4' && !acct) ambiguous.push('비용 항목');
      return { id: id, vendor: vendor, month: month, acct: acct, ambiguous: ambiguous, hits: hit };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
