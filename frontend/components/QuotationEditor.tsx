
import React from 'react';
import { Quotation } from '../types';

interface QuotationEditorProps {
  quote: Partial<Quotation>;
  index: number;
  onUpdate: (index: number, updated: Partial<Quotation>) => void;
  onRemove: (index: number) => void;
}

export const QuotationEditor: React.FC<QuotationEditorProps> = ({ quote, index, onUpdate, onRemove }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    onUpdate(index, { ...quote, [e.target.name]: e.target.value });
  };

  return (
    <div className="flex flex-wrap gap-2 p-3 bg-white border border-slate-200 rounded-lg shadow-sm items-center mb-2">
      <input
        name="bankName"
        value={quote.bankName || ''}
        onChange={handleChange}
        placeholder="银行"
        className="px-2 py-1 border rounded text-sm w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <select
        name="rating"
        value={quote.rating || 'AAA'}
        onChange={handleChange}
        className="px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="AAA">AAA</option>
        <option value="AA+">AA+</option>
        <option value="AA">AA</option>
      </select>
      <select
        name="tenor"
        value={quote.tenor || '1M'}
        onChange={handleChange}
        className="px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="1M">1M</option>
        <option value="3M">3M</option>
        <option value="6M">6M</option>
        <option value="9M">9M</option>
        <option value="1Y">1Y</option>
      </select>
      <input
        name="yieldRate"
        value={quote.yieldRate || ''}
        onChange={handleChange}
        placeholder="收益率"
        className="px-2 py-1 border rounded text-sm w-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <input
        name="maturityDate"
        value={quote.maturityDate || ''}
        onChange={handleChange}
        placeholder="到期日"
        className="px-2 py-1 border rounded text-sm w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <button
        onClick={() => onRemove(index)}
        className="text-red-500 hover:text-red-700 text-sm font-medium ml-auto"
      >
        删除
      </button>
    </div>
  );
};
