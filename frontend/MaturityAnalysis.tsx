import React, { useState, useEffect } from 'react';
import { DataChart } from './components/DataChart';
import { DataPanel } from './DataPanel';
import { fetchMaturityDates, fetchMaturityByDate, fetchMaturityMatrix } from './services/api';

interface MaturityItem {
  bank_name: string;
  tenor: string;
  yield_rate: string;
  volume: string;
}

interface BankStat {
  bank_name: string;
  count: number;
}

interface MaturityAnalysisProps {
  sectionId?: string;
  sectionName?: string;
}

export const MaturityAnalysis: React.FC<MaturityAnalysisProps> = ({ sectionId, sectionName }) => {
  const [activeTab, setActiveTab] = useState<'daily_analysis' | 'daily_data' | 'matrix'>('daily_analysis');

  // Shared daily state
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [dailyData, setDailyData] = useState<MaturityItem[]>([]);
  const [dailyStats, setDailyStats] = useState<BankStat[]>([]);

  // Matrix state
  const [matrixStartDate, setMatrixStartDate] = useState<string>('');
  const [matrixEndDate, setMatrixEndDate] = useState<string>('');
  const [matrixResult, setMatrixResult] = useState<any>(null);

  const [loading, setLoading] = useState(false);

  // 加载到期日期列表
  useEffect(() => {
    (async () => {
      try {
        const dates = await fetchMaturityDates();
        const dateList = dates.map((d: any) => d.date);
        setAvailableDates(dateList);
        if (dateList.length > 0 && !selectedDate) {
          setSelectedDate(dateList[0]);
        }
      } catch (e) {
        console.error('加载到期日期列表失败:', e);
      }
    })();
  }, []);

  // 选择日期后加载到期数据
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    (async () => {
      try {
        const data = await fetchMaturityByDate(selectedDate);
        setDailyData(data);
        const statsMap: Record<string, { count: number }> = {};
        data.forEach((item: MaturityItem) => {
          if (!statsMap[item.bank_name]) {
            statsMap[item.bank_name] = { count: 0 };
          }
          statsMap[item.bank_name].count += 1;
        });
        setDailyStats(
          Object.entries(statsMap)
            .map(([bank_name, s]) => ({ bank_name, ...s }))
            .sort((a, b) => b.count - a.count)
        );
      } catch (e) {
        console.error('加载到期数据失败:', e);
        setDailyData([]);
        setDailyStats([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDate]);

  // 矩阵查询
  const handleLoadMatrix = async () => {
    if (!matrixStartDate || !matrixEndDate) return;
    setLoading(true);
    try {
      const data = await fetchMaturityMatrix(matrixStartDate, matrixEndDate);
      setMatrixResult(data);
    } catch (e) {
      console.error('加载到期矩阵数据失败:', e);
      setMatrixResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      {/* Tab 切换 */}
      <div className="flex border-b border-slate-200">
        {([
          { key: 'daily_analysis', label: '每日到期分析' },
          { key: 'daily_data', label: '每日到期数据' },
          { key: 'matrix', label: '到期矩阵' },
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

        {/* ========== 每日到期分析（汇总卡片 + 图表 + 明细表） ========== */}
        {!loading && activeTab === 'daily_analysis' && (
          <div className="flex gap-6">
            <aside className="w-48 flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-700 mb-3">选择日期</h3>
              <div className="space-y-1 max-h-[500px] overflow-y-auto">
                {availableDates.map(date => (
                  <button
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                      selectedDate === date
                        ? 'bg-indigo-100 text-indigo-700 font-bold'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {date}
                  </button>
                ))}
              </div>
            </aside>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-slate-800 mb-4">
                {selectedDate || '选择日期'} 到期分析
              </h2>
              {dailyStats.length === 0 ? (
                <div className="text-center py-8 text-slate-400">暂无数据</div>
              ) : (
                <>
                  {/* 汇总卡片 */}
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-indigo-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1">到期笔数</div>
                      <div className="text-2xl font-black text-indigo-700">
                        {dailyStats.reduce((s, item) => s + item.count, 0)}
                      </div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1">涉及银行</div>
                      <div className="text-2xl font-black text-emerald-700">{dailyStats.length}</div>
                    </div>
                  </div>

                  {/* 柱状图 */}
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-700 mb-3">各银行到期笔数对比</h3>
                    <div className="h-80">
                      <DataChart
                        data={dailyStats.map(s => ({ name: s.bank_name, value: s.count, count: s.count }))}
                        chartType="bar"
                        showTooltip={true}
                      />
                    </div>
                  </div>

                  {/* 到期明细表 */}
                  <h3 className="text-sm font-bold text-slate-700 mb-3">到期明细</h3>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left py-2 px-3 font-bold text-slate-700">银行名称</th>
                          <th className="text-left py-2 px-3 font-bold text-slate-700">期限</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">收益率</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">发行量</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyData.map((item, idx) => (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-3 font-bold text-slate-800">{item.bank_name}</td>
                            <td className="py-2 px-3 text-slate-600">{item.tenor}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{item.yield_rate || '-'}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{item.volume || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ========== 每日到期数据（数据上传） ========== */}
        {!loading && activeTab === 'daily_data' && (
          <div>
            {sectionId ? (
              <DataPanel sectionId={sectionId} sectionName={sectionName || ''} onRefresh={() => {}} />
            ) : (
              <div className="text-center py-8 text-slate-400">暂无板块信息</div>
            )}
          </div>
        )}

        {/* ========== 到期矩阵 ========== */}
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
              <MatrixTable
                dates={matrixResult.dates || []}
                banks={matrixResult.banks || []}
                tenors={matrixResult.tenors || []}
                rawData={matrixResult.data || []}
              />
            ) : (
              <div className="text-center py-12 text-slate-400">请选择日期范围后查询</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ===== 到期矩阵表（纯比例布局） =====

const colorScale = (value: number, maxValue: number) => {
  if (value === 0 || maxValue === 0) return 'bg-slate-50';
  const intensity = value / maxValue;
  if (intensity > 0.7) return 'bg-red-600';
  if (intensity > 0.5) return 'bg-red-400';
  if (intensity > 0.3) return 'bg-orange-300';
  if (intensity > 0.15) return 'bg-yellow-200';
  return 'bg-green-200';
};

const MatrixTable: React.FC<{
  dates: string[];
  banks: string[];
  tenors: string[];
  rawData: any[];
}> = ({ dates, banks, tenors, rawData }) => {
  const [filterTenor, setFilterTenor] = useState<string>('');

  const getCount = (bank: string, date: string, tenor?: string) => {
    const items = rawData.filter(
      (d: any) => d.bank_name === bank && d.issue_date === date && (!tenor || d.tenor === tenor)
    );
    return items.reduce((sum: number, d: any) => sum + (d.count || 0), 0);
  };

  // 计算各银行到期总量 → 决定列宽
  const bankTotals = banks.map(b =>
    dates.reduce((s, d) => s + getCount(b, d, filterTenor || undefined), 0)
  );
  const maxBankTotal = Math.max(1, ...bankTotals);
  const grandTotal = Math.max(1, bankTotals.reduce((s, v) => s + v, 0));

  // 严格比例 flex：列宽 = 该银行总量 / 全场总量
  const bankFlexValues = bankTotals.map(t => Math.max(t, grandTotal * 0.02));

  // 计算各日期到期总量 → 决定行高
  const dateTotals = dates.map(d =>
    banks.reduce((s, b) => s + getCount(b, d, filterTenor || undefined), 0)
  );
  const maxDateTotal = Math.max(1, ...dateTotals);

  // 全场最大值 → 决定颜色深浅
  const maxCount = Math.max(
    1, ...banks.flatMap(b => dates.map(d => getCount(b, d, filterTenor || undefined)))
  );

  return (
    <div className="w-full">
      {/* 期限筛选 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-sm font-bold text-slate-600">期限：</span>
        <button
          onClick={() => setFilterTenor('')}
          className={`px-3 py-1 rounded text-sm font-bold transition-all ${
            !filterTenor ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          总览
        </button>
        {tenors.map(t => (
          <button
            key={t}
            onClick={() => setFilterTenor(t)}
            className={`px-3 py-1 rounded text-sm font-bold transition-all ${
              filterTenor === t ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* 矩阵表 — 严格比例布局 */}
      <div className="w-full border border-slate-200 rounded-lg overflow-hidden">
        {/* 表头 */}
        <div className="flex bg-slate-800 text-white">
          <div className="w-[90px] shrink-0 py-3 px-2 text-left font-bold text-xs leading-tight tracking-wide">
            日期
          </div>
          {banks.map((b, i) => (
            <div
              key={b}
              style={{ flex: `${bankFlexValues[i]} 1 0` }}
              className="py-3 px-1 text-center font-bold text-xs leading-tight border-l border-slate-700 truncate"
              title={b}
            >
              {b}
            </div>
          ))}
          <div className="w-[65px] shrink-0 py-3 px-1 text-center font-bold text-xs border-l border-slate-700 bg-slate-700">
            合计
          </div>
        </div>

        {/* 数据行 */}
        {dates.map((date, dateIdx) => {
          const rowTotal = banks.reduce((s, b) => s + getCount(b, date, filterTenor || undefined), 0);
          const rowHeight = Math.floor(38 + (dateTotals[dateIdx] / maxDateTotal) * 36);
          return (
            <div
              key={date}
              className="flex border-b border-slate-200 hover:bg-slate-50/50 transition-colors"
              style={{ minHeight: `${rowHeight}px` }}
            >
              <div className="w-[90px] shrink-0 py-2 px-2 font-bold text-slate-700 text-xs border-r border-slate-200 bg-slate-50/80 flex items-center">
                {date}
              </div>
              {banks.map((b, i) => {
                const cnt = getCount(b, date, filterTenor || undefined);
                const cntPct = maxCount > 0 ? cnt / maxCount : 0;
                const hasData = cnt > 0;
                return (
                  <div
                    key={b}
                    style={{ flex: `${bankFlexValues[i]} 1 0` }}
                    className="relative border-l border-slate-100 flex items-center justify-center"
                  >
                    {hasData && (
                      <div
                        className={`${colorScale(cnt, maxCount)} rounded-sm flex items-center justify-center font-bold text-white shadow-sm`}
                        style={{
                          width: `${Math.max(40, cntPct * 100)}%`,
                          height: `${Math.max(28, cntPct * 100)}%`,
                          minWidth: '36px',
                          minHeight: '24px',
                        }}
                        title={`${b} ${date}: ${cnt}笔`}
                      >
                        {cntPct > 0.08 ? (
                          <span className="text-[10px] leading-none truncate px-0.5">{cnt}</span>
                        ) : (
                          <span className="text-[9px] leading-none">{cnt}</span>
                        )}
                      </div>
                    )}
                    {!hasData && (
                      <span className="text-[10px] text-slate-300">-</span>
                    )}
                  </div>
                );
              })}
              <div className="w-[65px] shrink-0 py-2 px-1 text-center font-bold text-slate-800 border-l border-slate-200 bg-slate-50 flex items-center justify-center text-xs">
                {rowTotal > 0 ? rowTotal : '-'}
              </div>
            </div>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="flex items-center gap-3 mt-3 text-xs text-slate-500 flex-wrap">
        <span>图例：</span>
        <span className="inline-block w-4 h-4 bg-slate-200 rounded-sm" /> 无
        <span className="inline-block w-4 h-4 bg-green-200 rounded-sm" /> 少
        <span className="inline-block w-4 h-4 bg-yellow-200 rounded-sm" /> 中低
        <span className="inline-block w-4 h-4 bg-orange-300 rounded-sm" /> 中
        <span className="inline-block w-4 h-4 bg-red-400 rounded-sm" /> 多
        <span className="inline-block w-4 h-4 bg-red-600 rounded-sm" /> 最多
        <span className="ml-2 text-slate-400">|</span>
        <span className="text-slate-400">方块面积 ∝ 到期量</span>
      </div>
    </div>
  );
};
