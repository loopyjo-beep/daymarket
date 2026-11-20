// 한국은행 ECOS에서 원/달러 매매기준율(일별)을 받아 data/usdkrw.json에 저장한다.
// 실행: ECOS_KEY=발급키 node scripts/fetch-usdkrw.mjs
// - 처음 실행하면 2000-01-01부터 전부 받고, 이후에는 마지막 날짜 이후만 받아 덧붙인다.
// - 받아 온 값이 이상하면(개수 0, 범위 밖 값) 기존 파일을 그대로 두고 실패로 끝낸다. 화면은 이전 파일로 계속 동작한다.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const KEY = process.env.ECOS_KEY;
// 키가 없으면 실패로 끝내지 않고 건너뛴다(매일 실패 알림 방지). 화면은 Frankfurter(ECB) 환율로 대신 동작한다.
if (!KEY) { console.warn('ECOS_KEY 없음: 환율 수집을 건너뜁니다. GitHub Secrets에 ECOS_KEY를 등록하면 다음 실행부터 받습니다.'); process.exit(0); }
const OUT = 'data/usdkrw.json';
const START = '20000101';
const BASE = process.env.ECOS_BASE || 'https://ecos.bok.or.kr/api';
// 통계표 후보: 731Y001(주요국 통화의 대원화환율, 2022.6 개편 후). 036Y001은 개편 전 코드(예비)
const TABLES = ['731Y001', '036Y001'];

const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { console.warn(`재시도 ${i + 1}/3:`, e.message); await sleep(3000 * (i + 1)); }
  }
  throw new Error('ECOS 호출 실패: ' + path.replace(KEY, '***'));
}

// 통계표 안에서 "미국달러" + "매매기준율" 항목 코드를 찾는다(코드가 바뀌어도 동작하도록)
async function findItem(table) {
  const j = await get(`StatisticItemList/${KEY}/json/kr/1/500/${table}`);
  const rows = j?.StatisticItemList?.row || [];
  const hit = rows.find(r => /미국달러|미국 달러|USD/.test(r.ITEM_NAME) && /매매기준율/.test(r.ITEM_NAME) && r.CYCLE === 'D')
           || rows.find(r => /원\/미국달러/.test(r.ITEM_NAME) && r.CYCLE === 'D');
  return hit ? { table, item: hit.ITEM_CODE, name: hit.ITEM_NAME } : null;
}

async function fetchRange(table, item, from, to) {
  const out = {};
  const size = 10000;
  for (let s = 1; ; s += size) {
    const j = await get(`StatisticSearch/${KEY}/json/kr/${s}/${s + size - 1}/${table}/D/${from}/${to}/${item}`);
    if (j?.RESULT) { if (/INFO-200/.test(j.RESULT.CODE)) break; throw new Error(`${j.RESULT.CODE} ${j.RESULT.MESSAGE}`); }
    const rows = j?.StatisticSearch?.row || [];
    for (const r of rows) {
      const v = parseFloat(String(r.DATA_VALUE).replace(/,/g, ''));
      const d = `${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}-${r.TIME.slice(6, 8)}`;
      if (v > 0) out[d] = v;
    }
    const total = j?.StatisticSearch?.list_total_count || 0;
    if (s + size - 1 >= total) break;
    await sleep(1000);
  }
  return out;
}

let prev = { rates: {} };
try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 첫 실행 */ }
const prevDates = Object.keys(prev.rates || {}).sort();
const from = prevDates.length ? prevDates[prevDates.length - 1].replace(/-/g, '') : START;

let meta = prev.ecos || null;
if (!meta) for (const t of TABLES) { try { meta = await findItem(t); } catch (e) { console.warn(t, e.message); } if (meta) break; }
if (!meta) { console.error('ECOS에서 원/달러 매매기준율 항목을 찾지 못했습니다.'); process.exit(1); }
console.log('사용 항목:', meta);

const fresh = await fetchRange(meta.table, meta.item, from, kst);
const vals = Object.values(fresh);
if (!vals.length && !prevDates.length) { console.error('받아 온 값이 없습니다.'); process.exit(1); }
const bad = vals.filter(v => v < 500 || v > 3000);
if (bad.length) { console.error('범위를 벗어난 값이 있어 저장하지 않습니다:', bad.slice(0, 5)); process.exit(1); }

const rates = { ...prev.rates, ...fresh };
const sorted = Object.fromEntries(Object.keys(rates).sort().map(d => [d, rates[d]]));
await mkdir('data', { recursive: true });
await writeFile(OUT, JSON.stringify({
  source: '한국은행 ECOS 원/달러 매매기준율',
  ecos: meta,
  updated: new Date().toISOString(),
  rates: sorted,
}));
const ds = Object.keys(sorted);
console.log(`저장: ${ds.length}일 (${ds[0]} ~ ${ds[ds.length - 1]}), 이번에 받은 날짜 ${Object.keys(fresh).length}개`);
