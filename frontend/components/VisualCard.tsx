
import React, { useState } from 'react';
import { GroupedQuotation } from '../types';

interface VisualCardProps {
  groupedQuotes: GroupedQuotation[];
  onEditMaturity?: (tenor: string, date: string, weekday: string) => void;
  expanded?: boolean; // 是否在扩展模式（面板折叠时）
}

export const VisualCard: React.FC<VisualCardProps> = ({ groupedQuotes, onEditMaturity, expanded = false }) => {
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

  // 4 个类别：大行&国股、AAA 城农商、AA+、AA-
  const categories = [
    { key: 'BIG', label: '大行&国股' },
    { key: 'AAA', label: 'AAA 城农商' },
    { key: 'AA+', label: 'AA+' },
    { key: 'AA-', label: 'AA-' }
  ];

  const tenors = ['1M', '3M', '6M', '9M', '1Y'];

  // 统一边框格式：每个类别之间都用深色边框分隔
  const getBorderRight = (idx: number) => {
    const isLast = idx === categories.length - 1;
    if (isLast) return 'border-r-0';
    return 'border-r-2 border-slate-600'; // 类别之间用深色边框
  };

  // 类别内部边框（银行名和收益率之间）- 浅色
  const getInnerBorderRight = () => 'border-r border-slate-200';

  if (groupedQuotes.length === 0) return (
    <div className="flex flex-col items-center justify-center h-[500px] bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-slate-300 italic">
      <div className="text-4xl mb-4 opacity-20">📊</div>
      暂无报价数据
    </div>
  );

  return (
    <div id="capture-area" className={`bg-white p-0.5 border-2 border-slate-900 font-sans shadow-xl mx-auto w-full transition-all duration-300 ${expanded ? 'max-w-[1100px] scale-110' : 'max-w-[850px]'}`}>
      <div className="bg-slate-900 p-2 flex justify-between items-end">
        <div>
          <h1 className="text-base font-black text-white tracking-tighter uppercase">NCD 一级市场最新报价看板</h1>
          <p className="text-[7px] text-slate-400 font-bold tracking-[0.2em] mt-0.5">PRIMARY NEGOTIABLE CERTIFICATE OF DEPOSIT DAILY REPORT</p>
        </div>
        <div className="text-right flex flex-col items-end gap-0.5">
          <div className="flex gap-2 mb-0.5">
             <span className="flex items-center gap-0.5 text-[7px] text-red-500 font-bold">● 提价 ↑</span>
             <span className="flex items-center gap-0.5 text-[7px] text-emerald-500 font-bold">● 降价 ↓</span>
             <span className="flex items-center gap-0.5 text-[7px] text-blue-500 font-bold">● 正常</span>
          </div>
          <p className="text-[7px] font-mono text-slate-500 font-bold">UPDATE: {new Date().toLocaleString('zh-CN', { hour12: false })}</p>
        </div>
      </div>

      <div className="overflow-x-hidden">
        <table className="w-full border-collapse table-fixed">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-[8px] font-black uppercase">
              <th className="p-1.5 border-r-2 border-slate-600 border-b-2 border-slate-900 w-16">期限</th>
              {categories.map((cat, idx) => {
                const borderRight = getBorderRight(idx);
                return (
                  <th key={cat.key} className={`p-1.5 ${borderRight} border-b-2 border-slate-900 text-center`} colSpan={2}>
                    {cat.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {tenors.map((tenor) => {
              const group = groupedQuotes.find(g => g.tenor === tenor);
              const maxRows = Math.max(...categories.map(cat => group?.items.filter(i => i.category === (cat.key as any)).length || 0), 1);
              const isLastTenor = tenor === tenors[tenors.length - 1];

              return Array.from({ length: maxRows }).map((_, rowIndex) => {
                const isLastRow = rowIndex === maxRows - 1;
                // 边框样式：最后一行用深色边框，其他行用淡色边框
                const rowBorderClass = isLastRow ? 'border-b-2 border-slate-400' : 'border-b border-slate-200';

                return (
                <tr key={`${tenor}-${rowIndex}`} className={rowBorderClass}>
                  {rowIndex === 0 && (
                    <td className="bg-slate-50 border-r-2 border-slate-600 p-1.5 text-center align-middle" rowSpan={maxRows}>
                      <div className="flex flex-col items-center">
                        <span className="text-base font-black text-slate-900">{tenor}</span>
                        <div className="mt-0.5 text-[6px] text-slate-400 font-bold flex items-center gap-1">
                          {editingTenor === tenor ? (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex gap-0.5">
                                <input
                                  type="text"
                                  value={editDate}
                                  onChange={(e) => setEditDate(e.target.value)}
                                  placeholder="日期"
                                  className="w-12 text-[6px] border border-slate-300 rounded px-0.5"
                                />
                                <select
                                  value={editWeekday}
                                  onChange={(e) => setEditWeekday(e.target.value)}
                                  className="w-10 text-[6px] border border-slate-300 rounded px-0.5"
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
                                  className="flex-1 text-[5px] bg-emerald-500 text-white rounded px-0.5"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditingTenor(null)}
                                  className="flex-1 text-[5px] bg-slate-300 text-slate-700 rounded px-0.5"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 whitespace-nowrap">
                              <span className="text-[6px] text-slate-600 font-bold">{group?.maturityDate || '--'}</span>
                              <span className="text-[5px] text-slate-400">{group?.maturityWeekday || ''}</span>
                              <button
                                onClick={() => handleEditClick(tenor, group?.maturityDate || '', group?.maturityWeekday || '')}
                                className="text-[4px] text-indigo-400 hover:text-indigo-600 font-bold"
                              >
                                编辑
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  )}
                  {categories.map((cat, catIdx) => {
                    const items = group?.items.filter(i => i.category === (cat.key as any)) || [];
                    const item = items[rowIndex];
                    const hasItem = !!item;
                    const isUp = hasItem && item.yieldRate.includes('↑');
                    const isDown = hasItem && item.yieldRate.includes('↓');
                    const borderRight = getBorderRight(catIdx);
                    const innerBorder = getInnerBorderRight();
                    // 行已有统一边框，单元格只需保留右边框
                    return (
                      <React.Fragment key={cat.key}>
                        <td className={`p-1.5 pl-2 ${innerBorder}`}>
                          <span className={`text-[9px] font-bold ${hasItem ? (isUp ? 'text-red-600' : isDown ? 'text-emerald-600' : 'text-slate-700') : 'text-slate-300'}`}>
                            {item?.bankName || ' '}
                          </span>
                        </td>
                        <td className={`p-1.5 pr-2 ${borderRight}`}>
                          {hasItem ? (
                            <div className="flex items-center gap-1">
                              <span className={`text-[9px] font-black font-mono ${isUp ? 'text-red-600' : isDown ? 'text-emerald-600' : 'text-blue-700'}`}>
                                {item.yieldRate}
                              </span>
                              {item.remarks && (
                                <span className="text-[7px] text-slate-500 font-medium truncate flex-1" title={item.remarks}>{item.remarks}</span>
                              )}
                              {item.volume && (
                                <span className="text-[7px] font-bold text-slate-600 bg-slate-100 px-1 rounded shrink-0">
                                  {item.volume}
                                </span>
                              )}
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
      <div className="bg-slate-50 p-1 text-[6px] text-slate-400 font-black uppercase text-center border-t border-slate-200 tracking-[0.5em]">
        SYSTEM GENERATED REPORT • ACCURACY GUARANTEED
      </div>
    </div>
  );
};
