// 银行主体评级查询：看板识别时，匹配到词库的银行优先用这里的评级，而不是依赖左侧分区标签
import { fetchBankRatings } from './api';

interface RatingRow {
  rating: string;
  nk: string;
  ck: string;
}

// 与后端 normalizeBankKey 思路一致：去前缀数字/括号/股份公司字样，统一银行/农商等写法
function normalizeKey(name: string): string {
  return String(name || '')
    .replace(/^\d+/, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/股份有限公司|有限责任公司|有限公司/g, '')
    .replace(/^中国/, '')
    .replace(/^邮储/, '邮政储蓄')
    .replace(/^浦发/, '上海浦东发展')
    .replace(/农村商业银行|农商银行|农商行|农村商行/g, '农商')
    .replace(/农村合作银行|农合银行/g, '农合')
    .replace(/商业银行/g, '银行')
    .replace(/\s/g, '')
    .trim();
}

// 再去掉结构字，得到「核心名」，用于前缀匹配失败后的唯一兜底
function coreKey(name: string): string {
  return normalizeKey(name).replace(/银行|农商|农合|商行/g, '');
}

let rows: RatingRow[] = [];
let byNk = new Map<string, string>();
let loadPromise: Promise<void> | null = null;

function rebuild(list: Array<{ bank_name?: string; rating?: string }>) {
  rows = list
    .filter(r => r && r.bank_name && r.rating)
    .map(r => ({ rating: r.rating as string, nk: normalizeKey(r.bank_name as string), ck: coreKey(r.bank_name as string) }));
  byNk = new Map();
  for (const r of rows) {
    if (r.nk && !byNk.has(r.nk)) byNk.set(r.nk, r.rating);
  }
}

// 只拉一次；失败就退回分区标签，不影响识别
export function ensureBankRatingsLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const list = await fetchBankRatings();
        if (Array.isArray(list)) rebuild(list);
      } catch {
        // 忽略：没有评级数据时走分区标签
      }
    })();
  }
  return loadPromise;
}

// 候选行评级一致才采用，避免误配到其他银行
function uniqueRating(cands: RatingRow[]): string | null {
  if (cands.length === 0) return null;
  const ratings = new Set(cands.map(r => r.rating));
  return ratings.size === 1 ? cands[0].rating : null;
}

// 同步查询：拿到评级返回，拿不到返回 null（调用方回退到分区标签）
export function getBankRating(bankName: string): string | null {
  if (!bankName || rows.length === 0) return null;
  const nk = normalizeKey(bankName);
  if (!nk) return null;

  const exact = byNk.get(nk);
  if (exact) return exact;

  // 前缀：如「无锡农商」对「无锡农商银行」
  const byPrefix = uniqueRating(rows.filter(r => r.nk.startsWith(nk)));
  if (byPrefix) return byPrefix;

  // 包含：如「稠州银行」对「浙江稠州银行」；短名至少 3 字避免噪声
  if (nk.length >= 3) {
    const byContains = uniqueRating(rows.filter(r => r.nk.includes(nk)));
    if (byContains) return byContains;
  }

  // 去结构字后的核心名，唯一命中才采用，避免「上海银行 / 上海农商」混淆
  const ck = coreKey(bankName);
  const byCore = uniqueRating(rows.filter(r => r.ck === ck));
  if (byCore) return byCore;

  return null;
}
