import cron from 'node-cron';
import { saveDatabase } from './database.js';

/**
 * 发行量统计定时任务
 * 每个工作日 17:20 自动更新
 *
 * 注意：实际数据来自 auto-quote 系统的爬虫数据
 * 本模块只负责统计和展示，不负责爬取
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

// 初始化定时任务
export function initScheduler() {
  console.log('[定时任务] 初始化发行量统计任务...');

  // 每个工作日 17:20 执行
  // cron 表达式：minute hour day-of-month month day-of-week
  const job = cron.schedule('20 17 * * 1-5', () => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);

    console.log(`[定时任务] 触发发行量统计任务 - ${dateStr}`);

    if (shouldRunToday()) {
      console.log('[定时任务] 今天是工作日，执行统计任务');
      // 注意：数据已经在 temp_quotes 表中，只需要保存数据库即可
      // 实际的统计查询在前端进行，这里只需要确保数据已保存
      saveDatabase();
      console.log('[定时任务] 数据库已保存');
    } else {
      console.log('[定时任务] 今天是节假日，跳过统计任务');
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Shanghai'
  });

  console.log('[定时任务] 发行量统计任务已启动（每个工作日 17:20）');

  return job;
}
