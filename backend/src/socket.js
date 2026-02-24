import {
  getAllQuotations,
  getAllMaturities
} from './database.js';

export function setupSocket(io) {
  console.log('[WebSocket] 初始化中...');

  io.on('connection', (socket) => {
    console.log(`[WebSocket] 客户端连接: ${socket.id}`);

    // 发送全量数据给新连接的客户端
    const quotations = getAllQuotations().map(q => ({
      id: q.id,
      bankName: q.bank_name,
      rating: q.rating,
      tenor: q.tenor,
      yieldRate: q.yield_rate,
      weekday: q.weekday,
      maturityDate: q.maturity_date,
      maturityWeekday: q.maturity_weekday,
      volume: q.volume,
      remarks: q.remarks,
      createdAt: q.created_at,
      updatedAt: q.updated_at
    }));

    const maturities = getAllMaturities().map(m => ({
      tenor: m.tenor,
      date: m.date,
      weekday: m.weekday
    }));

    socket.emit('sync:full', {
      quotations,
      maturities
    });

    // ========== 报价事件 ==========

    // 新增报价
    socket.on('quotation:add', (quote) => {
      console.log(`[WebSocket] 新增报价: ${quote.bankName} - ${quote.yieldRate}`);
      // 广播给所有客户端（包括发送者，确保同步）
      io.emit('quotation:add', quote);
    });

    // 修改报价
    socket.on('quotation:update', (data) => {
      console.log(`[WebSocket] 修改报价: ${data.id}`);
      // 广播给所有客户端
      io.emit('quotation:update', data);
    });

    // 删除报价
    socket.on('quotation:delete', (id) => {
      console.log(`[WebSocket] 删除报价: ${id}`);
      io.emit('quotation:delete', id);
    });

    // ========== 期限配置事件 ==========

    socket.on('maturity:update', (maturities) => {
      console.log(`[WebSocket] 更新期限配置`);
      io.emit('maturity:update', maturities);
    });

    // 断开连接
    socket.on('disconnect', () => {
      console.log(`[WebSocket] 客户端断开: ${socket.id}`);
    });
  });

  console.log('[WebSocket] 初始化完成');
}
