// 报价解析器：支持同一行多银行、中英文期限、无空格收益率以及 OCR 文本

export const BANKS = [
  '工商银行', '农业银行', '中国银行', '建设银行', '交通银行', '邮储银行',
  '中信银行', '光大银行', '华夏银行', '广发银行', '平安银行', '招商银行',
  '浦发银行', '兴业银行', '浙商银行', '渤海银行', '恒丰银行', '民生银行',
  '北京银行', '上海银行', '江苏银行', '宁波银行', '南京银行', '杭州银行',
  '厦门国际银行', '汉口银行', '长沙银行', '成都银行', '重庆银行', '贵阳银行',
  '郑州银行', '青岛银行', '西安银行', '苏州银行', '河北银行', '哈尔滨银行',
  '大连银行', '盛京银行', '吉林银行', '内蒙古银行', '宁夏银行', '甘肃银行',
  '中原银行', '湖北银行', '温州银行', '台州银行', '厦门银行', '齐鲁银行',
  '威海银行', '晋商银行', '东莞银行', '广州银行', '珠海华润银行', '泰隆银行',
  '青海银行', '新疆银行', '绍兴银行', '湖州银行', '嘉兴银行', '金华银行',
  '海峡银行', '泉州银行', '赣州银行', '上饶银行', '日照银行', '烟台银行',
  '齐商银行', '华兴银行', '民泰银行', '邯郸银行', '邢台银行', '沧州银行',
  '承德银行', '衡水银行', '乌海银行', '鄂尔多斯银行', '抚顺银行', '鞍山银行',
  '丹东银行', '营口银行', '阜新银行', '辽阳银行', '铁岭银行', '朝阳银行',
  '天津银行',
  '重庆农商', '上海农商', '广州农商', '深圳农商', '东莞农商', '顺德农商',
  '天津农商', '武汉农商', '长沙农商行', '江南农商', '南海农商', '珠海农商',
  '佛山农商', '无锡农商', '常熟农商', '张家港农商', '江阴农商', '吴江农商',
  '太仓农商', '昆山农商'
];

// ---------- 银行别名 ----------

const BANK_ALIASES: Record<string, string> = {};

function addAlias(alias: string, bank: string) {
  if (alias.length >= 2) BANK_ALIASES[alias] = bank;
}

for (const bank of BANKS) {
  addAlias(bank, bank);
  // 只去掉“银行”后缀，避免“上海农商”被错误缩成“上海”而和“上海银行”冲突
  if (bank.endsWith('银行')) addAlias(bank.slice(0, -2), bank);
}

const EXTRA_ALIASES: Record<string, string> = {
  '工行': '工商银行',
  '农行': '农业银行',
  '中行': '中国银行',
  '建行': '建设银行',
  '交行': '交通银行',
  '招行': '招商银行',
  '邮储': '邮储银行',
  '兴行': '兴业银行',
  '兴银行': '兴业银行',
  '兴行银行': '兴业银行',
  '浦银行': '浦发银行',
  '信银行': '中信银行',
  '发银行': '广发银行',
};

for (const [alias, bank] of Object.entries(EXTRA_ALIASES)) {
  addAlias(alias, bank);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 长的别名排在前面，保证“浦发银行”不会被“发银行”抢先匹配
const ALIAS_PATTERN = new RegExp(
  Object.keys(BANK_ALIASES)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|'),
  'g'
);

interface BankMention {
  index: number;
  end: number;
  bank: string;
}

function findBankMentions(text: string): BankMention[] {
  const mentions: BankMention[] = [];
  ALIAS_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ALIAS_PATTERN.exec(text)) !== null) {
    mentions.push({
      index: match.index,
      end: match.index + match[0].length,
      bank: BANK_ALIASES[match[0]],
    });
  }
  return mentions;
}

// ---------- 文本清洗 ----------

// OCR 常把中文逐字隔开（“浦 发 银 行”）、把小数拆开（“1. 49”），这里统一还原
export function normalizeOcrText(raw: string): string {
  let text = raw
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/％/g, '%')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/：/g, ':')
    .replace(/[　 ]/g, ' ');

  text = text.replace(/([一-龥])[ \t]+(?=[一-龥])/g, '$1');
  text = text.replace(/(\d)[ \t]+(?=[个年月的天周万亿])/g, '$1');
  text = text.replace(/(\d)[ \t]*[.．。][ \t]*(?=\d)/g, '$1.');
  text = text.replace(/\d{4}\s*[/\-年]\s*\d{1,2}\s*[/\-月]\s*\d{1,2}\s*日?/g, ' ');
  text = text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');
  text = text.replace(/(上午|下午|早上|晚上|中午)/g, ' ');
  text = text.replace(/[ \t]*%[ \t]*/g, '%');

  return text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

// ---------- 模糊匹配（仅用于 OCR 把银行名识别错时兜底） ----------

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

function fuzzyBank(token: string): string | null {
  let bestBank = '';
  let bestScore = 0;
  for (const bank of BANKS) {
    const score = similarity(token, bank);
    if (score > bestScore) {
      bestScore = score;
      bestBank = bank;
    }
  }
  return bestScore >= 0.72 ? bestBank : null;
}

// 每行行首若没有被别名命中的银行名，尝试按编辑距离识别（如“兴业银衍”）
function findFuzzyLineBanks(text: string): BankMention[] {
  const mentions: BankMention[] = [];
  let offset = 0;

  for (const line of text.split('\n')) {
    if (findBankMentions(line).length === 0) {
      const match = line.match(/^\s*([一-龥]{2,6})/);
      if (match) {
        const token = match[1];
        const bank = fuzzyBank(token);
        if (bank) {
          const start = offset + line.indexOf(token);
          mentions.push({ index: start, end: start + token.length, bank });
        }
      }
    }
    offset += line.length + 1;
  }
  return mentions;
}

function mergeMentions(mentions: BankMention[]): BankMention[] {
  const sorted = [...mentions].sort((a, b) => a.index - b.index);
  const merged: BankMention[] = [];
  for (const mention of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && mention.index < prev.end) continue;
    merged.push(mention);
  }
  return merged;
}

// ---------- 期限 ----------

const TENOR_ALIASES: Array<[string, string]> = [
  ['十二个月', '1Y'], ['12个月', '1Y'], ['一年', '1Y'], ['1年', '1Y'], ['12M', '1Y'], ['1Y', '1Y'],
  ['九个月', '9M'], ['9个月', '9M'], ['9M', '9M'], ['9月', '9M'],
  ['六个月', '6M'], ['6个月', '6M'], ['6M', '6M'], ['6月', '6M'],
  ['三个月', '3M'], ['3个月', '3M'], ['3M', '3M'], ['3月', '3M'],
  ['一个月', '1M'], ['1个月', '1M'], ['1M', '1M'], ['1月', '1M'],
];

const TENOR_MAP = new Map(TENOR_ALIASES.map(([alias, tenor]) => [alias.toLowerCase(), tenor]));

const TENOR_PATTERN = new RegExp(
  TENOR_ALIASES
    .map(([alias]) => alias)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|'),
  'gi'
);

function findTenor(text: string): string {
  TENOR_PATTERN.lastIndex = 0;
  const match = TENOR_PATTERN.exec(text);
  return match ? TENOR_MAP.get(match[0].toLowerCase()) || '' : '';
}

// ---------- 收益率 ----------

function formatRate(value: number): string {
  let formatted = value.toFixed(4).replace(/(\.\d{2,}?)0+$/, '$1');
  if (!formatted.includes('.')) {
    formatted += '.00';
  } else if (formatted.split('.')[1].length === 1) {
    formatted = value.toFixed(2);
  }
  return formatted;
}

function isPlausibleRate(value: number): boolean {
  return value >= 0.1 && value <= 10;
}

function parseRate(text: string): string | null {
  // 去掉发行量，避免把“40e / 20亿 / 5000万”当成收益率
  let body = text
    .replace(/\d+(?:\.\d+)?\s*(?:亿|億|万|萬|e)(?![a-zA-Z])/gi, ' ')
    .replace(/AA\+|AAA|AA-|A\+/gi, ' ');

  const candidates: number[] = [];

  // 1.49% / 1.5％
  const percent = body.match(/(\d{1,3}(?:\.\d{1,4})?)\s*%/);
  if (percent) candidates.push(parseFloat(percent[1]));

  // 150bp / 150 个基点
  const bp = body.match(/(\d{2,4})\s*(?:bp|个基点)/i);
  if (bp) candidates.push(parseInt(bp[1], 10) / 100);

  // 1.49（修复“1.49 被识别成 49”的问题：优先按小数解析）
  const decimal = body.match(/(?<![\d.])(\d{1,2}\.\d{1,4})(?![\d])/);
  if (decimal) candidates.push(parseFloat(decimal[1]));

  // OCR 出来的 “1 49”（小数点丢失）
  const spacedDecimal = body.match(/(?<![\d.])(\d{1,2})[ \t]+(\d{2})(?![\d.])/);
  if (spacedDecimal) candidates.push(parseFloat(`${spacedDecimal[1]}.${spacedDecimal[2]}`));

  // 纯数字：只接受 1-9（如 2 表示 2.00）和 100-999 的 BP 写法（如 149 表示 1.49）
  // 10-99 的裸数字很可能是小数被截断后的误识别，直接忽略
  if (candidates.length === 0) {
    const ints = body.matchAll(/(?<![\d.])(\d{1,4})(?![\d.])/g);
    for (const match of ints) {
      const value = parseInt(match[1], 10);
      if (value >= 100 && value <= 999) candidates.push(value / 100);
      else if (value >= 1 && value <= 9) candidates.push(value);
    }
  }

  for (const value of candidates) {
    if (isPlausibleRate(value)) return formatRate(value);
  }
  return null;
}

// ---------- 评级 / 星期 / 发行量 ----------

function findRating(text: string): string {
  const match = text.match(/AA\+|AAA|AA-|AA(?![A-Z])|A\+/i);
  return match ? match[0].toUpperCase() : 'AAA';
}

const WEEKDAY_KEYWORDS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function findWeekday(text: string): string {
  for (const weekday of WEEKDAY_KEYWORDS) {
    if (text.includes(weekday)) return weekday;
  }
  return '';
}

function findVolume(text: string): string {
  const patterns = [
    /(\d+)\s*[eE]/,
    /(\d+)\s*[亿億]/,
    /(\d+)\s*[万萬]/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      if (text.includes('亿') || text.includes('億')) return match[1] + '亿';
      if (text.includes('万') || text.includes('萬')) return match[1] + '万';
      return match[1] + 'e';
    }
  }
  return '';
}

export function getCategory(bankName: string, rating: string = 'AAA'): string {
  const bigBanks = [
    '工商银行', '农业银行', '中国银行', '建设银行', '交通银行', '邮储银行',
    '中信银行', '光大银行', '华夏银行', '广发银行', '平安银行', '招商银行',
    '浦发银行', '兴业银行', '浙商银行', '渤海银行', '恒丰银行', '民生银行'
  ];

  if (bankName.includes('天津银行')) return 'AAA';

  for (const bank of bigBanks) {
    if (bankName.includes(bank)) return 'BIG';
  }

  if (rating === 'AA+') return 'AA+';
  if (rating === 'AA-') return 'AA-';
  return 'AAA';
}

// ---------- 解析 ----------

interface TenorRate {
  tenor: string;
  yieldRate: string;
}

function parseTenorRates(text: string): TenorRate[] {
  const results: TenorRate[] = [];
  const tenors: Array<{ index: number; end: number; tenor: string }> = [];

  TENOR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TENOR_PATTERN.exec(text)) !== null) {
    tenors.push({
      index: match.index,
      end: match.index + match[0].length,
      tenor: TENOR_MAP.get(match[0].toLowerCase()) || '',
    });
  }

  for (let i = 0; i < tenors.length; i++) {
    const end = i + 1 < tenors.length ? tenors[i + 1].index : text.length;
    const yieldRate = parseRate(text.slice(tenors[i].end, end));
    if (yieldRate) results.push({ tenor: tenors[i].tenor, yieldRate });
  }

  // 没有「期限+收益率」成对出现时，兜底解析整段
  if (results.length === 0) {
    const yieldRate = parseRate(text);
    if (yieldRate) results.push({ tenor: findTenor(text), yieldRate });
  }

  return results;
}

function extractBankName(text: string): string {
  const match = text.match(/^([一-龥a-zA-Z]{2,6})/);
  return match ? match[1] : '';
}

function buildQuotes(bodyText: string, bankName: string, defaultWeekday: string) {
  const rating = findRating(bodyText);
  const weekday = findWeekday(bodyText) || defaultWeekday;
  const volume = findVolume(bodyText);

  return parseTenorRates(bodyText).map(quote => ({
    bankName,
    rating,
    category: getCategory(bankName, rating),
    tenor: quote.tenor,
    yieldRate: quote.yieldRate,
    volume,
    weekday,
  }));
}

export function parseQuotation(text: string, defaultWeekday: string = '周一') {
  const normalized = normalizeOcrText(text);
  const mentions = mergeMentions([
    ...findBankMentions(normalized),
    ...findFuzzyLineBanks(normalized),
  ]);

  let bankName = mentions[0]?.bank || extractBankName(normalized);
  let body = normalized;
  if (mentions[0]) {
    body = normalized.slice(0, mentions[0].index) + ' ' + normalized.slice(mentions[0].end);
  }

  const quotes = buildQuotes(body, bankName || '未知银行', defaultWeekday);
  return quotes.length > 0 ? quotes[0] : null;
}

export function parseQuotations(text: string, defaultWeekday: string = '周一') {
  const normalized = normalizeOcrText(text);
  const mentions = mergeMentions([
    ...findBankMentions(normalized),
    ...findFuzzyLineBanks(normalized),
  ]);

  // 没有任何银行名：按一整段解析，银行名留空
  if (mentions.length === 0) {
    return buildQuotes(normalized, '', defaultWeekday);
  }

  const results: ReturnType<typeof buildQuotes> = [];

  // 第一个银行名之前的文本（表头/报价写在银行名前）归入第一家银行
  const prefix = normalized.slice(0, mentions[0].index);
  if (prefix.trim()) {
    results.push(...buildQuotes(prefix, mentions[0].bank, defaultWeekday));
  }

  // 多家银行共用一个报价的写法（长沙银行 广州银行 江南农商 1Y 1.43）：
  // 收益率只写在最后一家银行后面，前面几家要一起分享这段报价
  const pendingBanks: string[] = [];
  for (let i = 0; i < mentions.length; i++) {
    const start = mentions[i].end;
    const end = i + 1 < mentions.length ? mentions[i + 1].index : normalized.length;
    const body = normalized.slice(start, end);
    if (parseTenorRates(body).length === 0) {
      pendingBanks.push(mentions[i].bank);
      continue;
    }
    for (const bank of [...pendingBanks, mentions[i].bank]) {
      results.push(...buildQuotes(body, bank, defaultWeekday));
    }
    pendingBanks.length = 0;
  }

  return results;
}

export function parseMaturityDates(text: string): { tenor: string; date: string; weekday: string }[] {
  // 多种格式匹配
  const patterns = [
    /(\d+[MY])[^0-9]*(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})[^周]*/g,
    /(\d+[MY])[^0-9]*到期日[^周]*/g,
    /(到期日[^周]*)(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/g,
  ];

  const results: { tenor: string; date: string; weekday: string }[] = [];
  const seen = new Set<string>();

  // 提取期限和日期
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let tenor = match[1].toUpperCase().replace('MONTH', 'M').replace('YEAR', 'Y');
      if (tenor === '12M') tenor = '1Y';

      // 提取日期
      const dateMatch = match[0].match(/(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/);
      const date = dateMatch ? dateMatch[1] : '';

      // 提取星期
      const weekdayMatch = text.match(/周[一二三四五六日]/);
      const weekday = weekdayMatch ? weekdayMatch[0] : '';

      const key = tenor + date;
      if (!seen.has(key) && tenor && date) {
        seen.add(key);
        results.push({ tenor, date, weekday });
      }
    }
  }

  // 单独提取星期（如果有）
  const weekdayMatches = text.matchAll(/周[一二三四五六日]/g);
  for (const match of weekdayMatches) {
    const weekday = match[0];
    // 尝试找最近的日期
    const idx = match.index || 0;
    const nearbyText = text.substring(Math.max(0, idx - 20), idx + 5);
    const dateMatch = nearbyText.match(/(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/);

    if (dateMatch) {
      for (const result of results) {
        if (result.date === dateMatch[1] && !result.weekday) {
          result.weekday = weekday;
        }
      }
    }
  }

  return results;
}
