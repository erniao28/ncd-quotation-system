// 简单的报价解析器 - 带模糊匹配和错别字纠正

const BANKS = [
  '工商银行', '农业银行', '中国银行', '建设银行', '交通银行', '邮储银行',
  '中信银行', '光大银行', '华夏银行', '广发银行', '平安银行', '招商银行',
  '浦发银行', '兴业银行', '浙商银行', '渤海银行', '恒丰银行',
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
  '重庆农商', '上海农商', '广州农商', '深圳农商', '东莞农商', '顺德农商',
  '天津农商', '武汉农商', '长沙农商行', '江南农商', '南海农商', '珠海农商',
  '佛山农商', '无锡农商', '常熟农商', '张家港农商', '江阴农商', '吴江农商',
  '太仓农商', '昆山农商'
];

// 常见错别字纠正
const TYPO_CORRECTIONS: Record<string, string> = {
  '兴行银行': '兴业银行',
  '兴银行': '兴业银行',
  '信银行': '中信银行',
  '发银行': '广发银行',
  '浦发银行': '浦发银行',
  '浦银行': '浦发银行',
  '招商银行': '招商银行',
  '招行': '招商银行',
  '建行': '建设银行',
  '工行': '工商银行',
  '农行': '农业银行',
  '中行': '中国银行',
  '交行': '交通银行',
  '交通': '交通银行',
  '邮储': '邮储银行',
  '华夏银行': '华夏银行',
  '光大银行': '光大银行',
  '平安银行': '平安银行',
  '恒丰银行': '恒丰银行',
  '浙商银行': '浙商银行',
  '渤海银行': '渤海银行',
  '北京银行': '北京银行',
  '上海银行': '上海银行',
  '江苏银行': '江苏银行',
  '宁波银行': '宁波银行',
  '南京银行': '南京银行',
  '杭州银行': '杭州银行',
};

// 模糊匹配阈值
const FUZZY_THRESHOLD = 0.6;

// 编辑距离算法
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// 计算相似度
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// 纠正错别字
function correctTypo(text: string): string {
  let corrected = text;
  // 优先匹配长的错别字
  const sortedKeys = Object.keys(TYPO_CORRECTIONS).sort((a, b) => b.length - a.length);

  for (const typo of sortedKeys) {
    if (corrected.includes(typo)) {
      corrected = corrected.replace(typo, TYPO_CORRECTIONS[typo]);
    }
  }

  return corrected;
}

// 模糊匹配银行
function findBank(text: string): string | null {
  const corrected = correctTypo(text);

  // 先精确匹配
  for (const bank of BANKS) {
    if (corrected.includes(bank)) {
      return bank;
    }
  }

  // 模糊匹配
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const bank of BANKS) {
    // 提取银行名中的关键字进行匹配
    for (let i = 2; i <= bank.length; i++) {
      const keyword = bank.substring(0, i);
      if (corrected.includes(keyword)) {
        const score = i / bank.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = bank;
        }
      }
    }

    // 也检查银行名是否包含在文本中（反向匹配）
    if (corrected.length >= 3) {
      const score = similarity(corrected, bank);
      if (score >= FUZZY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestMatch = bank;
      }
    }
  }

  return bestScore >= 0.5 ? bestMatch : null;
}

const RATING_KEYWORDS: Record<string, string[]> = {
  'AAA': ['AAA', 'aaa', '3A'],
  'AA+': ['AA+', 'aa+', 'AAplus'],
  'AA': ['AA', 'aa'],
  'AA-': ['AA-', 'aa-'],
  'A+': ['A+', 'a+'],
  'A': ['A', 'a']
};

const TENOR_KEYWORDS: Record<string, string[]> = {
  '1M': ['1M', '1m', '1MONTH', '1month', '1个月', '一个月', '1月', '一 month'],
  '3M': ['3M', '3m', '3MONTH', '3month', '3个月', '三个月', '3月', '三 month'],
  '6M': ['6M', '6m', '6MONTH', '6month', '6个月', '六个月', '6月', '六 month'],
  '9M': ['9M', '9m', '9MONTH', '9month', '9个月', '九个月', '9月', '九 month'],
  '1Y': ['1Y', '1y', '1YEAR', '1year', '1年', '一年', '12M', '12m', '12个月', '十二 month']
};

const WEEKDAY_KEYWORDS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function getCategory(bankName: string): string {
  const bigBanks = ['工商银行', '农业银行', '中国银行', '建设银行', '交通银行', '邮储银行',
    '中信银行', '光大银行', '华夏银行', '广发银行', '平安银行', '招商银行',
    '浦发银行', '兴业银行', '浙商银行', '渤海银行', '恒丰银行'];

  for (const bank of bigBanks) {
    if (bankName.includes(bank)) return 'BIG';
  }
  return 'AAA';
}

function findRating(text: string): string {
  // 按顺序匹配：先匹配更具体的（带 +/- 的），再匹配一般的
  // 这样可以避免 "AA+" 被误匹配为 "AA" 或 "AAA"
  const priorityOrder = ['AA+', 'AA-', 'AAA', 'AA', 'A+', 'A'];

  for (const rating of priorityOrder) {
    const keywords = RATING_KEYWORDS[rating];
    if (!keywords) continue;
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return rating;
      }
    }
  }

  // 模糊匹配
  const textLower = text.toLowerCase();
  for (const [rating, keywords] of Object.entries(RATING_KEYWORDS)) {
    for (const keyword of keywords) {
      const score = similarity(textLower, keyword.toLowerCase());
      if (score >= 0.8) {
        return rating;
      }
    }
  }

  return 'AAA';
}

function findTenor(text: string): string {
  const textLower = text.toLowerCase();
  for (const [tenor, keywords] of Object.entries(TENOR_KEYWORDS)) {
    for (const keyword of keywords) {
      if (textLower.includes(keyword.toLowerCase())) {
        return tenor;
      }
    }
  }
  return '';
}

function findWeekday(text: string): string {
  for (const weekday of WEEKDAY_KEYWORDS) {
    if (text.includes(weekday)) {
      return weekday;
    }
  }
  return '';
}

function findYieldRate(text: string): string {
  // 匹配各种格式的利率
  const patterns = [
    // 带百分号：1.50% / 1.5% / 150%
    /(\d+\.?\d*)\s*[%％]/,
    // 不带百分号，但数字>=100，认为是BP形式，如150表示1.50%
    /(?:税后|税前)?\s*(\d{2,})\s*(?!%)/,
    // 不带百分号，数字在合理范围（如1.5, 1.50, 2.3等），直接返回
    /(\d{1,2}\.?\d*)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let value = parseFloat(match[1]);
      // 如果数值>=100，认为是BP形式（如150表示1.50%），自动除以100
      if (value >= 100) {
        value = value / 100;
      }
      // 格式化收益率：最多 4 位小数，至少显示 2 位小数
      let formatted = value.toFixed(4);
      // 去掉末尾多余的 0，但至少保留 2 位小数
      formatted = formatted.replace(/(\.\d{2,})0+$/, '$1');
      // 确保至少 2 位小数
      if (!formatted.includes('.')) {
        formatted += '.00';
      } else {
        const decimalPart = formatted.split('.')[1];
        if (decimalPart.length < 2) {
          formatted = value.toFixed(2);
        }
      }
      return formatted;
    }
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
      if (text.includes('亿') || text.includes('億')) {
        return match[1] + '亿';
      }
      if (text.includes('万') || text.includes('萬')) {
        return match[1] + '万';
      }
      return match[1] + 'e';
    }
  }
  return '';
}

export function parseQuotation(text: string, defaultWeekday: string = '周一'): {
  bankName: string;
  rating: string;
  category: string;
  tenor: string;
  yieldRate: string;
  volume: string;
  weekday: string;
} | null {

  // 尝试找银行名
  let bankName = findBank(text);

  // 如果找不到匹配的银行，提取文本开头作为自定义银行名
  if (!bankName) {
    // 提取银行名（到评级或期限之前的内容）
    const match = text.match(/^([^\s\d]{2,6})/);
    if (match) {
      bankName = match[1]; // 使用自定义名称
    } else {
      // 取前4个字符作为银行名
      bankName = text.substring(0, Math.min(4, text.length));
    }
  }

  const rating = findRating(text);
  const tenor = findTenor(text);
  const yieldRate = findYieldRate(text);
  const volume = findVolume(text);
  const weekday = findWeekday(text) || defaultWeekday;

  // 如果找不到银行名但有期限和利率，也允许通过（自定义银行）
  const category = getCategory(bankName || '');

  // 不再强制要求期限和收益率必须有值，改为返回空字符串让用户手动编辑
  // if (!tenor || !yieldRate) return null;

  return {
    bankName: bankName || '未知银行',
    rating,
    category,
    tenor,
    yieldRate,
    volume,
    weekday
  };
}

export function parseQuotations(text: string, defaultWeekday: string = '周一') {
  // 按行、逗号、分号分割
  const lines = text.split(/[\n,，;；]+/).filter(line => line.trim());

  // 第一步：先扫描整段文本找到银行名（可能在任意位置）
  let foundBankName = '';
  for (const line of lines) {
    // 先检查整行是否有银行名
    const bankInLine = findBank(line);
    if (bankInLine) {
      foundBankName = bankInLine;
      break;
    }
    // 检查每行的最后一个词
    const words = line.trim().split(/\s+/);
    if (words.length > 0) {
      const lastWord = words[words.length - 1];
      const bank = findBank(lastWord);
      if (bank) {
        foundBankName = bank;
        break;
      }
    }
    // 也检查每行的第一个词
    if (words.length > 0) {
      const firstWord = words[0];
      const bank = findBank(firstWord);
      if (bank) {
        foundBankName = bank;
        break;
      }
    }
  }

  const results = [];
  const bankName = foundBankName; // 整段统一用这个银行名

  for (const line of lines) {
    let trimmed = line.trim();
    if (trimmed.length < 1) continue;

    // 去掉日期和时间（如 2026/02/26, 10:30, 上午, 下午 等）
    trimmed = trimmed.replace(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/g, ''); // 日期
    trimmed = trimmed.replace(/\d{1,2}:\d{2}/g, ''); // 时间
    trimmed = trimmed.replace(/(上午|下午|早上|晚上|中午)/g, ''); // 时段发言
    trimmed = trimmed.trim();
    if (!trimmed) continue;

    // 去掉银行名（无论是开头还是结尾）
    let textToParse = trimmed;
    if (bankName && trimmed.includes(bankName)) {
      textToParse = trimmed.replace(bankName, '').trim();
    } else {
      // 也尝试去掉简称
      const bankShortNames: Record<string, string> = {
        '交通银行': '交通', '工商银行': '工行', '建设银行': '建行',
        '农业银行': '农行', '中国银行': '中行', '招商银行': '招行', '邮储银行': '邮储'
      };
      const shortName = bankShortNames[bankName];
      if (shortName && trimmed.includes(shortName)) {
        textToParse = trimmed.replace(shortName, '').trim();
      }
    }

    // 去掉 "-" 等无意义字符，只保留期限+收益率
    textToParse = textToParse.replace(/^-\s*|\s+-\s*$/g, '').trim();
    // 过滤掉只有期限没有收益率的行（如 "1M -" 或只有 "1M"）
    const pureTenorPattern = /^(1M|3M|6M|9M|1Y|1m|3m|6m|9m|1y)\s*$/i;
    if (pureTenorPattern.test(textToParse)) continue;
    if (!textToParse) continue;

    // 用正则同时匹配期限和收益率
    const tenorYieldPattern = /(1M|3M|6M|9M|1Y|1m|3m|6m|9m|1y)\s*(\d+\.?\d*%?)/gi;
    let match;
    const foundQuotes: any[] = [];

    while ((match = tenorYieldPattern.exec(textToParse)) !== null) {
      let tenor = match[1].toUpperCase();
      if (tenor === '1Y' || tenor === '1YEAR') tenor = '1Y';

      let yieldRate = match[2];
      if (!yieldRate.includes('%')) {
        const num = parseFloat(yieldRate);
        if (num >= 100) {
          yieldRate = parseFloat((num / 100).toFixed(4)).toString();
        } else {
          yieldRate = parseFloat(num.toFixed(4)).toString();
        }
      }

      foundQuotes.push({ tenor, yieldRate });
    }

    // 如果找到期限+收益率，生成报价
    if (foundQuotes.length > 0) {
      for (const q of foundQuotes) {
        results.push({
          bankName: bankName || '',
          rating: 'AAA',
          category: getCategory(bankName || ''),
          tenor: q.tenor,
          yieldRate: q.yieldRate,
          volume: '',
          weekday: defaultWeekday
        });
      }
    } else {
      // 如果没找到，用原来的方式解析整行
      const parsed = parseQuotation(trimmed, defaultWeekday);
      if (parsed) {
        results.push({
          ...parsed,
          bankName: bankName || parsed.bankName,
          category: getCategory(bankName || parsed.bankName)
        });
      }
    }
  }

  return results;
}

// 尝试部分解析
function tryParsePartial(text: string, defaultWeekday: string) {
  const bankName = findBank(text) || extractBankName(text);
  const tenor = findTenor(text);
  const rating = findRating(text);
  const yieldRate = findYieldRate(text);
  const weekday = findWeekday(text) || defaultWeekday;
  const volume = findVolume(text);

  // 至少要有银行名或期限或收益率之一
  if (!bankName && !tenor && !yieldRate) return null;

  return {
    bankName: bankName || '',
    rating: rating || 'AAA',
    category: getCategory(bankName || ''),
    tenor: tenor || '',
    yieldRate: yieldRate || '',
    volume: volume || '',
    weekday
  };
}

// 提取银行名（当模糊匹配失败时）
function extractBankName(text: string): string {
  // 提取开头的文字作为银行名
  const match = text.match(/^([\u4e00-\u9fa5a-zA-Z]{2,6})/);
  return match ? match[1] : '';
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
