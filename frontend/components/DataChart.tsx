import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

interface ChartData {
  name: string;
  value: number;
  [key: string]: any;
}

interface DataChartProps {
  data: ChartData[];
  chartType?: 'line' | 'bar' | 'pie';
  title?: string;
  colors?: string[];
}

const COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1'];

export const DataChart: React.FC<DataChartProps> = ({
  data,
  chartType = 'bar',
  title,
  colors = COLORS
}) => {
  const [activeChart, setActiveChart] = useState<'line' | 'bar' | 'pie'>(chartType);

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <div className="text-4xl mb-2">📊</div>
        暂无数据
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      {title && (
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <div className="flex gap-1">
            <button
              onClick={() => setActiveChart('line')}
              className={`px-2 py-1 text-xs font-bold rounded transition-all
                ${activeChart === 'line' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              折线图
            </button>
            <button
              onClick={() => setActiveChart('bar')}
              className={`px-2 py-1 text-xs font-bold rounded transition-all
                ${activeChart === 'bar' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              柱状图
            </button>
            <button
              onClick={() => setActiveChart('pie')}
              className={`px-2 py-1 text-xs font-bold rounded transition-all
                ${activeChart === 'pie' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              饼图
            </button>
          </div>
        </div>
      )}

      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          {activeChart === 'line' && (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                stroke={colors[0]}
                strokeWidth={2}
                dot={{ fill: colors[0], strokeWidth: 2 }}
              />
            </LineChart>
          )}

          {activeChart === 'bar' && (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
              />
              <Legend />
              <Bar dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}

          {activeChart === 'pie' && (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
              />
              <Legend />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// 预设图表配置
export const ChartPresets = {
  // 到期日分布图
  maturityDistribution: (data: { tenor: string; count: number }[]) => {
    return data.map(item => ({ name: item.tenor, value: item.count }));
  },

  // 发行量趋势图
  issuanceTrend: (data: { date: string; volume: number }[]) => {
    return data.map(item => ({ name: item.date, value: item.volume }));
  },

  // 银行评级分布
  ratingDistribution: (data: { rating: string; count: number }[]) => {
    return data.map(item => ({ name: item.rating, value: item.count }));
  },

  // 剩余额度排行
  quotaRanking: (data: { bank: string; quota: number }[]) => {
    return data.map(item => ({ name: item.bank, value: item.quota }));
  }
};
