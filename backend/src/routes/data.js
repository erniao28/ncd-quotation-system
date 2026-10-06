import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllSections,
  createSection,
  deleteSection,
  updateSection,
  getSectionFiles,
  addFile,
  deleteFile,
  getFileById,
  getSectionAnalysis,
  addAnalysisData,
  deleteAnalysisData,
  // 发行量统计
  getIssuanceByDate,
  getAvailableIssueDates,
  getIssuanceByBank,
  getIssuanceBankCompare,
  getMonthlyStats,
  syncIssuanceData,
  getIssuanceMatrix,
  addIssuanceRecords,
  // 到期量统计
  getMaturityDates,
  getMaturityByDate,
  getMonthlyMaturityStats,
  getMaturityMatrix,
  // 同业存单到期量（DM）
  getNcdMaturityByDate,
  getNcdMaturitySummary,
  getNcdMaturityBankSummary,
  getNcdMaturityDates,
  getNcdCategoryOptions,
  getNcdIssuanceState
} from '../database.js';
import { syncNcdDaily, backfillNcd, syncBankRatings } from '../dm.js';

const router = express.Router();

// ========== 板块管理 ==========

// 获取所有板块
router.get('/sections', (req, res) => {
  try {
    const sections = getAllSections();
    res.json(sections);
  } catch (error) {
    console.error('[API] 获取板块失败:', error);
    res.status(500).json({ error: '获取板块失败' });
  }
});

// 创建板块
router.post('/sections', (req, res) => {
  try {
    const { id, name, isCustom } = req.body;

    if (!id || !name) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const section = createSection(id, name, isCustom);
    res.json(section);
  } catch (error) {
    console.error('[API] 创建板块失败:', error);
    res.status(500).json({ error: '创建板块失败' });
  }
});

// 删除板块
router.delete('/sections/:id', (req, res) => {
  try {
    const { id } = req.params;
    deleteSection(id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('[API] 删除板块失败:', error);
    res.status(500).json({ error: '删除板块失败' });
  }
});

// 更新板块
router.put('/sections/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: '缺少板块名称' });
    }

    const section = updateSection(id, name);
    res.json(section);
  } catch (error) {
    console.error('[API] 更新板块失败:', error);
    res.status(500).json({ error: '更新板块失败' });
  }
});

// ========== 文件管理 ==========

// 获取板块的所有文件
router.get('/sections/:sectionId/files', (req, res) => {
  try {
    const { sectionId } = req.params;
    const files = getSectionFiles(sectionId);
    res.json(files);
  } catch (error) {
    console.error('[API] 获取文件列表失败:', error);
    res.status(500).json({ error: '获取文件列表失败' });
  }
});

// 上传文件
router.post('/sections/:sectionId/files', (req, res) => {
  try {
    const { sectionId } = req.params;
    const { filename, fileType, fileData, dataDate } = req.body;

    if (!filename || !fileType) {
      return res.status(400).json({ error: '缺少文件信息' });
    }

    const file = addFile({
      id: uuidv4(),
      section_id: sectionId,
      filename,
      file_type: fileType,
      file_data: fileData || null,
      data_date: dataDate || null
    });

    res.json(file);
  } catch (error) {
    console.error('[API] 上传文件失败:', error);
    res.status(500).json({ error: '上传文件失败' });
  }
});

// 删除文件
router.delete('/files/:id', (req, res) => {
  try {
    const { id } = req.params;
    deleteFile(id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('[API] 删除文件失败:', error);
    res.status(500).json({ error: '删除文件失败' });
  }
});

// 下载文件
router.get('/files/:id', (req, res) => {
  try {
    const { id } = req.params;
    const file = getFileById(id);

    if (!file) {
      return res.status(404).json({ error: '文件不存在' });
    }

    res.json(file);
  } catch (error) {
    console.error('[API] 获取文件失败:', error);
    res.status(500).json({ error: '获取文件失败' });
  }
});

// ========== 分析数据 ==========

// 获取板块的分析数据
router.get('/sections/:sectionId/analysis', (req, res) => {
  try {
    const { sectionId } = req.params;
    const analysis = getSectionAnalysis(sectionId);
    res.json(analysis);
  } catch (error) {
    console.error('[API] 获取分析数据失败:', error);
    res.status(500).json({ error: '获取分析数据失败' });
  }
});

// 保存分析数据
router.post('/sections/:sectionId/analysis', (req, res) => {
  try {
    const { sectionId } = req.params;
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({ error: '缺少分析数据' });
    }

    const analysis = addAnalysisData(uuidv4(), sectionId, data);
    res.json(analysis);
  } catch (error) {
    console.error('[API] 保存分析数据失败:', error);
    res.status(500).json({ error: '保存分析数据失败' });
  }
});

// 删除分析数据
router.delete('/analysis/:id', (req, res) => {
  try {
    const { id } = req.params;
    deleteAnalysisData(id);
    res.json({ success: true, id });
  } catch (error) {
    console.error('[API] 删除分析数据失败:', error);
    res.status(500).json({ error: '删除分析数据失败' });
  }
});

// ========== 发行量统计 API ==========

// 获取可用的发行日期列表
router.get('/issuance/dates', (req, res) => {
  try {
    const dates = getAvailableIssueDates();
    res.json(dates);
  } catch (error) {
    console.error('[API] 获取日期列表失败:', error);
    res.status(500).json({ error: '获取日期列表失败' });
  }
});

// 获取发行量矩阵数据（按银行 × 日期）
router.get('/issuance/matrix', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '缺少日期参数' });
    }
    const data = getIssuanceMatrix(startDate, endDate);
    res.json(data);
  } catch (error) {
    console.error('[API] 获取矩阵数据失败:', error);
    res.status(500).json({ error: '获取矩阵数据失败' });
  }
});

// 获取指定日期的发行量明细
router.get('/issuance/:date', (req, res) => {
  try {
    const { date } = req.params;
    const data = getIssuanceByDate(date);
    res.json(data);
  } catch (error) {
    console.error('[API] 获取发行量数据失败:', error);
    res.status(500).json({ error: '获取发行量数据失败' });
  }
});

// 获取银行统计（日期范围）
router.get('/issuance/stats/bank', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '缺少日期参数' });
    }
    const data = getIssuanceByBank(startDate, endDate);
    res.json(data);
  } catch (error) {
    console.error('[API] 获取银行统计失败:', error);
    res.status(500).json({ error: '获取银行统计失败' });
  }
});

// 获取银行发行量对比（含环比变化）
router.get('/issuance/stats/compare', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '缺少日期参数' });
    }
    const data = getIssuanceBankCompare(startDate, endDate);
    res.json(data);
  } catch (error) {
    console.error('[API] 获取银行对比数据失败:', error);
    res.status(500).json({ error: '获取对比数据失败' });
  }
});

// 获取月度统计
router.get('/issuance/stats/monthly', (req, res) => {
  try {
    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: '缺少月份参数' });
    }
    const data = getMonthlyStats(month);
    res.json(data);
  } catch (error) {
    console.error('[API] 获取月度统计失败:', error);
    res.status(500).json({ error: '获取月度统计失败' });
  }
});

// 手动录入发行量数据（追加，不覆盖）
router.post('/issuance/data', (req, res) => {
  try {
    const { records } = req.body;
    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: '缺少发行量数据' });
    }
    const result = addIssuanceRecords(records);
    res.json(result);
  } catch (error) {
    console.error('[API] 录入发行量数据失败:', error);
    res.status(500).json({ error: '录入发行量数据失败' });
  }
});

// 同步发行量数据
router.post('/issuance/sync', (req, res) => {
  try {
    const { quotes } = req.body;
    if (!quotes || !Array.isArray(quotes)) {
      return res.status(400).json({ error: '缺少数据参数' });
    }
    const result = syncIssuanceData(quotes);
    res.json(result);
  } catch (error) {
    console.error('[API] 同步发行量数据失败:', error);
    res.status(500).json({ error: '同步数据失败' });
  }
});

// ========== 到期量统计 API ==========

// 获取到期量矩阵数据（按银行 × 日期）
router.get('/maturity/matrix', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '缺少日期参数' });
    }
    const data = getMaturityMatrix(startDate, endDate);
    res.json(data);
  } catch (error) {
    console.error('[API] 获取到期量矩阵数据失败:', error);
    res.status(500).json({ error: '获取矩阵数据失败' });
  }
});

// 获取可用的到期日期列表
router.get('/maturity/dates', (req, res) => {
  try {
    const dates = getMaturityDates();
    res.json(dates);
  } catch (error) {
    console.error('[API] 获取到期日期列表失败:', error);
    res.status(500).json({ error: '获取日期列表失败' });
  }
});

// 获取指定日期的到期明细
router.get('/maturity/:date', (req, res) => {
  try {
    const { date } = req.params;
    const data = getMaturityByDate(date);
    res.json(data);
  } catch (error) {
    console.error('[API] 获取到期明细失败:', error);
    res.status(500).json({ error: '获取到期数据失败' });
  }
});

// 获取月度到期统计
router.get('/maturity/stats/monthly', (req, res) => {
  try {
    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ error: '缺少月份参数' });
    }
    const data = getMonthlyMaturityStats(month);
    res.json(data);
  } catch (error) {
    console.error('[API] 获取月度到期统计失败:', error);
    res.status(500).json({ error: '获取月度统计失败' });
  }
});

// ========== 同业存单到期量 API（DM 抓取） ==========

// 抓取状态（已入库条数、发行日范围）
router.get('/ncd-maturity/state', (req, res) => {
  try {
    res.json(getNcdIssuanceState());
  } catch (error) {
    res.status(500).json({ error: '获取抓取状态失败' });
  }
});

// 有到期数据的日期列表
router.get('/ncd-maturity/dates', (req, res) => {
  try {
    res.json(getNcdMaturityDates());
  } catch (error) {
    console.error('[API] 获取存单到期日期失败:', error);
    res.status(500).json({ error: '获取日期列表失败' });
  }
});

// 类别列表（大行国股 / AAA / AA+ … / 未评级）及各类别存单量
router.get('/ncd-maturity/categories', (req, res) => {
  try {
    res.json(getNcdCategoryOptions());
  } catch (error) {
    console.error('[API] 获取存单类别失败:', error);
    res.status(500).json({ error: '获取类别失败' });
  }
});

// 区间每日到期量汇总（可按类别 / 银行筛选）
router.get('/ncd-maturity/summary', (req, res) => {
  try {
    const { startDate, endDate, category, bank } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '缺少日期参数' });
    res.json(getNcdMaturitySummary(startDate, endDate, category || null, bank || null));
  } catch (error) {
    console.error('[API] 获取存单到期汇总失败:', error);
    res.status(500).json({ error: '获取汇总失败' });
  }
});

// 区间内按银行汇总（可按类别 / 银行筛选）
router.get('/ncd-maturity/bank-summary', (req, res) => {
  try {
    const { startDate, endDate, category, bank } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: '缺少日期参数' });
    res.json(getNcdMaturityBankSummary(startDate, endDate, category || null, bank || null));
  } catch (error) {
    console.error('[API] 获取存单银行汇总失败:', error);
    res.status(500).json({ error: '获取银行汇总失败' });
  }
});

// 触发抓取：{ mode: 'daily'（最近 5 天，默认） | 'backfill'(months) | 'ratings'(force) }
router.post('/ncd-maturity/sync', async (req, res) => {
  try {
    const { mode = 'daily', months = 13, force = false } = req.body || {};
    let result;
    if (mode === 'backfill') result = await backfillNcd(months);
    else if (mode === 'ratings') result = await syncBankRatings({ force });
    else result = await syncNcdDaily();
    res.json({ success: true, ...result, state: getNcdIssuanceState() });
  } catch (error) {
    console.error('[API] 抓取存单数据失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 指定到期日明细 + 按银行拆分（可按类别筛选）
router.get('/ncd-maturity/:date', (req, res) => {
  try {
    res.json(getNcdMaturityByDate(req.params.date, req.query.category || null));
  } catch (error) {
    console.error('[API] 获取存单到期明细失败:', error);
    res.status(500).json({ error: '获取明细失败' });
  }
});

export default router;
