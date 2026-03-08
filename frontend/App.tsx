
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
  deleteAllQuotations,
  fetchMaturities,
  updateMaturities,
  emitQuotationAdd,
  emitQuotationUpdate,
  emitQuotationDelete,
  emitMaturityUpdate
} from './services/api';
import html2canvas from 'html2canvas';

const APP_VERSION = '20260307'; // 版本号：YYYYMMDD 格式

const App: React.FC = () => {
  const [inputText, setInputText] = useState('');
  const [maturityInput, setMaturityInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [recognizedQuotes, setRecognizedQuotes] = useState<Partial<Quotation>[]>([]);
  const [allQuotes, setAllQuotes] = useState<Quotation[]>([]);
  const [maturities, setMaturities] = useState<MaturityInfo[]>([]);
  const [recognizedMaturities, setRecognizedMaturities] = useState<{ tenor: string; date: string; weekday: string }[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterTenor, setFilterTenor] = useState('ALL');
  const [filterRating, setFilterRating] = useState('ALL');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [sortBy, setSortBy] = useState<'YIELD' | 'TIME'>('YIELD');

  // 单条列表视图的排序
  const [listSortBy, setListSortBy] = useState<'TIME' | 'YIELD'>('TIME');
  const [listSortOrder, setListSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const [activeTab, setActiveTab] = useState<'VISUAL' | 'TEXT' | 'LIST'>('VISUAL');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedQuotes, setSelectedQuotes] = useState<Set<string>>(new Set());
  const [copySuccessMsg, setCopySuccessMsg] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 双击编辑模式 - 记录哪个 ID 处于编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);

  // 编辑中的收益率值（本地状态）
  const [editingYieldRate, setEditingYieldRate] = useState<string>('');

  // 同步到期日面板折叠状态
  const [isMaturityPanelCollapsed, setIsMaturityPanelCollapsed] = useState(false);

  // 解析报价面板折叠状态
  const [isQuotePanelCollapsed, setIsQuotePanelCollapsed] = useState(false);

  // 看板视图手动扩展状态（null=未手动操作，true=手动扩展，false=手动收缩）
  const [isVisualCardManuallyExpanded, setIsVisualCardManuallyExpanded] = useState<boolean | null>(null);

  // 切换看板视图扩展状态
  const toggleVisualCardExpand = () => {
    const panelsCollapsed = isMaturityPanelCollapsed && isQuotePanelCollapsed;
    const currentExpanded = panelsCollapsed || (isVisualCardManuallyExpanded ?? false);
    // 手动切换：如果当前是扩展的，就收缩；否则扩展
    setIsVisualCardManuallyExpanded(!currentExpanded);
  };

  // 计算看板实际扩展状态
  const isVisualCardExpanded = isVisualCardManuallyExpanded !== null
    ? isVisualCardManuallyExpanded  // 有手动设置时用手动值
    : (isMaturityPanelCollapsed && isQuotePanelCollapsed);  // 否则用面板状态

  // 拖动多选功能
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'select' | 'deselect'>('select');

  // 撤销功能的历史记录
  const [history, setHistory] = useState<Quotation[][]>([]);

  // 添加历史记录
  const pushHistory = (quotes: Quotation[]) => {
    setHistory(prev => {
      const newHistory = [...prev, JSON.parse(JSON.stringify(quotes))];
      // 只保留最近 10 步
      if (newHistory.length > 10) newHistory.shift();
      return newHistory;
    });
  };

  // 撤销上一步
  const handleUndo = () => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setAllQuotes(previousState);
    setHistory(prev => prev.slice(0, -1));
  };

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
      if (results.length === 0) {
        alert('未识别到有效的期限和日期格式');
        return;
      }
      // 显示解析结果，让用户确认
      setRecognizedMaturities(results);
    } catch (e: any) {
      console.error("同步失败详情:", e);
      alert('到期日解析失败，请检查输入格式。');
    }
  };

  // 确认发布基准日期
  const handleConfirmMaturity = async () => {
    if (recognizedMaturities.length === 0) return;

    // 更新本地状态
    setMaturities(recognizedMaturities);

    // 更新数据库
    await updateMaturities(recognizedMaturities);

    // 广播给其他用户
    emitMaturityUpdate(recognizedMaturities);

    // 更新所有报价的到期日
    setAllQuotes(prev => prev.map(q => {
      const mat = recognizedMaturities.find(m => m.tenor === q.tenor);
      return mat ? { ...q, maturityDate: mat.date, maturityWeekday: mat.weekday } : q;
    }));

    // 清空输入和识别结果
    setRecognizedMaturities([]);
    setMaturityInput('');
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

    // 推入历史记录
    pushHistory(allQuotes);

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

      // 格式化为 4 位小数，然后去掉末尾多余的 0，但至少保留 2 位小数
      let formattedRate = newRateVal.toFixed(4);
      formattedRate = formattedRate.replace(/(\.\d\d[1-9])0+$|(\.\d\d)0+$/, '$1$2');
      if (!formattedRate.includes('.')) {
        formattedRate += '.00';
      } else {
        const decimalPart = formattedRate.split('.')[1];
        if (decimalPart.length < 2) {
          formattedRate = formattedRate + '0'.repeat(2 - decimalPart.length);
        }
      }
      let finalYield = `${formattedRate}%`;

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
    // 对收益率进行精度处理
    let finalValue = value;
    if (field === 'yieldRate') {
      // 先从当前数据中获取原有的收益率和涨跌标记
      const currentQuote = allQuotes.find(q => q.id === id);
      const oldYield = currentQuote?.yieldRate || '';
      const oldCleanYield = parseFloat(oldYield.replace(/[↑↓%]/g, ''));

      // 从新值中提取数字（去掉所有非数字字符）
      const cleanRateStr = value.replace(/[^\d.]/g, '');
      const rateVal = parseFloat(cleanRateStr);

      if (!isNaN(rateVal)) {
        // 格式化为 4 位小数，然后去掉末尾多余的 0，但至少保留 2 位小数
        let formattedRate = rateVal.toFixed(4);
        // 去掉末尾多余的 0，但至少保留 2 位小数
        formattedRate = formattedRate.replace(/(\.\d\d[1-9])0+$|(\.\d\d)0+$/, '$1$2');
        // 如果小数点后不足 2 位，补足 2 位
        if (!formattedRate.includes('.')) {
          formattedRate += '.00';
        } else {
          const decimalPart = formattedRate.split('.')[1];
          if (decimalPart.length < 2) {
            formattedRate = formattedRate + '0'.repeat(2 - decimalPart.length);
          }
        }

        // 比较新旧值，决定涨跌标记
        let direction = '';
        if (!isNaN(oldCleanYield)) {
          if (rateVal > oldCleanYield) {
            direction = '↑'; // 提价
          } else if (rateVal < oldCleanYield) {
            direction = '↓'; // 降价
          }
          // 如果相等，不添加标记（保持正常蓝色）
        }

        finalValue = formattedRate + direction;
      }
    }

    // 先本地更新
    setAllQuotes(prev => prev.map(q => q.id === id ? { ...q, [field]: finalValue } : q));

    // 发送到后端
    try {
      const updated = await updateQuotationApi(id, { [field]: finalValue });
      // 广播给其他用户
      emitQuotationUpdate(updated);
    } catch (error) {
      console.error('更新报价失败:', error);
    }
  };

  // 点击行选中并复制
  const handleRowClick = (id: string, item: Quotation, event: React.MouseEvent) => {
    // 处理选中逻辑（支持 Ctrl 多选）
    setSelectedQuotes(prev => {
      const newSet = new Set(prev);
      const isCtrlClick = event.ctrlKey || event.metaKey;

      if (isCtrlClick) {
        // Ctrl 点击：切换当前项的选中状态
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
      } else {
        // 非 Ctrl 点击：如果已选中则取消，如果未选中则单选该项
        if (newSet.has(id)) {
          newSet.clear();
        } else {
          newSet.clear();
          newSet.add(id);
        }
      }
      return newSet;
    });

    // 自动复制该行内容
    const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
    copyToClipboard(text);
    setCopySuccessMsg('已复制');
    setTimeout(() => setCopySuccessMsg(''), 1500);
  };

  // 手动更新到期日（批量更新所有相同期限的报价）
  const handleUpdateMaturity = async (tenor: string, date: string, weekday: string) => {
    // 更新所有相同期限的报价
    const updatedQuotes = allQuotes.map(q =>
      q.tenor === tenor ? { ...q, maturityDate: date, maturityWeekday: weekday } : q
    );
    setAllQuotes(updatedQuotes);

    // 批量更新后端
    try {
      for (const quote of updatedQuotes.filter(q => q.tenor === tenor)) {
        await updateQuotationApi(quote.id, {
          maturityDate: date,
          maturityWeekday: weekday
        });
        // 广播更新后的数据（包含新的到期日）
        emitQuotationUpdate(quote);
      }
      // 同时更新 maturities 配置
      const updatedMaturities = maturities.map(m =>
        m.tenor === tenor ? { ...m, date, weekday } : m
      );
      // 如果没有该期限的配置，添加新的
      if (!maturities.some(m => m.tenor === tenor)) {
        updatedMaturities.push({ tenor, date, weekday });
      }
      await updateMaturities(updatedMaturities);
      emitMaturityUpdate(updatedMaturities);
    } catch (error) {
      console.error('批量更新到期日失败:', error);
    }
  };

  const handleDeleteQuote = async (id: string) => {
    // 推入历史记录
    pushHistory(allQuotes);

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
    if (filterRating !== 'ALL') {
      // BIG 筛选的是 category，其他筛选的是 rating
      if (filterRating === 'BIG') {
        result = result.filter(q => q.category === 'BIG');
      } else {
        result = result.filter(q => q.rating === filterRating);
      }
    }

    // 排序逻辑
    result.sort((a, b) => {
      if (sortBy === 'TIME') {
        // 按更新时间排序
        const timeA = a.updatedAt || a.createdAt || 0;
        const timeB = b.updatedAt || b.createdAt || 0;
        return sortOrder === 'ASC' ? timeA - timeB : timeB - timeA;
      } else {
        // 按收益率排序
        const valA = parseFloat(a.yieldRate.replace(/[^\d.]/g, '')) || 0;
        const valB = parseFloat(b.yieldRate.replace(/[^\d.]/g, '')) || 0;
        return sortOrder === 'ASC' ? valA - valB : valB - valA;
      }
    });
    return result;
  }, [allQuotes, searchTerm, filterTenor, filterRating, sortOrder, sortBy]);

  // 手动刷新函数
  const handleRefresh = async () => {
    try {
      const [quotes, mats] = await Promise.all([
        fetchQuotations(),
        fetchMaturities()
      ]);
      setAllQuotes(quotes);
      setMaturities(mats);
    } catch (error) {
      console.error('刷新失败:', error);
      alert('刷新失败，请检查网络连接');
    }
  };

  // 单条列表视图的排序
  const sortedListQuotes = useMemo(() => {
    let result = [...allQuotes];
    // 筛选
    if (searchTerm) result = result.filter(q => q.bankName.includes(searchTerm));
    if (filterTenor !== 'ALL') result = result.filter(q => q.tenor === filterTenor);
    if (filterRating !== 'ALL') {
      // BIG 筛选的是 category，其他筛选的是 rating
      if (filterRating === 'BIG') {
        result = result.filter(q => q.category === 'BIG');
      } else {
        result = result.filter(q => q.rating === filterRating);
      }
    }

    // 排序
    result.sort((a, b) => {
      if (listSortBy === 'TIME') {
        const timeA = a.updatedAt || a.createdAt || 0;
        const timeB = b.updatedAt || b.createdAt || 0;
        return listSortOrder === 'ASC' ? timeA - timeB : timeB - timeA;
      } else {
        const valA = parseFloat(a.yieldRate.replace(/[^\d.]/g, '')) || 0;
        const valB = parseFloat(b.yieldRate.replace(/[^\d.]/g, '')) || 0;
        return listSortOrder === 'ASC' ? valA - valB : valB - valA;
      }
    });

    return result;
  }, [allQuotes, searchTerm, filterTenor, filterRating, listSortBy, listSortOrder]);

  const groupedQuotes = useMemo(() => {
    const groups: Record<string, GroupedQuotation> = {};
    const tenorOrder = ['1M', '3M', '6M', '9M', '1Y'];
    const ratingOrder: Record<string, number> = { 'BIG': 0, 'AAA': 1, 'AA+': 2 };

    filteredQuotes.forEach(q => {
      if (!groups[q.tenor]) {
        groups[q.tenor] = { tenor: q.tenor, maturityDate: q.maturityDate, maturityWeekday: q.maturityWeekday, items: [] };
      }
      groups[q.tenor].items.push(q);
    });

    // 每个期限内排序：类别 > 收益率 DESC > 时间 DESC
    Object.values(groups).forEach(group => {
      group.items.sort((a, b) => {
        // 1. 先按类别排序
        const ratingA = ratingOrder[a.category] ?? 99;
        const ratingB = ratingOrder[b.category] ?? 99;
        if (ratingA !== ratingB) return ratingA - ratingB;

        // 2. 同类别按收益率降序
        const yieldA = parseFloat(a.yieldRate.replace(/[^\d.]/g, '')) || 0;
        const yieldB = parseFloat(b.yieldRate.replace(/[^\d.]/g, '')) || 0;
        if (yieldA !== yieldB) return yieldB - yieldA;

        // 3. 收益率相同按时间降序（新的在前）
        const timeA = a.updatedAt || a.createdAt || 0;
        const timeB = b.updatedAt || b.createdAt || 0;
        return timeB - timeA;
      });
    });

    return tenorOrder.map(t => groups[t]).filter(Boolean);
  }, [filteredQuotes]);

  const exportText = useMemo(() => {
    // 按评级排序：大行 > AAA > AA+
    const ratingOrder: Record<string, number> = {
      'BIG': 0,
      'AAA': 1,
      'AA+': 2
    };

    const sortedGroupedQuotes = groupedQuotes.map(g => {
      const sortedItems = [...g.items].sort((a, b) => {
        const ratingA = ratingOrder[a.category] ?? 99;
        const ratingB = ratingOrder[b.category] ?? 99;
        if (ratingA !== ratingB) return ratingA - ratingB;
        // 同评级按收益率排序
        const yieldA = parseFloat(a.yieldRate.replace(/[^\d.]/g, '')) || 0;
        const yieldB = parseFloat(b.yieldRate.replace(/[^\d.]/g, '')) || 0;
        return yieldA - yieldB;
      });
      return { ...g, items: sortedItems };
    });

    return sortedGroupedQuotes.map(g => {
      const header = `(${g.tenor} 到期日 ${g.maturityDate} ${g.maturityWeekday})`;
      const rows = g.items.map(i => {
        const vol = i.volume ? `${i.volume}` : '';
        return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate} ${vol} ${i.remarks}`.trim();
      }).join('\n');
      return `${header}\n${rows}`;
    }).join('\n\n');
  }, [groupedQuotes]);

  // 复制文本到剪贴板（兼容方法）
  const copyToClipboard = (text: string): boolean => {
    // 方法1：现代API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => true).catch(() => false);
      return true;
    }
    // 方法2：兼容方法
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  };

  // 复制选中报价的函数（不带到期日）
  const handleCopySelected = () => {
    // 直接从 allQuotes 中获取选中的项，确保所有视图的数据一致
    const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
    if (selectedItems.length === 0) {
      setCopySuccessMsg('请先选择要复制的报价');
      setTimeout(() => setCopySuccessMsg(''), 2000);
      return;
    }
    const text = selectedItems.map(i => {
      const vol = i.volume ? ` ${i.volume}` : '';
      const remarks = i.remarks ? ` ${i.remarks}` : '';
      return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}${vol}${remarks}`.trim();
    }).join('\n');
    const success = copyToClipboard(text);
    setCopySuccessMsg(success ? `已复制 ${selectedItems.length} 条报价` : '复制失败，请手动复制');
    setTimeout(() => setCopySuccessMsg(''), 2000);
  };

  // 复制选中报价的函数（带到期日，同复制全部格式）
  const handleCopySelectedWithTenor = () => {
    // 直接从 allQuotes 中获取选中的项，确保所有视图的数据一致
    const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
    if (selectedItems.length === 0) {
      setCopySuccessMsg('请先选择要复制的报价');
      setTimeout(() => setCopySuccessMsg(''), 2000);
      return;
    }
    // 按期限分组
    const byTenor: Record<string, typeof selectedItems> = {};
    selectedItems.forEach(item => {
      if (!byTenor[item.tenor]) byTenor[item.tenor] = [];
      byTenor[item.tenor].push(item);
    });

    const tenorOrder = ['1M', '3M', '6M', '9M', '1Y'];
    const text = tenorOrder
      .filter(t => byTenor[t] && byTenor[t].length > 0)
      .map(tenor => {
        const group = groupedQuotes.find(g => g.tenor === tenor);
        const header = `(${tenor} 到期日 ${group?.maturityDate || '--'} ${group?.maturityWeekday || ''})`;
        const rows = byTenor[tenor].map(i => {
          const vol = i.volume ? ` ${i.volume}` : '';
          const remarks = i.remarks ? ` ${i.remarks}` : '';
          return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}${vol}${remarks}`.trim();
        }).join('\n');
        return `${header}\n${rows}`;
      }).join('\n\n');

    const success = copyToClipboard(text);
    setCopySuccessMsg(success ? `已复制 ${selectedItems.length} 条报价（分期限）` : '复制失败，请手动复制');
    setTimeout(() => setCopySuccessMsg(''), 2000);
  };

  const handleCopyAll = () => {
    const success = copyToClipboard(exportText);
    setCopyFeedback(success);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // 批量调整选中报价的收益率（±0.5bp）
  const handleAdjustYield = (adjustment: number) => {
    if (selectedQuotes.size === 0) {
      alert('请先选择要调整的报价');
      return;
    }

    // 推入历史记录
    pushHistory(allQuotes);

    // 根据调整方向确定符号
    const directionSymbol = adjustment > 0 ? '↑' : '↓';

    // 更新选中的报价
    setAllQuotes(prev => prev.map(q => {
      if (!selectedQuotes.has(q.id)) return q;

      // 提取收益率数字（去掉 ↑↓ 符号）
      const currentYield = parseFloat(q.yieldRate.replace(/[↑↓]/g, ''));
      if (isNaN(currentYield)) return q;

      // 调整收益率（0.5bp = 0.005%）
      const newYield = currentYield + adjustment;
      if (newYield < 0) return q; // 不允许负收益率

      // 格式化：最多 4 位小数，至少 2 位
      let formatted = newYield.toFixed(4).replace(/(\.\d{2,})0+$/, '$1');
      if (!formatted.includes('.')) formatted += '.00';
      else if (formatted.split('.')[1].length < 2) formatted = newYield.toFixed(2);

      // 添加方向符号
      return { ...q, yieldRate: formatted + directionSymbol };
    }));

    // 同步更新后端
    selectedQuotes.forEach(async (id) => {
      const quote = allQuotes.find(q => q.id === id);
      if (!quote) return;

      const currentYield = parseFloat(quote.yieldRate.replace(/[↑↓]/g, ''));
      const newYield = currentYield + adjustment;
      if (newYield < 0) return;

      let formatted = newYield.toFixed(4).replace(/(\.\d{2,})0+$/, '$1');
      if (!formatted.includes('.')) formatted += '.00';
      else if (formatted.split('.')[1].length < 2) formatted = newYield.toFixed(2);

      await updateQuotationApi(id, { yieldRate: formatted + directionSymbol });
      emitQuotationUpdate({ ...quote, yieldRate: formatted + directionSymbol });
    });

    // 不清空选中，允许连续调整
  };

  // 复制看板为图片
  const handleCopyCardAsImage = async () => {
    const cardElement = document.getElementById('capture-area');
    if (!cardElement) {
      alert('未找到可复制的看板');
      return;
    }

    try {
      // 使用 html2canvas 截取图片
      const canvas = await html2canvas(cardElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0,
        windowWidth: cardElement.offsetWidth,
        windowHeight: cardElement.offsetHeight,
        logging: false,
        ignoreElements: (element) => {
          // 不排除任何元素
          return false;
        },
        onclone: (clonedDoc) => {
          // 确保克隆的元素没有 overflow 隐藏问题
          const cloned = clonedDoc.getElementById('capture-area');
          if (cloned) {
            cloned.style.overflow = 'visible';
            cloned.style.width = cardElement.offsetWidth + 'px';
          }
        }
      });

      // 转换为 base64 用于预览
      const dataUrl = canvas.toDataURL('image/png');
      setPreviewImage(dataUrl);

      // 同时尝试复制到剪贴板
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          if (navigator.clipboard && navigator.clipboard.write) {
            const item = new ClipboardItem({ 'image/png': blob });
            await navigator.clipboard.write([item]);
            setCopySuccessMsg('已复制图片');
          }
        } catch (err) {
          setCopySuccessMsg('图片已生成，请右键保存或拖拽使用');
        }
        setTimeout(() => setCopySuccessMsg(''), 3000);
      }, 'image/png');
    } catch (error) {
      console.error('截图失败:', error);
      alert('生成图片失败：' + error);
    }
  };

  // 批量删除选中的报价
  const handleDeleteSelected = async () => {
    if (selectedQuotes.size === 0) {
      alert('请先选择要删除的报价');
      return;
    }
    if (!confirm(`确定要删除选中的 ${selectedQuotes.size} 条报价吗？`)) return;

    // 推入历史记录
    pushHistory(allQuotes);

    const idsToDelete = Array.from(selectedQuotes);

    // 先本地更新
    setAllQuotes(prev => prev.filter(q => !selectedQuotes.has(q.id)));
    setSelectedQuotes(new Set());

    // 批量删除后端数据
    try {
      for (const id of idsToDelete) {
        await deleteQuotationApi(id);
        emitQuotationDelete(id);
      }
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败，请检查网络连接');
    }
  };

  // 选中/取消选中（需要 Ctrl 键才能累加选中，否则只选中当前项）
  const toggleSelect = (id: string, isChecked?: boolean, useCtrl = false) => {
    setSelectedQuotes(prev => {
      const newSet = new Set(prev);
      const targetState = isChecked !== undefined ? isChecked : !newSet.has(id);

      if (useCtrl) {
        // Ctrl 模式：累加选中
        if (targetState) {
          newSet.add(id);
        } else {
          newSet.delete(id);
        }
      } else {
        // 默认模式：只选中当前项（清空之前的选中）
        newSet.clear();
        if (targetState) {
          newSet.add(id);
        }
      }
      return newSet;
    });
  };

  // 记录拖动开始的复选框 ID
  const [dragStartId, setDragStartId] = useState<string | null>(null);
  // 记录拖动开始时的所有可见 ID 列表（用于处理排序后的拖曳）
  const [dragStartVisibleIds, setDragStartVisibleIds] = useState<string[]>([]);
  // 记录拖动开始时是否按住了 Ctrl
  const [dragStartWithCtrl, setDragStartWithCtrl] = useState<boolean>(false);
  // 记录当前是否按住 Ctrl 键
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);

  // 监听 Ctrl 键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.ctrlKey) setIsCtrlPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.ctrlKey) setIsCtrlPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // 拖动选择开始
  const handleDragStart = (id: string, isChecked: boolean, visibleIds: string[], isCtrlPressed = false) => {
    setDragStartId(id);
    setDragStartVisibleIds(visibleIds);
    setDragStartWithCtrl(isCtrlPressed);
    setIsDragging(true);
    setDragMode(isChecked ? 'deselect' : 'select');

    // 如果不是 Ctrl 模式，先清空选中
    if (!isCtrlPressed) {
      setSelectedQuotes(new Set());
    }
    // 选中起始项
    setSelectedQuotes(prev => {
      const newSet = new Set(prev);
      if (isChecked) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      return newSet;
    });
  };

  // 拖动经过 - 基于 ID 列表范围选择
  const handleDragEnter = (id: string) => {
    if (!isDragging || dragStartId === null || dragStartVisibleIds.length === 0) return;

    setSelectedQuotes(prev => {
      const newSet = new Set(prev);
      const startIndex = dragStartVisibleIds.indexOf(dragStartId);
      const endIndex = dragStartVisibleIds.indexOf(id);
      if (startIndex === -1 || endIndex === -1) return newSet;

      const start = Math.min(startIndex, endIndex);
      const end = Math.max(startIndex, endIndex);

      const rangeIds = dragStartVisibleIds.slice(start, end + 1);

      for (const cid of rangeIds) {
        if (dragMode === 'select') {
          newSet.add(cid);
        } else {
          newSet.delete(cid);
        }
      }
      return newSet;
    });
  };

  // 拖动结束
  const handleDragEnd = () => {
    setIsDragging(false);
    setDragStartId(null);
    setDragStartVisibleIds([]);
    // 拖曳结束后自动复制选中的内容
    setTimeout(() => {
      if (activeTab === 'TEXT') {
        // 文字版：使用分期限格式复制
        const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
        if (selectedItems.length > 0) {
          // 按期限分组复制
          const byTenor: Record<string, typeof selectedItems> = {};
          for (const item of selectedItems) {
            const tenorKey = item.tenor;
            if (!byTenor[tenorKey]) byTenor[tenorKey] = [];
            byTenor[tenorKey].push(item);
          }
          let text = '';
          const tenorOrder = ['1M', '3M', '6M', '9M', '1Y'];
          for (const tenor of tenorOrder) {
            if (byTenor[tenor] && byTenor[tenor].length > 0) {
              text += `(${tenor} 到期日 ${byTenor[tenor][0].maturityDate} ${byTenor[tenor][0].maturityWeekday})\n`;
              for (const item of byTenor[tenor]) {
                const vol = item.volume ? ` ${item.volume}` : '';
                const remarks = item.remarks ? ` ${item.remarks}` : '';
                text += `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${vol}${remarks}\n`;
              }
            }
          }
          copyToClipboard(text.trim());
          setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
          setTimeout(() => setCopySuccessMsg(''), 1500);
        }
      } else if (activeTab === 'LIST') {
        // 单条更新：使用纯文本格式复制
        const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
        if (selectedItems.length > 0) {
          const text = selectedItems.map(i => {
            const vol = i.volume ? ` ${i.volume}` : '';
            const remarks = i.remarks ? ` ${i.remarks}` : '';
            return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}${vol}${remarks}`.trim();
          }).join('\n');
          copyToClipboard(text);
          setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
          setTimeout(() => setCopySuccessMsg(''), 1500);
        }
      }
    }, 0);
  };

  // 全局鼠标抬起事件，结束拖动
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragStartId(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const selectAll = () => {
    setSelectedQuotes(new Set(filteredQuotes.map(q => q.id)));
  };

  const cancelSelectAll = () => {
    setSelectedQuotes(new Set());
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 text-white p-1.5 rounded-xl font-bold text-lg">NCD.AI</div>
          <h1 className="text-base font-bold text-slate-800">专业报价管理系统</h1>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
            {isConnected ? '● 已连接' : '○ 未连接'}
          </span>
          <span className="text-[9px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded ml-2">v{APP_VERSION}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${history.length > 0 ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
            title="撤销上一步操作"
          >
            ↶ 撤销
          </button>
          <div className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">起息周几:</span>
            <input value={valueWeekday} onChange={e => setValueWeekday(e.target.value)} className="bg-transparent w-6 text-indigo-600 font-bold border-none outline-none text-xs text-center" />
          </div>
          <button onClick={handleCopySelected} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all" title="只复制选中的报价内容">
            复制选中 ({selectedQuotes.size})
          </button>
          <button onClick={handleCopySelectedWithTenor} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-500 text-white hover:bg-indigo-600 transition-all" title="复制选中报价，带到期期限行">
            复制选中分期限
          </button>
          <button onClick={handleDeleteSelected} disabled={selectedQuotes.size === 0} className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${selectedQuotes.size > 0 ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
            删除选中
          </button>
          <button onClick={handleCopyCardAsImage} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-all">
            生成图片
          </button>
          <button
            onClick={() => {
              setIsMaturityPanelCollapsed(!isMaturityPanelCollapsed);
              // 当面板从折叠变为展开时，清除手动扩展状态
              if (!isMaturityPanelCollapsed) setIsVisualCardManuallyExpanded(null);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${isMaturityPanelCollapsed ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            title={isMaturityPanelCollapsed ? '展开同步到期日' : '折叠同步到期日'}
          >
            {isMaturityPanelCollapsed ? '▶ 到期日' : '▼ 到期日'}
          </button>
          <button
            onClick={() => {
              setIsQuotePanelCollapsed(!isQuotePanelCollapsed);
              // 当面板从折叠变为展开时，清除手动扩展状态
              if (!isQuotePanelCollapsed) setIsVisualCardManuallyExpanded(null);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${isQuotePanelCollapsed ? 'bg-indigo-500 text-white hover:bg-indigo-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            title={isQuotePanelCollapsed ? '展开解析报价' : '折叠解析报价'}
          >
            {isQuotePanelCollapsed ? '▶ 解析报价' : '▼ 解析报价'}
          </button>
          <div className="flex items-center gap-1 border-l border-slate-300 pl-3 ml-1">
            <button
              onClick={() => handleAdjustYield(0.005)}
              disabled={selectedQuotes.size === 0}
              className={`px-2 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedQuotes.size > 0 ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
              title="选中收益率 +0.5bp"
            >
              ↑+0.5bp
            </button>
            <button
              onClick={() => handleAdjustYield(-0.005)}
              disabled={selectedQuotes.size === 0}
              className={`px-2 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedQuotes.size > 0 ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
              title="选中收益率 -0.5bp"
            >
              ↓-0.5bp
            </button>
          </div>
          <button onClick={handleCopyAll} className={`px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg transition-all ${copyFeedback ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
            {copyFeedback ? '复制成功' : '复制全部'}
          </button>
          {copySuccessMsg && <span className="text-emerald-500 text-xs font-bold self-center">{copySuccessMsg}</span>}
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 grid grid-cols-12 gap-6 w-full">
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* 同步到期日面板 - 可折叠 */}
          {!isMaturityPanelCollapsed && (
            <section className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span> 1. 同步到期日
              </h2>
              <textarea
                value={maturityInput}
                onChange={e => setMaturityInput(e.target.value)}
                className="w-full h-16 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none focus:border-orange-200 transition-all resize-none"
                placeholder="粘贴包含 (1M 到期日 2025/10/16 周四) 的文本..."
              ></textarea>
              <button onClick={handleSyncMaturity} className="w-full mt-2 py-1.5 bg-orange-50 text-orange-600 rounded-xl text-xs font-bold hover:bg-orange-100">解析到期日</button>
            </section>
          )}

          {recognizedMaturities.length > 0 && (
            <div className="bg-slate-900 p-4 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4">
              <h3 className="text-[10px] font-bold text-slate-400 mb-3 uppercase tracking-widest">解析结果确认 - 可编辑 ({recognizedMaturities.length})</h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar text-white">
                {recognizedMaturities.map((m, i) => (
                  <div key={i} className="bg-slate-800 p-2 rounded-xl border border-slate-700">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500">期限</label>
                        <input
                          className="w-12 bg-slate-700 text-white text-xs font-bold px-1.5 py-0.5 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={m.tenor}
                          onChange={(e) => {
                            const newMaturities = [...recognizedMaturities];
                            newMaturities[i] = { ...newMaturities[i], tenor: e.target.value.toUpperCase() };
                            setRecognizedMaturities(newMaturities);
                          }}
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500">日期</label>
                        <input
                          type="text"
                          className="w-24 bg-slate-700 text-white text-xs font-bold px-1.5 py-0.5 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={m.date}
                          onChange={(e) => {
                            const newMaturities = [...recognizedMaturities];
                            newMaturities[i] = { ...newMaturities[i], date: e.target.value };
                            setRecognizedMaturities(newMaturities);
                          }}
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500">星期</label>
                        <select
                          className="w-16 bg-slate-700 text-white text-xs font-bold px-1.5 py-0.5 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={m.weekday}
                          onChange={(e) => {
                            const newMaturities = [...recognizedMaturities];
                            newMaturities[i] = { ...newMaturities[i], weekday: e.target.value };
                            setRecognizedMaturities(newMaturities);
                          }}
                        >
                          <option value="">星期</option>
                          <option value="周一">周一</option>
                          <option value="周二">周二</option>
                          <option value="周三">周三</option>
                          <option value="周四">周四</option>
                          <option value="周五">周五</option>
                          <option value="周六">周六</option>
                          <option value="周日">周日</option>
                        </select>
                      </div>
                      <button
                        onClick={() => {
                          const newMaturities = recognizedMaturities.filter((_, idx) => idx !== i);
                          setRecognizedMaturities(newMaturities);
                        }}
                        className="text-red-400 hover:text-red-300 text-xs ml-auto"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setRecognizedMaturities([])}
                  className="flex-1 py-2 bg-slate-700 text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-600"
                >
                  取消
                </button>
                <button onClick={handleConfirmMaturity} className="flex-1 py-2 bg-emerald-500 text-white rounded-xl text-xs font-bold hover:bg-emerald-400">
                  确认发布
                </button>
              </div>
            </div>
          )}

          {!isQuotePanelCollapsed && (
            <section className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
             <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
               <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span> 2. 解析新报价
             </h2>
             <textarea
               value={inputText}
               onChange={e => setInputText(e.target.value)}
               className="w-full h-32 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:border-indigo-200 transition-all resize-none"
               placeholder="可一次粘贴多条，格式: 兴业银行 AAA 周一 6M 1.62%，支持多行、逗号分隔"
             ></textarea>
             <button
               disabled={isParsing}
               onClick={handleParse}
               className="w-full mt-3 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-xl hover:bg-indigo-700 transition-all disabled:opacity-50"
             >
               {isParsing ? '正在解析...' : '解析报价'}
             </button>
          </section>
          )}

          {/* 解析报价结果 - 可折叠 */}
          {!isQuotePanelCollapsed && recognizedQuotes.length > 0 && (
            <div className="bg-slate-900 p-4 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4">
              <h3 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-widest">解析结果确认 - 可编辑 ({recognizedQuotes.length})</h3>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar text-white">
                {recognizedQuotes.map((q, i) => (
                  <div key={i} className="bg-slate-800 p-2 rounded-xl border border-slate-700">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {/* 银行名 */}
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500">银行</label>
                        <input
                          className="w-20 bg-slate-700 text-white text-xs font-bold px-1.5 py-0.5 rounded outline-none focus:ring-1 focus:ring-indigo-500"
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
                        <label className="text-[9px] text-slate-500">期限</label>
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
                        <label className="text-[9px] text-slate-500">收益率(%)</label>
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
                        <label className="text-[9px] text-slate-500">评级</label>
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
                          
                        </select>
                      </div>
                      {/* 类别 */}
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500">类别</label>
                        <select
                          className="bg-slate-700 text-white text-sm px-2 py-1 rounded outline-none focus:ring-1 focus:ring-indigo-500"
                          value={q.category || 'BIG'}
                          onChange={(e) => {
                            const newQuotes = [...recognizedQuotes];
                            newQuotes[i] = { ...newQuotes[i], category: e.target.value };
                            setRecognizedQuotes(newQuotes);
                          }}
                        >
                          <option value="BIG">大行</option>
                          <option value="AAA">AAA</option>
                          <option value="AA+">AA+</option>
                          
                        </select>
                      </div>
                      {/* 星期 */}
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500">报价日</label>
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
                 <button onClick={() => setActiveTab('LIST')} className={`px-6 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === 'LIST' ? 'bg-white shadow text-slate-900' : 'text-slate-400'}`}>单条更新</button>
               </div>

               <div className="flex flex-wrap gap-1.5 items-center">
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
                    <option value="BIG">大行</option>
                    <option value="AAA">AAA</option>
                    <option value="AA+">AA+</option>
                    
                 </select>
                 <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'YIELD' | 'TIME')}
                  className="bg-slate-50 border border-slate-200 px-2 py-2 rounded-xl text-xs"
                  title="排序方式"
                 >
                    <option value="YIELD">收益率排序</option>
                    <option value="TIME">时间排序</option>
                 </select>
                 <button onClick={() => setSortOrder(o => o === 'ASC' ? 'DESC' : 'ASC')} className="p-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors" title="倒序/正序">
                    <svg className={`w-4 h-4 text-slate-500 transition-transform ${sortOrder === 'ASC' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="2" /></svg>
                 </button>
                 <button onClick={handleRefresh} className="p-2 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition-colors" title="刷新数据">
                    <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                 </button>
               </div>
            </div>

            {activeTab === 'VISUAL' && (
              <VisualCard
                groupedQuotes={groupedQuotes}
                onEditMaturity={handleUpdateMaturity}
                expanded={isVisualCardExpanded}
                onToggleExpand={toggleVisualCardExpand}
              />
            )}

            {activeTab === 'TEXT' && (
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex-1 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center mb-6 shrink-0">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">文字版 (自动保存)</h3>
                    <div className="flex gap-2">
                      <button onClick={selectAll} className="text-[10px] font-bold text-indigo-400 hover:text-indigo-600">
                        全选
                      </button>
                      <button onClick={cancelSelectAll} className="text-[10px] font-bold text-slate-400 hover:text-slate-600">
                        取消全选
                      </button>
                    </div>
                  </div>
                  <button onClick={async () => {if(confirm('清空所有？')) {await deleteAllQuotations(); setAllQuotes([]);}}} className="text-[10px] font-bold text-red-400 hover:text-red-600 uppercase">Clear All</button>
                </div>
                <div className="space-y-6 flex-1 overflow-y-auto">
                  {groupedQuotes.map((group, groupIdx) => (
                    <div key={groupIdx} className="font-mono text-sm">
                      <div className="text-indigo-600 font-bold mb-3 flex items-center sticky top-0 bg-slate-50 z-10">
                        <span className="bg-indigo-50 px-2 py-0.5 rounded text-[10px] whitespace-nowrap">({group.tenor} 到期日 {group.maturityDate} {group.maturityWeekday})</span>
                        <div className="h-px bg-slate-200 flex-1 ml-2"></div>
                      </div>
                      <div className="space-y-1">
                        {group.items.map((item, itemIdx) => {
                          const isSelected = selectedQuotes.has(item.id);
                          // 双击编辑模式 - 只有在 editingId 匹配时才可编辑
                          const isEditable = editingId === item.id;
                          // 当前组内的 ID 列表（用于拖曳选择）
                          const groupIds = group.items.map(i => i.id);
                          return (
                          <div key={item.id} className={`flex flex-nowrap gap-1 items-center group py-1 px-2 rounded transition-colors ${
                            isSelected ? 'bg-indigo-100 border border-indigo-300' : 'hover:bg-white'
                          }`}
                            onClick={(e) => {
                              // 点击行任意位置：切换选中 + 复制（Ctrl+ 点击累加选中）
                              e.stopPropagation();
                              const isCtrl = e.ctrlKey;
                              toggleSelect(item.id, undefined, isCtrl);
                              // 复制逻辑：Ctrl+ 点击复制所有选中的项，单击只复制当前行
                              setTimeout(() => {
                                if (isCtrl) {
                                  // Ctrl+ 点击：复制所有选中的项（分期限格式）
                                  const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
                                  if (selectedItems.length > 0) {
                                    const byTenor: Record<string, typeof selectedItems> = {};
                                    for (const selItem of selectedItems) {
                                      const tenorKey = selItem.tenor;
                                      if (!byTenor[tenorKey]) byTenor[tenorKey] = [];
                                      byTenor[tenorKey].push(selItem);
                                    }
                                    let text = '';
                                    const tenorOrder = ['1M', '3M', '6M', '9M', '1Y'];
                                    for (const tenor of tenorOrder) {
                                      if (byTenor[tenor] && byTenor[tenor].length > 0) {
                                        text += `(${tenor} 到期日 ${byTenor[tenor][0].maturityDate} ${byTenor[tenor][0].maturityWeekday})\n`;
                                        for (const selItem of byTenor[tenor]) {
                                          const vol = selItem.volume ? ` ${selItem.volume}` : '';
                                          const remarks = selItem.remarks ? ` ${selItem.remarks}` : '';
                                          text += `${selItem.bankName} ${selItem.rating} ${selItem.weekday} ${selItem.tenor} ${selItem.yieldRate}${vol}${remarks}\n`;
                                        }
                                      }
                                    }
                                    copyToClipboard(text.trim());
                                    setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
                                    setTimeout(() => setCopySuccessMsg(''), 1500);
                                  }
                                } else {
                                  // 单击：只复制当前行
                                  const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                                  copyToClipboard(text);
                                  setCopySuccessMsg('已复制');
                                  setTimeout(() => setCopySuccessMsg(''), 1500);
                                }
                              }, 0);
                            }}
                            onMouseDown={(e) => {
                              // 按下鼠标开始拖曳（Ctrl+ 拖曳累加选中）
                              e.preventDefault();
                              e.stopPropagation();
                              handleDragStart(item.id, isSelected, groupIds, e.ctrlKey);
                            }}
                            onMouseEnter={() => {
                              handleDragEnter(item.id);
                            }}
                            onMouseUp={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDragEnd();
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                e.stopPropagation();
                                const isCtrl = e.ctrlKey;
                                // 拖曳过程中不调用 toggleSelect，避免清空选中
                                if (!isDragging) {
                                  toggleSelect(item.id, e.target.checked, isCtrl);
                                }
                                // 复制逻辑：Ctrl+ 单击复制所有选中的项，单击只复制当前行
                                setTimeout(() => {
                                  if (isCtrl) {
                                    // Ctrl+ 单击：复制所有选中的项（分期限格式）
                                    const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
                                    if (selectedItems.length > 0) {
                                      const byTenor: Record<string, typeof selectedItems> = {};
                                      for (const selItem of selectedItems) {
                                        const tenorKey = selItem.tenor;
                                        if (!byTenor[tenorKey]) byTenor[tenorKey] = [];
                                        byTenor[tenorKey].push(selItem);
                                      }
                                      let text = '';
                                      const tenorOrder = ['1M', '3M', '6M', '9M', '1Y'];
                                      for (const tenor of tenorOrder) {
                                        if (byTenor[tenor] && byTenor[tenor].length > 0) {
                                          text += `(${tenor} 到期日 ${byTenor[tenor][0].maturityDate} ${byTenor[tenor][0].maturityWeekday})\n`;
                                          for (const selItem of byTenor[tenor]) {
                                            const vol = selItem.volume ? ` ${selItem.volume}` : '';
                                            const remarks = selItem.remarks ? ` ${selItem.remarks}` : '';
                                            text += `${selItem.bankName} ${selItem.rating} ${selItem.weekday} ${selItem.tenor} ${selItem.yieldRate}${vol}${remarks}\n`;
                                          }
                                        }
                                      }
                                      copyToClipboard(text.trim());
                                      setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
                                      setTimeout(() => setCopySuccessMsg(''), 1500);
                                    }
                                  } else {
                                    // 单击：只复制当前行
                                    const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                                    copyToClipboard(text);
                                    setCopySuccessMsg('已复制');
                                    setTimeout(() => setCopySuccessMsg(''), 1500);
                                  }
                                }, 0);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(item.id, isSelected, groupIds, e.ctrlKey);
                              }}
                              onMouseEnter={(e) => {
                                handleDragEnter(item.id);
                              }}
                              onMouseUp={(e) => {
                                e.stopPropagation();
                                handleDragEnd();
                              }}
                              className="w-3.5 h-3.5 text-indigo-600 rounded shrink-0 cursor-pointer"
                              title="点击选中，或拖曳批量选择"
                            />
                            <input
                              className="w-20 font-bold bg-transparent border-none focus:bg-white outline-none p-0 text-slate-900 text-[10px] shrink-0"
                              value={item.bankName}
                              readOnly={!isEditable}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingId(item.id);
                                (e.target as HTMLInputElement).focus();
                              }}
                              onBlur={() => setEditingId(null)}
                              onChange={e => handleUpdateQuote(item.id, 'bankName', e.target.value)}
                              data-bank-name={item.id}
                            />
                            <select
                              className="w-10 text-slate-400 text-[9px] bg-transparent outline-none cursor-pointer shrink-0"
                              value={item.rating}
                              disabled={!isEditable}
                              onBlur={() => setEditingId(null)}
                              onChange={e => {
                                e.stopPropagation();
                                handleUpdateQuote(item.id, 'rating', e.target.value);
                              }}
                            >
                              <option value="AAA">AAA</option>
                              <option value="AA+">AA+</option>
                              <option value="AA-">AA-</option>
                            </select>
                            <select
                              className="w-14 text-[8px] px-0.5 py-0.5 rounded font-bold cursor-pointer outline-none bg-white border border-slate-200 shrink-0"
                              value={item.category}
                              disabled={!isEditable}
                              onBlur={() => setEditingId(null)}
                              onChange={e => {
                                e.stopPropagation();
                                handleUpdateQuote(item.id, 'category', e.target.value as any);
                              }}
                            >
                              <option value="BIG">大行&国股</option>
                              <option value="AAA">AAA 城农商</option>
                              <option value="AA+">AA+</option>
                              <option value="AA-">AA-</option>
                            </select>
                            <input className="w-5 text-slate-400 text-[8px] bg-transparent shrink-0" value={item.weekday} readOnly={!isEditable} onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }} onBlur={() => setEditingId(null)} onChange={e => handleUpdateQuote(item.id, 'weekday', e.target.value)} />
                            <input
                              className={`w-14 font-bold text-right outline-none bg-transparent text-[10px] shrink-0 ${item.yieldRate.includes('↑') ? 'text-red-600' : item.yieldRate.includes('↓') ? 'text-emerald-600' : 'text-blue-600'}`}
                              value={isEditable ? editingYieldRate : item.yieldRate.replace(/%|↑|↓/g, '')}
                              placeholder="收益率"
                              readOnly={!isEditable}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingId(item.id);
                                // 初始化编辑值为当前值
                                setEditingYieldRate(item.yieldRate.replace(/%|↑|↓/g, ''));
                                const input = (e.target as HTMLInputElement);
                                input.focus();
                              }}
                              onBlur={(e) => {
                                setEditingId(null);
                                // 失去焦点时提交最终值
                                const val = e.target.value.replace(/[^\d.]/g, '');
                                if (val && val !== item.yieldRate.replace(/%|↑|↓/g, '')) {
                                  handleUpdateQuote(item.id, 'yieldRate', val);
                                }
                                setEditingYieldRate('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.stopPropagation();
                                  // 先提交值再退出
                                  const val = (e.target as HTMLInputElement).value.replace(/[^\d.]/g, '');
                                  if (val && val !== item.yieldRate.replace(/%|↑|↓/g, '')) {
                                    handleUpdateQuote(item.id, 'yieldRate', val);
                                  }
                                  setEditingId(null);
                                  setEditingYieldRate('');
                                  // 选中并复制
                                  toggleSelect(item.id);
                                  const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                                  copyToClipboard(text);
                                  setCopySuccessMsg('已复制');
                                  setTimeout(() => setCopySuccessMsg(''), 1500);
                                }
                              }}
                              onChange={(e) => {
                                // 更新本地编辑状态，允许自由编辑
                                const val = e.target.value.replace(/[^\d.]/g, '');
                                setEditingYieldRate(val);
                              }}
                            />
                            <input
                              className="w-14 text-slate-400 text-[8px] text-center bg-transparent shrink-0"
                              value={item.volume ? item.volume.replace(/亿 | 元/g, '') : ''}
                              placeholder="量"
                              readOnly={!isEditable}
                              onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }}
                              onBlur={() => setEditingId(null)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.stopPropagation();
                                  setEditingId(null);
                                  toggleSelect(item.id);
                                  const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                                  copyToClipboard(text);
                                  setCopySuccessMsg('已复制');
                                  setTimeout(() => setCopySuccessMsg(''), 1500);
                                }
                              }}
                              onChange={e => {
                                const val = e.target.value.replace(/[^0-9.]/g, '');
                                handleUpdateQuote(item.id, 'volume', val ? val + '亿元' : '');
                              }}
                            />
                            <input
                              className="w-20 text-slate-400 italic text-[8px] truncate bg-transparent shrink-0"
                              value={item.remarks || ''}
                              placeholder="备注"
                              readOnly={!isEditable}
                              onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }}
                              onBlur={() => setEditingId(null)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.stopPropagation();
                                  setEditingId(null);
                                  toggleSelect(item.id);
                                  const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                                  copyToClipboard(text);
                                  setCopySuccessMsg('已复制');
                                  setTimeout(() => setCopySuccessMsg(''), 1500);
                                }
                              }}
                              onChange={e => handleUpdateQuote(item.id, 'remarks', e.target.value)}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteQuote(item.id);
                              }}
                              className="text-red-300 hover:text-red-500 transition-all text-[9px] font-bold shrink-0 ml-auto"
                              title="删除"
                            >
                              删除
                            </button>
                          </div>
                        );
                        })}
                      </div>
                    </div>
                  ))}
                  {groupedQuotes.length === 0 && <div className="text-center text-slate-300 py-20 italic">暂无报价数据</div>}
                </div>
              </div>
            )}

            {activeTab === 'LIST' && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex-1 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">单条价格更新 (实时)</h3>
                    <div className="flex gap-2">
                      <button onClick={selectAll} className="text-[9px] font-bold text-indigo-400 hover:text-indigo-600">
                        全选
                      </button>
                      <button onClick={cancelSelectAll} className="text-[9px] font-bold text-slate-400 hover:text-slate-600">
                        取消全选
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={listSortBy}
                      onChange={e => setListSortBy(e.target.value as 'TIME' | 'YIELD')}
                      className="bg-white border border-slate-200 px-2 py-1.5 rounded-lg text-[9px] font-bold"
                    >
                      <option value="TIME">按时间</option>
                      <option value="YIELD">按收益率</option>
                    </select>
                    <button
                      onClick={() => setListSortOrder(o => o === 'ASC' ? 'DESC' : 'ASC')}
                      className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
                      title="倒序/正序"
                    >
                      <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${listSortOrder === 'ASC' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="2" /></svg>
                    </button>
                    <button onClick={async () => {if(confirm('清空所有？')) {await deleteAllQuotations(); setAllQuotes([]);}}} className="text-[9px] font-bold text-red-400 hover:text-red-600 uppercase">Clear All</button>
                  </div>
                </div>
                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {sortedListQuotes.map((item, idx) => {
                    const isSelected = selectedQuotes.has(item.id);
                    // 双击编辑模式 - 只有在 editingId 匹配时才可编辑
                    const isEditable = editingId === item.id;
                    // 当前可见的 ID 列表（用于拖曳选择）
                    const visibleIds = sortedListQuotes.map(i => i.id);
                    return (
                      <div
                        key={item.id}
                        className={`flex flex-nowrap gap-1 items-center group py-1 px-2 rounded transition-colors ${
                          isSelected
                            ? 'bg-indigo-100 border border-indigo-300'
                            : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                        }`}
                        onClick={(e) => {
                          // 点击行任意位置：切换选中 + 复制（Ctrl+ 点击累加选中）
                          e.stopPropagation();
                          const isCtrl = e.ctrlKey;
                          toggleSelect(item.id, undefined, isCtrl);
                          // 复制逻辑：Ctrl+ 点击复制所有选中的项，单击只复制当前行
                          setTimeout(() => {
                            if (isCtrl) {
                              // Ctrl+ 点击：复制所有选中的项（纯文本格式）
                              const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
                              if (selectedItems.length > 0) {
                                const text = selectedItems.map(i => {
                                  const vol = i.volume ? ` ${i.volume}` : '';
                                  const remarks = i.remarks ? ` ${i.remarks}` : '';
                                  return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}${vol}${remarks}`.trim();
                                }).join('\n');
                                copyToClipboard(text);
                                setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
                                setTimeout(() => setCopySuccessMsg(''), 1500);
                              }
                            } else {
                              // 单击：只复制当前行
                              const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                              copyToClipboard(text);
                              setCopySuccessMsg('已复制');
                              setTimeout(() => setCopySuccessMsg(''), 1500);
                            }
                          }, 0);
                        }}
                        onDoubleClick={(e) => {
                          // 双击进入编辑模式
                          e.stopPropagation();
                          e.preventDefault();
                          setEditingId(item.id);
                          // 聚焦到第一个输入框
                          setTimeout(() => {
                            const input = document.querySelector(`input[data-bank-name-list="${item.id}"]`) as HTMLInputElement;
                            if (input) input.focus();
                          }, 0);
                        }}
                        onMouseDown={(e) => {
                          // 按下鼠标开始拖曳（Ctrl+ 拖曳累加选中）
                          e.preventDefault();
                          e.stopPropagation();
                          handleDragStart(item.id, isSelected, visibleIds, e.ctrlKey);
                        }}
                        onMouseEnter={() => {
                          handleDragEnter(item.id);
                        }}
                        onMouseUp={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDragEnd();
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            const isCtrl = e.ctrlKey;
                            // 拖曳过程中不调用 toggleSelect，避免清空选中
                            if (!isDragging) {
                              toggleSelect(item.id, e.target.checked, isCtrl);
                            }
                            // 复制逻辑：Ctrl+ 单击复制所有选中的项，单击只复制当前行
                            setTimeout(() => {
                              if (isCtrl) {
                                // Ctrl+ 单击：复制所有选中的项（纯文本格式）
                                const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
                                if (selectedItems.length > 0) {
                                  const text = selectedItems.map(i => {
                                    const vol = i.volume ? ` ${i.volume}` : '';
                                    const remarks = i.remarks ? ` ${i.remarks}` : '';
                                    return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}${vol}${remarks}`.trim();
                                  }).join('\n');
                                  copyToClipboard(text);
                                  setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
                                  setTimeout(() => setCopySuccessMsg(''), 1500);
                                }
                              } else {
                                // 单击：只复制当前行
                                const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                                copyToClipboard(text);
                                setCopySuccessMsg('已复制');
                                setTimeout(() => setCopySuccessMsg(''), 1500);
                              }
                            }, 0);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleDragStart(item.id, isSelected, visibleIds, e.ctrlKey);
                          }}
                          onMouseEnter={(e) => {
                            handleDragEnter(item.id);
                          }}
                          onMouseUp={(e) => {
                            e.stopPropagation();
                            handleDragEnd();
                          }}
                          className={`w-3.5 h-3.5 text-indigo-600 rounded cursor-pointer shrink-0 ${isDragging ? 'select-none' : ''}`}
                          title="点击选中，或拖曳批量选择 (Ctrl+ 点击累加)"
                        />
                        <span className="text-[8px] text-slate-400 font-mono w-14 shrink-0">{new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleTimeString('zh-CN', {hour12:false, hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
                        <input
                          className="w-20 font-bold bg-transparent border-none focus:bg-white outline-none p-0 text-slate-900 text-[10px] shrink-0"
                          value={item.bankName}
                          readOnly={!isEditable}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingId(item.id);
                            (e.target as HTMLInputElement).focus();
                          }}
                          onBlur={() => setEditingId(null)}
                          onChange={e => handleUpdateQuote(item.id, 'bankName', e.target.value)}
                          data-bank-name-list={item.id}
                        />
                        <select
                          className="w-10 text-slate-400 text-[9px] bg-transparent outline-none cursor-pointer shrink-0"
                          value={item.rating}
                          disabled={!isEditable}
                          onBlur={() => setEditingId(null)}
                          onChange={e => {
                            e.stopPropagation();
                            handleUpdateQuote(item.id, 'rating', e.target.value);
                          }}
                        >
                          <option value="AAA">AAA</option>
                          <option value="AA+">AA+</option>
                          <option value="AA-">AA-</option>
                        </select>
                        <select
                          className="w-14 text-[8px] px-0.5 py-0.5 rounded font-bold cursor-pointer outline-none bg-white border border-slate-200 shrink-0"
                          value={item.category}
                          disabled={!isEditable}
                          onBlur={() => setEditingId(null)}
                          onChange={e => {
                            e.stopPropagation();
                            handleUpdateQuote(item.id, 'category', e.target.value as any);
                          }}
                        >
                          <option value="BIG">大行&国股</option>
                          <option value="AAA">AAA 城农商</option>
                          <option value="AA+">AA+</option>
                          <option value="AA-">AA-</option>
                        </select>
                        <input className="w-5 text-slate-400 text-[8px] bg-transparent shrink-0" value={item.weekday} readOnly={!isEditable} onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }} onBlur={() => setEditingId(null)} onChange={e => handleUpdateQuote(item.id, 'weekday', e.target.value)} />
                        <input className="w-10 text-slate-400 text-[8px] bg-transparent shrink-0" value={item.tenor} readOnly={!isEditable} onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }} onBlur={() => setEditingId(null)} onChange={e => handleUpdateQuote(item.id, 'tenor', e.target.value)} />
                        <input
                          className={`w-14 font-bold text-right outline-none bg-transparent text-[10px] shrink-0 ${item.yieldRate.includes('↑') ? 'text-red-600' : item.yieldRate.includes('↓') ? 'text-emerald-600' : 'text-blue-600'}`}
                          value={isEditable ? editingYieldRate : item.yieldRate.replace(/%|↑|↓/g, '')}
                          placeholder="收益率"
                          readOnly={!isEditable}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingId(item.id);
                            // 初始化编辑值为当前值
                            setEditingYieldRate(item.yieldRate.replace(/%|↑|↓/g, ''));
                            const input = (e.target as HTMLInputElement);
                            input.focus();
                          }}
                          onBlur={(e) => {
                            setEditingId(null);
                            // 失去焦点时提交最终值
                            const val = e.target.value.replace(/[^\d.]/g, '');
                            if (val && val !== item.yieldRate.replace(/%|↑|↓/g, '')) {
                              handleUpdateQuote(item.id, 'yieldRate', val);
                            }
                            setEditingYieldRate('');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              // 先提交值再退出
                              const val = (e.target as HTMLInputElement).value.replace(/[^\d.]/g, '');
                              if (val && val !== item.yieldRate.replace(/%|↑|↓/g, '')) {
                                handleUpdateQuote(item.id, 'yieldRate', val);
                              }
                              setEditingId(null);
                              setEditingYieldRate('');
                              // 选中并复制
                              toggleSelect(item.id);
                              const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                              copyToClipboard(text);
                              setCopySuccessMsg('已复制');
                              setTimeout(() => setCopySuccessMsg(''), 1500);
                            }
                          }}
                          onChange={(e) => {
                            // 更新本地编辑状态，允许自由编辑
                            const val = e.target.value.replace(/[^\d.]/g, '');
                            setEditingYieldRate(val);
                          }}
                        />
                        <input
                          className="w-14 text-slate-400 text-[8px] text-center bg-transparent shrink-0"
                          value={item.volume ? item.volume.replace(/亿 | 元/g, '') : ''}
                          placeholder="量"
                          readOnly={!isEditable}
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              setEditingId(null);
                              toggleSelect(item.id);
                              const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                              copyToClipboard(text);
                              setCopySuccessMsg('已复制');
                              setTimeout(() => setCopySuccessMsg(''), 1500);
                            }
                          }}
                          onChange={e => {
                            const val = e.target.value.replace(/[^0-9.]/g, '');
                            handleUpdateQuote(item.id, 'volume', val ? val + '亿元' : '');
                          }}
                        />
                        <input
                          className="w-20 text-slate-400 italic text-[8px] truncate bg-transparent shrink-0"
                          value={item.remarks || ''}
                          placeholder="备注"
                          readOnly={!isEditable}
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              setEditingId(null);
                              toggleSelect(item.id);
                              const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                              copyToClipboard(text);
                              setCopySuccessMsg('已复制');
                              setTimeout(() => setCopySuccessMsg(''), 1500);
                            }
                          }}
                          onChange={e => handleUpdateQuote(item.id, 'remarks', e.target.value)}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteQuote(item.id);
                          }}
                          className="text-red-300 hover:text-red-500 transition-all text-[8px] font-bold shrink-0 ml-auto"
                        >
                          删除
                        </button>
                      </div>
                    );
                  })}
                  {sortedListQuotes.length === 0 && <div className="text-center text-slate-300 py-20 italic">暂无报价数据</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {previewImage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-8" onClick={() => setPreviewImage(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-900">看板图片预览</h3>
                <p className="text-[10px] text-slate-400 mt-1">右键点击图片可复制，或拖拽到微信/钉钉发送</p>
              </div>
              <button onClick={() => setPreviewImage(null)} className="text-slate-400 hover:text-slate-600 text-2xl">×</button>
            </div>
            <div className="p-6 bg-slate-50 flex justify-center">
              <img src={previewImage} alt="看板预览" className="max-w-full h-auto shadow-lg" />
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-between items-center bg-white rounded-b-2xl">
              <span className="text-[10px] text-slate-400">生成时间：{new Date().toLocaleString('zh-CN')}</span>
              <div className="flex gap-2">
                <button onClick={() => {
                  const link = document.createElement('a');
                  link.download = `ncd-quotation-${Date.now()}.png`;
                  link.href = previewImage;
                  link.click();
                }} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700">
                  下载到本地
                </button>
                <button onClick={() => setPreviewImage(null)} className="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-300">
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="p-8 text-center text-[10px] text-slate-300 font-bold uppercase tracking-widest">
        Professional NCD Engine • 智能解析 • 多人实时协作 <span className="text-slate-500">| v{APP_VERSION}</span>
      </footer>
    </div>
  );
};

export default App;
