import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  upsertNcdIssuance, getNcdIssuanceState,
  upsertBankRatings, getBanksNeedingRating, getAllNcdIssuers, refreshBankMeta,
} from './database.js';

/**
 * DM (innodealing) 同业存单发行数据抓取
 *
 * 抓的是同业存单"报价发行"记录（带代码），据此反推每日到期量：
 *   到期日 = 起息日 + 期限，按 actual_maturity_date 聚合即得当日到期明细。
 *
 * 两个坑（已实测）：
 *   1. 必须用官方 MCP SDK 握手，裸 HTTP 调用一律 -32603。
 *   2. 多日区间查询 offset 失效（会返回重复），因此必须逐日拉。
 */

const GATEWAY = 'https://gapi-ext.innodealing.com/dm-mcp-service/publicapi/mcp/v1/bond-primary/';
const ANALYSIS_GATEWAY = 'https://gapi-ext.innodealing.com/dm-mcp-service/publicapi/mcp/v1/bond-analysis/';
const NCD_CATEGORY = 5; // bond_category=5 即同业存单

function creds() {
  const key = process.env.DM_APP_KEY;
  const secret = process.env.DM_APP_SECRET;
  if (!key || !secret) throw new Error('缺少 DM_APP_KEY / DM_APP_SECRET 环境变量');
  return { key, secret };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// DM 有频率限制（429 请求过于频繁），需退避重试
async function callWithRetry(fn, { retries = 6, base = 3000, label = '' } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const retryable = /429|过于频繁|too many|timeout|ECONN|socket hang up|ETIMEDOUT/i.test(msg);
      if (!retryable || i >= retries) throw e;
      const wait = base * Math.pow(2, i) + Math.floor(Math.random() * 800);
      console.log(`[DM] ${label} 触发限流，${(wait / 1000).toFixed(1)}s 后重试 (${i + 1}/${retries})`);
      await sleep(wait);
    }
  }
}

async function withClient(fn, gateway = GATEWAY) {
  const { key, secret } = creds();
  const client = new Client({ name: 'ncd-backend', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway), {
    requestInit: { headers: { 'x-app-key': key, 'x-app-secret': secret } },
    requestTimeout: 60000,
  }));
  try {
    return await fn(client);
  } finally {
    try { await client.close(); } catch {}
  }
}

// 把 DM 原始记录规整成入库行
function normalize(q) {
  const id = q.security_id || `${q.sec_short_name || q.issuer_full_name || '?'}|${q.start_accrue_date || ''}|${q.bond_issue_tenor || ''}`;
  return {
    security_id: id,
    issuer_name: q.issuer_full_name || null,
    sec_name: q.sec_short_name || null,
    tenor: q.bond_issue_tenor || null,
    amount: q.actu_issue_amount != null ? q.actu_issue_amount / 10000 : (q.plan_issue_amount != null ? q.plan_issue_amount / 10000 : null), // 万元 → 亿元
    ref_yield: q.ref_yield ?? null,
    issue_date: q.issue_start_date || null,
    start_accrue_date: q.start_accrue_date || null,
    maturity_date: q.actual_maturity_date || null,
    issue_status: q.issue_status ?? null,
  };
}

// 拉取单日发行的同业存单（单日查询可靠，返回 ≤200 条无需翻页）
export async function pullNcdByDay(client, day) {
  const res = await client.callTool({ name: 'bond_primary_data', arguments: { params: {
    user_message: `查询${day}同业存单`, start_date: day, end_date: day,
    bond_category: NCD_CATEGORY, limit: 200, offset: 0 } } });
  const txt = res.content?.[0]?.text ?? '';
  if (res.isError) throw new Error(`DM 返回错误(${day}): ${txt.slice(0, 200)}`);
  let list = [];
  try {
    const o = JSON.parse(txt);
    list = o?.data?.[0]?.list ?? o?.data?.list ?? [];
  } catch {
    return [];
  }
  return list.map(normalize).filter(r => r.maturity_date);
}

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };

// 逐日抓取 [startDay, endDay]。必须逐日，因为 DM 多日区间查询的 offset 失效
export async function syncNcdRange(startDay, endDay, onProgress) {
  return withClient(async (client) => {
    let total = 0, calls = 0;
    let day = startDay;
    while (day <= endDay) {
      const rows = await callWithRetry(() => pullNcdByDay(client, day), { label: day });
      total += upsertNcdIssuance(rows).count;
      calls++;
      if (onProgress && calls % 25 === 0) onProgress({ day, calls, total });
      await sleep(300);
      day = addDays(day, 1);
    }
    return { calls, total, state: getNcdIssuanceState() };
  });
}

const monthStart = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
const monthEnd = d => iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));

// 按月刷新：抓上一个自然月的全部发行记录。
// 依据：本月到期量在上月底就已全部确定（最短期限 1M），故每月只需刷一次上月发行，
// 即可锁定本月及以后的到期明细，无需每天抓取。约 22 个交易日 ≈ 22 次调用。
export async function refreshPreviousMonth(onProgress) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return syncNcdRange(monthStart(prev), monthEnd(prev), onProgress);
}

// 一次性回补：从 monthsBack 个月前到今天（可断点续跑，从已入库的最后一个发行日之后继续）
export async function backfillNcd(monthsBack = 13, onProgress) {
  const end = iso(new Date());
  const earliest = new Date(end + 'T00:00:00');
  earliest.setMonth(earliest.getMonth() - monthsBack);

  const state = getNcdIssuanceState();
  let day = iso(earliest);
  if (state.max_issue_date && state.max_issue_date > day) day = addDays(state.max_issue_date, 1);
  return syncNcdRange(day, end, onProgress);
}

// 每日增量：回看最近 days 天（含今天）。之所以回看而不是只抓今天，
// 是因为「发行中」的存单在上市/取消后金额与状态会变，需要覆写修正。
// 默认回看 7 天（而非 5 天）是为了跨过长假：假期后仍能覆盖到节前的「发行中」记录。7 次调用/日，可忽略。
const DAILY_LOOKBACK = 7;
export async function syncNcdDaily(days = DAILY_LOOKBACK, onProgress) {
  const end = iso(new Date());
  const start = addDays(end, -(Math.max(1, days) - 1));
  const r = await syncNcdRange(start, end, onProgress);
  // 新入库的发行人是新银行，bucket 还是空的，这里先按「大行国股/未评级」归类
  r.meta = refreshBankMeta();
  return r;
}

// ===== 主体评级（bond-analysis / com_rating）=====
// 只查「还没评级的银行」，一次最多 5 家。约 265 家银行 → 53 次调用，首轮之后基本不再调用。
const RATING_GATEWAY = ANALYSIS_GATEWAY;
const RATING_BATCH = 5;
const RATING_SPAN_DAYS = 1820; // DM 限制查询区间自然日 ≤1825 天

// com_rating 返回 data 为扁平数组，同一家银行有多条历史评级。
// 取「外部评级」优先、评级日期最新的一条；只有 PCA 评分时回退用它。
function pickLatestRatings(list, requested) {
  const best = new Map();
  const rank = ds => (ds === '外部评级' ? 1 : ds === '标普信评PCA评分' ? 0 : -1);
  for (const r of list) {
    const name = r.com_chi_name;
    if (!name || !r.rating) continue;
    const cur = best.get(name);
    const curKey = cur ? [rank(cur.data_source), cur.rating_date || ''] : null;
    const key = [rank(r.data_source), r.rating_date || ''];
    if (!cur || (key[0] > curKey[0] || (key[0] === curKey[0] && key[1] > curKey[1]))) best.set(name, r);
  }
  // 请求了但 DM 无评级的银行，写一条 rating=null 占位，避免每次 sync 重复查询
  return requested.map(name => {
    const r = best.get(name);
    return r
      ? { bank_name: name, rating: r.rating, rating_date: r.rating_date ?? null, institution: r.rating_institution_short_name ?? null }
      : { bank_name: name, rating: null, rating_date: null, institution: null };
  });
}

async function fetchRatings(client, batch, start, end) {
  const res = await client.callTool({ name: 'com_rating', arguments: { params: {
    user_message: `查询${batch.join('、')}的主体评级`,
    com_chi_name_list: batch, start_date: start, end_date: end } } });
  const txt = res.content?.[0]?.text ?? '';
  if (res.isError) throw new Error(`DM com_rating 返回错误: ${txt.slice(0, 200)}`);
  let list = [];
  try {
    const o = JSON.parse(txt);
    list = Array.isArray(o?.data) ? o.data : (o?.data?.list ?? []);
  } catch {
    return pickLatestRatings([], batch);
  }
  return pickLatestRatings(list, batch);
}

// 抓取主体评级并回填 bucket/rating。force=true 时重抓所有银行（评级会不定期更新）。
export async function syncBankRatings({ force = false, onProgress } = {}) {
  const banks = force ? getAllNcdIssuers() : getBanksNeedingRating();
  if (banks.length === 0) {
    const meta = refreshBankMeta();
    return { banks: 0, calls: 0, updated: 0, meta };
  }
  const end = iso(new Date());
  const start = addDays(end, -RATING_SPAN_DAYS);
  const result = await withClient(async (client) => {
    let calls = 0, updated = 0;
    for (let i = 0; i < banks.length; i += RATING_BATCH) {
      const batch = banks.slice(i, i + RATING_BATCH);
      const rows = await callWithRetry(() => fetchRatings(client, batch, start, end), { label: `rating:${batch[0]}` });
      calls++;
      updated += upsertBankRatings(rows).count;
      if (onProgress && calls % 10 === 0) onProgress({ calls, done: Math.min(i + RATING_BATCH, banks.length), total: banks.length });
      await sleep(400);
    }
    return { banks: banks.length, calls, updated };
  }, RATING_GATEWAY);
  result.meta = refreshBankMeta();
  return result;
}
