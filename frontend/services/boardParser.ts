// 看板图解析：用表头的期限/到期日切分列，再把每个词块按坐标还原成一条报价

import { BANKS, getCategory } from './parser';

export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number;
  color?: 'red' | 'green' | 'black';
}

export interface BoardSection {
  text: string;
  top: number;
  bottom: number;
}

export interface BoardOcrResult {
  board: boolean;
  width: number;
  height: number;
  headerBottom?: number;
  headerText?: string;
  bodyText?: string;
  headerWords?: OcrWord[];
  bodyWords?: OcrWord[];
  sections?: BoardSection[];
}

export interface BoardQuote {
  bankName: string;
  rating: string;
  category: string;
  tenor: string;
  yieldRate: string;
  volume: string;
  weekday: string;
  remarks: string;
  maturityDate: string;
  maturityWeekday: string;
  rawBankName: string;
}

interface HeaderGroup {
  tenor: string;
  date: string;
  weekday: string;
  x: number;
  low: number;
  high: number;
}

const DATE_RE = /(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/;
const TENOR_RE = /(1[0-2]|[1-9])\s*(M|Y)\b/i;
const CN_TENORS: Array<[RegExp, string]> = [
  [/十二个?月|12个?月|一年|1年/, '1Y'],
  [/九个?月|9个?月/, '9M'],
  [/六个?月|6个?月/, '6M'],
  [/三个?月|3个?月/, '3M'],
  [/一个?月|1个?月/, '1M'],
];
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 银行名补充（看板里常见的城商行 / 农商行）
const EXTRA_BOARD_BANKS = [
  '桂林银行', '富滇银行', '江西银行', '九江银行', '徽商银行', '东亚银行',
  '重庆三峡银行', '中阳银行', '青岛农商行', '秦农农商银行', '萧山农商银行',
  '成都农商银行', '广东南海农商行', '东莞农村商业银行', '重庆农村商业银行',
  '江苏江南农商行', '江苏江南农村商业银行', '上海华瑞银行', '广东华兴银行',
  '大华银行', '广西北部湾银行', '武汉农商行', '富邦华一银行',
  '湖南银行', '泸州银行', '柳州银行', '长安银行', '浙江民泰商行',
  '中山农商行', '福建海峡银行', '广东南粤银行', '长城华西银行',
  '四川天府银行', '绵阳市商业银行', '天津滨海农村商行', '浙江绍兴瑞丰农商行',
  '四川银行', '江门农商银行', '宜宾市商业银行',
];

const BANK_CANDIDATES = Array.from(new Set([...BANKS, ...EXTRA_BOARD_BANKS]));

const NAME_FIXES: Array<[RegExp, string]> = [
  [/青鸟|青包|青名/g, '青岛'],
  [/富汗|富演|富寅|富滨|宫汗/g, '富滇'],
  [/华页|华克/g, '华夏'],
  [/恒主|全丰/g, '恒丰'],
  [/浙有|浙高/g, '浙商'],
  [/满海|济海|潢海|涝海/g, '渤海'],
  [/激商|谷有|微商|微有|油商|笤有|答有/g, '徽商'],
  [/微银行/g, '徽商银行'],
  [/十江/g, '九江'],
  [/海睦/g, '海峡'],
  [/许州|闽了州/g, '郑州'],
  [/中州/g, '中原'],
  [/天滨海津/g, '天津滨海'],
  [/素农/g, '秦农'],
  [/三睦|三圭|三屿|三起|三叶/g, '三峡'],
  [/吕阳|雪阳|糙阳|足阳/g, '中阳'],
  [/豆阳/g, '贵阳'],
  [/齐重/g, '齐鲁'],
  [/大注/g, '大连'],
  [/东于|东劳/g, '东亚'],
  [/东蔓/g, '东莞'],
  [/丙京|丙真|育京/g, '南京'],
  [/桂杯|桂酌/g, '桂林'],
  [/荒山|(?:赣|黄)山(?=农商)/g, '萧山'],
  [/央了/g, '中原'],
  [/搬门/g, '厦门'],
  [/国乐/g, '国际'],
  [/华闵/g, '华兴'],
  [/照殷/g, '日照'],
  [/江天/g, '江西'],
  [/过海|再海/g, '南海'],
  [/江商/g, '江南'],
  [/后原/g, '中原'],
  [/杭类/g, '杭州'],
  [/祥有/g, '农商'],
  [/农诊|农彦|农奇|农有|农少/g, '农商'],
  [/家有行/g, '农商行'],
  [/农商条/g, '农商银行'],
  [/农商海$/g, '农商银行'],
  [/日照行/g, '日照银行'],
  [/少行/g, '行'],
  [/淄行|当行|雪行|搬行|染行|衍行|狠行|恨行|必行|用行|殷行|梁行|海行|红行|滋行|溪行|混行|老行|漫行|泥行|按行|毛行/g, '银行'],
];

// 比较银行名时忽略“银行/农商/农村/有”等结构性字，避免 OCR 把后缀认错就完全匹配不上
const STRUCTURAL_RE = /[银行农商村有市城业]/g;

function normalizeTenor(text: string): string {
  const match = text.match(TENOR_RE);
  if (match) {
    const months = parseInt(match[1], 10);
    return months === 12 ? '1Y' : `${months}${match[2].toUpperCase()}`;
  }
  for (const [pattern, tenor] of CN_TENORS) {
    if (pattern.test(text)) return tenor;
  }
  return '';
}

function pad(value: string): string {
  return value.padStart(2, '0');
}

function weekdayFromDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : WEEKDAYS[parsed.getDay()];
}

function centerOf(word: OcrWord): number {
  return word.left + word.width / 2;
}

function centerY(word: OcrWord): number {
  return word.top + word.height / 2;
}

function parseHeaderWords(words: OcrWord[]): HeaderGroup[] {
  const groups: HeaderGroup[] = [];
  const seen = new Set<string>();

  for (const word of words) {
    const dateMatch = word.text.match(DATE_RE);
    if (!dateMatch) continue;

    const date = `${dateMatch[1]}-${pad(dateMatch[2])}-${pad(dateMatch[3])}`;
    const lineY = centerY(word);
    const lineWords = words
      .filter(other => Math.abs(centerY(other) - lineY) <= 14)
      .sort((a, b) => a.left - b.left);

    // 期限紧挨在日期左边，星期紧挨在日期右边
    let tenor = '';
    let weekday = '';
    for (const other of lineWords) {
      if (other.left + other.width > word.left + 8) continue;
      const gap = word.left - (other.left + other.width);
      if (gap <= 90 && normalizeTenor(other.text)) tenor = normalizeTenor(other.text);
    }
    for (const other of lineWords) {
      if (other.left < word.left + word.width) continue;
      if (other.left - (word.left + word.width) > 90) continue;
      const weekdayMatch = other.text.match(/周[一二三四五六日]/);
      if (weekdayMatch) {
        weekday = weekdayMatch[0];
        break;
      }
    }
    if (!tenor) {
      const beforeDate = lineWords
        .filter(other => other.left + other.width <= word.left + 8)
        .map(other => other.text)
        .join(' ');
      tenor = normalizeTenor(beforeDate);
    }
    if (!tenor || seen.has(tenor)) continue;

    seen.add(tenor);
    groups.push({
      tenor,
      date,
      weekday: weekday || weekdayFromDate(date),
      x: centerOf(word),
      low: -Infinity,
      high: Infinity,
    });
  }

  groups.sort((a, b) => a.x - b.x);
  for (let i = 1; i < groups.length; i++) {
    const boundary = (groups[i - 1].x + groups[i].x) / 2;
    groups[i - 1].high = boundary;
    groups[i].low = boundary;
  }
  return groups;
}

function groupRows(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: OcrWord[][] = [];

  for (const word of sorted) {
    const row = rows[rows.length - 1];
    if (row) {
      const rowTop = Math.min(...row.map(item => item.top));
      if (Math.abs(word.top - rowTop) <= 12) {
        row.push(word);
        continue;
      }
    }
    rows.push([word]);
  }

  return rows;
}

function numericCandidate(text: string): string | null {
  const cleaned = text.replace(/[^\d.]/g, '');
  return /^\d{1,2}\.\d{1,4}$/.test(cleaned) || /^\d{3,5}$/.test(cleaned) ? cleaned : null;
}

function formatRate(value: number): string {
  let text = value.toFixed(4).replace(/0+$/, '');
  if (text.endsWith('.')) text += '00';
  else if ((text.split('.')[1] || '').length < 2) text += '0';
  return text;
}

// 看板收益率都以 0.5bp 为步长（1.405 / 1.415 / 1.435 …）。OCR 偶尔认错末位
// （1.44 → 1447）或把涨跌标注粘到小数末尾（1.4351），此时去掉最后一位小数正好回到网格上
function onHalfBpGrid(value: number): boolean {
  const scaled = value * 200;
  return Math.abs(scaled - Math.round(scaled)) < 1e-4;
}

function trimGridNoise(value: number): number {
  if (onHalfBpGrid(value)) return value;
  const [integer, fraction = ''] = value.toFixed(6).replace(/0+$/, '').split('.');
  if (fraction.length <= 2) return value;
  const trimmed = parseFloat(`${integer}.${fraction.slice(0, -1)}`);
  return onHalfBpGrid(trimmed) ? trimmed : value;
}

function normalizeYield(raw: string): string | null {
  const cleaned = raw.replace(/[^\d.]/g, '');
  if (!cleaned) return null;

  let value: number;
  if (cleaned.includes('.')) {
    const [, decimals = ''] = cleaned.split('.');
    if (decimals.length > 4) return null;
    value = parseFloat(cleaned);
  } else if (cleaned.length === 1) {
    value = parseFloat(cleaned);
  } else if (cleaned.length === 3) {
    value = parseInt(cleaned, 10) / 100;
  } else if (cleaned.length === 4) {
    value = parseInt(cleaned, 10) / 1000;
  } else if (cleaned.length === 5) {
    value = parseInt(cleaned, 10) / 10000;
  } else {
    return null;
  }

  if (!Number.isFinite(value)) return null;
  value = trimGridNoise(value);
  if (value < 0.1 || value > 10) return null;
  return formatRate(value);
}

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
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

function cleanRemarks(raw: string): string {
  const text = raw.replace(/\s+/g, '');
  const notes: string[] = [];

  // “银”常被 OCR 认成“良/艮”
  if (/非(?:银|良|艮)|限非/.test(text)) notes.push('限非银');
  const volume = text.match(/(\d+(?:\.\d+)?)[万亿]/);
  if (volume) notes.push(`募集${volume[1]}${text.includes('亿') ? '亿' : '万'}`);
  const change = text.match(/(\d+(?:\.\d+)?)\+/);
  if (change) notes.push(`${change[1]}+`);

  return notes.join('；');
}

function matchBank(raw: string): string {
  if (!raw) return '';
  let normalized = raw;
  for (const [pattern, replacement] of NAME_FIXES) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized
    .replace(/^(和|了|已|人)+/, '')
    .replace(/(和|了|已|限非银|限非)+$/, '');

  // 只剩“银行/农商”这类结构字时无法判断是哪家银行，宁可丢弃也不要匹配成错误银行
  if (normalized.replace(STRUCTURAL_RE, '').length === 0) return '';

  let bestBank = '';
  let bestScore = -1;
  for (const bank of BANK_CANDIDATES) {
    const coreScore = similarity(normalized.replace(STRUCTURAL_RE, ''), bank.replace(STRUCTURAL_RE, ''));
    const fullScore = similarity(normalized, bank);
    const prefixScore = similarity(normalized, bank.slice(0, normalized.length));
    // 取三种口径的最高分：单字之差的 OCR 错字不应被“去结构字”后的低分拖累；
    // 再用全名/前缀分做小数位加权，避免去结构字后同分时选错银行
    const score = Math.max(coreScore, fullScore, prefixScore) + fullScore * 0.001 + prefixScore * 0.002;
    if (score > bestScore) {
      bestScore = score;
      bestBank = bank;
    }
  }

  return bestScore >= 0.62 ? bestBank : normalized;
}

interface SectionStyle {
  rating: string;
  category: string;
}

// 左侧分组标签 → 评级/看板分类
function sectionStyle(text: string): SectionStyle | null {
  if (!text) return null;
  if (/AA\+/.test(text)) return { rating: 'AA+', category: 'AA+' };
  if (/AA-/.test(text)) return { rating: 'AA-', category: 'AA-' };
  if (/国有|股份制|国股|大行/.test(text)) return { rating: 'AAA', category: 'BIG' };
  if (/AAA/i.test(text)) return { rating: 'AAA', category: 'AAA' };
  return null;
}

function buildQuote(row: OcrWord[], group: HeaderGroup, style: SectionStyle | null): BoardQuote | null {
  const sorted = [...row].sort((a, b) => a.left - b.left);
  const minLeft = Number.isFinite(group.low) ? group.low : 0;

  const yieldWord = sorted.find(word => {
    if (word.left < minLeft + 50) return false;
    return numericCandidate(word.text) !== null;
  });
  if (!yieldWord) return null;

  const yieldValue = normalizeYield(yieldWord.text);
  if (!yieldValue) return null;

  const bankWords = sorted.filter(word =>
    word.left < yieldWord.left - 42 && /[一-龥]/.test(word.text)
  );
  const rawBankName = bankWords
    .map(word => word.text)
    .join('')
    .replace(/[^一-龥]/g, '')
    .trim();
  if (!rawBankName) return null;

  const bankName = matchBank(rawBankName);
  if (!bankName || bankName.length < 2) return null;

  const remarksWords = sorted.filter(word => {
    if (word.left <= yieldWord.left + Math.max(yieldWord.width, 8) + 4) return false;
    return /[一-龥\d+]/.test(word.text);
  });
  const remarks = cleanRemarks(remarksWords.map(word => word.text).join(''));

  const rating = style?.rating || 'AAA';
  return {
    bankName,
    rating,
    category: style?.category || getCategory(bankName, rating),
    tenor: group.tenor,
    yieldRate: yieldValue,
    volume: '',
    weekday: '',
    remarks,
    maturityDate: group.date,
    maturityWeekday: group.weekday,
    rawBankName,
  };
}

export function parseBoard(result: BoardOcrResult | null | undefined): BoardQuote[] {
  if (!result?.board) return [];

  const groups = parseHeaderWords(result.headerWords || []);
  if (groups.length === 0) return [];

  const bodyWords = result.bodyWords || [];
  const quotes: BoardQuote[] = [];
  const seen = new Set<string>();

  // 左侧评级分组（国有/股份制、AAA、AA+）决定每条报价归到哪一列
  const sections = (result.sections || []).flatMap(section => {
    const style = sectionStyle(section.text);
    return style ? [{ top: section.top, bottom: section.bottom, style }] : [];
  });

  for (const group of groups) {
    const columnWords = bodyWords.filter(word => {
      const x = centerOf(word);
      return x >= group.low && x < group.high;
    });

    for (const row of groupRows(columnWords)) {
      const rowY = row.reduce((sum, word) => sum + centerY(word), 0) / row.length;
      const section = sections.find(item => rowY >= item.top && rowY < item.bottom);
      const quote = buildQuote(row, group, section?.style || null);
      if (!quote) continue;

      const key = `${quote.tenor}|${quote.bankName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      quotes.push(quote);
    }
  }

  return quotes;
}
