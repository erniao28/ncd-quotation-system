
import React, { useState } from 'react';
import { GroupedQuotation } from '../types';

interface VisualCardProps {
  groupedQuotes: GroupedQuotation[];
  onEditMaturity?: (tenor: string, date: string, weekday: string) => void;
  visibleCategoryKeys?: string[];
}

export const VisualCard: React.FC<VisualCardProps> = ({ groupedQuotes, onEditMaturity, visibleCategoryKeys = ['BIG', 'AAA', 'AA+'] }) => {
  const [editingTenor, setEditingTenor] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editWeekday, setEditWeekday] = useState('');

  const handleEditClick = (tenor: string, date: string, weekday: string) => {
    setEditingTenor(tenor);
    setEditDate(date);
    setEditWeekday(weekday);
  };

  const handleSave = () => {
    if (editingTenor && onEditMaturity) {
      onEditMaturity(editingTenor, editDate, editWeekday);
    }
    setEditingTenor(null);
  };

  // 生成图片只保留到 AA+：大行&国股、AAA 城农商、AA+
  const categories = [
    { key: 'BIG', label: '大行&国股' },
    { key: 'AAA', label: 'AAA 城农商' },
    { key: 'AA+', label: 'AA+' }
  ].filter(cat => visibleCategoryKeys.includes(cat.key));

  const tenors = ['1M', '3M', '6M', '9M', '1Y'];

  // 同一类别内按收益率由低到高排列，无法解析的排到最后
  const rateValue = (rate: string): number => {
    const value = parseFloat(String(rate).replace(/[↑↓%]/g, ''));
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };

  // 隐藏列后剩余列会变宽，内容居中避免一侧留白过多
  const isCondensed = categories.length < 3;

  // 统一边框格式：每个类别之间都用深色边框分隔
  const getBorderRight = (idx: number) => {
    const isLast = idx === categories.length - 1;
    if (isLast) return 'border-r-0';
    return 'border-r-2 border-slate-600';
  };

  // 类别内部边框（银行名和收益率之间）- 浅色
  const getInnerBorderRight = () => 'border-r border-slate-200';

  if (groupedQuotes.length === 0 || categories.length === 0) return (
    <div className="flex flex-col items-center justify-center h-[500px] bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-slate-300 italic">
      <div className="text-4xl mb-4 opacity-20">📊</div>
      暂无报价数据
    </div>
  );

  return (
    <div id="capture-area" className="board font-sans w-full">
      <div className="board-head px-5 py-3.5 flex justify-between items-end">
        <div>
          <h1 className="text-xl font-black text-white tracking-tighter leading-none">存单一级市场报价</h1>
          <p className="text-[9px] text-slate-400 font-medium font-mono tracking-[0.2em] mt-1">NEGOTIABLE CERTIFICATE OF DEPOSIT</p>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <div className="flex gap-3">
             <span className="flex items-center gap-0.5 text-[9.5px] yield-up font-bold">● 提价 ↑</span>
             <span className="flex items-center gap-0.5 text-[9.5px] yield-down font-bold">● 降价 ↓</span>
             <span className="flex items-center gap-0.5 text-[9.5px] yield-flat font-bold">● 正常</span>
          </div>
          <p className="text-[9px] font-mono text-slate-500 font-bold">UPDATE: {new Date().toLocaleString('zh-CN', { hour12: false })}</p>
        </div>
      </div>

      <div className="overflow-x-hidden">
        <table className="w-full border-collapse table-fixed">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-[11px] font-black uppercase">
              <th className="py-2 px-2 border-r-2 border-slate-600 border-b-2 border-slate-900 w-24">期限</th>
              {categories.map((cat, idx) => {
                const borderRight = getBorderRight(idx);
                return (
                  <th key={cat.key} className={`py-2 px-2 ${borderRight} border-b-2 border-slate-900 text-center`} colSpan={2}>
                    {cat.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {tenors.map((tenor) => {
              const group = groupedQuotes.find(g => g.tenor === tenor);
              const itemsByCategory = categories.map(cat =>
                (group?.items.filter(i => i.category === (cat.key as any)) || [])
                  .slice()
                  .sort((a, b) => rateValue(a.yieldRate) - rateValue(b.yieldRate))
              );
              const maxRows = Math.max(...itemsByCategory.map(items => items.length), 1);
              const isLastTenor = tenor === tenors[tenors.length - 1];

              return Array.from({ length: maxRows }).map((_, rowIndex) => {
                const isLastRow = rowIndex === maxRows - 1;
                // 边框样式：最后一行用深色边框，其他行用淡色边框
                const rowBorderClass = isLastRow ? 'border-b-2 border-slate-400' : 'border-b border-slate-200';

                return (
                <tr key={`${tenor}-${rowIndex}`} className={rowBorderClass}>
                  {rowIndex === 0 && (
                    <td className="bg-slate-50 border-r-2 border-slate-600 px-2 py-2 text-center align-middle" rowSpan={maxRows}>
                      <div className="flex flex-col items-center">
                        <span className="text-[22px] font-black text-slate-900 leading-none">{tenor}</span>
                        <div className="mt-1.5 text-[8px] text-slate-400 font-bold flex items-center gap-1">
                          {editingTenor === tenor ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex gap-0.5">
                                <input
                                  type="text"
                                  value={editDate}
                                  onChange={(e) => setEditDate(e.target.value)}
                                  placeholder="日期"
                                  className="w-16 text-[8px] border border-slate-300 rounded px-1 py-0.5"
                                />
                                <select
                                  value={editWeekday}
                                  onChange={(e) => setEditWeekday(e.target.value)}
                                  className="w-12 text-[8px] border border-slate-300 rounded px-0.5 py-0.5"
                                >
                                  <option value="">周</option>
                                  <option value="周一">一</option>
                                  <option value="周二">二</option>
                                  <option value="周三">三</option>
                                  <option value="周四">四</option>
                                  <option value="周五">五</option>
                                  <option value="周六">六</option>
                                  <option value="周日">日</option>
                                </select>
                              </div>
                              <div className="flex gap-0.5">
                                <button
                                  onClick={handleSave}
                                  className="flex-1 text-[7px] bg-emerald-500 text-white rounded px-1 py-0.5"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditingTenor(null)}
                                  className="flex-1 text-[7px] bg-slate-300 text-slate-700 rounded px-1 py-0.5"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-0.5 whitespace-nowrap">
                              <span className="text-[9px] text-slate-600 font-bold font-mono">{group?.maturityDate || '--'}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-[8px] text-slate-400">{group?.maturityWeekday || ''}</span>
                                <button
                                  onClick={() => handleEditClick(tenor, group?.maturityDate || '', group?.maturityWeekday || '')}
                                  className="capture-hide text-[7px] text-indigo-400 hover:text-indigo-600 font-bold"
                                >
                                  编辑
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  )}
                  {categories.map((cat, catIdx) => {
                    const item = itemsByCategory[catIdx][rowIndex];
                    const hasItem = !!item;
                    const isUp = hasItem && item.yieldRate.includes('↑');
                    const isDown = hasItem && item.yieldRate.includes('↓');
                    const borderRight = getBorderRight(catIdx);
                    const innerBorder = getInnerBorderRight();
                    // 行已有统一边框，单元格只需保留右边框
                    return (
                      <React.Fragment key={cat.key}>
                        <td className={`px-2.5 py-1.5 ${innerBorder} ${isCondensed ? 'text-center' : ''}`}>
                          <span className={`text-[12px] font-bold ${hasItem ? 'text-slate-700' : 'text-slate-300'}`}>
                            {item?.bankName || ' '}
                          </span>
                        </td>
                        <td className={`px-2.5 py-1.5 ${borderRight}`}>
                          {hasItem ? (
                            <div className={`flex items-center ${isCondensed ? 'justify-center' : ''}`}>
                              {/* 固定宽度的内容块：备注不会把价格挤到别的起始位置 */}
                              <div className="flex items-center gap-1.5 w-[160px] min-w-0">
                                <span className={`text-[14px] font-black font-mono leading-tight shrink-0 ${isUp ? 'yield-up' : isDown ? 'yield-down' : 'yield-flat'}`}>
                                  {item.yieldRate}
                                </span>
                                {item.remarks && (
                                  <span className="text-[9px] text-slate-500 font-medium truncate flex-1 min-w-0" title={item.remarks}>{item.remarks}</span>
                                )}
                                {item.volume && (
                                  <span className="text-[8.5px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                                    {item.volume}
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[6px] text-slate-100"> </span>
                          )}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            });
          })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
