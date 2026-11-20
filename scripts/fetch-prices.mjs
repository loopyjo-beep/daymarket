// 지원 종목의 일별 종가를 받아 data/prices/<종목>.json 과 data/prices/index.json 에 저장한다.
// 실행: KRX_AUTH_KEY=... TIINGO_KEY=... node scripts/fetch-prices.mjs
//
// 국내: 한국거래소(KRX) OPEN API 유가증권·코스닥 일별매매정보(2010년~전일). 키: KRX_AUTH_KEY
//       날짜 하나에 시장 전체가 오므로 날짜마다 코스피·코스닥 2번 호출한다(키당 하루 10,000건 한도).
//       KRX 키가 없고 DATA_GO_KR_KEY만 있으면 금융위원회_주식시세정보(2020년~)를 쓴다.
// 미국: TIINGO_KEY가 있으면 Tiingo 일별 종가(무료 플랜도 상장 이후 전체, 30년 이상). 종목마다 1번 호출.
//       Tiingo 무료·개인 플랜은 '내부 사용만' 허용한다. 공개 출시 전 표시 라이선스 계약 또는 출처 교체 필요.
//       TIINGO_KEY가 없고 MARKETSTACK_KEY만 있으면 Marketstack v2 /eod(무료 1년, Basic 10년)를 쓴다.
//
// 저장 형식: {"symbol","market","source","updated","d":[날짜...],"c":[원래 종가...],"splits":[[날짜,배수]...]}
// 액면분할은 가격을 고치지 않고 splits에만 적는다. 화면이 읽을 때 분할 전 가격을 배수로 나눠 맞춘다.
// 한 종목이 실패해도 나머지는 계속 진행하고, 기존 파일은 지우지 않는다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SYMBOLS = [
  ['005930', '삼성전자', 'KR'], ['000660', 'SK하이닉스', 'KR'], ['373220', 'LG에너지솔루션', 'KR'],
  ['005380', '현대차', 'KR'], ['000270', '기아', 'KR'], ['035420', 'NAVER', 'KR'],
  ['035720', '카카오', 'KR'], ['068270', '셀트리온', 'KR'], ['105560', 'KB금융', 'KR'],
  ['AAPL', '애플', 'US'], ['MSFT', '마이크로소프트', 'US'], ['NVDA', '엔비디아', 'US'],
  ['TSLA', '테슬라', 'US'], ['AMZN', '아마존', 'US'], ['GOOGL', '알파벳(구글)', 'US'],
  ['META', '메타', 'US'], ['QQQ', '인베스코 QQQ', 'US'], ['SPY', 'SPDR S&P500', 'US'], ['SCHD', '슈왑 미국배당', 'US'],
];

const DIR = 'data/prices';
const KR_KEY = process.env.DATA_GO_KR_KEY;
const KRX_KEY = process.env.KRX_AUTH_KEY;
let KRX_BASE = process.env.KRX_BASE || 'https://data-dbg.krx.co.kr/svc/apis/sto';
const KRX_START = process.env.KRX_START || '2010-01-04';
const KRX_MAX_CALLS = +(process.env.KRX_MAX_CALLS || 9000);
const US_YEARS = +(process.env.US_YEARS || 10);
const US_KEY = process.env.MARKETSTACK_KEY;
const TIINGO_KEY = process.env.TIINGO_KEY;
const TIINGO_BASE = process.env.TIINGO_BASE || 'https://api.tiingo.com';
const US_START = process.env.US_START || '2000-01-01'; // 환율 데이터 시작(2000)에 맞춤. Tiingo는 이 날짜와 상장일 중 늦은 날부터 준다
const KR_BASE = process.env.KR_BASE || 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService';
const US_BASE = process.env.US_BASE || 'https://api.marketstack.com/v2';
const KR_START = process.env.KR_START || '2020-01-01';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mask = s => s.replace(/(serviceKey|access_key)=[^&]+/g, '$1=***');

async function getJSON(url, label, headers = {}) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { throw new Error(`JSON 아님 (HTTP ${r.status}): ${text.slice(0, 200)}`); }
      if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`); e.status = r.status; e.body = j; throw e; }
      return j;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500 && e.status !== 429) break; // 키·요금제 오류는 재시도해도 같다
      console.warn(`  재시도 ${i + 1}/3 ${label}: ${e.message}`);
      await sleep(3000 * (i + 1));
    }
  }
  lastErr.message = `${label} 실패: ${lastErr.message} (${mask(url)})`;
  throw lastErr;
}

async function load(sym) {
  try { return JSON.parse(await readFile(`${DIR}/${sym}.json`, 'utf8')); } catch { return null; }
}

function merge(prev, rows) {
  const m = new Map();
  if (prev) prev.d.forEach((d, i) => m.set(d, prev.c[i]));
  for (const [d, c] of rows) if (c > 0) m.set(d, c);
  const d = [...m.keys()].sort();
  return { d, c: d.map(k => m.get(k)) };
}

// 국내: 하루 등락 제한(±30%)을 넘는 변화는 정상 거래로 나올 수 없으므로 액면분할·병합·무상증자로 본다.
// 흔한 배수에 가까울 때만 기록하고, 판단한 내용은 로그로 남긴다.
const RATIOS = [1.5, 2, 2.5, 3, 4, 5, 10, 20, 25, 50, 100];
const logged = new Set(); const logOnce = (k, f) => { if (!logged.has(k)) { logged.add(k); f(); } };
function detectSplitsKR(sym, d, c) {
  const out = [];
  for (let i = 1; i < d.length; i++) {
    const r = c[i - 1] / c[i];
    const up = r >= 1.45, down = r <= 1 / 1.45;
    if (!up && !down) continue;
    const x = up ? r : 1 / r;
    const best = RATIOS.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
    if (Math.abs(best - x) / best <= 0.12) {
      const ratio = up ? best : 1 / best;
      out.push([d[i], ratio]);
      logOnce(sym + d[i], () => console.log(`  ${sym} ${d[i]} 가격 ${c[i - 1]} → ${c[i]}: 배수 ${ratio}로 보정`));
    } else {
      logOnce(sym + d[i], () => console.warn(`  ${sym} ${d[i]} 큰 가격 변화(${c[i - 1]} → ${c[i]})가 있지만 흔한 배수가 아니라 보정하지 않음. 확인 필요`));
    }
  }
  return out;
}

async function fetchKR(sym, from, to) {
  const rows = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({
      serviceKey: KR_KEY, resultType: 'json', numOfRows: '1000', pageNo: String(page),
      likeSrtnCd: sym, beginBasDt: from.replace(/-/g, ''), endBasDt: to.replace(/-/g, ''),
    });
    const j = await getJSON(`${KR_BASE}/getStockPriceInfo?${q}`, `KR ${sym} p${page}`);
    const head = j?.response?.header;
    if (head && head.resultCode !== '00') throw new Error(`KR ${sym}: ${head.resultCode} ${head.resultMsg}`);
    const body = j?.response?.body || {};
    let items = body.items?.item || [];
    if (!Array.isArray(items)) items = [items];
    for (const it of items) {
      if (String(it.srtnCd) !== sym) continue;
      const b = String(it.basDt);
      rows.push([`${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}`, parseFloat(String(it.clpr).replace(/,/g, ''))]);
    }
    const total = +body.totalCount || 0;
    if (page * 1000 >= total || !items.length) break;
    await sleep(300);
  }
  return rows;
}

// KRX: 하루치 시장 전체에서 필요한 종목만 고른다. ISU_CD가 표준코드(KR7005930003)로 오는 경우도 처리
const krxCode = it => {
  const a = String(it.ISU_SRT_CD || ''), b = String(it.ISU_CD || '');
  if (/^\d{6}$/.test(a)) return a;
  if (/^\d{6}$/.test(b)) return b;
  if (/^KR7\d{6}/.test(b)) return b.slice(3, 9);
  return a || b;
};
async function krxDay(path, date) {
  const url = `${KRX_BASE}/${path}?basDd=${date.replace(/-/g, '')}`;
  try {
    const r = await fetch(url, { headers: { AUTH_KEY: KRX_KEY }, signal: AbortSignal.timeout(60000) });
    const t = await r.text();
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${t.slice(0, 200)}`), { status: r.status });
    return JSON.parse(t).OutBlock_1 || [];
  } catch (e) {
    // https가 안 되면 http로 한 번 바꿔 본다(KRX 문서 예시가 http)
    if (!e.status && KRX_BASE.startsWith('https://')) { KRX_BASE = KRX_BASE.replace('https://', 'http://'); console.warn('  KRX https 실패, http로 전환:', e.message); return krxDay(path, date); }
    throw e;
  }
}

// Tiingo: [{date:"2020-08-31T00:00:00.000Z", close(원래 종가), splitFactor(그날 분할 배수, 평소 1)...}]
// 키는 주소가 아니라 Authorization 헤더로 보낸다(로그에 남지 않게).
async function fetchTiingo(sym, from, to) {
  const q = new URLSearchParams({ startDate: from, endDate: to, format: 'json', resampleFreq: 'daily' });
  const j = await getJSON(`${TIINGO_BASE}/tiingo/daily/${encodeURIComponent(sym.toLowerCase())}/prices?${q}`, `Tiingo ${sym}`,
    { Authorization: `Token ${TIINGO_KEY}`, 'Content-Type': 'application/json' });
  if (!Array.isArray(j)) throw new Error(`Tiingo ${sym} 응답 형식 이상: ${JSON.stringify(j).slice(0, 200)}`);
  const rows = []; const splits = [];
  for (const x of j) {
    const d = String(x.date).slice(0, 10);
    rows.push([d, +x.close]);
    if (x.splitFactor && +x.splitFactor !== 1) splits.push([d, +x.splitFactor]);
  }
  return { rows, splits };
}

async function fetchUS(symbols, from, to) {
  const rows = {}; const splits = {};
  symbols.forEach(s => { rows[s] = []; splits[s] = []; });
  let offset = 0;
  for (;;) {
    const q = new URLSearchParams({ access_key: US_KEY, symbols: symbols.join(','), date_from: from, date_to: to, limit: '1000', offset: String(offset), sort: 'ASC' });
    const j = await getJSON(`${US_BASE}/eod?${q}`, `US offset ${offset}`);
    if (j.error) { const e = new Error(`${j.error.code}: ${j.error.message}`); e.body = j; throw e; }
    const data = j.data || [];
    for (const x of data) {
      const s = x.symbol; if (!rows[s]) continue;
      const d = String(x.date).slice(0, 10);
      rows[s].push([d, +x.close]);
      if (x.split_factor && +x.split_factor !== 1) splits[s].push([d, +x.split_factor]);
    }
    const p = j.pagination || {};
    offset += data.length;
    if (!data.length || offset >= (p.total ?? 0)) break;
    await sleep(500);
  }
  return { rows, splits };
}

function mergeSplits(prev, add) {
  const m = new Map((prev || []).map(([d, r]) => [d, r]));
  for (const [d, r] of add) m.set(d, r);
  return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
}

await mkdir(DIR, { recursive: true });
const today = todayKST();
let index = { symbols: {} };
try { index = JSON.parse(await readFile(`${DIR}/index.json`, 'utf8')); } catch { /* 첫 실행 */ }
const results = { ok: [], fail: [], skip: [] }; const okMap = {};

async function save(sym, name, market, source, merged, splits) {
  if (!merged.d.length) { results.fail.push(`${sym}(데이터 0건)`); return; }
  await writeFile(`${DIR}/${sym}.json`, JSON.stringify({ symbol: sym, name, market, source, updated: new Date().toISOString(), d: merged.d, c: merged.c, splits }));
  index.symbols[sym] = { name, market, source, first: merged.d[0], last: merged.d[merged.d.length - 1], n: merged.d.length };
  okMap[sym] = `${sym} ${merged.d[0]}~${merged.d[merged.d.length - 1]} (${merged.d.length}일)`; results.ok = Object.values(okMap);
}

// 국내
const kr = SYMBOLS.filter(x => x[2] === 'KR');
const yesterday = addDays(today, -1);
if (KRX_KEY) {
  const stateFile = `${DIR}/_krx_state.json`;
  let state = {}; try { state = JSON.parse(await readFile(stateFile, 'utf8')); } catch { /* 처음 */ }
  if (process.env.KR_BACKFILL === '1') state = {};
  const prevs = {}; const rows = {};
  for (const [s] of kr) {
    const p = await load(s);
    // 다른 출처(금융위)로 받은 파일이거나 처음부터 다시 받을 때는 기존 값을 쓰지 않는다
    prevs[s] = state.last && p && /KRX/.test(p.source || '') ? p : null;
    rows[s] = [];
  }
  let d = state.last ? addDays(state.last, 1) : KRX_START;
  let calls = 0, days = 0, lastDone = state.last || null, failed = false;
  const flush = async () => {
    for (const [s, name] of kr) {
      const merged = merge(prevs[s], rows[s]);
      if (!merged.d.length) continue;
      const splits = detectSplitsKR(s, merged.d, merged.c);
      await save(s, name, 'KR', '한국거래소(KRX) OPEN API', merged, splits);
      prevs[s] = { d: merged.d, c: merged.c, source: 'KRX' }; rows[s] = [];
    }
    if (lastDone) await writeFile(stateFile, JSON.stringify({ last: lastDone, updated: new Date().toISOString() }));
  };
  console.log(`KR(KRX) ${d} ~ ${yesterday}, 이번 실행 최대 ${KRX_MAX_CALLS}회 호출`);
  for (; d <= yesterday; d = addDays(d, 1)) {
    const w = new Date(d + 'T00:00:00Z').getUTCDay();
    if (w === 0 || w === 6) { lastDone = d; continue; }
    if (calls + 2 > KRX_MAX_CALLS) { console.log(`  호출 한도에 도달해 ${lastDone}까지 저장하고 멈춤. 다음 실행에서 이어받음`); break; }
    try {
      const [a, b] = await Promise.all([krxDay('stk_bydd_trd', d), krxDay('ksq_bydd_trd', d)]);
      calls += 2;
      for (const it of [...a, ...b]) {
        const code = krxCode(it);
        if (rows[code]) rows[code].push([d, parseFloat(String(it.TDD_CLSPRC).replace(/,/g, ''))]);
      }
      lastDone = d; days++;
      if (days % 250 === 0) { await flush(); console.log(`  ${d}까지 저장 (${calls}회 호출)`); }
    } catch (e) { console.error(`  ${d} 실패: ${e.message}`); failed = true; break; }
    await sleep(+(process.env.KRX_SLEEP ?? 80));
  }
  await flush();
  console.log(`  KRX 끝: ${calls}회 호출, 마지막 처리일 ${lastDone}${failed ? ' (중간 실패, 다음 실행에서 이어받음)' : ''}`);
  if (failed && !results.ok.length) results.fail.push('KRX');
} else if (KR_KEY) {
  for (const [sym, name] of kr) {
    try {
      const prev = await load(sym);
      const from = prev?.d?.length && process.env.KR_BACKFILL !== '1' ? prev.d[prev.d.length - 1] : KR_START;
      console.log(`KR(금융위) ${sym} ${name}: ${from} ~ ${today}`);
      const rows = await fetchKR(sym, from, today);
      const merged = merge(prev, rows);
      const splits = detectSplitsKR(sym, merged.d, merged.c);
      await save(sym, name, 'KR', '금융위원회 주식시세정보(공공데이터포털)', merged, splits);
    } catch (e) { console.error(`  실패: ${e.message}`); results.fail.push(sym); }
    await sleep(300);
  }
} else { console.warn('KRX_AUTH_KEY, DATA_GO_KR_KEY 모두 없음: 국내 종목 건너뜀'); results.skip.push(...kr.map(x => x[0])); }

// 미국
const us = SYMBOLS.filter(x => x[2] === 'US');
if (TIINGO_KEY) {
  for (const [sym, name] of us) {
    try {
      let prev = await load(sym);
      // 다른 출처(Marketstack)로 받은 파일이거나 처음부터 다시 받을 때는 전체를 새로 받는다(출처 섞임 방지)
      if (process.env.US_BACKFILL === '1' || (prev && !/Tiingo/.test(prev.source || ''))) prev = null;
      const from = prev?.d?.length ? prev.d[prev.d.length - 1] : US_START;
      console.log(`US(Tiingo) ${sym} ${name}: ${from} ~ ${today}`);
      const got = await fetchTiingo(sym, from, today);
      const merged = merge(prev, got.rows);
      await save(sym, name, 'US', 'Tiingo', merged, mergeSplits(prev?.splits, got.splits));
    } catch (e) { console.error(`  실패: ${e.message}`); results.fail.push(sym); }
    await sleep(+(process.env.TIINGO_SLEEP ?? 800)); // 무료: 시간당 50회
  }
} else if (!US_KEY) { console.warn('TIINGO_KEY, MARKETSTACK_KEY 모두 없음: 미국 종목 건너뜀'); results.skip.push(...us.map(x => x[0])); }
else {
  // Marketstack: 새 종목(백필)과 기존 종목(이어받기)을 나눠 한꺼번에 요청한다
  const prevs = Object.fromEntries(await Promise.all(us.map(async ([s]) => [s, await load(s)])));
  // US_BACKFILL=1 이면 기존 파일이 있어도 처음부터(10년) 다시 받는다(유료 플랜으로 바꾼 뒤 과거분 채우기)
  if (process.env.US_BACKFILL === '1') for (const s in prevs) prevs[s] = null;
  const fresh = us.filter(([s]) => !prevs[s]?.d?.length).map(x => x[0]);
  const cont = us.filter(([s]) => prevs[s]?.d?.length).map(x => x[0]);
  const groups = [];
  const startFor = y => addDays(addDays(today, -Math.round(y * 365.25)), 7);
  if (fresh.length) groups.push([fresh, null]);
  if (cont.length) {
    const from = cont.map(s => prevs[s].d[prevs[s].d.length - 1]).sort()[0];
    groups.push([cont, from]);
  }
  for (const [syms, fixedFrom] of groups) {
    // 새 종목은 US_YEARS년 → 5년 → 1년 순서로 시도한다(요금제가 허용하는 가장 긴 기간)
    const tries = fixedFrom ? [fixedFrom] : [...new Set([US_YEARS, 5, 1])].filter(y => y <= US_YEARS).map(startFor);
    let got = null;
    for (const from of tries) {
      try { console.log(`US ${syms.join(',')}: ${from} ~ ${today}`); got = await fetchUS(syms, from, today); break; }
      catch (e) { console.warn(`  거절됨: ${e.message}`); }
    }
    if (!got) { results.fail.push(...syms); continue; }
    for (const s of syms) {
      const name = us.find(x => x[0] === s)[1];
      const merged = merge(prevs[s], got.rows[s]);
      await save(s, name, 'US', 'Marketstack', merged, mergeSplits(prevs[s]?.splits, got.splits[s]));
    }
  }
}

// 받은 종목이 있을 때만 목록 파일을 고친다(키가 없는 날 빈 커밋 방지)
if (results.ok.length) {
  index.updated = new Date().toISOString();
  await writeFile(`${DIR}/index.json`, JSON.stringify(index, null, 1));
}
console.log('\n성공:', results.ok.length, results.ok.join(' | '));
if (results.skip.length) console.log('건너뜀(키 없음):', results.skip.join(','));
if (results.fail.length) { console.log('실패:', results.fail.join(',')); }
// 일부 실패는 기존 파일로 계속 동작하므로 작업 자체를 실패로 끝내지는 않는다. 전부 실패하면 실패 처리
if (!results.ok.length && results.fail.length) process.exit(1);
