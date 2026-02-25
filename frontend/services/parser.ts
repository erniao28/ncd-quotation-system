// 简单的报价解析器 - 不需要 AI API

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

const RATING_KEYWORDS = {
  'AAA': ['AAA', 'aaa', 'ＡＡＡ'],
  'AA+': ['AA+', 'aa+', 'ＡＡ＋', 'AAplus', 'AA-'],
  'AA': ['AA', 'aa', 'ＡＡ'],
  'AA-': ['AA-', 'aa-']
};

const TENOR_KEYWORDS = {
  '1M': ['1M', '1个月', '一个月'],
  '3M': ['3M', '3个月', '三个月'],
  '6M': ['6M', '6个月', '六个月'],
  '9M': ['9M', '9个月', '九个月'],
  '1Y': ['1Y', '1年', '一年', '12M']
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

function findBank(text: string): string | null {
  // 按银行名长度排序（长匹配优先）
  const sortedBanks = [...BANKS].sort((a, b) => b.length - a.length);

  for (const bank of sortedBanks) {
    if (text.includes(bank)) {
      return bank;
    }
  }
  return null;
}

function findRating(text: string): string {
  for (const [rating, keywords] of Object.entries(RATING_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return rating;
      }
    }
  }
  return 'AAA';
}

function findTenor(text: string): string {
  for (const [tenor, keywords] of Object.entries(TENOR_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
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
  // 匹配利率：1.62%、1.62%、162% 等
  const ratePatterns = [
    /(\d+\.?\d*)%/,
    /(\d+\.?\d*)\s*%/,
    /(\d+(\.\d+)?)%/,
  ];

  for (const pattern of ratePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return '';
}

function findVolume(text: string): string {
  // 匹配量：40e、20亿、50万等
  const volumePatterns = [
    /(\d+)\s*[eE]/,
    /(\d+)\s*[亿萬]/,
    /(\d+)\s*[万萬]/,
  ];

  for (const pattern of volumePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1] + (text.includes('亿') || text.includes('萬') ? '亿' : 'e');
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

  const bankName = findBank(text);
  if (!bankName) return null;

  const rating = findRating(text);
  const tenor = findTenor(text);
  const yieldRate = findYieldRate(text);
  const volume = findVolume(text);
  const weekday = findWeekday(text) || defaultWeekday;
  const category = getCategory(bankName);

  if (!tenor || !yieldRate) return null;

  return {
    bankName,
    rating,
    category,
    tenor,
    yieldRate,
    volume,
    weekday
  };
}

export function parseQuotations(text: string, defaultWeekday: string = '周一') {
  // 按行分割
  const lines = text.split(/[\n,，;；]+/).filter(line => line.trim());

  const results = [];
  for (const line of lines) {
    const parsed = parseQuotation(line.trim(), defaultWeekday);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

export function parseMaturityDates(text: string): { tenor: string; date: string; weekday: string }[] {
  // 匹配格式：1M 到期日 2025/10/16 周四
  const pattern = /(\d+[MY])[^0-9]*(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,2})[^周]*?(周[一二三四五六日])?/g;

  const results = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    let tenor = match[1].toUpperCase();
    if (tenor === '12M') tenor = '1Y';

    results.push({
      tenor,
      date: match[2],
      weekday: match[3] || ''
    });
  }

  return results;
}
