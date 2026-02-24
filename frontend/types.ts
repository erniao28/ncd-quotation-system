
export enum Rating {
  AAA = 'AAA',
  AAplus = 'AA+',
  AA = 'AA',
  AAbelow = 'AA及以下'
}

export interface Quotation {
  id: string;
  bankName: string;
  rating: string;
  category: 'BIG' | 'AAA' | 'AAplus' | 'AA_BELOW';
  weekday: string; // 起息日
  tenor: string;
  yieldRate: string; // 包含 ↑ 符号
  volume: string; // 募集量，如 40e
  remarks: string;
  maturityDate: string;
  maturityWeekday: string;
}

export interface MaturityInfo {
  tenor: string;
  date: string;
  weekday: string;
}

export interface GroupedQuotation {
  tenor: string;
  maturityDate: string;
  maturityWeekday: string;
  items: Quotation[];
}
