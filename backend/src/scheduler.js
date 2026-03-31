import cron from 'node-cron';
import { saveDatabase, syncIssuanceData } from './database.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 发行量统计定时任务
 * 每个工作日 17:20 自动更新
 *
 * 注意：实际数据来自 auto-quote 系统的爬虫数据
 * 本模块负责从 auto-quote 数据库同步数据并统计
 */

// 判断是否为工作日
function isWorkday() {
  const today = new Date();
  const day = today.getDay(); // 0 = Sunday, 6 = Saturday
  return day >= 1 && day <= 5; // 周一至周五
}

// 判断是否为节假日（需要手动配置）
// 格式：'YYYY-MM-DD': true 表示是节假日，false 表示调休上班
const holidayConfig = {
  // 示例：
  // '2026-04-04': true,  // 清明节放假
  // '2026-04-07': false, // 调休上班
};

function isHoliday(dateStr) {
  return holidayConfig[dateStr] === true;
}

function isWorkdayMakeup(dateStr) {
  return holidayConfig[dateStr] === false;
}

// 判断今天是否需要执行任务
function shouldRunToday() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);

  // 如果是配置的调休上班日，执行
  if (isWorkdayMakeup(dateStr)) {
    return true;
  }

  // 如果是节假日，不执行
  if (isHoliday(dateStr)) {
    return false;
  }

  // 否则按正常工作日判断
  return isWorkday();
}

// 从 auto-quote 数据库同步数据
async function syncFromAutoQuote() {
  try {
    // auto-quote 数据库路径（服务器环境）
    let autoQuoteDbPath = '/var/www/auto-quote/backend/data/cd_quote.db';

    // 检查数据库是否存在（服务器路径）
    if (!fs.existsSync(autoQuoteDbPath)) {
      // 尝试本地开发路径
      autoQuoteDbPath = path.resolve(__dirname, '../../auto-quote/backend/data/cd_quote.db');
    }

    // 检查数据库是否存在
    if (!fs.existsSync(autoQuoteDbPath)) {
      console.log('[定时任务] auto-quote 数据库不存在:', autoQuoteDbPath);
      return { success: false, reason: '数据库不存在' };
    }

    // 使用 sql.js 读取数据库
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const fileBuffer = fs.readFileSync(autoQuoteDbPath);
    const autoQuoteDb = new SQL.Database(fileBuffer);

    // 查询 temp_quotes 表
    const results = autoQuoteDb.exec('SELECT * FROM temp_quotes');

    if (!results || results.length === 0) {
      console.log('[定时任务] auto-quote 数据库中没有 temp_quotes 表');
      return { success: false, reason: '没有数据' };
    }

    // 转换为对象数组
    const columns = results[0].columns;
    const values = results[0].values;
    const quotes = values.map(row => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });

    // 同步到主数据库
    const result = syncIssuanceData(quotes);
    console.log('[定时任务] 同步成功，共', result.count, '条数据');

    return { success: true, count: result.count };
  } catch (error) {
    console.error('[定时任务] 同步失败:', error);
    return { success: false, error: error.message };
  }
}

// 初始化定时任务
export function initScheduler() {
  console.log('[定时任务] 初始化发行量统计任务...');

  // 每个工作日 17:20 执行
  // cron 表达式：minute hour day-of-month month day-of-week
  const job = cron.schedule('20 17 * * 1-5', async () => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);

    console.log(`[定时任务] 触发发行量统计任务 - ${dateStr}`);

    if (shouldRunToday()) {
      console.log('[定时任务] 今天是工作日，执行统计任务');
      const result = await syncFromAutoQuote();
      if (result.success) {
        console.log('[定时任务] 数据同步完成，共', result.count, '条');
      } else {
        console.log('[定时任务] 数据同步失败:', result.reason || result.error);
      }
    } else {
      console.log('[定时任务] 今天是节假日，跳过统计任务');
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  });

  console.log('[定时任务] 发行量统计任务已启动（每个工作日 17:20）');

  // 开发模式：立即执行一次测试
  if (process.env.NODE_ENV !== 'production') {
    console.log('[定时任务] 开发模式：5 秒后执行一次测试同步...');
    setTimeout(async () => {
      console.log('[定时任务] 执行测试同步...');
      const result = await syncFromAutoQuote();
      console.log('[定时任务] 测试结果:', result);
    }, 5000);
  }

  return job;
}
