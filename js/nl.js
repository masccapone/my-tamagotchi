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
    function resolve(n) {
      var cand = (ctx.months || []).filter(function (x) { return +x.slice(5) === n; }).sort();
      if (cand.length) { var ok = cand.filter(function (x) { return x <= asOfYm; }); var list = ok.length ? ok : cand; return list[list.length - 1]; }
      return n <= mo ? ym(y, n) : ym(y - 1, n);
    }
    var m;
    if ((m = /(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(text))) return ym(+m[1], +m[2]);
    if (/(이번\s*달|금월|당월)/.test(text)) return asOfYm;
    if (/(지난\s*달|저번\s*달|전월|지난달)/.test(text)) return mo === 1 ? ym(y - 1, 12) : ym(y, mo - 1);
    var all = [], re = /(\d{1,2})\s*월/g;
    while ((m = re.exec(text))) { var n = +m[1]; if (n >= 1 && n <= 12) all.push(resolve(n)); }
    if (!all.length) return null;
    // "7월보다 8월에", "7월 대비 8월": 비교 문장이면 묻는 달은 나중 달
    if (all.length > 1 && /(보다|대비|비교|에 비해)/.test(text)) return all.slice().sort()[all.length - 1];
    return all[0];
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

  /* 아직 지원하지 않는 조건: 이런 말이 있으면 월 단위 숫자를 대신 답하지 않고 거절한다 */
  var UNSUPPORTED = [
    [/(상반기|하반기|(?<!손익)분기|올해|금년|작년|재작년|전년|연간|연도|누적|누계|연초|지금까지|\d+\s*월\s*(부터|까지)|~)/, '월 단위가 아닌 기간(분기·반기·올해·누적·전년 비교)'],
    [/(이번\s*주|지난\s*주|저번\s*주|주간|어제|그제|엊그제|하루|일별|일주일|일간)/, '주·일 단위 기간'],
    [/(빼고|제외|말고|뺀)/, '항목을 제외한 계산'],
    [/((매출|비용|이익|수익)\s*대비|비율|퍼센트|%|증감률|몇\s*배|수익률|마진율|이익률)/, '비율 계산'],
    [/평균/, '평균 계산'],
    [/((단가|물량).{0,12}(제일|가장).{0,8}(높|낮|많|적|큰|작))|((제일|가장).{0,8}(높|낮|많|적|큰|작).{0,8}(단가|물량))/, '업체 간 단가·물량 순위 비교']
  ];
  function findVendors(text, ctx) {
    var nq = BM.normName(text), out = [];
    (ctx.vendors || []).forEach(function (v) { if (v.key && v.key.length >= 3 && nq.indexOf(v.key) >= 0) out.push(v); });
    return out.filter(function (v, i) { return !out.some(function (w, j) { return j !== i && w.key !== v.key && w.key.indexOf(v.key) >= 0; }); });
  }
  var ACCT_ALIAS = { '전기세': '전력비', '전기료': '전력비', '전기요금': '전력비', '월세': '지급임차료', '임차료': '지급임차료', '세금': '세금과공과금', '인건비': '급여', '수수료': '지급수수료', '유류비': '차량유지비', '기름값': '차량유지비', '수리비': '수선비', '소모품': '소모품비', '식대': '복리후생비', '통신료': '통신비', '보험': '보험료', '접대': '접대비', '운임': '운반비', '물류비': '운반비', '이자': '이자비용' };
  function findAcct(text, ctx) {
    var al = Object.keys(ACCT_ALIAS).filter(function (k) { return text.indexOf(k) >= 0; }).sort(function (a, b) { return b.length - a.length; })[0];
    if (al) { var target = (ctx.accts || []).filter(function (a) { return a.indexOf(ACCT_ALIAS[al]) === 0; })[0]; if (target) return target; }
    return findAcctDirect(text, ctx);
  }
  function findAcctDirect(text, ctx) {
    var toks = tokens(text), best = null, score = 0;
    (ctx.accts || []).forEach(function (a) {
      var s = 0;
      if (text.indexOf(a) >= 0) s = 100 + a.length;
      else toks.forEach(function (t) { if (t.length >= 3 && a.indexOf(t) >= 0) s = Math.max(s, t.length); });
      if (s > score) { score = s; best = a; }
    });
    return best;
  }

  var NUM_KO = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
  var SUFFIX = /([가-힣A-Za-z0-9]{2,}?(?:환경|산업|물류|에너지|건설|개발|상사|테크|자원|리싸이클링|리사이클링|로지스|종합|플라스틱|전자|철강|이엔피|이엔비|이앤피|운수|기업|무역|공사|중공업|유통|화학|소재|그린텍|그린))/;

  function features(t) {
    var f = {};
    f.forecast = /(예측|전망|내년|내후년|향후|앞으로|다음\s*분기|다음\s*해|나올\s*(거|것)|예상\s*매출)/.test(t);
    f.bep = /(BEP|본전|손익\s*분기|적자\s*(안|면|를\s*면|탈출|벗어)|흑자.{0,6}(전환|되려|나려)|이익.{0,6}전환|매출.{0,14}(더|얼마).{0,8}(필요|해야|돼야|되어야|는\s*돼))/i.test(t);
    f.cash = /(통장|계좌|잔고|보유\s*현금|현금.{0,6}(얼마|있|보유)|은행.{0,8}(돈|얼마|잔))/.test(t);
    f.neg = /(마이너스|음수)/.test(t);
    f.check = /(맞지\s*않|안\s*맞|어긋|오류|잘못|이상한|이상\s*없|누락|빠진|제대로|맞는\s*거|맞아|점검|검증|입력\s*안|틀린|틀렸|오타|실수)/.test(t);
    f.price = /(단가|얼마\s*(로|에)\s*받)/.test(t);
    f.vol = /(물량|반입|반출|몇\s*톤|톤수|몇\s*kg)/.test(t);
    f.save = /(줄\s*수\s*있|줄일\s*수|절감|비용.{0,6}(줄|아낄)|줄여|줄이)/.test(t);
    f.why = /(왜|이유|원인)/.test(t);
    f.grow = /(늘|증가|올랐|많이\s*나갔|증감|어디서\s*늘)/.test(t);
    f.dep = /(입금|들어\s*왔|들어\s*와|들어\s*옴|들어\s*온\s*돈|받았|받음|수금)/.test(t);
    f.ar = /(미수|받을\s*돈|받아야|못\s*받|외상(?!\s*매입)|매출\s*채권|채권)/.test(t);
    f.ap = /(미지급|줄\s*돈|줘야|지급할|지급해야|외상\s*매입|채무|갚|나갈\s*돈|나가야)/.test(t);
    f.rev = /(매출|판매\s*금액|판매액|수입)/.test(t) && !/(미수|채권)/.test(t);
    f.profit = /(이익|손실|손익|적자|흑자|남았|밑졌|남겼|손해|이득|장사)/.test(t);
    f.exp = /(비용|지출|쓴|썼|나간\s*돈|나갔|나왔)/.test(t);
    f.due = /(이번\s*달|언제|예정|기한|도래|내야|줘야)/.test(t);
    f.both = /(나갈\s*돈.*들어올\s*돈|들어올\s*돈.*나갈\s*돈|자금\s*수지|현금\s*흐름)/.test(t);
    f.top = /(상위|제일\s*큰|가장\s*큰|큰\s*(곳|업체)|많은\s*(곳|업체)|(\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(곳|개|군데|위)|순위)/.test(t);
    f.all = /(전부|전체|총액|총\s|합계|모두|다\s*해서|합치면)/.test(t);
    f.what = /(뭐야|무슨|무엇|뭔가|어떤|내역|이게)/.test(t);
    return f;
  }

  function findTopN(t) {
    var m = /(\d+)\s*(곳|개|군데|위)/.exec(t);
    if (m) return +m[1];
    m = /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(곳|개|군데)/.exec(t);
    return m ? NUM_KO[m[1]] : null;
  }
  var KO_MONTHS = { '한': 1, '두': 2, '석': 3, '세': 3, '넉': 4, '네': 4, '다섯': 5, '여섯': 6, '일곱': 7, '여덟': 8, '아홉': 9, '열': 10 };
  function findDays(t) {
    var m;
    if ((m = /(한|두|석|세|넉|네|다섯|여섯|일곱|여덟|아홉|열)\s*(달|개월)\s*(넘|이상|초과|지난|째|동안)/.exec(t))) return KO_MONTHS[m[1]] * 30;
    if ((m = /(\d+)\s*일\s*(넘|이상|초과|지난)/.exec(t))) return +m[1];
    if ((m = /(\d+)\s*(개월|달)\s*(넘|이상|초과|지난)/.exec(t))) return +m[1] * 30;
    if (/(반년|6\s*개월)\s*(넘|이상)?/.test(t) && /(넘|이상|오래|안\s*들어)/.test(t)) return 180;
    if (/(1\s*년|일\s*년)\s*(넘|이상)/.test(t)) return 365;
    if (/(오래된|장기)/.test(t)) return 90;
    return null;
  }

  /* 질문에 업체처럼 보이는 말이 있는데 자료에 없으면 그 말을 돌려준다 */
  function unknownVendorPhrase(t, vendor, needsVendor) {
    if (vendor) return null;
    var m = SUFFIX.exec(t);
    if (m && !/^(이번|지난|전체|우리|회사)/.test(m[1])) return m[1];
    if (needsVendor) {
      var tk = tokens(t).filter(function (x) { return !/(미수금|미지급금|단가|물량|매출|입금|얼마|알려|받고|바뀐|바뀌|있어|줄|돈)/.test(x); });
      if (tk.length) return tk[0];
    }
    return null;
  }

  BM.nl = {
    parse: function (text, ctx) {
      text = String(text || '').trim();
      if (!text) return null;
      var vendor = findVendor(text, ctx), acct = findAcct(text, ctx), month = findMonth(text, ctx);
      var rt = acct ? text.replace(acct, ' ') : text;
      var f = features(rt), id = null, view = null, focus = null;
      var unsupported = [];
      if (!f.forecast) {
        var ut = month && /올해|금년/.test(text) ? text.replace(/올해|금년/g, ' ') : text;
        UNSUPPORTED.forEach(function (u) { var mm = u[0].exec(ut); if (mm) unsupported.push({ phrase: mm[0], reason: u[1] }); });
      }
      var days = findDays(rt), topN = findTopN(rt);

      if (f.forecast) id = 'q18';
      else if (f.bep) id = 'q8';
      else if (f.cash) id = 'q9';
      else if (f.ap && f.neg) { id = 'q13'; view = 'negative'; }
      else if (f.check) { id = 'q17'; if (f.rev || /매출/.test(text)) focus = 'revenue'; }
      else if (f.price) id = 'q10';
      else if (f.vol) id = 'q11';
      else if (f.save) id = 'q7';
      else if (f.why && (acct || f.exp)) id = 'q5';
      else if (f.grow && (f.exp || acct || /(뭐가|어디서|어떤\s*게|어느\s*게)/.test(rt))) id = 'q16';
      else if (f.both) id = 'q3';
      else if (f.dep && !(f.ar && !vendor && (f.all || f.top || days))) id = 'q2';
      else if (f.ar) {
        if (!vendor && f.due && !days && !f.all && !f.top) id = 'q3';
        else id = 'q12';
      }
      else if (f.ap) {
        if (vendor && f.due) id = 'q1';
        else if (!vendor && f.due && /(들어올|받을)/.test(rt)) id = 'q3';
        else id = 'q13';
      }
      else if (f.rev) id = 'q14';
      else if (acct && (f.exp || f.what || /얼마|나왔|나갔|쓴|총액|합계|내역/.test(rt))) id = 'q4';
      else if (f.exp && (f.top || /(큰|많|제일|가장)/.test(rt))) id = 'q15';
      else if (f.exp) id = 'q15';
      else if (f.profit) id = 'q6';
      else if (acct) id = 'q4';
      if (id === 'q4' && !acct) id = 'q15';
      if (!id) return null;

      var needsVendor = ['q1', 'q10'].indexOf(id) >= 0;
      var vendorUsed = ['q1', 'q2', 'q10', 'q11', 'q12', 'q13', 'q14'].indexOf(id) >= 0;
      var unknown = vendorUsed ? unknownVendorPhrase(text, vendor, needsVendor) : null;
      var vendors = vendorUsed ? findVendors(text, ctx) : [];
      if (unknown && /^(이번|지난|전체|우리|회사|올해)/.test(unknown)) unknown = null;
      // 조건처럼 보이는데 읽지 못한 말이 있으면 추측해서 답하지 않는다
      var unsure = [];
      var dur = /((?:한|두|석|세|넉|네|다섯|여섯|일곱|여덟|아홉|열)\s*(?:달|개월|주|해)|\d+\s*(?:주|분기)|분기)/.exec(text);
      if (dur && days == null && ['q12', 'q13', 'q1', 'q2'].indexOf(id) >= 0) unsure.push(dur[1]);
      if (['q4', 'q15'].indexOf(id) >= 0 && !acct) { var w = /([가-힣]{2,}(?:세|료|값|금))(?![가-힣])/.exec(rt); if (w && !/(미수금|미지급금|보증금)/.test(w[1])) unsure.push(w[1]); }
      var ambiguous = [];
      if (needsVendor && !vendor && !unknown) ambiguous.push('업체');
      if (vendor && vendor.many) ambiguous.push('업체가 여러 곳');
      if (id === 'q4' && !acct) ambiguous.push('비용 항목');
      var baseMonth = null;
      if (id === 'q16') { var ms = []; var rg = /(\d{1,2})\s*월/g, mm; while ((mm = rg.exec(text))) { if (+mm[1] >= 1 && +mm[1] <= 12) ms.push(findMonth(mm[1] + '월', ctx)); } if (ms.length > 1) baseMonth = ms.slice().sort()[0]; }
      return { id: id, vendor: unknown ? null : vendor, unknownVendor: unknown, month: month, baseMonth: baseMonth, acct: acct, days: days, topN: topN, view: view, focus: focus, ambiguous: ambiguous, unsure: unsure, unsupported: unsupported, vendors: vendors.length > 1 ? vendors : null, hits: [] };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
