import React, { useState, useEffect } from 'react';
import { DataChart } from './components/DataChart';
import { DataPanel } from './DataPanel';
import { fetchIssuanceDates, fetchIssuanceByDate, fetchIssuanceBankCompare, addIssuanceData } from './services/api';

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

interface IssuanceAnalysisProps {
  sectionId?: string;
  sectionName?: string;
}

export const IssuanceAnalysis: React.FC<IssuanceAnalysisProps> = ({ sectionId, sectionName }) => {
  const [activeTab, setActiveTab] = useState<'daily_analysis' | 'daily_data' | 'matrix'>('daily_analysis');

  // Shared daily state
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [dailyData, setDailyData] = useState<IssuanceData[]>([]);
  const [dailyStats, setDailyStats] = useState<BankStat[]>([]);

  // Matrix state
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
      // 清空表单（保留日期）
      setEntryBank('');
      setEntryProduct('');
      setEntryVolume('');
      setEntryTenor('');
      setEntryYield('');
      // 重新加载日期列表和数据
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

    // 使用当前录入表单中的日期
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

  // 加载可用日期
  useEffect(() => {
    (async () => {
      try {
        const dates = await fetchIssuanceDates();
        const dateList = dates.map((d: any) => d.date);
        setAvailableDates(dateList);
        if (dateList.length > 0 && !selectedDate) {
          setSelectedDate(dateList[0]);
        }
      } catch (e) {
        console.error('加载日期列表失败:', e);
      }
    })();
  }, []);

  // 选择日期后加载发行量数据（两个每日 tab 共享）
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    (async () => {
      try {
        const data = await fetchIssuanceByDate(selectedDate);
        setDailyData(data);
        const statsMap: Record<string, { count: number; total_volume: number }> = {};
        data.forEach((item: IssuanceData) => {
          if (!statsMap[item.bank_name]) {
            statsMap[item.bank_name] = { count: 0, total_volume: 0 };
          }
          statsMap[item.bank_name].count += 1;
          const volume = parseFloat(item.volume.replace('亿元', '').replace('亿', '')) || 0;
          statsMap[item.bank_name].total_volume += volume;
        });
        setDailyStats(
          Object.entries(statsMap)
            .map(([bank_name, s]) => ({ bank_name, ...s }))
            .sort((a, b) => b.total_volume - a.total_volume)
        );
      } catch (e) {
        console.error('加载发行量数据失败:', e);
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
      const compareData = await fetchIssuanceBankCompare(matrixStartDate, matrixEndDate);
      setMatrixResult(compareData);
    } catch (e) {
      console.error('加载矩阵数据失败:', e);
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
          { key: 'daily_analysis', label: '每日数据分析' },
          { key: 'daily_data', label: '每日数据' },
          { key: 'matrix', label: '矩阵图' },
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

        {/* ========== 每日数据分析（汇总卡片 + 图表 + 明细表） ========== */}
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
                {selectedDate || '选择日期'} 发行量分析
              </h2>
              {dailyStats.length === 0 ? (
                <div className="text-center py-8 text-slate-400">暂无数据</div>
              ) : (
                <>
                  {/* 汇总卡片 */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-indigo-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1">银行数量</div>
                      <div className="text-2xl font-black text-indigo-700">{dailyStats.length}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1">发行总笔数</div>
                      <div className="text-2xl font-black text-emerald-700">
                        {dailyStats.reduce((s, item) => s + item.count, 0)}
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1">发行总量 (亿元)</div>
                      <div className="text-2xl font-black text-amber-700">
                        {dailyStats.reduce((s, item) => s + item.total_volume, 0).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* 柱状图 */}
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-700 mb-3">各银行发行量对比</h3>
                    <div className="h-80">
                      <DataChart
                        data={dailyStats.map(s => ({ name: s.bank_name, value: s.total_volume, count: s.count }))}
                        chartType="bar"
                        showTooltip={true}
                      />
                    </div>
                  </div>

                  {/* 发行明细表 */}
                  <h3 className="text-sm font-bold text-slate-700 mb-3">发行明细</h3>
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
                        {dailyData.map((item, idx) => (
                          <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-3 font-bold text-slate-800">{item.bank_name}</td>
                            <td className="py-2 px-3 text-slate-600">{item.issue_name || '-'}</td>
                            <td className="py-2 px-3 text-right font-bold text-slate-800">{item.volume}</td>
                            <td className="py-2 px-3 text-slate-600">{item.tenor}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{item.ref_yield || '-'}</td>
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

        {/* ========== 矩阵图（卡片网格，按银行汇总） ========== */}
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
              <MatrixCards
                data={matrixResult.banks || []}
                prevPeriod={matrixResult.prev_period || null}
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

// ===== 矩阵图（类别卡片网格，每组多行） =====

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

const MatrixCards: React.FC<{
  data: Array<{ bank_name: string; total_volume: number; change_pct: number | null }>;
  prevPeriod: { start: string; end: string } | null;
}> = ({ data, prevPeriod }) => {
  // 分组
  const groups: Record<string, typeof data> = {};
  for (const bank of data) {
    const cat = categorizeBank(bank.bank_name);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(bank);
  }

  // 组内按发行量降序，组间按最大银行发行量降序
  const categoryList = Object.entries(groups)
    .map(([category, banks]) => {
      banks.sort((a, b) => b.total_volume - a.total_volume);
      return {
        category,
        max_volume: banks[0]?.total_volume || 0,
        banks,
      };
    })
    .sort((a, b) => b.max_volume - a.max_volume);

  return (
    <div>
      {/* 对比信息 */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-slate-400">
          共 {data.length} 家银行，分 {categoryList.length} 个类别
        </span>
        {prevPeriod && (
          <span className="text-xs text-slate-500">
            对比周期：{prevPeriod.start} ~ {prevPeriod.end}
          </span>
        )}
      </div>

      {categoryList.length === 0 ? (
        <div className="text-center py-12 text-slate-400">所选日期范围内无数据</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {categoryList.map(cat => (
            <div
              key={cat.category}
              className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl border border-slate-700/50 shadow-lg overflow-hidden"
            >
              {/* 类别标题 */}
              <div className="px-4 py-2.5 bg-slate-800/90 border-b border-slate-700/50">
                <span className="text-base font-bold text-white">{cat.category}</span>
              </div>
              {/* 银行列表 */}
              <div className="px-4 py-3 space-y-2.5">
                {cat.banks.map(bank => (
                  <div key={bank.bank_name} className="flex items-center justify-between">
                    <span className="text-sm text-slate-200 truncate mr-2">{bank.bank_name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold text-cyan-300">{bank.total_volume.toFixed(1)}亿</span>
                      {bank.change_pct !== null && (
                        <span className={`text-xs font-bold ${
                          bank.change_pct >= 0 ? 'text-red-400' : 'text-green-400'
                        }`}>
                          {bank.change_pct >= 0 ? '▲' : '▼'}{Math.abs(bank.change_pct).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
