import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllQuotations,
  addQuotation,
  updateQuotation,
  deleteQuotation,
  getAllMaturities,
  upsertMaturity,
  getConfig,
  setConfig
} from '../database.js';

const router = express.Router();

// ========== 报价 API ==========

// 获取所有报价
router.get('/quotations', (req, res) => {
  try {
    const quotes = getAllQuotations();
    // 转换数据库字段名为前端需要的格式
    const formatted = quotes.map(q => ({
      id: q.id,
      bankName: q.bank_name,
      rating: q.rating,
      category: q.category || 'AAA',
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
    res.json(formatted);
  } catch (error) {
    console.error('[API] 获取报价失败:', error);
    res.status(500).json({ error: '获取报价失败' });
  }
});

// 新增报价
router.post('/quotations', (req, res) => {
  try {
    const quote = req.body;

    // 如果没有 ID，生成一个
    if (!quote.id) {
      quote.id = uuidv4();
    }

    // 转换字段名为数据库格式
    const dbQuote = {
      id: quote.id,
      bank_name: quote.bankName || '',
      rating: quote.rating || '',
      category: quote.category || 'AAA',
      tenor: quote.tenor || '',
      yield_rate: quote.yieldRate || '',
      weekday: quote.weekday || '',
      maturity_date: quote.maturityDate || '',
      maturity_weekday: quote.maturityWeekday || '',
      volume: quote.volume || '',
      remarks: quote.remarks || ''
    };

    const saved = addQuotation(dbQuote);

    // 返回前端格式
    res.json({
      id: saved.id,
      bankName: saved.bank_name,
      rating: saved.rating,
      category: saved.category || 'AAA',
      tenor: saved.tenor,
      yieldRate: saved.yield_rate,
      weekday: saved.weekday,
      maturityDate: saved.maturity_date,
      maturityWeekday: saved.maturity_weekday,
      volume: saved.volume,
      remarks: saved.remarks,
      createdAt: saved.created_at,
      updatedAt: saved.updated_at
    });
  } catch (error) {
    console.error('[API] 新增报价失败:', error);
    res.status(500).json({ error: '新增报价失败' });
  }
});

// 修改报价
router.put('/quotations/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // 转换字段名
    const dbUpdates = {};
    if (updates.bankName !== undefined) dbUpdates.bank_name = updates.bankName;
    if (updates.rating !== undefined) dbUpdates.rating = updates.rating;
    if (updates.category !== undefined) dbUpdates.category = updates.category;
    if (updates.tenor !== undefined) dbUpdates.tenor = updates.tenor;
    if (updates.yieldRate !== undefined) dbUpdates.yield_rate = updates.yieldRate;
    if (updates.weekday !== undefined) dbUpdates.weekday = updates.weekday;
    if (updates.maturityDate !== undefined) dbUpdates.maturity_date = updates.maturityDate;
    if (updates.maturityWeekday !== undefined) dbUpdates.maturity_weekday = updates.maturityWeekday;
    if (updates.volume !== undefined) dbUpdates.volume = updates.volume;
    if (updates.remarks !== undefined) dbUpdates.remarks = updates.remarks;

    const updated = updateQuotation(id, dbUpdates);

    if (!updated) {
      return res.status(404).json({ error: '报价不存在' });
    }

    res.json({
      id: updated.id,
      bankName: updated.bank_name,
      rating: updated.rating,
      category: updated.category || 'AAA',
      tenor: updated.tenor,
      yieldRate: updated.yield_rate,
      weekday: updated.weekday,
      maturityDate: updated.maturity_date,
      maturityWeekday: updated.maturity_weekday,
      volume: updated.volume,
      remarks: updated.remarks,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at
    });
  } catch (error) {
    console.error('[API] 修改报价失败:', error);
    res.status(500).json({ error: '修改报价失败' });
  }
});

// 删除报价
router.delete('/quotations/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = deleteQuotation(id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('[API] 删除报价失败:', error);
    res.status(500).json({ error: '删除报价失败' });
  }
});

// ========== 期限配置 API ==========

// 获取所有期限配置
router.get('/maturities', (req, res) => {
  try {
    const mats = getAllMaturities();
    const formatted = mats.map(m => ({
      tenor: m.tenor,
      date: m.date,
      weekday: m.weekday
    }));
    res.json(formatted);
  } catch (error) {
    console.error('[API] 获取期限配置失败:', error);
    res.status(500).json({ error: '获取期限配置失败' });
  }
});

// 更新期限配置
router.post('/maturities', (req, res) => {
  try {
    const mat = req.body;

    // 支持批量更新
    if (Array.isArray(mat)) {
      mat.forEach(m => upsertMaturity(m));
    } else {
      upsertMaturity(mat);
    }

    // 返回更新后的数据
    const all = getAllMaturities();
    res.json(all.map(m => ({
      tenor: m.tenor,
      date: m.date,
      weekday: m.weekday
    })));
  } catch (error) {
    console.error('[API] 更新期限配置失败:', error);
    res.status(500).json({ error: '更新期限配置失败' });
  }
});

// ========== 系统配置 API ==========

router.get('/config/:key', (req, res) => {
  try {
    const { key } = req.params;
    const value = getConfig(key);
    res.json({ key, value });
  } catch (error) {
    console.error('[API] 获取配置失败:', error);
    res.status(500).json({ error: '获取配置失败' });
  }
});

router.put('/config/:key', (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const result = setConfig(key, value);
    res.json(result);
  } catch (error) {
    console.error('[API] 设置配置失败:', error);
    res.status(500).json({ error: '设置配置失败' });
  }
});

export default router;
