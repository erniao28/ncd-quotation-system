
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Quotation, GroupedQuotation, MaturityInfo } from './types';
import { parseQuotations, parseMaturityDates, normalizeOcrText } from './services/parser';
import { parseBoard } from './services/boardParser';
import { VisualCard } from './components/VisualCard';
import { DataSupport } from './DataSupport';
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
  emitMaturityUpdate,
  ocrImage,
  ocrBoard
} from './services/api';
import html2canvas from 'html2canvas';

const APP_VERSION = '20261116'; // 版本号：YYYYMMDD 格式

const App: React.FC = () => {
  // 视图模式：'quote' = 报价系统，'data' = 数据支持
  const [viewMode, setViewMode] = useState<'quote' | 'data'>('quote');
  // 皮肤预览：cream = 奶油浅色，dark = 暗色终端（仅视觉，可随时切换）
  const [theme, setTheme] = useState<'cream' | 'dark'>(() => {
    const param = new URLSearchParams(window.location.search).get('theme');
    if (param === 'dark' || param === 'cream') return param;
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ncd-theme') : null;
    return saved === 'dark' ? 'dark' : 'cream';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ncd-theme', theme);
  }, [theme]);
  const [inputText, setInputText] = useState('');
  const [maturityInput, setMaturityInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [recognizedQuotes, setRecognizedQuotes] = useState<Partial<Quotation>[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const publishingRef = useRef(false);
  const [allQuotes, setAllQuotes] = useState<Quotation[]>([]);
  const [maturities, setMaturities] = useState<MaturityInfo[]>([]);
  const [recognizedMaturities, setRecognizedMaturities] = useState<{ tenor: string; date: string; weekday: string }[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterTenor, setFilterTenor] = useState('ALL');
  const [filterRating, setFilterRating] = useState('ALL');

  // 单条列表视图的排序
  const [listSortBy, setListSortBy] = useState<'TIME' | 'YIELD' | 'VOLUME'>('TIME');
  const [listSortOrder, setListSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const [activeTab, setActiveTab] = useState<'VISUAL' | 'TEXT' | 'LIST'>('VISUAL');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedQuotes, setSelectedQuotes] = useState<Set<string>>(new Set());
  const [copySuccessMsg, setCopySuccessMsg] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 报价图片识别
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState('');

  // 双击编辑模式 - 记录哪个 ID 处于编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);

  // 用户手动改变选中状态的标志
  const [userChangedSelection, setUserChangedSelection] = useState(false);

  // 编辑模式（批量编辑选中的报价）
  const [isEditMode, setIsEditMode] = useState(false);

  // 编辑中的收益率值（本地状态）
  const [editingYieldRate, setEditingYieldRate] = useState<string>('');
  // 编辑中的字段值（双击编辑时使用本地状态，blur 时才提交）
  const [editingFieldValues, setEditingFieldValues] = useState<Record<string, string>>({});
  const getEditValue = (itemId: string, fieldKey: string, actualValue: string) =>
    editingId === itemId && editingFieldValues[`${itemId}-${fieldKey}`] !== undefined
      ? editingFieldValues[`${itemId}-${fieldKey}`]
      : actualValue;

  // 起息周几旁的「同步到期日」浮层
  const [isMaturityPopoverOpen, setIsMaturityPopoverOpen] = useState(false);

  // 工具栏按钮点击后的短暂高亮
  const [flashAction, setFlashAction] = useState<string | null>(null);
  const flashToolbar = (name: string) => {
    setFlashAction(name);
    window.setTimeout(() => setFlashAction(prev => (prev === name ? null : prev)), 900);
  };

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

  // 同一「银行+期限」只保留一条：后出现的覆盖先出现的（看板识别结果排在最后，优先）
  const dedupeRecognizedQuotes = (list: Partial<Quotation>[]) => {
    const keyed = new Map<string, Partial<Quotation>>();
    const rest: Partial<Quotation>[] = [];
    for (const q of list) {
      if (!q.bankName || !q.tenor) {
        rest.push(q);
        continue;
      }
      keyed.set(`${q.tenor}|${q.bankName}`, q);
    }
    return [...keyed.values(), ...rest];
  };

  const parseQuotesFromText = async (text: string) => {
    if (!text.trim()) return;
    setIsParsing(true);
    try {
      const results = await parseQuotations(text, valueWeekday);
      if (results.length === 0) {
        alert('解析成功但未发现报价项，请尝试更清晰的格式。');
      } else {
        setRecognizedQuotes(dedupeRecognizedQuotes(results));
      }
    } catch (error: any) {
      console.error("识别失败详情:", error);
      alert('解析过程出错，请检查输入格式。');
    }
    finally { setIsParsing(false); }
  };

  const handleParse = () => parseQuotesFromText(inputText);

  const readFileAsDataURL = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // 大图先压缩，避免上传过慢或超过后端大小限制
  const prepareImage = async (file: File): Promise<{ dataUrl: string; width: number; height: number }> => {
    const dataUrl = await readFileAsDataURL(file);

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });

    const maxSide = 2400;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    if (scale === 1) {
      return { dataUrl, width: image.width, height: image.height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return { dataUrl, width: image.width, height: image.height };
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: canvas.width, height: canvas.height };
  };

  const handleImageFiles = async (files: File[]) => {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (images.length === 0 || isOcrRunning) return;

    setIsOcrRunning(true);
    try {
      const texts: string[] = [];
      const boardQuotes: Partial<Quotation>[] = [];

      for (let i = 0; i < images.length; i++) {
        setOcrStatus(`正在识别图片 ${i + 1}/${images.length}`);
        const prepared = await prepareImage(images[i]);

        // 宽幅横版截图优先按“看板图”识别，才能从表头还原期限
        const isBoard = prepared.width >= 900 && prepared.width / prepared.height >= 1.5;
        if (isBoard) {
          try {
            setOcrStatus(`正在识别看板图 ${i + 1}/${images.length}`);
            const result = await ocrBoard(prepared.dataUrl);
            const quotes = parseBoard(result);
            if (quotes.length > 0) {
              boardQuotes.push(...(quotes as Partial<Quotation>[]));
              continue;
            }
          } catch (error) {
            console.warn('看板图识别失败，回退文本识别:', error);
          }
        }

        const text = await ocrImage(prepared.dataUrl);
        if (text.trim()) texts.push(normalizeOcrText(text));
      }

      const recognizedText = texts.join('\n').trim();

      if (boardQuotes.length > 0) {
        const existingQuotes = inputText.trim()
          ? await parseQuotations(inputText, valueWeekday)
          : [];
        const textQuotes = recognizedText
          ? await parseQuotations(recognizedText, valueWeekday)
          : [];
        setRecognizedQuotes(dedupeRecognizedQuotes([...existingQuotes, ...textQuotes, ...boardQuotes]));
        setInputText(prev => [prev.trim(), recognizedText].filter(Boolean).join('\n'));
        return;
      }

      if (!recognizedText) {
        alert('图片中未识别到文字，请换一张更清晰的截图。');
        return;
      }

      const mergedText = [inputText.trim(), recognizedText].filter(Boolean).join('\n');
      setInputText(mergedText);
      await parseQuotesFromText(mergedText);
    } catch (error: any) {
      console.error('图片识别失败详情:', error);
      alert('图片识别失败：' + (error?.message || '请稍后重试'));
    } finally {
      setIsOcrRunning(false);
      setOcrStatus('');
    }
  };

  const handleConfirmAdd = async () => {
    // 防止连点导致并发发布：并发批次互相看不到对方写入的数据，会产生重复报价
    if (publishingRef.current) return;
    publishingRef.current = true;
    setIsPublishing(true);

    try {
    // 推入历史记录
    pushHistory(allQuotes);

    const added: Quotation[] = [];
    const updated: Quotation[] = [];
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

      // 在 allQuotes 中查找已存在的记录（用 updated 数组做批内去重）
      const existingInBatch = [...added, ...updated];
      const existingAll = [...allQuotes];
      const existingQuote = existingAll.find(q =>
        q.bankName === newPart.bankName && q.tenor === newPart.tenor
      );
      const alreadyAdded = existingInBatch.find(q =>
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

      if (existingQuote && !alreadyAdded) {
        // 更新已存在的报价
        const oldRateVal = parseFloat(existingQuote.yieldRate.replace(/[^\d.]/g, ''));
        if (!isNaN(oldRateVal)) {
          if (newRateVal > oldRateVal) finalYield += '↑';
          else if (newRateVal < oldRateVal) finalYield += '↓';
        }

        const updatedQuoteData = {
          ...existingQuote,
          ...newPart,
          yieldRate: finalYield,
          maturityDate: newPart.maturityDate || mat?.date || existingQuote.maturityDate,
          maturityWeekday: newPart.maturityWeekday || mat?.weekday || existingQuote.maturityWeekday,
        } as Quotation;

        try {
          const saved = await updateQuotationApi(existingQuote.id, updatedQuoteData);
          updated.push(saved);
        } catch (err) {
          console.error('更新报价失败:', err);
        }
      } else if (!existingQuote && !alreadyAdded) {
        // 全新的报价
        const newQuote = {
          ...newPart,
          id: Math.random().toString(36).substr(2, 9),
          yieldRate: finalYield,
          maturityDate: newPart.maturityDate || mat?.date || '未同步',
          maturityWeekday: newPart.maturityWeekday || mat?.weekday || '未知',
          remarks: newPart.remarks || '',
          volume: newPart.volume || '',
          weekday: newPart.weekday || valueWeekday,
        } as Quotation;

        try {
          const saved = await addQuotation(newQuote);
          added.push(saved);
        } catch (err) {
          console.error('保存报价失败:', err);
          alert('保存报价失败: ' + err);
        }
      } else {
        // 批内重复（same bankName+tenor in same batch）— 跳过
        skippedCount++;
      }
    }

    // 单次功能性 state 合并（不丢失 WebSocket 回音带来的并发修改）
    setAllQuotes(prev => {
      const result = [...prev];
      for (const q of added) {
        if (!result.some(r => r.id === q.id)) result.push(q);
      }
      for (const q of updated) {
        const idx = result.findIndex(r => r.id === q.id);
        if (idx > -1) result[idx] = q;
      }
      return result;
    });

    // state 更新后再广播 WebSocket，避免回音竞争条件
    for (const q of added) emitQuotationAdd(q);
    for (const q of updated) emitQuotationUpdate(q);

    setRecognizedQuotes([]);
    setInputText('');

    if (skippedCount > 0) {
      alert(`已发布 ${recognizedQuotes.length - skippedCount} 条报价，${skippedCount} 条因缺少银行名或收益率被跳过`);
    }
    } finally {
      publishingRef.current = false;
      setIsPublishing(false);
    }
  };

  const handleUpdateQuote = async (id: string, field: keyof Quotation, value: string) => {
    // 对收益率进行精度处理
    let finalValue = value;
    if (field === 'yieldRate') {
      // 从新值中提取数字（去掉所有非数字字符）
      const cleanRateStr = value.replace(/[^\d.]/g, '');
      const rateVal = parseFloat(cleanRateStr);

      if (!isNaN(rateVal)) {
        // 格式化为 4 位小数
        let formattedRate = rateVal.toFixed(4);
        // 去掉末尾多余的 0，但至少保留 2 位小数
        formattedRate = formattedRate.replace(/(\.\d{2,})0+$/, '$1');
        // 如果小数点后只有 1 位，补足 2 位
        const decimalPart = formattedRate.split('.')[1];
        if (decimalPart && decimalPart.length === 1) {
          formattedRate = rateVal.toFixed(2);
        }
        // 特殊处理：如果第 3 位是 0，只保留 2 位（如 1.560 → 1.56）
        // 但如果第 3 位不是 0，保留到第 3 或第 4 位（如 1.565 或 1.5655）
        if (decimalPart && decimalPart.length >= 3) {
          const thirdDigit = decimalPart[2];
          if (thirdDigit === '0') {
            // 第 3 位是 0，只保留 2 位
            formattedRate = rateVal.toFixed(2);
          }
          // 否则保持当前位数（3-4 位）
        }

        // 先从当前数据中获取原有的收益率和涨跌标记
        const currentQuote = allQuotes.find(q => q.id === id);
        const oldYield = currentQuote?.yieldRate || '';
        const oldCleanYield = parseFloat(oldYield.replace(/[↑↓%]/g, ''));

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
    setAllQuotes(prev => prev.map(q => q.id === id ? { ...q, [field]: finalValue, updatedAt: Date.now() } : q));

    // 发送到后端
    try {
      const updated = await updateQuotationApi(id, { [field]: finalValue });
      // 广播给其他用户
      emitQuotationUpdate(updated);
    } catch (error) {
      console.error('更新报价失败:', error);
    }
  };

  // 点击行选中
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

    // 设置标志，让 useEffect 处理复制（确保复制内容来自选中的 ID，而非闭包中的 item）
    setUserChangedSelection(true);
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

    return result;
  }, [allQuotes, searchTerm, filterTenor, filterRating]);

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
      } else if (listSortBy === 'YIELD') {
        const valA = parseFloat(a.yieldRate.replace(/[^\d.]/g, '')) || 0;
        const valB = parseFloat(b.yieldRate.replace(/[^\d.]/g, '')) || 0;
        return listSortOrder === 'ASC' ? valA - valB : valB - valA;
      } else {
        // 按募集量排序
        const volA = parseFloat((a.volume || '0').replace(/[^0-9.]/g, '')) || 0;
        const volB = parseFloat((b.volume || '0').replace(/[^0-9.]/g, '')) || 0;
        return listSortOrder === 'ASC' ? volA - volB : volB - volA;
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

  // 格式化收益率：去掉末尾0，最少保留2位小数
  // 例：1.485 → 1.485, 1.490 → 1.49, 1.100 → 1.10, 1.000 → 1.00
  const formatYieldRate = (value: number) => {
    const str = value.toFixed(4);
    const [intPart, decPart] = str.split('.');
    let trimmed = decPart.replace(/0+$/, '');
    if (trimmed.length < 2) trimmed = trimmed.padEnd(2, '0');
    return intPart + '.' + trimmed;
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

      // 格式化收益率
      let formatted = formatYieldRate(newYield);

      // 添加方向符号 + 更新时间
      return { ...q, yieldRate: formatted + directionSymbol, updatedAt: Date.now() };
    }));

    // 同步更新后端
    selectedQuotes.forEach(async (id) => {
      const quote = allQuotes.find(q => q.id === id);
      if (!quote) return;

      const currentYield = parseFloat(quote.yieldRate.replace(/[↑↓]/g, ''));
      const newYield = currentYield + adjustment;
      if (newYield < 0) return;

      let formatted = formatYieldRate(newYield);

      try {
        const updated = await updateQuotationApi(id, { yieldRate: formatted + directionSymbol });
        emitQuotationUpdate(updated);
      } catch (e) {
        console.error('批量调整失败:', e);
      }
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
            // 编辑入口只在页面交互时出现，不应进入导出的图片
            cloned.querySelectorAll('.capture-hide').forEach((element) => {
              (element as HTMLElement).style.display = 'none';
            });
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
  const toggleSelect = (id: string, isChecked?: boolean, useCtrl = false): void => {
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

  // 获取当前选中状态的副本（用于立即复制）
  const getSelectedQuotesCopy = (): Set<string> => {
    return new Set(selectedQuotes);
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
    // 拖曳结束后自动复制选中的内容（通过 useEffect 处理）
    setUserChangedSelection(true);
  };

  // 排序选中的报价：期限 → 类别 → 收益率高价优先
  const sortSelectedQuotes = (items: Quotation[]) => {
    const ratingOrder: Record<string, number> = { 'BIG': 0, 'AAA': 1, 'AA+': 2, 'AA': 3, 'AA-': 4 };
    const tenorOrder = ['1M', '3M', '6M', '9M', '1Y'];

    return [...items].sort((a, b) => {
      // 1. 先按期限排序
      const tenorA = tenorOrder.indexOf(a.tenor);
      const tenorB = tenorOrder.indexOf(b.tenor);
      if (tenorA !== tenorB) return tenorA - tenorB;

      // 2. 同期限按类别排序
      const ratingA = ratingOrder[a.category] ?? 99;
      const ratingB = ratingOrder[b.category] ?? 99;
      if (ratingA !== ratingB) return ratingA - ratingB;

      // 3. 同类别按收益率降序（高价优先）
      const yieldA = parseFloat(a.yieldRate.replace(/[^\d.]/g, '')) || 0;
      const yieldB = parseFloat(b.yieldRate.replace(/[^\d.]/g, '')) || 0;
      return yieldB - yieldA;
    });
  };

  // 复制选中报价的函数（根据当前视图决定格式）
  const copySelectedQuotes = (selectedSet?: Set<string>) => {
    // 使用传入的 Set 或当前的 selectedQuotes
    const currentSelected = selectedSet || selectedQuotes;
    const selectedItems = allQuotes.filter(q => currentSelected.has(q.id));
    if (selectedItems.length === 0) return;

    if (activeTab === 'TEXT') {
      // 文字版：使用分期限格式复制，按期限 → 类别 → 收益率排序
      const sortedItems = sortSelectedQuotes(selectedItems);
      const byTenor: Record<string, typeof sortedItems> = {};
      for (const item of sortedItems) {
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
    } else if (activeTab === 'LIST') {
      // 单条更新：按照当前列表的排序顺序复制（保持用户看到的顺序）
      const sortedIds = sortedListQuotes.map(i => i.id);
      const sortedItems = [...selectedItems].sort((a, b) => {
        return sortedIds.indexOf(a.id) - sortedIds.indexOf(b.id);
      });
      const text = sortedItems.map(i => {
        const vol = i.volume ? ` ${i.volume}` : '';
        const remarks = i.remarks ? ` ${i.remarks}` : '';
        return `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}${vol}${remarks}`.trim();
      }).join('\n');
      copyToClipboard(text);
      setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
      setTimeout(() => setCopySuccessMsg(''), 1500);
    }
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

  // 监听选中状态变化，自动复制
  useEffect(() => {
    if (!userChangedSelection || selectedQuotes.size === 0) return;

    // 从 allQuotes 中获取选中的项（确保使用最新数据）
    const selectedItems = allQuotes.filter(q => selectedQuotes.has(q.id));
    if (selectedItems.length === 0) {
      setUserChangedSelection(false);
      return;
    }

    // 根据当前视图决定复制格式
    let text = '';
    if (activeTab === 'TEXT') {
      // 文字版：使用分期限格式复制，按期限 → 类别 → 收益率排序
      const sortedItems = sortSelectedQuotes(selectedItems);
      const byTenor: Record<string, typeof sortedItems> = {};
      for (const item of sortedItems) {
        const tenorKey = item.tenor;
        if (!byTenor[tenorKey]) byTenor[tenorKey] = [];
        byTenor[tenorKey].push(item);
      }
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
    } else if (activeTab === 'LIST') {
      // 单条更新：按照当前列表的排序顺序复制（保持用户看到的顺序）
      const sortedIds = sortedListQuotes.map(i => i.id);
      const sortedItems = [...selectedItems].sort((a, b) => {
        return sortedIds.indexOf(a.id) - sortedIds.indexOf(b.id);
      });
      for (const i of sortedItems) {
        const vol = i.volume ? ` ${i.volume}` : '';
        const remarks = i.remarks ? ` ${i.remarks}` : '';
        text += `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}${vol}${remarks}\n`;
      }
    } else {
      // 看板视图：简单格式
      for (const i of selectedItems) {
        const vol = i.volume ? ` ${i.volume}` : '';
        const remarks = i.remarks ? ` ${i.remarks}` : '';
        text += `${i.bankName} ${i.rating} ${i.weekday} ${i.tenor} ${i.yieldRate}${vol}${remarks}\n`;
      }
    }

    if (text) {
      copyToClipboard(text.trim());
      setCopySuccessMsg(`已复制 ${selectedItems.length} 条报价`);
      setTimeout(() => setCopySuccessMsg(''), 1500);
    }

    setUserChangedSelection(false);
  }, [selectedQuotes, userChangedSelection, activeTab, allQuotes, sortedListQuotes]);

  const selectAll = () => {
    setSelectedQuotes(new Set(filteredQuotes.map(q => q.id)));
  };

  const cancelSelectAll = () => {
    setSelectedQuotes(new Set());
  };

  return (
    <div className="app-root flex flex-col">
      {/* 顶部独立导航条 */}
      <nav className="app-nav py-2.5 sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="brand-mark">NCD</div>
          <h1 className="nav-title">一级报价系统</h1>
          {viewMode === 'quote' && (
            <>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${isConnected ? 'text-slate-900' : 'text-red-500'}`}>
                {isConnected ? '● 已连接' : '○ 未连接'}
              </span>
              <span className="micro text-slate-900">v{APP_VERSION}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* 视图切换按钮 */}
          <div className="seg">
            <button
              onClick={() => setViewMode('quote')}
              className={`seg-item ${viewMode === 'quote' ? 'is-active' : ''}`}
            >
              报价
            </button>
            <button
              onClick={() => setViewMode('data')}
              className={`seg-item ${viewMode === 'data' ? 'is-active' : ''}`}
            >
              数据支持
            </button>
          </div>
          <a
            href="/auto-quote/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            title="打开要素生成系统"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            要素生成
          </a>
          <div className="w-px h-6 bg-slate-200" />
          {/* 皮肤预览切换（仅本地对比用，定稿后可移除） */}
          <button
            onClick={() => setTheme(theme === 'cream' ? 'dark' : 'cream')}
            className="btn btn-ghost w-9 px-0"
            title={theme === 'cream' ? '切换到暗色（仅预览）' : '切换到奶油色（仅预览）'}
          >
            {theme === 'cream' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" strokeWidth={1.8} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            )}
          </button>
        </div>
        </div>
      </nav>

      {/* 数据支持视图 */}
      {viewMode === 'data' && (
        <DataSupport />
      )}

      {/* 报价系统视图 */}
      {viewMode === 'quote' && (
        <>
      {/* 功能操作栏 */}
      <header className="app-toolbar py-2.5">
        <div className="max-w-[1400px] mx-auto px-6 flex flex-wrap items-center gap-2">
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            className={`btn ${history.length > 0 ? 'btn-secondary' : 'btn-ghost'}`}
            title="撤销上一步操作"
          >
            ↶ 撤销
          </button>
          <div className="relative">
            <div className="flex items-center gap-1.5 bg-slate-100 pl-3 pr-1 py-1 rounded-full border border-slate-200">
              <span className="micro text-slate-600">起息周几</span>
              <input value={valueWeekday} onChange={e => setValueWeekday(e.target.value)} className="bg-transparent w-6 text-slate-600 font-bold border-none outline-none text-xs text-center" />
              <button
                onClick={() => setIsMaturityPopoverOpen(!isMaturityPopoverOpen)}
                className="btn btn-ghost w-6 h-6 px-0"
                title="同步到期日"
              >
                <svg className={`w-3 h-3 transition-transform ${isMaturityPopoverOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {isMaturityPopoverOpen && (
              <div className="absolute left-0 top-full mt-2 w-[380px] panel p-3 z-50 animate-in slide-in-from-top-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="micro">同步到期日 - 可编辑</h3>
                  <button
                    onClick={() => setIsMaturityPopoverOpen(false)}
                    className="btn btn-ghost w-6 h-6 px-0"
                    title="关闭"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <textarea
                  value={maturityInput}
                  onChange={e => setMaturityInput(e.target.value)}
                  className="field-dark w-full h-20 p-2 text-xs font-mono resize-none"
                  placeholder="粘贴包含 (1M 到期日 2025/10/16 周四) 的文本..."
                ></textarea>
                <button onClick={handleSyncMaturity} className="btn btn-primary btn-block mt-2">解析到期日</button>
                {recognizedMaturities.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar text-white">
                      {recognizedMaturities.map((m, i) => (
                        <div key={i} className="bg-slate-800 p-2 rounded-xl border border-slate-700">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <div className="flex flex-col">
                              <label className="text-[9px] text-slate-500">期限</label>
                              <input
                                className="field-dark w-12 text-xs font-bold px-1.5 py-0.5"
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
                                className="field-dark w-24 text-xs font-bold px-1.5 py-0.5"
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
                                className="field-dark w-16 text-xs font-bold px-1.5 py-0.5"
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
                        className="btn btn-on-dark flex-1"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => { handleConfirmMaturity(); setIsMaturityPopoverOpen(false); }}
                        className="btn btn-primary flex-1"
                      >
                        确认发布
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="w-px h-5 bg-slate-300" />
          <button
            onClick={() => { handleCopySelected(); flashToolbar('copySel'); }}
            disabled={selectedQuotes.size === 0}
            className={`btn ${selectedQuotes.size > 0 ? (flashAction === 'copySel' ? 'btn-primary' : 'btn-secondary') : 'btn-ghost'}`}
            title="只复制选中的报价内容"
          >
            复制选中 ({selectedQuotes.size})
          </button>
          <button
            onClick={() => { handleCopySelectedWithTenor(); flashToolbar('copyTenor'); }}
            disabled={selectedQuotes.size === 0}
            className={`btn ${selectedQuotes.size > 0 ? (flashAction === 'copyTenor' ? 'btn-primary' : 'btn-secondary') : 'btn-ghost'}`}
            title="复制选中报价，带到期期限行"
          >
            复制选中分期限
          </button>
          <button onClick={handleCopyAll} className="btn btn-ghost">
            {copyFeedback ? '复制成功' : '复制全部'}
          </button>
          {copySuccessMsg && <span className="text-emerald-500 text-xs font-bold self-center">{copySuccessMsg}</span>}
          <div className="w-px h-5 bg-slate-300" />
          <button
            disabled={selectedQuotes.size === 0}
            onClick={() => setIsEditMode(!isEditMode)}
            className={`btn ${selectedQuotes.size > 0 ? (isEditMode ? 'btn-primary' : 'btn-secondary') : 'btn-ghost'}`}
            title="编辑选中的报价"
          >
            {isEditMode ? '完成编辑' : '编辑'} ({selectedQuotes.size})
          </button>
          <button
            onClick={() => { handleDeleteSelected(); flashToolbar('delete'); }}
            disabled={selectedQuotes.size === 0}
            className={`btn ${selectedQuotes.size > 0 ? (flashAction === 'delete' ? 'btn-primary' : 'btn-secondary') : 'btn-ghost'}`}
          >
            删除选中
          </button>
          <div className="w-px h-5 bg-slate-300" />
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleAdjustYield(0.005)}
              disabled={selectedQuotes.size === 0}
              className={`btn ${selectedQuotes.size > 0 ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'btn-ghost'}`}
              title="选中收益率 +0.5bp"
            >
              ↑+0.5bp
            </button>
            <button
              onClick={() => handleAdjustYield(-0.005)}
              disabled={selectedQuotes.size === 0}
              className={`btn ${selectedQuotes.size > 0 ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200' : 'btn-ghost'}`}
              title="选中收益率 -0.5bp"
            >
              ↓-0.5bp
            </button>
          </div>
          <button onClick={handleCopyCardAsImage} className="btn btn-secondary ml-auto">
            生成图片
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 flex flex-col gap-6 w-full">
        {/* 解析报价 */}
        <section className="card p-4">
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onPaste={e => {
              const files = Array.from(e.clipboardData?.files || []);
              if (files.some(file => file.type.startsWith('image/'))) {
                e.preventDefault();
                handleImageFiles(files);
              }
            }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files || []);
              if (files.some(file => file.type.startsWith('image/'))) handleImageFiles(files);
            }}
            className="field w-full h-24 p-3 text-sm resize-none"
          ></textarea>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              handleImageFiles(files);
            }}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              disabled={isParsing || isOcrRunning}
              onClick={() => imageInputRef.current?.click()}
              className="btn btn-secondary"
            >
              {isOcrRunning ? ocrStatus : '图片识别'}
            </button>
            <button
              disabled={isParsing || isOcrRunning}
              onClick={handleParse}
              className="btn btn-primary"
            >
              {isParsing ? '正在解析...' : '解析报价'}
            </button>
          </div>
        </section>

        {/* 解析报价结果 */}
          {recognizedQuotes.length > 0 && (
            <div className="panel p-4 animate-in slide-in-from-bottom-4">
              <h3 className="micro mb-3">解析结果确认 - 可编辑 ({recognizedQuotes.length})</h3>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar text-white">
                {recognizedQuotes.map((q, i) => (
                  <div key={i} className="bg-slate-800 p-2 rounded-xl border border-slate-700">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {/* 银行名 */}
                      <div className="flex flex-col">
                        <label className="text-[9px] text-slate-500">银行</label>
                        <input
                          className="field-dark w-20 text-xs font-bold px-1.5 py-0.5"
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
                          className="field-dark text-sm px-2 py-1"
                          value={q.tenor || ''}
                          onChange={(e) => {
                            const newQuotes = [...recognizedQuotes];
                            // 手动改期限后，不再沿用看板原列的到期日，交给到期日表匹配
                            newQuotes[i] = { ...newQuotes[i], tenor: e.target.value, maturityDate: '', maturityWeekday: '' };
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
                          className="field-dark w-20 text-indigo-400 text-sm font-bold px-2 py-1"
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
                          className="field-dark text-sm px-2 py-1"
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
                          className="field-dark text-sm px-2 py-1"
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
                          className="field-dark text-sm px-2 py-1"
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
                    {(q.maturityDate || q.remarks) && (
                      <div className="mt-1 text-[10px] text-slate-500 flex gap-3">
                        {q.maturityDate && <span>到期 {q.maturityDate} {q.maturityWeekday || ''}</span>}
                        {q.remarks && <span className="text-amber-500">{q.remarks}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setRecognizedQuotes([])}
                  className="btn btn-on-dark btn-tall flex-1"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmAdd}
                  disabled={isPublishing}
                  className="btn btn-primary btn-tall flex-1"
                >
                  {isPublishing ? '发布中...' : '确认发布'}
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
               <div className="flex items-center gap-2">
                 <div className="seg">
                   <button onClick={() => setActiveTab('VISUAL')} className={`seg-item ${activeTab === 'VISUAL' ? 'is-active' : ''}`}>图片</button>
                   <button onClick={() => setActiveTab('TEXT')} className={`seg-item ${activeTab === 'TEXT' ? 'is-active' : ''}`}>文字版</button>
                   <button onClick={() => setActiveTab('LIST')} className={`seg-item ${activeTab === 'LIST' ? 'is-active' : ''}`}>单条更新</button>
                 </div>
               </div>

               <div className="flex flex-wrap gap-1.5 items-center">
                 <input
                  placeholder="搜银行..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="field w-32 px-4 py-2 text-xs"
                 />
                 <select value={filterTenor} onChange={e => setFilterTenor(e.target.value)} className="field px-2 py-2 text-xs">
                    <option value="ALL">期限</option>
                    <option value="1M">1M</option><option value="3M">3M</option><option value="6M">6M</option><option value="9M">9M</option><option value="1Y">1Y</option>
                 </select>
                 <select value={filterRating} onChange={e => setFilterRating(e.target.value)} className="field px-2 py-2 text-xs">
                    <option value="ALL">评级</option>
                    <option value="BIG">大行</option>
                    <option value="AAA">AAA</option>
                    <option value="AA+">AA+</option>
                 </select>
                 <button onClick={handleRefresh} className="btn btn-ghost p-2" title="刷新数据">
                    <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                 </button>
               </div>
            </div>

            {activeTab === 'VISUAL' && (
              <VisualCard
                groupedQuotes={groupedQuotes}
                onEditMaturity={handleUpdateMaturity}
              />
            )}

            {activeTab === 'TEXT' && (
              <div className="card p-6 flex-1 flex flex-col overflow-hidden">
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
                      <div className="text-indigo-600 font-bold mb-3 flex items-center sticky top-0 bg-white z-10">
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
                              // 点击行任意位置：切换选中
                              e.stopPropagation();
                              const isCtrl = e.ctrlKey;
                              // 设置一个标志，表示用户刚刚改变了选中状态
                              setUserChangedSelection(true);
                              toggleSelect(item.id, undefined, isCtrl);
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
                              className="w-20 font-bold bg-transparent border-none focus:bg-white outline-none p-0 text-slate-900 text-[10px] shrink-0"
                              value={item.bankName}
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
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingId(item.id);
                              }}
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
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingId(item.id);
                              }}
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
                            <input className="w-5 text-slate-400 text-[8px] bg-transparent shrink-0" value={item.weekday} onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }} onBlur={() => setEditingId(null)} onChange={e => handleUpdateQuote(item.id, 'weekday', e.target.value)} />
                            <input
                              className={`w-14 font-bold text-right outline-none bg-transparent text-[10px] shrink-0 ${item.yieldRate.includes('↑') ? 'yield-up' : item.yieldRate.includes('↓') ? 'yield-down' : 'yield-flat'}`}
                              value={editingId === item.id ? editingYieldRate : item.yieldRate.replace(/%|↑|↓/g, '')}
                              placeholder="收益率"
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
              <div className="card p-4 flex-1 flex flex-col">
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
                      onChange={e => setListSortBy(e.target.value as 'TIME' | 'YIELD' | 'VOLUME')}
                      className="bg-white border border-slate-200 px-2 py-1.5 rounded-lg text-[9px] font-bold"
                    >
                      <option value="TIME">按时间</option>
                      <option value="YIELD">按收益率</option>
                      <option value="VOLUME">按募集量</option>
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
                          // 点击行任意位置：切换选中
                          e.stopPropagation();
                          const isCtrl = e.ctrlKey;
                          // 设置一个标志，表示用户刚刚改变了选中状态
                          setUserChangedSelection(true);
                          toggleSelect(item.id, undefined, isCtrl);
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
                        <span className="text-[8px] text-slate-400 font-mono w-14 shrink-0">{new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleTimeString('zh-CN', {hour12:false, hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
                        <input
                          className="w-20 font-bold bg-transparent border-none focus:bg-white outline-none p-0 text-slate-900 text-[10px] shrink-0"
                          value={getEditValue(item.id, 'bankName', item.bankName)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingId(item.id);
                            (e.target as HTMLInputElement).focus();
                          }}
                          onBlur={() => {
                            const val = editingFieldValues[`${item.id}-bankName`];
                            if (val !== undefined && val !== item.bankName) {
                              handleUpdateQuote(item.id, 'bankName', val);
                            }
                            setEditingFieldValues(prev => { const n={...prev}; delete n[`${item.id}-bankName`]; return n; });
                            setEditingId(null);
                          }}
                          onChange={e => {
                            setEditingFieldValues(prev => ({ ...prev, [`${item.id}-bankName`]: e.target.value }));
                          }}
                          data-bank-name-list={item.id}
                        />
                        <select
                          className="w-10 text-slate-400 text-[9px] bg-transparent outline-none cursor-pointer shrink-0"
                          value={item.rating}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingId(item.id);
                          }}
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
                        <input className="w-5 text-slate-400 text-[8px] bg-transparent shrink-0" value={getEditValue(item.id, 'weekday', item.weekday)} onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }} onBlur={() => { const v=editingFieldValues[`${item.id}-weekday`]; if(v!==undefined && v!==item.weekday) handleUpdateQuote(item.id,'weekday',v); setEditingFieldValues(p=>{const n={...p}; delete n[`${item.id}-weekday`]; return n;}); setEditingId(null); }} onChange={e => setEditingFieldValues(p=>({...p,[`${item.id}-weekday`]:e.target.value}))} />
                        <input className="w-10 text-slate-400 text-[8px] bg-transparent shrink-0" value={getEditValue(item.id, 'tenor', item.tenor)} onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }} onBlur={() => { const v=editingFieldValues[`${item.id}-tenor`]; if(v!==undefined && v!==item.tenor) handleUpdateQuote(item.id,'tenor',v); setEditingFieldValues(p=>{const n={...p}; delete n[`${item.id}-tenor`]; return n;}); setEditingId(null); }} onChange={e => setEditingFieldValues(p=>({...p,[`${item.id}-tenor`]:e.target.value}))} />
                        <input
                          className={`w-14 font-bold text-right outline-none bg-transparent text-[10px] shrink-0 ${item.yieldRate.includes('↑') ? 'yield-up' : item.yieldRate.includes('↓') ? 'yield-down' : 'yield-flat'}`}
                          value={editingId === item.id ? editingYieldRate : item.yieldRate.replace(/%|↑|↓/g, '')}
                          placeholder="收益率"
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
                          value={getEditValue(item.id, 'volume', item.volume ? item.volume.replace(/亿|元/g, '') : '')}
                          placeholder="量"
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }}
                          onBlur={() => {
                            const v = editingFieldValues[`${item.id}-volume`];
                            if (v !== undefined) {
                              const val = v.replace(/[^0-9.]/g, '');
                              if (val && val !== (item.volume ? item.volume.replace(/亿|元/g, '') : '')) {
                                handleUpdateQuote(item.id, 'volume', val ? val + '亿元' : '');
                              }
                            }
                            setEditingFieldValues(p=>{const n={...p}; delete n[`${item.id}-volume`]; return n;});
                            setEditingId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              const v = editingFieldValues[`${item.id}-volume`];
                              if (v !== undefined) {
                                const val = v.replace(/[^0-9.]/g, '');
                                if (val && val !== (item.volume ? item.volume.replace(/亿|元/g, '') : '')) {
                                  handleUpdateQuote(item.id, 'volume', val ? val + '亿元' : '');
                                }
                              }
                              setEditingFieldValues(p=>{const n={...p}; delete n[`${item.id}-volume`]; return n;});
                              setEditingId(null);
                              toggleSelect(item.id);
                              const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                              copyToClipboard(text);
                              setCopySuccessMsg('已复制');
                              setTimeout(() => setCopySuccessMsg(''), 1500);
                            }
                          }}
                          onChange={e => {
                            setEditingFieldValues(p=>({...p,[`${item.id}-volume`]:e.target.value}));
                          }}
                        />
                        <input
                          className="w-20 text-slate-400 italic text-[8px] truncate bg-transparent shrink-0"
                          value={getEditValue(item.id, 'remarks', item.remarks || '')}
                          placeholder="备注"
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); (e.target as HTMLInputElement).focus(); }}
                          onBlur={() => {
                            const v = editingFieldValues[`${item.id}-remarks`];
                            if (v !== undefined && v !== (item.remarks || '')) {
                              handleUpdateQuote(item.id, 'remarks', v);
                            }
                            setEditingFieldValues(p=>{const n={...p}; delete n[`${item.id}-remarks`]; return n;});
                            setEditingId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              const v = editingFieldValues[`${item.id}-remarks`];
                              if (v !== undefined && v !== (item.remarks || '')) {
                                handleUpdateQuote(item.id, 'remarks', v);
                              }
                              setEditingFieldValues(p=>{const n={...p}; delete n[`${item.id}-remarks`]; return n;});
                              setEditingId(null);
                              toggleSelect(item.id);
                              const text = `${item.bankName} ${item.rating} ${item.weekday} ${item.tenor} ${item.yieldRate}${item.volume ? ' ' + item.volume : ''}${item.remarks ? ' ' + item.remarks : ''}`.trim();
                              copyToClipboard(text);
                              setCopySuccessMsg('已复制');
                              setTimeout(() => setCopySuccessMsg(''), 1500);
                            }
                          }}
                          onChange={e => {
                            setEditingFieldValues(p=>({...p,[`${item.id}-remarks`]:e.target.value}));
                          }}
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
                }} className="btn btn-primary">
                  下载到本地
                </button>
                <button onClick={() => setPreviewImage(null)} className="btn btn-secondary">
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>
      )}

    </div>
  );
};

export default App;
