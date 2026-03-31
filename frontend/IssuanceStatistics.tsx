import React, { useState, useEffect } from 'react';
import { DataChart } from './components/DataChart';
import { fetchIssuanceDates, fetchIssuanceByDate, fetchMonthlyStats } from './services/api';

interface IssuanceData {
  bank_name: string;
  issue_name: string;
  volume: string;
  tenor: string;
  ref_yield: string;
}

interface IssuanceStats {
  bank_name: string;
  count: number;
  total_volume: number;
}

export const IssuanceStatistics: React.FC = () => {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [issuanceData, setIssuanceData] = useState<IssuanceData[]>([]);
  const [bankStats, setBankStats] = useState<IssuanceStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'daily' | 'monthly'>('daily');
  const [monthFilter, setMonthFilter] = useState<string>('');

  // 加载可用日期
  const loadAvailableDates = async () => {
    try {
      const dates = await fetchIssuanceDates();
      setAvailableDates(dates.map((d: any) => d.date));
      if (dates.length > 0 && !selectedDate) {
        setSelectedDate(dates[0].date);
      }
    } catch (error) {
      console.error('加载日期列表失败:', error);
    }
  };

  useEffect(() => {
    loadAvailableDates();
  }, []);

  // 加载指定日期的发行量数据
  const loadIssuanceData = async (date: string) => {
    setLoading(true);
    try {
      const data = await fetchIssuanceByDate(date);
      setIssuanceData(data);

      // 按银行统计
      const stats: Record<string, { count: number; total_volume: number }> = {};
      data.forEach((item: IssuanceData) => {
        if (!stats[item.bank_name]) {
          stats[item.bank_name] = { count: 0, total_volume: 0 };
        }
        stats[item.bank_name].count += 1;
        const volume = parseFloat(item.volume.replace('亿元', '').replace('亿', '')) || 0;
        stats[item.bank_name].total_volume += volume;
      });

      const bankStatsArray = Object.entries(stats).map(([bank_name, data]) => ({
        bank_name,
        count: data.count,
        total_volume: data.total_volume
      })).sort((a, b) => b.total_volume - a.total_volume);

      setBankStats(bankStatsArray);
    } catch (error) {
      console.error('加载发行量数据失败:', error);
      setIssuanceData([]);
      setBankStats([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDate) {
      loadIssuanceData(selectedDate);
    }
  }, [selectedDate]);

  // 加载月度统计
  const loadMonthlyStats = async () => {
    if (!monthFilter) return;
    setLoading(true);
    try {
      const data = await fetchMonthlyStats(monthFilter);
      setBankStats(data);
    } catch (error) {
      console.error('加载月度统计失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'monthly' && monthFilter) {
      loadMonthlyStats();
    }
  }, [viewMode, monthFilter]);

  // 生成图表数据
  const chartData = bankStats.map(stat => ({
    name: stat.bank_name,
    value: stat.total_volume,
    count: stat.count
  }));

  // 获取当前月份的快捷选项
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航栏 */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black text-slate-800">发行量统计</h1>
            <p className="text-xs text-slate-500 mt-1">查看每日/月度发行量数据</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('daily')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                viewMode === 'daily'
                  ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-300'
                  : 'bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200'
              }`}
            >
              每日统计
            </button>
            <button
              onClick={() => setViewMode('monthly')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                viewMode === 'monthly'
                  ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-300'
                  : 'bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200'
              }`}
            >
              月度统计
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* 左侧日期选择器 */}
        <aside className="w-64 bg-white border-r border-slate-200 p-4 min-h-[calc(100vh-80px)]">
          {viewMode === 'daily' ? (
            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-3">选择日期</h3>
              <div className="space-y-1 max-h-[calc(100vh-150px)] overflow-y-auto">
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
            </div>
          ) : (
            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-3">选择月份</h3>
              <input
                type="month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                onBlur={loadMonthlyStats}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-2">
                选择月份后自动加载
              </p>
            </div>
          )}
        </aside>

        {/* 右侧主内容区 */}
        <main className="flex-1 p-6">
          {/* 统计摘要 */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-bold text-slate-800 mb-4">
              {viewMode === 'daily' ? `${selectedDate || '选择日期'} 发行量统计` : `${monthFilter || '选择月份'} 月度统计`}
            </h2>

            {loading ? (
              <div className="text-center py-8 text-slate-400">
                加载中...
              </div>
            ) : bankStats.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                {viewMode === 'daily' ? '暂无发行量数据' : '暂无月度统计数据'}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-indigo-50 rounded-lg p-4">
                    <div className="text-xs text-slate-500 mb-1">银行数量</div>
                    <div className="text-2xl font-black text-indigo-700">{bankStats.length}</div>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-4">
                    <div className="text-xs text-slate-500 mb-1">发行总笔数</div>
                    <div className="text-2xl font-black text-emerald-700">
                      {bankStats.reduce((sum, s) => sum + s.count, 0)}
                    </div>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-4">
                    <div className="text-xs text-slate-500 mb-1">发行总量 (亿元)</div>
                    <div className="text-2xl font-black text-amber-700">
                      {bankStats.reduce((sum, s) => sum + s.total_volume, 0).toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* 发行量柱状图 */}
                <div className="mb-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-3">各银行发行量对比</h3>
                  <div className="h-80">
                    <DataChart
                      data={chartData}
                      chartType="bar"
                      showTooltip={true}
                    />
                  </div>
                </div>

                {/* 明细表格 */}
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-3">明细数据</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-2 px-3 font-bold text-slate-700">排名</th>
                          <th className="text-left py-2 px-3 font-bold text-slate-700">银行名称</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">发行笔数</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">发行量 (亿元)</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">占比</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bankStats.map((stat, index) => {
                          const totalVolume = bankStats.reduce((sum, s) => sum + s.total_volume, 0);
                          const percentage = totalVolume > 0
                            ? ((stat.total_volume / totalVolume) * 100).toFixed(2)
                            : '0.00';
                          return (
                            <tr key={stat.bank_name} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-2 px-3 text-slate-600">
                                {index === 0 && '🥇'}
                                {index === 1 && '🥈'}
                                {index === 2 && '🥉'}
                                {index > 2 && `#${index + 1}`}
                              </td>
                              <td className="py-2 px-3 font-bold text-slate-800">{stat.bank_name}</td>
                              <td className="py-2 px-3 text-right text-slate-600">{stat.count}</td>
                              <td className="py-2 px-3 text-right font-bold text-slate-800">
                                {stat.total_volume.toFixed(2)}
                              </td>
                              <td className="py-2 px-3 text-right text-slate-600">{percentage}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
