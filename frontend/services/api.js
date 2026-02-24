// 后端 API 服务
import { io } from 'socket.io-client';

// 自动获取当前域名（支持本地和服务器）
const API_BASE = `${window.location.protocol}//${window.location.hostname}:3000/api`;
const WS_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;

// ========== HTTP API ==========

async function fetchQuotations() {
  const res = await fetch(`${API_BASE}/quotations`);
  if (!res.ok) throw new Error('获取报价失败');
  return res.json();
}

async function addQuotation(quote) {
  const res = await fetch(`${API_BASE}/quotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quote)
  });
  if (!res.ok) throw new Error('新增报价失败');
  return res.json();
}

async function updateQuotation(id, updates) {
  const res = await fetch(`${API_BASE}/quotations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (!res.ok) throw new Error('修改报价失败');
  return res.json();
}

async function deleteQuotation(id) {
  const res = await fetch(`${API_BASE}/quotations/${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('删除报价失败');
  return res.json();
}

async function fetchMaturities() {
  const res = await fetch(`${API_BASE}/maturities`);
  if (!res.ok) throw new Error('获取期限配置失败');
  return res.json();
}

async function updateMaturities(maturities) {
  const res = await fetch(`${API_BASE}/maturities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(maturities)
  });
  if (!res.ok) throw new Error('更新期限配置失败');
  return res.json();
}

// ========== WebSocket 实时同步 ==========

let socket = null;
let listeners = {
  onQuotationAdd: null,
  onQuotationUpdate: null,
  onQuotationDelete: null,
  onMaturityUpdate: null,
  onFullSync: null
};

export function initSocket() {
  if (socket?.connected) return socket;

  socket = io(WS_BASE, {
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('[Socket] 已连接:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('[Socket] 已断开');
  });

  // 全量数据同步（初始化）
  socket.on('sync:full', (data) => {
    console.log('[Socket] 收到全量数据:', data);
    if (listeners.onFullSync) listeners.onFullSync(data);
  });

  // 报价新增
  socket.on('quotation:add', (quote) => {
    console.log('[Socket] 收到新增报价:', quote);
    if (listeners.onQuotationAdd) listeners.onQuotationAdd(quote);
  });

  // 报价修改
  socket.on('quotation:update', (data) => {
    console.log('[Socket] 收到修改报价:', data);
    if (listeners.onQuotationUpdate) listeners.onQuotationUpdate(data);
  });

  // 报价删除
  socket.on('quotation:delete', (id) => {
    console.log('[Socket] 收到删除报价:', id);
    if (listeners.onQuotationDelete) listeners.onQuotationDelete(id);
  });

  // 期限配置更新
  socket.on('maturity:update', (maturities) => {
    console.log('[Socket] 收到期限配置更新:', maturities);
    if (listeners.onMaturityUpdate) listeners.onMaturityUpdate(maturities);
  });

  return socket;
}

export function emitQuotationAdd(quote) {
  socket?.emit('quotation:add', quote);
}

export function emitQuotationUpdate(data) {
  socket?.emit('quotation:update', data);
}

export function emitQuotationDelete(id) {
  socket?.emit('quotation:delete', id);
}

export function emitMaturityUpdate(maturities) {
  socket?.emit('maturity:update', maturities);
}

export function setSocketListeners(callbacks) {
  listeners = { ...listeners, ...callbacks };
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

// 导出 HTTP API 函数
export {
  fetchQuotations,
  addQuotation,
  updateQuotation,
  deleteQuotation,
  fetchMaturities,
  updateMaturities
};
