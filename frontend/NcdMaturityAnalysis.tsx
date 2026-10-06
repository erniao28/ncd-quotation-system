import React, { useState, useEffect, useMemo } from 'react';
import { DataChart } from './components/DataChart';
import {
  fetchNcdMaturityDates,
  fetchNcdMaturityByDate,
  fetchNcdMaturitySummary,
  fetchNcdMaturityBankSummary,
  fetchNcdCategories,
  fetchNcdMaturityState,
  syncNcdMaturity,
} from './services/api';

interface NcdRecord {
  issuer_name: string;
  sec_name: string;
  tenor: string;
  amount: number;
  ref_yield: number | null;
  security_id: string;
  rating: string | null;
  bucket: string;
}

interface NcdBank {
  bank_name: string;
  bucket: string;
  rating: string | null;
  amount: number;
  count: number;
}

interface NcdTenor {
  tenor: string;
  amount: number;
  count: number;
}

interface NcdDetail {
  date: string;
  total_amount: number;
  total_count: number;
  bank_count: number;
  by_tenor: NcdTenor[];
  banks: NcdBank[];
  records: NcdRecord[];
}

interface SummaryRow {
  date: string;
  total_amount: number;
  total_count: number;
  bank_count: number;
}

interface BankSummaryRow {
  bank_name: string;
  bucket: string;
  amount: number;
  count: number;
}

// 与后端 RATING_BUCKETS 保持一致；「大行国股」由银行名判定，其余按 DM 主体评级分桶
const CATEGORIES = ['大行国股', 'AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', '未评级', '其他'];
const TENORS = ['1M', '3M', '6M', '9M', '1Y'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
};
// 一天优先；否则取离目标日最近的（先后不限，取绝对值最小）
const nearestDateIn = (dates: string[], target: string) => {
  let best = dates[0];
  let bestDiff = Infinity;
  for (const d of dates) {
    const diff = Math.abs(new Date(d + 'T00:00:00').getTime() - new Date(target + 'T00:00:00').getTime());
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return best;
};

export const NcdMaturityAnalysis: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'daily' | 'range'>('daily');

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [detail, setDetail] = useState<NcdDetail | null>(null);
  const [loading, setLoading] = useState(false);

  // 类别筛选（每日到期与区间汇总共用）
  const [category, setCategory] = useState('');
  const [categoryCounts, setCategoryCounts] = useState<Record<string, { count: number; amount: number }>>({});
  // 每日到期里的银行模糊检索
  const [bankFilter, setBankFilter] = useState('');

  // 日历当前显示的月份
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  // 区间汇总里按单家银行筛选（服务端 instr 模糊匹配，回车/点查询生效）
  const [rangeBank, setRangeBank] = useState('');
  const [bankSummary, setBankSummary] = useState<BankSummaryRow[]>([]);

  const [state, setState] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');

  const todayStr = toISO(new Date());

  // 默认区间：今天 ~ 30 天后
  useEffect(() => {
    setRangeStart(todayStr);
    setRangeEnd(addDays(todayStr, 30));
  }, []);

  const loadDates = async () => {
    try {
      const dates: string[] = await fetchNcdMaturityDates();
      setAvailableDates(dates);
      if (dates.length > 0 && !selectedDate) {
        // 默认显示今天；今天无到期则退到离今天最近的有数据日期
        setSelectedDate(dates.includes(todayStr) ? todayStr : nearestDateIn(dates, todayStr));
      }
    } catch (e) {
      console.error('加载存单到期日期失败:', e);
    }
  };

  const loadState = async () => {
    try { setState(await fetchNcdMaturityState()); } catch {}
  };

  const loadCategories = async () => {
    try { setCategoryCounts(await fetchNcdCategories()); } catch {}
  };

  useEffect(() => { loadDates(); loadState(); loadCategories(); }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    (async () => {
      try { setDetail(await fetchNcdMaturityByDate(selectedDate, category || undefined)); }
      catch (e) { console.error(e); setDetail(null); }
      finally { setLoading(false); }
    })();
  }, [selectedDate, category]);

  // 区间汇总：一次拉「按日期」和「按银行」两份，两者共用类别/银行筛选条件
  const loadRange = async (start = rangeStart, end = rangeEnd, cat = category, bank = rangeBank) => {
    if (!start || !end) return;
    setLoading(true);
    try {
      const [daily, byBank] = await Promise.all([
        fetchNcdMaturitySummary(start, end, cat || undefined, bank || undefined),
        fetchNcdMaturityBankSummary(start, end, cat || undefined, bank || undefined),
      ]);
      setSummary(daily);
      setBankSummary(byBank);
    } catch (e) {
      console.error(e);
      setSummary([]);
      setBankSummary([]);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadRange = () => loadRange();

  // 切换区间汇总的类别时，若已有结果则立即重查
  const changeCategory = (value: string) => {
    setCategory(value);
    if (activeTab === 'range' && rangeStart && rangeEnd) loadRange(rangeStart, rangeEnd, value, rangeBank);
  };

  // 点「按银行汇总」里的某一行 = 把该行银行设为筛选条件并重查
  const handleSelectBank = (name: string) => {
    setRangeBank(name);
    loadRange(rangeStart, rangeEnd, category, name);
  };

  const handleSync = async (mode: 'daily' | 'backfill' | 'ratings') => {
    if (mode === 'backfill' && !confirm('回补 13 个月发行记录，约 400 次调用、耗时几分钟，确定继续？')) return;
    setSyncing(true);
    setMsg(mode === 'backfill' ? '回补中，请稍候（几分钟）...' : mode === 'ratings' ? '同步银行评级中...' : '同步最近 5 天发行记录中...');
    try {
      const r = await syncNcdMaturity(mode);
      setMsg(mode === 'ratings'
        ? `评级同步完成：${r.banks ?? 0} 家 / ${r.calls ?? 0} 次调用`
        : `完成：入库 ${r.total} 条，累计 ${r.state?.count ?? '-'} 条`);
      await loadDates();
      await loadState();
      await loadCategories();
      if (mode === 'ratings' && selectedDate) {
        setDetail(await fetchNcdMaturityByDate(selectedDate, category || undefined));
      }
    } catch (e) {
      setMsg('抓取失败，请查看后端日志');
    } finally {
      setSyncing(false);
    }
  };

  // ===== 日历 =====
  const dateSet = new Set(availableDates);

  const calendarCells = (() => {
    const first = new Date(viewMonth.year, viewMonth.month, 1);
    const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
    const leading = first.getDay(); // 0=周日
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

  // 模糊检索：按银行名过滤（前端过滤，不触发重复请求）
  const filteredBanks = useMemo(() => {
    if (!detail) return [];
    const kw = bankFilter.trim();
    if (!kw) return detail.banks;
    return detail.banks.filter(b => b.bank_name.includes(kw));
  }, [detail, bankFilter]);

  const filteredRecords = useMemo(() => {
    if (!detail) return [];
    const kw = bankFilter.trim();
    const list = kw ? detail.records.filter(r => (r.issuer_name || '').includes(kw)) : detail.records;
    return list;
  }, [detail, bankFilter]);

  const tenorMap = useMemo(() => {
    const m: Record<string, NcdTenor> = {};
    for (const t of detail?.by_tenor || []) m[t.tenor] = t;
    return m;
  }, [detail]);

  const summaryTotal = useMemo(() => ({
    amount: summary.reduce((s, r) => s + r.total_amount, 0),
    count: summary.reduce((s, r) => s + r.total_count, 0),
  }), [summary]);

  const bankSummaryTotal = useMemo(() => ({
    amount: bankSummary.reduce((s, r) => s + r.amount, 0),
    count: bankSummary.reduce((s, r) => s + r.count, 0),
  }), [bankSummary]);

  const categorySelect = (
    <select value={category} onChange={e => changeCategory(e.target.value)}
      className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
      <option value="">全部类别</option>
      {CATEGORIES.map(c => {
        const n = categoryCounts[c]?.count;
        return <option key={c} value={c}>{n != null ? `${c}（${n}）` : c}</option>;
      })}
    </select>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-slate-50">
        <div className="text-xs text-slate-500">
          {state ? `已入库 ${state.count ?? 0} 条发行记录（${state.min_issue_date || '-'} ~ ${state.max_issue_date || '-'}）` : '加载中...'}
          {msg && <span className="ml-3 text-indigo-600 font-bold">{msg}</span>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleSync('daily')} disabled={syncing}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            同步最新
          </button>
          <button onClick={() => handleSync('ratings')} disabled={syncing}
            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            同步评级
          </button>
          <button onClick={() => handleSync('backfill')} disabled={syncing}
            className="px-3 py-1.5 bg-slate-600 text-white text-xs font-bold rounded-lg hover:bg-slate-700 disabled:opacity-50">
            回补 13 个月
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-slate-200">
        {([
          { key: 'daily', label: '每日到期' },
          { key: 'range', label: '区间汇总' },
        ] as const).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-6 py-3 text-sm font-bold transition-all border-b-2 ${
              activeTab === tab.key ? 'border-indigo-500 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {loading && <div className="text-center py-8 text-slate-400">加载中...</div>}

        {/* ===== 每日到期 ===== */}
        {!loading && activeTab === 'daily' && (
          <div className="flex gap-6">
            <aside className="w-72 flex-shrink-0">
              <h3 className="text-sm font-bold text-slate-700 mb-3">选择到期日</h3>

              {/* 日历 */}
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
                        title={has ? '' : '无到期'}
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
                到期量随新发存单每日变动，每个工作日 18:10 自动同步最近 7 天发行记录。
              </p>
              {availableDates.length === 0 && (
                <p className="text-xs text-amber-600 mt-2">暂无数据，请点右上角「回补 13 个月」</p>
              )}
            </aside>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800">{selectedDate || '选择日期'} 同业存单到期</h2>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={bankFilter}
                    onChange={e => setBankFilter(e.target.value)}
                    placeholder="检索银行名（模糊）"
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {categorySelect}
                </div>
              </div>

              {!detail || detail.total_count === 0 ? (
                <div className="text-center py-8 text-slate-400">{category ? `该类别当日无到期数据` : '当日暂无到期数据'}</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-amber-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1">到期总量 (亿元)</div>
                      <div className="text-2xl font-black text-amber-700">{detail.total_amount.toFixed(1)}</div>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1">到期只数</div>
                      <div className="text-2xl font-black text-indigo-700">{detail.total_count}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-4">
                      <div className="text-xs text-slate-500 mb-1">涉及银行</div>
                      <div className="text-2xl font-black text-emerald-700">{detail.bank_count}</div>
                    </div>
                  </div>

                  {/* 按期限汇总 */}
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-700 mb-2">按期限汇总</h3>
                    <div className="grid grid-cols-5 gap-3">
                      {TENORS.map(t => {
                        const v = tenorMap[t];
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

                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-700 mb-3">各银行到期量对比</h3>
                    <div className="h-80">
                      <DataChart data={filteredBanks.map(b => ({ name: b.bank_name, value: b.amount, count: b.count }))} chartType="bar" showTooltip={true} />
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-slate-700 mb-3">
                    到期明细（按银行汇总）
                    <span className="ml-2 text-xs font-normal text-slate-400">{filteredBanks.length} 家</span>
                  </h3>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg mb-6">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left py-2 px-3 font-bold text-slate-700">银行</th>
                          <th className="text-left py-2 px-3 font-bold text-slate-700">类别</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">到期量(亿)</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">只数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBanks.map((b, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-3 text-slate-800">{b.bank_name}</td>
                            <td className="py-2 px-3 text-slate-500">{b.bucket}</td>
                            <td className="py-2 px-3 text-right font-bold text-slate-800">{b.amount.toFixed(2)}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{b.count}</td>
                          </tr>
                        ))}
                        {filteredBanks.length === 0 && (
                          <tr><td colSpan={4} className="py-6 text-center text-slate-400">无匹配银行</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <h3 className="text-sm font-bold text-slate-700 mb-3">
                    到期存单明细
                    <span className="ml-2 text-xs font-normal text-slate-400">{filteredRecords.length} 只</span>
                  </h3>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left py-2 px-3 font-bold text-slate-700">银行</th>
                          <th className="text-left py-2 px-3 font-bold text-slate-700">存单名称</th>
                          <th className="text-left py-2 px-3 font-bold text-slate-700">期限</th>
                          <th className="text-left py-2 px-3 font-bold text-slate-700">类别</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">发行量(亿)</th>
                          <th className="text-right py-2 px-3 font-bold text-slate-700">参考收益率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecords.map((r, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-3 font-bold text-slate-800">{r.issuer_name || '-'}</td>
                            <td className="py-2 px-3 text-slate-600">{r.sec_name || '-'}</td>
                            <td className="py-2 px-3 text-slate-600">{r.tenor || '-'}</td>
                            <td className="py-2 px-3 text-slate-500">{r.bucket || '-'}</td>
                            <td className="py-2 px-3 text-right font-bold text-slate-800">{r.amount != null ? r.amount.toFixed(2) : '-'}</td>
                            <td className="py-2 px-3 text-right text-slate-600">{r.ref_yield != null ? r.ref_yield : '-'}</td>
                          </tr>
                        ))}
                        {filteredRecords.length === 0 && (
                          <tr><td colSpan={6} className="py-6 text-center text-slate-400">无匹配存单</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ===== 区间汇总 ===== */}
        {!loading && activeTab === 'range' && (
          <div>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <span className="text-slate-400">~</span>
              <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {categorySelect}
              <input
                type="text"
                value={rangeBank}
                onChange={e => setRangeBank(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleLoadRange(); }}
                placeholder="检索银行名（回车查询）"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {rangeBank && (
                <button onClick={() => { setRangeBank(''); loadRange(rangeStart, rangeEnd, category, ''); }}
                  className="px-2 py-2 text-xs text-slate-500 hover:text-slate-800">
                  清除
                </button>
              )}
              <button onClick={handleLoadRange} disabled={!rangeStart || !rangeEnd}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                查询
              </button>
              <span className="text-sm text-slate-500">
                合计量 <b className="text-amber-700">{summaryTotal.amount.toFixed(1)}</b> 亿
                / <b className="text-indigo-700">{summaryTotal.count}</b> 只
              </span>
            </div>

            {summary.length === 0 ? (
              <div className="text-center py-12 text-slate-400">所选区间无到期数据</div>
            ) : (
              <>
                <h3 className="text-sm font-bold text-slate-700 mb-3">
                  按日期汇总
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {rangeBank ? `银行含「${rangeBank}」` : '全部银行'}
                  </span>
                </h3>
                <div className="h-72 mb-6">
                  <DataChart data={summary.map(r => ({ name: r.date, value: r.total_amount, count: r.total_count }))} chartType="bar" showTooltip={true} />
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left py-2 px-3 font-bold text-slate-700">到期日</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">到期量(亿)</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">只数</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">银行数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map((r, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-2 px-3 text-slate-800">{r.date}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-800">{r.total_amount.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{r.total_count}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{r.bank_count}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-amber-50 border-t-2 border-amber-200 font-bold">
                        <td className="py-2 px-3 text-slate-800">合计</td>
                        <td className="py-2 px-3 text-right text-amber-700">{summaryTotal.amount.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-indigo-700">{summaryTotal.count}</td>
                        <td className="py-2 px-3 text-right text-slate-500">-</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <h3 className="text-sm font-bold text-slate-700 mt-6 mb-3">
                  按银行汇总
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {bankSummary.length} 家 · 点任意一行查看该行的按日期分布
                  </span>
                </h3>
                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left py-2 px-3 font-bold text-slate-700">银行</th>
                        <th className="text-left py-2 px-3 font-bold text-slate-700">类别</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">到期量(亿)</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">只数</th>
                        <th className="text-right py-2 px-3 font-bold text-slate-700">占比</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankSummary.map((b, i) => (
                        <tr key={i} onClick={() => handleSelectBank(b.bank_name)}
                          className={`border-b border-slate-100 cursor-pointer hover:bg-indigo-50 ${
                            rangeBank && b.bank_name.includes(rangeBank) ? 'bg-indigo-50/60' : ''
                          }`}>
                          <td className="py-2 px-3 text-slate-800">{b.bank_name}</td>
                          <td className="py-2 px-3 text-slate-500">{b.bucket}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-800">{b.amount.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-slate-600">{b.count}</td>
                          <td className="py-2 px-3 text-right text-slate-500">
                            {bankSummaryTotal.amount > 0 ? `${(b.amount / bankSummaryTotal.amount * 100).toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-amber-50 border-t-2 border-amber-200 font-bold">
                        <td className="py-2 px-3 text-slate-800">合计</td>
                        <td className="py-2 px-3 text-slate-500">-</td>
                        <td className="py-2 px-3 text-right text-amber-700">{bankSummaryTotal.amount.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-indigo-700">{bankSummaryTotal.count}</td>
                        <td className="py-2 px-3 text-right text-slate-500">100.0%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
