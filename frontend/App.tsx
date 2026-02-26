
import React, { useState, useMemo, useEffect } from 'react';
import { Quotation, GroupedQuotation, MaturityInfo } from './types';
import { parseQuotations, parseMaturityDates } from './services/parser';
import { VisualCard } from './components/VisualCard';
import {
  initSocket,
  setSocketListeners,
  disconnectSocket,
  fetchQuotations,
  addQuotation,
  updateQuotation as updateQuotationApi,
  deleteQuotation as deleteQuotationApi,
  fetchMaturities,
  updateMaturities,
  emitQuotationAdd,
  emitQuotationUpdate,
  emitQuotationDelete,
  emitMaturityUpdate
} from './services/api';

const App: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [maturityInput, setMaturityInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [recognizedQuotes, setRecognizedQuotes] = useState<Partial<Quotation>[]>([]);
  const [allQuotes, setAllQuotes] = useState<Quotation[]>([]);
  const [maturities, setMaturities] = useState<MaturityInfo[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterTenor, setFilterTenor] = useState('ALL');
  const [filterRating, setFilterRating] = useState('ALL');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const [activeTab, setActiveTab] = useState<'VISUAL' | 'TEXT'>('VISUAL');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedQuotes, setSelectedQuotes] = useState<Set<string>>(new Set());
  const [copySuccessMsg, setCopySuccessMsg] = useState('');

  // 初始化数据加载和 WebSocket
  useEffect(() => {
    // 从后端加载数据
    const loadData = async () => {
      try {
        const [quotes, mats] = await Promise.all([
          fetchQuotations(),
          fetchMaturities()
        ]);
        setAllQuotes(quotes);
        setMaturities(mats);
      } catch (error) {
        console.error('加载数据失败:', error);
      }
    };

    loadData();

    // 初始化 WebSocket
    initSocket();

    // 设置 Socket 事件监听器
    setSocketListeners({
      onFullSync: (data) => {
        setAllQuotes(data.quotations || []);
        setMaturities(data.maturities || []);
        setIsConnected(true);
      },
      onQuotationAdd: (quote) => {
        setAllQuotes(prev => {
          // 检查是否已存在（避免重复添加）
          const exists = prev.some(q => q.id === quote.id);
          if (exists) return prev;
          return [...prev, quote as Quotation];
        });
      },
      onQuotationUpdate: (data) => {
        setAllQuotes(prev => prev.map(q => q.id === data.id ? { ...q, ...data } : q));
      },
      onQuotationDelete: (id) => {
        setAllQuotes(prev => prev.filter(q => q.id !== id));
      },
      onMaturityUpdate: (newMaturities) => {
        setMaturities(newMaturities);
        // 同时更新报价中的到期日
        setAllQuotes(prev => prev.map(q => {
          const mat = newMaturities.find((m: MaturityInfo) => m.tenor === q.tenor);
          return mat ? { ...q, maturityDate: mat.date, maturityWeekday: mat.weekday } : q;
        }));
      }
    });

    return () => {
      disconnectSocket();
    };
  }, []);

  const getNextWeekday = () => {
    const today = new Date();
    const day = today.getDay();
    let add = 1;
    if (day === 5) add = 3;
    else if (day === 6) add = 2;
    const next = new Date(today.getTime() + add * 24 * 60 * 60 * 1000);
    return '周' + ['日','一','二','三','四','五','六'][next.getDay()];
  };

  const [valueWeekday, setValueWeekday] = useState(getNextWeekday());

  const handleSyncMaturity = async () => {
    if (!maturityInput.trim()) return;
    try {
      const results = await parseMaturityDates(maturityInput);
      setMaturities(results);

      // 更新数据库
      await updateMaturities(results);

      // 广播给其他用户
      emitMaturityUpdate(results);

      setAllQuotes(prev => prev.map(q => {
        const mat = results.find(m => m.tenor === q.tenor);
        return mat ? { ...q, maturityDate: mat.date, maturityWeekday: mat.weekday } : q;
      }));
    } catch (e: any) {
      console.error("同步失败详情:", e);
      alert('到期日同步失败，请检查 API Key 是否配置或网络是否通畅。');
    }
  };

  const handleParse = async () => {
    if (!inputText.trim()) return;
    setIsParsing(true);
    try {
      const results = await parseQuotations(inputText, valueWeekday);
      if (results.length === 0) {
        alert('解析成功但未发现报价项，请尝试更清晰的格式。');
      } else {
        setRecognizedQuotes(results);
      }
    } catch (error: any) {
      console.error("识别失败详情:", error);
      alert('解析过程出错，请检查输入格式。');
    }
    finally { setIsParsing(false); }
  };

  const handleConfirmAdd = async () => {
    const updatedQuotes = [...allQuotes];
    let skippedCount = 0;

    for (const newPart of recognizedQuotes) {
      // 跳过没有银行名或没有收益率的项
      if (!newPart.bankName || !newPart.yieldRate) {
        skippedCount++;
        continue;
      }

      const mat = maturities.find(m => m.tenor === newPart.tenor);
      const cleanRateStr = newPart.yieldRate.toString().replace(/[^\d.]/g, '');
      const newRateVal = parseFloat(cleanRateStr);

      if (isNaN(newRateVal)) continue;

      const existingIdx = updatedQuotes.findIndex(q =>
        q.bankName === newPart.bankName && q.tenor === newPart.tenor
      );

      let finalYield = `${newRateVal.toFixed(2)}%`;

      if (existingIdx > -1) {
        const oldRateVal = parseFloat(updatedQuotes[existingIdx].yieldRate.replace(/[^\d.]/g, ''));
        if (!isNaN(oldRateVal)) {
          if (newRateVal > oldRateVal) finalYield += '↑';
          else if (newRateVal < oldRateVal) finalYield += '↓';
        }

        updatedQuotes[existingIdx] = {
          ...updatedQuotes[existingIdx],
          ...newPart,
          yieldRate: finalYield,
          maturityDate: mat?.date || updatedQuotes[existingIdx].maturityDate,
          maturityWeekday: mat?.weekday || updatedQuotes[existingIdx].maturityWeekday,
        } as Quotation;

        // 更新到后端
        const updated = await updateQuotationApi(updatedQuotes[existingIdx].id, updatedQuotes[existingIdx]);
        // 广播给其他用户
        emitQuotationUpdate(updated);
      } else {
        const newQuote = {
          ...newPart,
          id: Math.random().toString(36).substr(2, 9),
          yieldRate: finalYield,
          maturityDate: mat?.date || '未同步',
          maturityWeekday: mat?.weekday || '未知',
          remarks: newPart.remarks || '',
          volume: newPart.volume || '',
          weekday: newPart.weekday || valueWeekday,
        } as Quotation;

        try {
          // 保存到后端
          const saved = await addQuotation(newQuote);
          // 广播给其他用户
          emitQuotationAdd(saved);
          updatedQuotes.push(saved);
        } catch (err) {
          console.error('保存报价失败:', err);
          alert('保存报价失败: ' + err);
        }
      }
    }

    setAllQuotes(updatedQuotes);
    setRecognizedQuotes([]);
    setInputText('');

    if (skippedCount > 0) {
      alert(`已发布 ${recognizedQuotes.length - skippedCount} 条报价，${skippedCount} 条因缺少银行名或收益率被跳过`);
    }
  };

  const handleUpdateQuote = async (id: string, field: keyof Quotation, value: string) => {
    // 先本地更新
    setAllQuotes(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));

    // 获取更新后的数据
    const quote = allQuotes.find(q => q.id === id);
    if (!quote) return;

    // 发送到后端
    try {
      const updated = await updateQuotationApi(id, { [field]: value });
      // 广播给其他用户
      emitQuotationUpdate(updated);
    } catch (error) {
      console.error('更新报价失败:', error);
    }
  };

  const handleDeleteQuote = async (id: string) => {
    // 先本地更新
    setAllQuotes(prev => prev.filter(q => q.id !== id));

    // 删除后端数据
    try {
      await deleteQuotationApi(id);
      // 广播给其他用户
      emitQuotationDelete(id);
    } catch (error) {
      console.error('删除报价失败:', error);
    }
  };

  const filteredQuotes = useMemo(() => {
    let result = [...allQuotes];
    if (searchTerm) result = result.filter(q => q.bankName.includes(searchTerm));
    if (filterTenor !== 'ALL') result = result.filter(q => q.tenor === filterTenor);
    if (filterRating !== 'ALL') result = result.filter(q => q.rating === filterRating);

    result.sort((a, b) => {
      const valA = parseFloat(a.yieldRate.replace(/[^\d.]/g, '')) || 0;
      const valB = parseFloat(b.yieldRate.replace(/[^\d.]/g, '')) || 0;
      return sortOrder === 'ASC' ? valA - valB : valB - valA;
    });
    return result;
  }, [allQuotes, searchTerm, filterTenor, filterRating, sortOrder]);

  const groupedQuotes = useMemo(() => {
    const groups: Record<string, GroupedQuotation> = {};
    const tenorOrder = ['1M', '3M', '6M', '9M', '1Y'];
    filteredQuotes.forEach(q => {
      if (!groups[q.tenor]) {
        groups[q.tenor] = { tenor: q.tenor, maturityDate: q.maturityDate, maturityWeekday: q.maturityWeekday, items: [] };
      }
      groups[q.tenor].items.push(q);
    });
    return tenorOrder.map(t => groups[t]).filter(Boolean);
  }, [filteredQuotes]);

  const exportText = useMemo(() => {
    return groupedQuotes.map(g => {
      const header = `(${g.tenor} 到期日 ${g.maturityDate} ${g.maturityWeekday})`;
      const rows = g.items.map(i => {
        const vol = i.volume ? `${i.volume}` : '';
        return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate} ${vol} ${i.remarks}`.trim();
      }).join('\n');
      return `${header}\n${rows}`;
    }).join('\n\n');
  }, [groupedQuotes]);

  // 复制选中报价的函数
  const handleCopySelected = () => {
    const selectedItems = groupedQuotes.flatMap(g =>
      g.items.filter(i => selectedQuotes.has(i.id))
    );
    if (selectedItems.length === 0) {
      setCopySuccessMsg('请先选择要复制的报价');
      setTimeout(() => setCopySuccessMsg(''), 2000);
      return;
    }
    const text = selectedItems.map(i => {
      return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}`;
    }).join('\n');
    navigator.clipboard.writeText(text);
    setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
    setTimeout(() => setCopySuccessMsg(''), 2000);
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(exportText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const toggleSelect = (id: string) => {
    setSelectedQuotes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    if (selectedQuotes.size === filteredQuotes.length) {
      setSelectedQuotes(new Set());
    } else {
      setSelectedQuotes(new Set(filteredQuotes.map(q => q.id)));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 text-white p-2 rounded-xl font-bold text-xl">NCD.AI</div>
          <h1 className="text-lg font-bold text-slate-800">专业报价管理系统</h1>
          <span className={`text-xs px-2 py-1 rounded-full ${isConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
            {isConnected ? '● 已连接' : '○ 未连接'}
          </span>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">起息周几:</span>
            <input value={valueWeekday} onChange={e => setValueWeekday(e.target.value)} className="bg-transparent w-8 text-indigo-600 font-bold border-none outline-none text-sm text-center" />
          </div>
          <button onClick={handleCopySelected} className="px-4 py-2 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all">
            复制选中 ({selectedQuotes.size})
          </button>
          <button onClick={handleCopyAll} className={`px-4 py-2 rounded-xl text-sm font-bold shadow-lg transition-all ${copyFeedback ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
            {copyFeedback ? '复制成功' : '复制全部'}
          </button>
          {copySuccessMsg && <span className="text-emerald-500 text-sm font-bold self-center">{copySuccessMsg}</span>}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-8 grid grid-cols-12 gap-8 w-full">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <section className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-400"></span> 1. 同步到期日
            </h2>
            <textarea
              value={maturityInput}
              onChange={e => setMaturityInput(e.target.value)}
              className="w-full h-20 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-mono outline-none focus:border-orange-200 transition-all resize-none"
              placeholder="粘贴包含 (1M 到期日 2025/10/16 周四) 的文本..."
            ></textarea>
            <button onClick={handleSyncMaturity} className="w-full mt-2 py-2 bg-orange-50 text-orange-600 rounded-xl text-xs font-bold hover:bg-orange-100">同步基准日期</button>
          </section>

          <section className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
             <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
               <span className="w-2 h-2 rounded-full bg-indigo-500"></span> 2. 解析新报价
             </h2>
             <textarea
               value={inputText}
               onChange={e => setInputText(e.target.value)}
               className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:border-indigo-200 transition-all resize-none"
               placeholder="可一次粘贴多条，格式: 兴业银行 AAA 周一 6M 1.62%，支持多行、逗号分隔"
             ></textarea>
             <button
               disabled={isParsing}
               onClick={handleParse}
               className="w-full mt-4 py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-xl hover:bg-indigo-700 transition-all disabled:opacity-50"
             >
               {isParsing ? '正在解析...' : '解析报价'}
             </button>
          </section>

          {recognizedQuotes.length > 0 && (
            <div className="bg-slate-900 p-6 rounded-3xl shadow-2xl animate-in slide-in-from-bottom-4">
              <h3 className="text-xs font-bold text-slate-400 mb-4 uppercase tracking-widest">解析结果确认 - 可编辑 ({recognizedQuotes.length})</h3>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar text-white">
                {recognizedQuotes.map((q, i) => (
                  <div key={i} className="bg-slate-800 p-3 rounded-xl border border-slate-700">
                    <div className="flex flex-wrap gap-2 items-center">
                      {/* 银行名 */}
                      <div className="flex flex-col">
                        <label className="text-[10px] text-slate-500">银行</label>
                        <input
                          className="w-24 bg-slate-700 text-white text-sm font-bold px-2 py-1 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={q.bankName || ''}
                          onChange={(e) => {
                            const newQuotes = [...recognizedQuotes];
                            newQuotes[i] = { ...newQuotes[i], bankName: e.target.value };
                            setRecognizedQuotes(newQuotes);
                          }}
                        />
                      </div>
                      {/* 期限 */}
                      <div className="flex flex-col">
                        <label className="text-[10px] text-slate-500">期限</label>
                        <select
                          className="bg-slate-700 text-white text-sm px-2 py-1 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={q.tenor || ''}
                          onChange={(e) => {
                            const newQuotes = [...recognizedQuotes];
                            newQuotes[i] = { ...newQuotes[i], tenor: e.target.value };
                            setRecognizedQuotes(newQuotes);
                          }}
                        >
                          <option value="">请选择</option>
                          <option value="1M">1M</option>
                          <option value="3M">3M</option>
                          <option value="6M">6M</option>
                          <option value="9M">9M</option>
                          <option value="1Y">1Y</option>
                        </select>
                      </div>
                      {/* 收益率 */}
                      <div className="flex flex-col">
                        <label className="text-[10px] text-slate-500">收益率(%)</label>
                        <input
                          className="w-20 bg-slate-700 text-indigo-400 text-sm font-bold px-2 py-1 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={q.yieldRate || ''}
                          placeholder="如: 1.50"
                          onChange={(e) => {
                            const newQuotes = [...recognizedQuotes];
                            newQuotes[i] = { ...newQuotes[i], yieldRate: e.target.value };
                            setRecognizedQuotes(newQuotes);
                          }}
                        />
                      </div>
                      {/* 评级 */}
                      <div className="flex flex-col">
                        <label className="text-[10px] text-slate-500">评级</label>
                        <select
                          className="bg-slate-700 text-white text-sm px-2 py-1 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={q.rating || 'AAA'}
                          onChange={(e) => {
                            const newQuotes = [...recognizedQuotes];
                            newQuotes[i] = { ...newQuotes[i], rating: e.target.value };
                            setRecognizedQuotes(newQuotes);
                          }}
                        >
                          <option value="AAA">AAA</option>
                          <option value="AA+">AA+</option>
                          <option value="AA">AA</option>
                          <option value="AA-">AA-</option>
                        </select>
                      </div>
                      {/* 类别 */}
                      <div className="flex flex-col">
                        <label className="text-[10px] text-slate-500">类别</label>
                        <select
                          className="bg-slate-700 text-white text-sm px-2 py-1 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={q.category || 'AAA'}
                          onChange={(e) => {
                            const newQuotes = [...recognizedQuotes];
                            newQuotes[i] = { ...newQuotes[i], category: e.target.value };
                            setRecognizedQuotes(newQuotes);
                          }}
                        >
                          <option value="BIG">大行</option>
                          <option value="AAA">AAA</option>
                        </select>
                      </div>
                      {/* 星期 */}
                      <div className="flex flex-col">
                        <label className="text-[10px] text-slate-500">报价日</label>
                        <select
                          className="bg-slate-700 text-white text-sm px-2 py-1 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={q.weekday || valueWeekday}
                          onChange={(e) => {
                            const newQuotes = [...recognizedQuotes];
                            newQuotes[i] = { ...newQuotes[i], weekday: e.target.value };
                            setRecognizedQuotes(newQuotes);
                          }}
                        >
                          <option value="周一">周一</option>
                          <option value="周二">周二</option>
                          <option value="周三">周三</option>
                          <option value="周四">周四</option>
                          <option value="周五">周五</option>
                        </select>
                      </div>
                      {/* 删除按钮 */}
                      <div className="flex flex-col justify-end">
                        <button
                          onClick={() => {
                            const newQuotes = recognizedQuotes.filter((_, idx) => idx !== i);
                            setRecognizedQuotes(newQuotes);
                          }}
                          className="text-red-400 hover:text-red-300 text-xs"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setRecognizedQuotes([])}
                  className="flex-1 py-3 bg-slate-700 text-slate-300 rounded-xl font-bold hover:bg-slate-600"
                >
                  取消
                </button>
                <button onClick={handleConfirmAdd} className="flex-1 py-3 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-400">确认发布</button>
              </div>
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-6 min-h-[700px]">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
               <div className="flex bg-slate-100 p-1 rounded-xl">
                 <button onClick={() => setActiveTab('VISUAL')} className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'VISUAL' ? 'bg-white shadow text-slate-900' : 'text-slate-400'}`}>看板视图</button>
                 <button onClick={() => setActiveTab('TEXT')} className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'TEXT' ? 'bg-white shadow text-slate-900' : 'text-slate-400'}`}>文字版</button>
               </div>

               <div className="flex flex-wrap gap-2 items-center">
                 <input
                  placeholder="搜银行..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 w-32"
                 />
                 <select value={filterTenor} onChange={e => setFilterTenor(e.target.value)} className="bg-slate-50 border border-slate-200 px-2 py-2 rounded-xl text-xs">
                    <option value="ALL">期限</option>
                    <option value="1M">1M</option><option value="3M">3M</option><option value="6M">6M</option><option value="9M">9M</option><option value="1Y">1Y</option>
                 </select>
                 <select value={filterRating} onChange={e => setFilterRating(e.target.value)} className="bg-slate-50 border border-slate-200 px-2 py-2 rounded-xl text-xs">
                    <option value="ALL">评级</option>
                    <option value="AAA">AAA</option><option value="AA+">AA+</option>
                 </select>
                 <button onClick={() => setSortOrder(o => o === 'ASC' ? 'DESC' : 'ASC')} className="p-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors">
                    <svg className={`w-4 h-4 text-slate-500 transition-transform ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="2" /></svg>
                 </button>
               </div>
            </div>

            {activeTab === 'VISUAL' ? (
              <VisualCard groupedQuotes={groupedQuotes} />
            ) : (
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex-1 flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">文字版 (自动保存)</h3>
                    <button onClick={selectAll} className="text-[10px] font-bold text-indigo-400 hover:text-indigo-600">
                      {selectedQuotes.size === filteredQuotes.length ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <button onClick={() => {if(confirm('清空所有？')) setAllQuotes([])}} className="text-[10px] font-bold text-red-400 hover:text-red-600 uppercase">Clear All</button>
                </div>
                <div className="space-y-8 flex-1">
                  {groupedQuotes.map((group, idx) => (
                    <div key={idx} className="font-mono text-sm">
                      <div className="text-indigo-600 font-bold mb-4 flex items-center">
                        <span className="bg-indigo-50 px-3 py-1 rounded-lg">({group.tenor} 到期日 {group.maturityDate} {group.maturityWeekday})</span>
                        <div className="h-px bg-slate-200 flex-1 ml-4"></div>
                      </div>
                      <div className="space-y-2">
                        {group.items.map(item => (
                          <div key={item.id} className="flex flex-wrap gap-2 items-center group py-1.5 hover:bg-white rounded-lg px-3 transition-colors">
                            <input
                              type="checkbox"
                              checked={selectedQuotes.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                              className="w-4 h-4 text-indigo-600 rounded"
                            />
                            <input
                              className="w-28 font-bold bg-transparent border-none focus:bg-white outline-none p-0 text-slate-900"
                              value={item.bankName}
                              onChange={e => handleUpdateQuote(item.id, 'bankName', e.target.value)}
                            />
                            <input className="w-10 text-slate-400 text-xs bg-transparent" value={item.rating} onChange={e => handleUpdateQuote(item.id, 'rating', e.target.value)} />
                            <input className="w-8 text-slate-400 text-xs bg-transparent" value={item.weekday} onChange={e => handleUpdateQuote(item.id, 'weekday', e.target.value)} />
                            <input
                              className={`w-20 font-bold text-right outline-none bg-transparent ${item.yieldRate.includes('↑') ? 'text-red-600' : item.yieldRate.includes('↓') ? 'text-emerald-600' : 'text-blue-600'}`}
                              value={item.yieldRate}
                              onChange={e => handleUpdateQuote(item.id, 'yieldRate', e.target.value)}
                            />
                            <input className="w-12 text-slate-400 text-xs text-center" value={item.volume} placeholder="量" onChange={e => handleUpdateQuote(item.id, 'volume', e.target.value)} />
                            <input className="flex-1 text-slate-400 italic text-xs truncate" value={item.remarks} placeholder="备注" onChange={e => handleUpdateQuote(item.id, 'remarks', e.target.value)} />
                            <button
                              onClick={() => {
                                const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}`;
                                navigator.clipboard.writeText(text);
                                setCopySuccessMsg('已复制');
                                setTimeout(() => setCopySuccessMsg(''), 1500);
                              }}
                              className="opacity-0 group-hover:opacity-100 text-blue-300 hover:text-blue-500 transition-all text-xs font-bold"
                              title="复制此行"
                            >
                              复制
                            </button>
                            <button onClick={() => handleDeleteQuote(item.id)} className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 transition-all text-xs font-bold">删除</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {groupedQuotes.length === 0 && <div className="text-center text-slate-300 py-20 italic">暂无报价数据</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <footer className="p-8 text-center text-[10px] text-slate-300 font-bold uppercase tracking-widest">
        Professional NCD Engine • 智能解析 • 多人实时协作
      </footer>
    </div>
  );
};

export default App;
