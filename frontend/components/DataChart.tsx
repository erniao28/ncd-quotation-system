import React, { useEffect, useState } from 'react';
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
  showTooltip?: boolean;
}

// 图表颜色跟随主题变量，皮肤切换时重读
const readVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const useThemeVars = () => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setTick(tick => tick + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return {
    accent: readVar('--accent', '#f0b429'),
    accentStrong: readVar('--accent-strong', '#a87303'),
    accentSoft: readVar('--accent-soft', '#fdf3da'),
    ink: readVar('--ink', '#141414'),
    ink2: readVar('--ink-2', '#5f5a50'),
    ink3: readVar('--ink-3', '#8b8578'),
    line: readVar('--line', '#e9e4d9'),
    surface: readVar('--surface', '#ffffff'),
    up: readVar('--up', '#c0362c'),
    down: readVar('--down', '#1e7a4f'),
  };
};

export const DataChart: React.FC<DataChartProps> = ({
  data,
  chartType = 'bar',
  title,
  colors,
  showTooltip = true
}) => {
  const [activeChart, setActiveChart] = useState<'line' | 'bar' | 'pie'>(chartType);
  const theme = useThemeVars();

  const palette = colors || [
    theme.accent,
    theme.ink2,
    theme.up,
    theme.down,
    theme.ink3,
    theme.accentStrong,
    theme.line
  ];

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <div className="text-4xl mb-2">📊</div>
        暂无数据
      </div>
    );
  }

  const axisStyle = { fontSize: 12, fill: theme.ink3 };
  const tooltipStyle = {
    backgroundColor: theme.surface,
    border: `1px solid ${theme.line}`,
    borderRadius: '8px',
    fontSize: '12px',
    color: theme.ink
  };
  const tooltipTextStyle = { color: theme.ink2 };

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
              <CartesianGrid strokeDasharray="3 3" stroke={theme.line} />
              <XAxis dataKey="name" stroke={theme.ink3} tick={axisStyle} />
              <YAxis stroke={theme.ink3} tick={axisStyle} />
              {showTooltip && <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipTextStyle} labelStyle={tooltipTextStyle} />}
              <Line
                type="monotone"
                dataKey="value"
                stroke={theme.accent}
                strokeWidth={2}
                dot={{ fill: theme.accent, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          )}

          {activeChart === 'bar' && (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.line} />
              <XAxis dataKey="name" stroke={theme.ink3} tick={axisStyle} />
              <YAxis stroke={theme.ink3} tick={axisStyle} />
              {showTooltip && <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipTextStyle} labelStyle={tooltipTextStyle} />}
              <Bar dataKey="value" fill={theme.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
                  <Cell key={`cell-${index}`} fill={palette[index % palette.length]} />
                ))}
              </Pie>
              {showTooltip && <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipTextStyle} labelStyle={tooltipTextStyle} />}
              <Legend wrapperStyle={{ color: theme.ink2, fontSize: 12 }} />
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
