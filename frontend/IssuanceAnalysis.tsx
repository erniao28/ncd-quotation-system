import React, { useState, useEffect, useMemo } from 'react';
import { DataChart } from './components/DataChart';
import { TreemapChart, TreemapBank } from './components/TreemapChart';
import { DataPanel } from './DataPanel';
import {
  fetchIssuanceDates,
  fetchIssuanceByDate,
  fetchIssuanceBankStats,
  fetchIssuanceDailySummary,
  fetchIssuanceBankCompare,
  addIssuanceData,
} from './services/api';

interface IssuanceData {
  bank_name: string;
  issue_name: string;
  volume: string;
  tenor: string;
  ref_yield: string;
}

interface BankStat {
  bank_name: string;
  count: number;
  total_volume: number;
}

interface DailySummaryRow {
  date: string;
  total_volume: number;
  total_count: number;
  bank_count: number;
}

interface IssuanceAnalysisProps {
  sectionId?: string;
  sectionName?: string;
}

const TENORS = ['1M', '3M', '6M', '9M', '1Y'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const nearestDateIn = (dates: string[], target: string) => {
  let best = dates[0];
  let bestDiff = Infinity;
  for (const d of dates) {
    const diff = Math.abs(new Date(d + 'T00:00:00').getTime() - new Date(target + 'T00:00:00').getTime());
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return best;
};

// 后端 tenor 是「1年/6月」这类中文写法
function normalizeTenor(raw: string): string {
  const text = (raw || '').trim();
  const upper = text.toUpperCase().replace(/\s/g, '');
  if (TENORS.includes(upper)) return upper;
  if (/^12M$/.test(upper) || /1年|十二个?月|12个?月/.test(text)) return '1Y';
  if (/9个?月/.test(text)) return '9M';
  if (/6个?月|半年/.test(text)) return '6M';
  if (/3个?月|一季度/.test(text)) return '3M';
  if (/1个?月|一个月/.test(text)) return '1M';
  return text;
}

function parseVolume(vol: string | number | null | undefined): number {
  if (typeof vol === 'number') return Number.isFinite(vol) ? vol : 0;
  const match = String(vol ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

// 发行量数据的银行名可能带年份前缀，如「26烟台银行」
const displayBank = (name: string) => (name || '').replace(/^\d+/, '');

export const IssuanceAnalysis: React.FC<IssuanceAnalysisProps> = ({ sectionId, sectionName }) => {
  const [activeTab, setActiveTab] = useState<'daily' | 'range' | 'matrix' | 'daily_data'>('daily');

  // 每日发行
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [dailyData, setDailyData] = useState<IssuanceData[]>([]);
  const [dailyBankFilter, setDailyBankFilter] = useState('');
  // 日历当前显示的月份
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  // 区间汇总
  const [rangeStart, setRangeStart] = useState<string>('');
  const [rangeEnd, setRangeEnd] = useState<string>('');
  const [rangeBank, setRangeBank] = useState('');
  const [rangeSummary, setRangeSummary] = useState<DailySummaryRow[]>([]);
  const [rangeBanks, setRangeBanks] = useState<BankStat[]>([]);

  // 矩阵图
  const [matrixStartDate, setMatrixStartDate] = useState<string>('');
  const [matrixEndDate, setMatrixEndDate] = useState<string>('');
  const [matrixResult, setMatrixResult] = useState<any>(null);

  const [loading, setLoading] = useState(false);

  // 发行量录入表单
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryDate, setEntryDate] = useState('');
  const [entryBank, setEntryBank] = useState('');
  const [entryProduct, setEntryProduct] = useState('');
  const [entryVolume, setEntryVolume] = useState('');
  const [entryTenor, setEntryTenor] = useState('');
  const [entryYield, setEntryYield] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryMsg, setEntryMsg] = useState('');

  const todayStr = toISO(new Date());

  const handleAddIssuanceRecord = async () => {
    if (!entryDate || !entryBank) {
      setEntryMsg('请至少填写日期和银行名称');
      return;
    }
    setEntrySaving(true);
    setEntryMsg('');
    try {
      await addIssuanceData([{
        bank_name: entryBank.trim(),
        issue_name: entryProduct.trim(),
        volume: entryVolume.trim(),
        tenor: entryTenor.trim(),
        ref_yield: entryYield.trim(),
        issue_date: entryDate
      }]);
      setEntryMsg('录入成功！');
      setEntryBank('');
      setEntryProduct('');
      setEntryVolume('');
      setEntryTenor('');
      setEntryYield('');
      const dates = await fetchIssuanceDates();
      setAvailableDates(dates.map((d: any) => d.date));
      if (entryDate) setSelectedDate(entryDate);
    } catch (e) {
      console.error('录入失败:', e);
      setEntryMsg('录入失败，请重试');
    } finally {
      setEntrySaving(false);
    }
  };

  // 批量录入：从剪贴板/文本解析
  const handleBatchImport = async () => {
    const text = prompt('粘贴发行量数据（每行一条，格式：银行名称,发行量,期限,收益率,产品名称\n日期在录入前统一设置）');
    if (!text) return;
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return;

    const date = entryDate || new Date().toISOString().slice(0, 10);
    const records = lines.map(line => {
      const parts = line.split(/[,，\t]/).map(s => s.trim());
      return {
        bank_name: parts[0] || '',
        issue_name: parts[4] || '',
        volume: parts[1] || '',
        tenor: parts[2] || '',
        ref_yield: parts[3] || '',
        issue_date: date
      };
    }).filter(r => r.bank_name);

    if (records.length === 0) {
      setEntryMsg('未识别到有效数据');
      return;
    }

    setEntrySaving(true);
    setEntryMsg('');
    try {
      const result = await addIssuanceData(records);
      setEntryMsg(`成功录入 ${result.count} 条数据！`);
      const dates = await fetchIssuanceDates();
      setAvailableDates(dates.map((d: any) => d.date));
      if (date) setSelectedDate(date);
    } catch (e) {
      console.error('批量导入失败:', e);
      setEntryMsg('批量导入失败');
    } finally {
      setEntrySaving(false);
    }
  };

  // 加载可用日期，默认选中最新一天；区间默认最近 30 天
  useEffect(() => {
    (async () => {
      try {
        const dates = await fetchIssuanceDates();
        const list: string[] = dates.map((d: any) => d.date);
        setAvailableDates(list);
        if (list.length > 0) {
          const latest = list[0];
          setSelectedDate(prev => prev || latest);
          const d = new Date(latest + 'T00:00:00');
          setViewMonth(prev => (prev.year === d.getFullYear() && prev.month === d.getMonth()
            ? prev
            : { year: d.getFullYear(), month: d.getMonth() }));
          setRangeEnd(prev => prev || latest);
          setRangeStart(prev => prev || addDays(latest, -29));
        }
      } catch (e) {
        console.error('加载日期列表失败:', e);
      }
    })();
  }, []);

  // 选择日期后加载发行量明细（每日发行/每日数据共享）
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    (async () => {
      try {
        const data = await fetchIssuanceByDate(selectedDate);
        setDailyData(data);
      } catch (e) {
        console.error('加载发行量数据失败:', e);
        setDailyData([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDate]);

  // ===== 每日发行聚合 =====
  const dailyBanks = useMemo(() => {
    const map = new Map<string, BankStat>();
    for (const item of dailyData) {
      const name = displayBank(item.bank_name);
      const stat = map.get(name) || { bank_name: name, count: 0, total_volume: 0 };
      stat.count += 1;
      stat.total_volume += parseVolume(item.volume);
      map.set(name, stat);
    }
    return [...map.values()].sort((a, b) => b.total_volume - a.total_volume);
  }, [dailyData]);

  const dailyTenorStats = useMemo(() => {
    const map = new Map<string, { tenor: string; amount: number; count: number }>();
    for (const item of dailyData) {
      const tenor = normalizeTenor(item.tenor);
      if (!tenor) continue;
      const row = map.get(tenor) || { tenor, amount: 0, count: 0 };
      row.amount += parseVolume(item.volume);
      row.count += 1;
      map.set(tenor, row);
    }
    return map;
  }, [dailyData]);

  const dailyTotals = useMemo(() => ({
    volume: dailyBanks.reduce((s, b) => s + b.total_volume, 0),
    count: dailyData.length,
    banks: dailyBanks.length,
  }), [dailyBanks, dailyData]);

  const filteredDailyBanks = useMemo(() => {
    const kw = dailyBankFilter.trim();
    return kw ? dailyBanks.filter(b => b.bank_name.includes(kw)) : dailyBanks;
  }, [dailyBanks, dailyBankFilter]);

  const filteredDailyRecords = useMemo(() => {
    const kw = dailyBankFilter.trim();
    return kw ? dailyData.filter(r => displayBank(r.bank_name).includes(kw)) : dailyData;
  }, [dailyData, dailyBankFilter]);

  // ===== 区间汇总 =====
  const loadRange = async (start = rangeStart, end = rangeEnd, bank = rangeBank) => {
    if (!start || !end) return;
    setLoading(true);
    try {
      const [byDate, byBank] = await Promise.all([
        fetchIssuanceDailySummary(start, end, bank || undefined),
        fetchIssuanceBankStats(start, end, bank || undefined),
      ]);
      setRangeSummary(byDate);
      setRangeBanks(byBank);
    } catch (e) {
      console.error('加载区间汇总失败:', e);
      setRangeSummary([]);
      setRangeBanks([]);
    } finally {
      setLoading(false);
    }
  };

  const rangeTotals = useMemo(() => ({
    volume: rangeSummary.reduce((s, r) => s + (r.total_volume || 0), 0),
    count: rangeSummary.reduce((s, r) => s + (r.total_count || 0), 0),
  }), [rangeSummary]);

  const rangeBanksTotal = useMemo(
    () => rangeBanks.reduce((s, b) => s + (b.total_volume || 0), 0),
    [rangeBanks]
  );

  // 点「按银行汇总」里的某一行 = 把该行银行设为筛选条件并重查
  const handleSelectRangeBank = (name: string) => {
    setRangeBank(name);
    loadRange(rangeStart, rangeEnd, name);
  };

  // 矩阵查询
  const handleLoadMatrix = async () => {
    if (!matrixStartDate || !matrixEndDate) return;
    setLoading(true);
    try {
      const compareData = await fetchIssuanceBankCompare(matrixStartDate, matrixEndDate);
      setMatrixResult(compareData);
    } catch (e) {
      console.error('加载矩阵数据失败:', e);
      setMatrixResult(null);
    } finally {
      setLoading(false);
    }
  };

  // ===== 日历 =====
  const dateSet = new Set(availableDates);

  const calendarCells = (() => {
    const first = new Date(viewMonth.year, viewMonth.month, 1);
    const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
    const leading = first.getDay();
    const cells: Array<{ day: number; iso: string } | null> = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, iso: `${viewMonth.year}-${pad2(viewMonth.month + 1)}-${pad2(d)}` });
    }
    return cells;
  })();

  const shiftMonth = (delta: number) => {
    const d = new Date(viewMonth.year, viewMonth.month + delta, 1);
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() });
  };

  const jumpToDate = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedDate(iso);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      {/* Tab 切换 */}
      <div className="flex border-b border-slate-200">
        {([
          { key: 'daily', label: '每日发行' },
          { key: 'range', label: '区间汇总' },
          { key: 'matrix', label: '矩阵图' },
          { key: 'daily_data', label: '每日数据' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-6 py-3 text-sm font-bold transition-all border-b-2 ${
              activeTab === tab.key
                ? 'border-indigo-500 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="p-6">
        {loading && (
          <div className="text-center py-8 text-slate-400">加载中...</div>
        )}

        {/* ========== 每日发行（日历 + 汇总卡片 + 期限/银行对比 + 明细） ========== */}
        {!loading && activeTab === 'daily' && (
          <div className="flex gap-6">
            <aside className="w-72 flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-700 mb-3">选择发行日</h3>

              <div className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => shiftMonth(-1)} className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded" title="上个月">‹</button>
                  <span className="text-sm font-bold text-slate-700">{viewMonth.year} 年 {viewMonth.month + 1} 月</span>
                  <button onClick={() => shiftMonth(1)} className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded" title="下个月">›</button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-400 mb-1">
                  {['日', '一', '二', '三', '四', '五', '六'].map(w => <div key={w}>{w}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendarCells.map((c, i) => {
                    if (!c) return <div key={i} />;
                    const has = dateSet.has(c.iso);
                    const isSel = c.iso === selectedDate;
                    const isToday = c.iso === todayStr;
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedDate(c.iso)}
                        title={has ? '' : '无发行数据'}
                        className={`relative h-8 rounded text-xs transition-all ${
                          isSel ? 'bg-indigo-600 text-white font-bold'
                          : has ? 'text-slate-700 hover:bg-indigo-100'
                          : 'text-slate-400 hover:bg-slate-100'
                        } ${isToday && !isSel ? 'ring-1 ring-indigo-300' : ''}`}
                      >
                        {c.day}
                        {has && !isSel && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-400" />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
                  <button onClick={() => jumpToDate(todayStr)} className="text-xs text-indigo-600 hover:underline">今天</button>
                  {selectedDate && !dateSet.has(selectedDate) && availableDates.length > 0 && (
                    <button onClick={() => jumpToDate(nearestDateIn(availableDates, selectedDate))} className="text-xs text-indigo-600 hover:underline">
                      最近有数据
                    </button>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                发行量数据每工作日 17:35 自动同步。
              </p>
              {availableDates.length === 0 && (
                <p className="text-xs text-amber-600 mt-2">暂无数据，请到「每日数据」上传或录入</p>
              )}
            </aside>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800">{selectedDate || '选择日期'} 同业存单发行</h2>
                <input
                  type="text"
                  value={dailyBankFilter}
                  onChange={e => setDailyBankFilter(e.target.value)}
                  placeholder="检索银行名（模糊）"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {dailyData.length === 0 ? (
                <div className="text-center py-8 text-slate-400">当日暂无发行数据</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <div className="text-xs text-slate-500 mb-1">发行总量 (亿元)</div>
                      <div className="text-2xl font-black text-indigo-700">{dailyTotals.volume.toFixed(1)}</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <div className="text-xs text-slate-500 mb-1">发行只数</div>
                      <div className="text-2xl font-black text-indigo-700">{dailyTotals.count}</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                      <div className="text-xs text-slate-500 mb-1">涉及银行</div>
                      <div className="text-2xl font-black text-indigo-700">{dailyTotals.banks}</div>
                    </div>
                  </div>

                  {/* 按期限汇总 */}
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-700 mb-2">按期限汇总</h3>
                    <div className="grid grid-cols-5 gap-3">
                      {TENORS.map(t => {
                        const v = dailyTenorStats.get(t);
                        return (
                          <div key={t} className="border border-slate-200 rounded-lg px-3 py-2">
                            <div className="text-xs font-bold text-slate-500 mb-1">{t}</div>
                            <div className="text-lg font-black text-slate-800">{v ? v.amount.toFixed(1) : '-'}</div>
                            <div className="text-[11px] text-slate-400">{v ? `${v.count} 只` : '0 只'}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 各银行对比 */}
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-700 mb-3">各银行发行量对比</h3>
                    <div className="h-80">
                      <DataChart
                        data={filteredDailyBanks.map(s => ({ name: s.bank_name, value: s.total_volume, count: s.count }))}
                        chartType="bar"
                        showTooltip={true}
                      />
                    </div>
                  </div>

                  {/* 银行汇总表 */}
                  <h3 className="text-sm font-bold text-slate-700 mb-3">
                    发行明细（按银行汇总）
                    <span className="ml-2 text-xs font-normal text-slate-400">{filteredDailyBanks.length} 家</span>
                  </h3>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg mb-6">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left py-2 px-3 font-bold text-slate-700">银行</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">发行量(亿)</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">只数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDailyBanks.map((b, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-3 text-slate-800">{b.bank_name}</td>
                            <td className="py-2 px-3 text-right font-bold text-slate-800">{b.total_volume.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{b.count}</td>
                          </tr>
                        ))}
                        {filteredDailyBanks.length === 0 && (
                          <tr><td colSpan={3} className="py-6 text-center text-slate-400">无匹配银行</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* 存单明细 */}
                  <h3 className="text-sm font-bold text-slate-700 mb-3">
                    存单明细
                    <span className="ml-2 text-xs font-normal text-slate-400">{filteredDailyRecords.length} 只</span>
                  </h3>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left py-2 px-3 font-bold text-slate-700">银行名称</th>
                          <th className="text-left py-2 px-3 font-bold text-slate-700">产品名称</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">发行量</th>
                          <th className="text-left py-2 px-3 font-bold text-slate-700">期限</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">参考收益率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDailyRecords.map((item, idx) => (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-3 font-bold text-slate-800">{displayBank(item.bank_name)}</td>
                            <td className="py-2 px-3 text-slate-600">{item.issue_name || '-'}</td>
                            <td className="py-2 px-3 text-right font-bold text-slate-800">{item.volume}</td>
                            <td className="py-2 px-3 text-slate-600">{item.tenor}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{item.ref_yield || '-'}</td>
                          </tr>
                        ))}
                        {filteredDailyRecords.length === 0 && (
                          <tr><td colSpan={5} className="py-6 text-center text-slate-400">无匹配存单</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ========== 区间汇总（按日期 / 按银行） ========== */}
        {!loading && activeTab === 'range' && (
          <div>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <span className="text-slate-400">~</span>
              <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <input
                type="text"
                value={rangeBank}
                onChange={e => setRangeBank(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadRange(); }}
                placeholder="检索银行名（回车查询）"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {rangeBank && (
                <button onClick={() => { setRangeBank(''); loadRange(rangeStart, rangeEnd, ''); }}
                  className="px-2 py-2 text-xs text-slate-500 hover:text-slate-800">
                  清除
                </button>
              )}
              <button onClick={() => loadRange()} disabled={!rangeStart || !rangeEnd}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                查询
              </button>
              <span className="text-sm text-slate-500">
                合计量 <b className="text-amber-700">{rangeTotals.volume.toFixed(1)}</b> 亿
                / <b className="text-indigo-700">{rangeTotals.count}</b> 只
              </span>
            </div>

            {rangeSummary.length === 0 ? (
              <div className="text-center py-12 text-slate-400">所选区间无发行数据</div>
            ) : (
              <>
                <h3 className="text-sm font-bold text-slate-700 mb-3">
                  按日期汇总
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {rangeBank ? `银行含「${rangeBank}」` : '全部银行'}
                  </span>
                </h3>
                <div className="h-72 mb-6">
                  <DataChart data={rangeSummary.map(r => ({ name: r.date, value: r.total_volume, count: r.total_count }))} chartType="bar" showTooltip={true} />
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left py-2 px-3 font-bold text-slate-700">发行日</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">发行量(亿)</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">只数</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">银行数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rangeSummary.map((r, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-2 px-3 text-slate-800">{r.date}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-800">{(r.total_volume || 0).toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{r.total_count}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{r.bank_count}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-amber-50 border-t-2 border-amber-200 font-bold">
                        <td className="py-2 px-3 text-slate-800">合计</td>
                        <td className="py-2 px-3 text-right text-amber-700">{rangeTotals.volume.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-indigo-700">{rangeTotals.count}</td>
                        <td className="py-2 px-3 text-right text-slate-500">-</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <h3 className="text-sm font-bold text-slate-700 mt-6 mb-3">
                  按银行汇总
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {rangeBanks.length} 家 · 点任意一行查看该行的按日期分布
                  </span>
                </h3>
                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left py-2 px-3 font-bold text-slate-700">银行</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">发行量(亿)</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">只数</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">占比</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rangeBanks.map((b, i) => (
                        <tr key={i} onClick={() => handleSelectRangeBank(b.bank_name)}
                          className={`border-b border-slate-100 cursor-pointer hover:bg-indigo-50 ${
                            rangeBank && b.bank_name.includes(rangeBank) ? 'bg-indigo-50/60' : ''
                          }`}>
                          <td className="py-2 px-3 text-slate-800">{displayBank(b.bank_name)}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-800">{(b.total_volume || 0).toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{b.count}</td>
                          <td className="py-2 px-3 text-right text-slate-500">
                            {rangeBanksTotal > 0 ? `${(b.total_volume / rangeBanksTotal * 100).toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-amber-50 border-t-2 border-amber-200 font-bold">
                        <td className="py-2 px-3 text-slate-800">合计</td>
                        <td className="py-2 px-3 text-right text-amber-700">{rangeBanksTotal.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-indigo-700">{rangeBanks.reduce((s, b) => s + b.count, 0)}</td>
                        <td className="py-2 px-3 text-right text-slate-500">100.0%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ========== 矩阵图（矩形树图：面积 = 发行量，颜色 = 净发行） ========== */}
        {!loading && activeTab === 'matrix' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="date"
                value={matrixStartDate}
                onChange={e => setMatrixStartDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-slate-400">~</span>
              <input
                type="date"
                value={matrixEndDate}
                onChange={e => setMatrixEndDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleLoadMatrix}
                disabled={!matrixStartDate || !matrixEndDate}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                查询
              </button>
            </div>
            {matrixResult ? (
              <MatrixTreemap
                data={matrixResult.banks || []}
                period={matrixResult.period || null}
              />
            ) : (
              <div className="text-center py-12 text-slate-400">请选择日期范围后查询</div>
            )}
          </div>
        )}

        {/* ========== 每日数据（数据上传 + 数据录入） ========== */}
        {!loading && activeTab === 'daily_data' && (
          <div className="space-y-6">
            {sectionId ? (
              <DataPanel sectionId={sectionId} sectionName={sectionName || ''} onRefresh={() => {}} />
            ) : (
              <div className="text-center py-8 text-slate-400">暂无板块信息</div>
            )}

            {/* 发行量数据录入 */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowEntryForm(!showEntryForm)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-sm font-bold text-slate-700"
              >
                <span>发行量数据录入</span>
                <svg className={`w-4 h-4 transition-transform ${showEntryForm ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showEntryForm && (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">日期 *</label>
                      <input type="date" value={entryDate}
                        onChange={e => setEntryDate(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">银行名称 *</label>
                      <input type="text" value={entryBank} placeholder="例：工商银行"
                        onChange={e => setEntryBank(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">产品名称</label>
                      <input type="text" value={entryProduct} placeholder="例：24国开10"
                        onChange={e => setEntryProduct(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">发行量</label>
                      <input type="text" value={entryVolume} placeholder="例：100亿 或 100"
                        onChange={e => setEntryVolume(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">期限</label>
                      <input type="text" value={entryTenor} placeholder="例：1Y"
                        onChange={e => setEntryTenor(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">参考收益率</label>
                      <input type="text" value={entryYield} placeholder="例：1.85%"
                        onChange={e => setEntryYield(e.target.value)}
                        className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button onClick={handleAddIssuanceRecord} disabled={entrySaving || !entryDate || !entryBank}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {entrySaving ? '保存中...' : '添加'}
                    </button>
                    <button onClick={handleBatchImport} disabled={entrySaving}
                      className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      批量导入
                    </button>
                    <span className={`text-sm ${entryMsg.includes('成功') ? 'text-emerald-600' : 'text-red-500'}`}>
                      {entryMsg}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ===== 矩阵图（矩形树图：面积 = 发行量，颜色 = 净发行 vs 每日到期） =====

// 银行归类
function categorizeBank(rawName: string): string {
  const name = rawName.replace(/^26/, '');

  // 国有大行
  if (/^(中国|工商|农业|建设|交通|邮储|邮政储蓄)/.test(name)) return '国有大行';

  // 股份制银行
  if (/^(兴业|浦发|民生|中信|光大|华夏|浙商|渤海|恒丰|平安|招商|广发)/.test(name)) return '股份制银行';

  // 农商行 / 农合 / 农信
  if (/农商|农村|农合|农联社/.test(name)) return '农商行';

  // 民营银行
  if (/微众|网商|富民|民商|三湘|金城|华通|新网|蓝海/.test(name)) return '民营银行';

  // 外资银行
  if (/恒生|富邦华一|渣打|汇丰/.test(name)) return '外资银行';

  // 政策性银行
  if (/国家开发|进出口|农业发展/.test(name)) return '政策性银行';

  return '城商行';
}

const MatrixTreemap: React.FC<{
  data: Array<{
    bank_name: string;
    total_volume: number;
    maturity_volume: number;
    net_volume: number;
  }>;
  period: { start: string; end: string } | null;
}> = ({ data, period }) => {
  // 按银行类别分组，组内按发行量降序
  const groups = useMemo(() => {
    const map: Record<string, TreemapBank[]> = {};
    for (const bank of data) {
      const category = categorizeBank(bank.bank_name);
      if (!map[category]) map[category] = [];
      map[category].push({
        key: bank.bank_name,
        label: bank.bank_name.replace(/^26/, ''),
        value: bank.total_volume,
        issueVolume: bank.total_volume,
        maturityVolume: bank.maturity_volume || 0,
        netVolume: bank.net_volume || 0
      });
    }
    return Object.entries(map).map(([category, banks]) => ({
      key: category,
      label: `${category} · ${banks.reduce((sum, bank) => sum + bank.value, 0).toFixed(0)}亿`,
      banks
    }));
  }, [data]);

  const totals = useMemo(() => {
    const issue = data.reduce((s, b) => s + b.total_volume, 0);
    const maturity = data.reduce((s, b) => s + (b.maturity_volume || 0), 0);
    return { issue, maturity, net: issue - maturity };
  }, [data]);

  return (
    <div>
      {/* 对比信息 */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className="text-sm text-slate-500">
          共 {data.length} 家银行，分 {groups.length} 个类别
        </span>
        <span className="text-xs text-slate-500">
          {period ? `${period.start} ~ ${period.end} · ` : ''}
          发行 <b className="text-slate-700">{totals.issue.toFixed(1)}</b> 亿
          / 到期 <b className="text-slate-700">{totals.maturity.toFixed(1)}</b> 亿
          / 净发行 <b className={totals.net >= 0 ? 'text-red-600' : 'text-emerald-600'}>
            {totals.net >= 0 ? '+' : ''}{totals.net.toFixed(1)}
          </b> 亿
        </span>
      </div>

      <TreemapChart groups={groups} />
    </div>
  );
};
