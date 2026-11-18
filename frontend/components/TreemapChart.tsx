import React, { useEffect, useMemo, useState } from 'react';

export interface TreemapBank {
  key: string;
  label: string;
  value: number;           // 发行量（面积）
  issueVolume: number;     // 区间发行量
  maturityVolume: number;  // 区间到期量
  netVolume: number;       // 净发行 = 发行量 − 到期量
}

export interface TreemapGroup {
  key: string;
  label: string;
  banks: TreemapBank[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlacedBank extends Rect {
  bank: TreemapBank;
}

interface PlacedGroup extends Rect {
  group: TreemapGroup;
}

// 布局在 1000 × 560 的虚拟画布上计算，渲染时换算成百分比
const W = 1000;
const H = 560;
const GROUP_GAP = 4;
const GROUP_HEADER = 20;
const CELL_GAP = 1.5;

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
    ink: readVar('--ink', '#141414'),
    ink2: readVar('--ink-2', '#5f5a50'),
    line: readVar('--line', '#e9e4d9'),
    surface2: readVar('--surface-2', '#f0ede4'),
    surface3: readVar('--surface-3', '#e7e2d6'),
    up: readVar('--up', '#c0362c'),
    down: readVar('--down', '#1e7a4f'),
  };
};

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 经典 squarify 布局：把一组按面积分配的矩形切成尽量接近正方形的块
function squarify<T extends { value: number }>(items: T[], rect: Rect): Array<T & Rect> {
  const total = items.reduce((sum, item) => sum + Math.max(item.value, 0), 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return [];

  const scale = (rect.w * rect.h) / total;
  const result: Array<T & Rect> = [];
  let area: Rect = { ...rect };
  let row: T[] = [];
  let rest = items.filter(item => item.value > 0);

  const worst = (candidate: T[], side: number) => {
    const sum = candidate.reduce((s, item) => s + item.value, 0) * scale;
    const max = Math.max(...candidate.map(item => item.value * scale));
    const min = Math.min(...candidate.map(item => item.value * scale));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const layoutRow = () => {
    const side = Math.min(area.w, area.h);
    if (side <= 0) {
      for (const item of rest) result.push({ ...item, x: area.x, y: area.y, w: 0, h: 0 });
      rest = [];
      row = [];
      return;
    }
    const rowArea = row.reduce((s, item) => s + item.value, 0) * scale;
    const thickness = Math.min(rowArea / side, area.w >= area.h ? area.w : area.h);
    const horizontal = area.w >= area.h;
    let offset = 0;
    for (const item of row) {
      const length = (item.value * scale) / thickness;
      if (horizontal) {
        result.push({ ...item, x: area.x, y: area.y + offset, w: thickness, h: length });
      } else {
        result.push({ ...item, x: area.x + offset, y: area.y, w: length, h: thickness });
      }
      offset += length;
    }
    area = horizontal
      ? { x: area.x + thickness, y: area.y, w: area.w - thickness, h: area.h }
      : { x: area.x, y: area.y + thickness, w: area.w, h: area.h - thickness };
    row = [];
  };

  while (rest.length > 0) {
    const item = rest[0];
    const side = Math.min(area.w, area.h);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
      row.push(item);
      rest = rest.slice(1);
    } else {
      layoutRow();
    }
  }
  if (row.length > 0) layoutRow();

  return result;
}

function buildLayout(groups: TreemapGroup[]): { placedGroups: PlacedGroup[]; placedBanks: PlacedBank[] } {
  const groupItems = groups
    .map(group => ({
      value: group.banks.reduce((sum, bank) => sum + Math.max(bank.value, 0), 0),
      group
    }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);

  const placedGroups: PlacedGroup[] = [];
  const placedBanks: PlacedBank[] = [];

  for (const placed of squarify(groupItems, { x: 0, y: 0, w: W, h: H })) {
    const rect: Rect = { x: placed.x, y: placed.y, w: placed.w, h: placed.h };
    placedGroups.push({ ...rect, group: placed.group });

    const hasHeader = rect.h > GROUP_HEADER * 2 && rect.w > 60;
    const inner = hasHeader
      ? { x: rect.x + GROUP_GAP, y: rect.y + GROUP_HEADER, w: rect.w - GROUP_GAP * 2, h: rect.h - GROUP_HEADER - GROUP_GAP }
      : { x: rect.x + GROUP_GAP, y: rect.y + GROUP_GAP, w: rect.w - GROUP_GAP * 2, h: rect.h - GROUP_GAP * 2 };
    if (inner.w <= 0 || inner.h <= 0) continue;

    const bankItems = placed.group.banks
      .filter(bank => bank.value > 0)
      .sort((a, b) => b.value - a.value)
      .map(bank => ({ value: bank.value, bank }));

    for (const cell of squarify(bankItems, inner)) {
      placedBanks.push({
        ...cell,
        bank: cell.bank,
        x: cell.x + CELL_GAP,
        y: cell.y + CELL_GAP,
        w: Math.max(cell.w - CELL_GAP * 2, 1),
        h: Math.max(cell.h - CELL_GAP * 2, 1)
      });
    }
  }

  return { placedGroups, placedBanks };
}

export const TreemapChart: React.FC<{ groups: TreemapGroup[] }> = ({ groups }) => {
  const theme = useThemeVars();
  const { placedGroups, placedBanks } = useMemo(() => buildLayout(groups), [groups]);

  // 色深按净发行绝对值缩放；分档封顶，避免个别大行把其他家压成全浅色
  const maxAbs = Math.max(
    10,
    ...groups.flatMap(group => group.banks
      .filter(bank => bank.maturityVolume > 0)
      .map(bank => Math.abs(bank.netVolume)))
  );

  const cellColors = (bank: TreemapBank) => {
    if (bank.maturityVolume <= 0) {
      return { backgroundColor: theme.surface3, color: theme.ink2 };
    }
    const t = Math.min(1, Math.abs(bank.netVolume) / Math.min(maxAbs, 300));
    const alpha = 0.22 + 0.63 * Math.sqrt(t);
    const base = bank.netVolume >= 0 ? theme.up : theme.down;
    return {
      backgroundColor: hexToRgba(base, alpha),
      color: alpha >= 0.45 ? '#ffffff' : theme.ink
    };
  };

  const netText = (net: number) => `${net >= 0 ? '+' : ''}${net.toFixed(1)}`;

  if (placedBanks.length === 0) {
    return <div className="text-center py-12 text-slate-400">所选日期范围内无数据</div>;
  }

  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-xl border border-slate-200" style={{ aspectRatio: `${W} / ${H}` }}>
        {/* 类别底板 */}
        {placedGroups.map(group => (
          <div
            key={`group-bg-${group.group.key}`}
            className="absolute border border-slate-200"
            style={{
              left: `${(group.x / W) * 100}%`,
              top: `${(group.y / H) * 100}%`,
              width: `${(group.w / W) * 100}%`,
              height: `${(group.h / H) * 100}%`,
              backgroundColor: theme.surface2
            }}
          />
        ))}

        {/* 类别标题 */}
        {placedGroups
          .filter(group => group.h > GROUP_HEADER * 2 && group.w > 60)
          .map(group => (
            <div
              key={`group-label-${group.group.key}`}
              className="absolute flex items-center overflow-hidden text-[10px] font-bold"
              style={{
                left: `${(group.x / W) * 100}%`,
                top: `${(group.y / H) * 100}%`,
                width: `${(group.w / W) * 100}%`,
                height: `${(GROUP_HEADER / H) * 100}%`,
                paddingLeft: 5,
                color: theme.ink2
              }}
            >
              <span className="truncate">{group.group.label}</span>
            </div>
          ))}

        {/* 银行方块：面积 = 发行量，颜色 = 环比变化 */}
        {placedBanks.map(cell => {
          const colors = cellColors(cell.bank);
          const showName = cell.w >= 46 && cell.h >= 22;
          const showValue = cell.w >= 64 && cell.h >= 40;
          const nameSize = cell.w >= 140 && cell.h >= 80 ? 14 : 11;
          const mat = cell.bank.maturityVolume;
          const tooltip = `${cell.bank.label}：发行 ${cell.bank.issueVolume.toFixed(1)} 亿` +
            (mat > 0 ? `，到期 ${mat.toFixed(1)} 亿，净发行 ${netText(cell.bank.netVolume)} 亿` : '，无到期数据');
          return (
            <div
              key={`cell-${cell.bank.key}`}
              title={tooltip}
              className="absolute flex flex-col items-center justify-center overflow-hidden px-0.5 text-center"
              style={{
                left: `${(cell.x / W) * 100}%`,
                top: `${(cell.y / H) * 100}%`,
                width: `${(cell.w / W) * 100}%`,
                height: `${(cell.h / H) * 100}%`,
                ...colors
              }}
            >
              {showName && (
                <span className="w-full truncate font-bold leading-tight" style={{ fontSize: nameSize }}>
                  {cell.bank.label}
                </span>
              )}
              {showValue && (
                <span className="w-full truncate leading-tight opacity-90" style={{ fontSize: 10 }}>
                  {cell.bank.value.toFixed(1)}亿
                  {mat > 0 && ` ${netText(cell.bank.netVolume)}`}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 图例说明 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-500">
        <span>面积 = 发行量</span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: hexToRgba(theme.up, 0.85) }} />
          净发行为正（发行 &gt; 到期）
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: hexToRgba(theme.down, 0.85) }} />
          净发行为负（发行 &lt; 到期）
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block w-2.5 h-2.5 rounded-[2px] border border-slate-200" style={{ backgroundColor: theme.surface3 }} />
          无到期数据
        </span>
      </div>
    </div>
  );
};
