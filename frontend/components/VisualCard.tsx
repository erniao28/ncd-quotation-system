
import React, { useState } from 'react';
import { GroupedQuotation } from '../types';

interface VisualCardProps {
  groupedQuotes: GroupedQuotation[];
  onEditMaturity?: (tenor: string, date: string, weekday: string) => void;
}

export const VisualCard: React.FC<VisualCardProps> = ({ groupedQuotes, onEditMaturity }) => {
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

  const categories = [
    { key: 'BIG', label: 'AAA(大行&国股)' },
    { key: 'AAA', label: 'AAA(城农商)' },
    { key: 'AA+', label: 'AA+' },
    { key: 'AA', label: 'AA' },
    { key: 'AA-', label: 'AA-' }
  ];

  const tenors = ['1M', '3M', '6M', '9M', '1Y'];

  if (groupedQuotes.length === 0) return (
    <div className="flex flex-col items-center justify-center h-[500px] bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 text-slate-300 italic">
      <div className="text-4xl mb-4 opacity-20">📊</div>
      暂无报价数据
    </div>
  );

  return (
    <div id="capture-area" className="bg-white p-1 border-2 border-slate-900 font-sans shadow-xl mx-auto w-full max-w-[1200px] overflow-hidden">
      <div className="bg-slate-900 p-4 flex justify-between items-end">
        <div>
          <h1 className="text-xl font-black text-white tracking-tighter uppercase">NCD 一级市场最新报价看板</h1>
          <p className="text-[9px] text-slate-400 font-bold tracking-[0.2em] mt-1">PRIMARY NEGOTIABLE CERTIFICATE OF DEPOSIT DAILY REPORT</p>
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <div className="flex gap-4 mb-1">
             <span className="flex items-center gap-1 text-[10px] text-red-500 font-bold">● 提价 ↑</span>
             <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-bold">● 降价 ↓</span>
             <span className="flex items-center gap-1 text-[10px] text-blue-500 font-bold">● 正常</span>
          </div>
          <p className="text-[9px] font-mono text-slate-500 font-bold">UPDATE: {new Date().toLocaleString('zh-CN', { hour12: false })}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-100 text-slate-600 text-[10px] font-black uppercase">
              <th className="p-2 border-r border-slate-300 border-b-2 border-slate-900 w-24">期限</th>
              {categories.map(cat => (
                <th key={cat.key} className="p-2 border-r border-slate-300 border-b-2 border-slate-900 text-center last:border-r-0" colSpan={2}>
                  {cat.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenors.map((tenor) => {
              const group = groupedQuotes.find(g => g.tenor === tenor);
              const maxRows = Math.max(...categories.map(cat => group?.items.filter(i => i.category === (cat.key as any)).length || 0), 1);

              return Array.from({ length: maxRows }).map((_, rowIndex) => (
                <tr key={`${tenor}-${rowIndex}`} className={`border-b border-slate-200 ${rowIndex === maxRows - 1 ? 'border-b-2 border-slate-400' : ''}`}>
                  {rowIndex === 0 && (
                    <td className="bg-slate-50 border-r border-slate-300 p-2 text-center align-middle" rowSpan={maxRows}>
                      <div className="flex flex-col items-center">
                        <span className="text-lg font-black text-slate-900">{tenor}</span>
                        <div className="mt-1 text-[8px] text-slate-400 font-bold">
                          {editingTenor === tenor ? (
                            <div className="flex flex-col gap-1">
                              <input
                                type="text"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                placeholder="日期"
                                className="w-20 text-[9px] border border-slate-300 rounded px-1"
                              />
                              <select
                                value={editWeekday}
                                onChange={(e) => setEditWeekday(e.target.value)}
                                className="w-20 text-[9px] border border-slate-300 rounded px-1"
                              >
                                <option value="">星期</option>
                                <option value="周一">周一</option>
                                <option value="周二">周二</option>
                                <option value="周三">周三</option>
                                <option value="周四">周四</option>
                                <option value="周五">周五</option>
                              </select>
                              <div className="flex gap-1">
                                <button
                                  onClick={handleSave}
                                  className="flex-1 text-[8px] bg-emerald-500 text-white rounded px-1"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditingTenor(null)}
                                  className="flex-1 text-[8px] bg-slate-300 text-slate-700 rounded px-1"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p>{group?.maturityDate || '--'}</p>
                              <p>{group?.maturityWeekday || '--'}</p>
                              <button
                                onClick={() => handleEditClick(tenor, group?.maturityDate || '', group?.maturityWeekday || '')}
                                className="mt-1 text-[8px] text-indigo-500 hover:text-indigo-700 font-bold"
                              >
                                编辑
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                  )}
                  {categories.map(cat => {
                    const item = group?.items.filter(i => i.category === (cat.key as any))[rowIndex];
                    const isUp = item?.yieldRate.includes('↑');
                    const isDown = item?.yieldRate.includes('↓');
                    return (
                      <React.Fragment key={cat.key}>
                        <td className={`p-2 pl-3 border-r border-slate-100 w-32 truncate text-[11px] font-bold ${item ? (isUp ? 'text-red-600' : isDown ? 'text-emerald-600' : 'text-slate-700') : 'opacity-0'}`}>
                          {item?.bankName}
                        </td>
                        <td className={`p-2 pr-3 border-r border-slate-300 last:border-r-0 text-right w-36 ${item ? 'opacity-100' : 'opacity-0'}`}>
                          <div className="flex items-center justify-end gap-1.5">
                             {item?.volume && (
                               <span className="text-[9px] font-black text-slate-400 border border-slate-100 px-1 rounded bg-slate-50">
                                 {item.volume} +
                               </span>
                             )}
                            <span className={`text-[11px] font-black font-mono ${isUp ? 'text-red-600' : isDown ? 'text-emerald-600' : 'text-blue-700'}`}>
                              {item?.yieldRate}
                            </span>
                          </div>
                          {item?.remarks && <p className="text-[8px] text-slate-400 italic truncate max-w-[120px]">{item.remarks}</p>}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
      <div className="bg-slate-50 p-1.5 text-[8px] text-slate-400 font-black uppercase text-center border-t border-slate-200 tracking-[0.5em]">
        SYSTEM GENERATED REPORT • ACCURACY GUARANTEED
      </div>
    </div>
  );
};
