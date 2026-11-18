import initSqlJs from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || '../data/ncd_data.db';
const fullDbPath = path.resolve(__dirname, dbPath);

// 确保 data 目录存在
const dataDir = path.dirname(fullDbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

// 初始化数据库
async function initDatabase() {
  const SQL = await initSqlJs();

  // 尝试加载已有数据库
  if (fs.existsSync(fullDbPath)) {
    const fileBuffer = fs.readFileSync(fullDbPath);
    db = new SQL.Database(fileBuffer);
    console.log('[数据库] 已加载已有数据库:', fullDbPath);
  } else {
    db = new SQL.Database();
    console.log('[数据库] 创建新数据库:', fullDbPath);
  }

  // 创建表
  db.run(`
    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      bank_name TEXT NOT NULL,
      rating TEXT DEFAULT '',
      category TEXT DEFAULT '',
      tenor TEXT NOT NULL,
      yield_rate TEXT DEFAULT '',
      weekday TEXT DEFAULT '',
      maturity_date TEXT DEFAULT '',
      maturity_weekday TEXT DEFAULT '',
      volume TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // 尝试添加 category 字段（如果表已存在）
  try {
    db.run('ALTER TABLE quotations ADD COLUMN category TEXT DEFAULT ""');
  } catch (e) {
    // 字段可能已存在，忽略
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS maturities (
      tenor TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      weekday TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // ========== 数据支持模块表 ==========

  // 数据板块配置表
  db.run(`
    CREATE TABLE IF NOT EXISTS data_sections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_custom INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `);

  // 数据文件表
  db.run(`
    CREATE TABLE IF NOT EXISTS data_files (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_path TEXT,
      file_data BLOB,
      data_date TEXT,
      uploaded_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (section_id) REFERENCES data_sections(id) ON DELETE CASCADE
    )
  `);

  // 迁移：为已存在的数据文件表添加 data_date 字段
  try {
    db.run('ALTER TABLE data_files ADD COLUMN data_date TEXT');
  } catch (_e) {
    // 列已存在则忽略
  }

  // 分析数据表（结构化数据）
  db.run(`
    CREATE TABLE IF NOT EXISTS analysis_data (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (section_id) REFERENCES data_sections(id) ON DELETE CASCADE
    )
  `);

  // 发行量统计表（从 auto-quote 系统同步）
  db.run(`
    CREATE TABLE IF NOT EXISTS temp_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_name TEXT NOT NULL,
      issue_name TEXT,
      volume TEXT,
      tenor TEXT,
      ref_yield TEXT,
      issue_date TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
  `);

  // 同业存单发行记录（从 DM 抓取，用于反推每日到期量及按银行拆分）
  // 存单到期日 = 起息日 + 期限，故按到期日聚合发行记录即得到每日到期明细
  // rating / bucket 为派生字段：rating 来自 DM 主体评级，bucket 为「大行国股」或评级
  db.run(`
    CREATE TABLE IF NOT EXISTS ncd_issuance (
      security_id TEXT PRIMARY KEY,
      issuer_name TEXT,
      sec_name TEXT,
      tenor TEXT,
      amount REAL,
      ref_yield REAL,
      issue_date TEXT,
      start_accrue_date TEXT,
      maturity_date TEXT,
      issue_status INTEGER,
      synced_at INTEGER
    )
  `);

  // 银行主体评级（DM com_rating），按银行名缓存
  db.run(`
    CREATE TABLE IF NOT EXISTS bank_rating (
      bank_name TEXT PRIMARY KEY,
      rating TEXT,
      rating_date TEXT,
      institution TEXT,
      updated_at INTEGER
    )
  `);

  // 迁移：给 ncd_issuance 补 rating / bucket 列（老库没有）
  for (const col of ['rating TEXT', 'bucket TEXT']) {
    try { db.run(`ALTER TABLE ncd_issuance ADD COLUMN ${col}`); } catch (e) { /* 已存在 */ }
  }

  // 创建索引以提高查询性能
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_issue_date ON temp_quotes(issue_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_bank_name ON temp_quotes(bank_name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ncd_maturity ON ncd_issuance(maturity_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ncd_issue ON ncd_issuance(issue_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ncd_bucket ON ncd_issuance(bucket)`);
  } catch (e) {
    console.log('[数据库] 索引创建跳过');
  }

  // 初始化默认板块
  const defaultSections = [
    { id: 'maturity_date', name: '到期日', is_custom: 0 },
    { id: 'issuance_volume', name: '发行量', is_custom: 0 },
    { id: 'maturity_volume', name: '到期量', is_custom: 0 },
    { id: 'ncd_maturity', name: '存单到期量', is_custom: 0 },
    { id: 'remaining_quota', name: '存单剩余额度', is_custom: 0 },
    { id: 'custom', name: '自定义板块', is_custom: 1 }
  ];

  defaultSections.forEach(section => {
    try {
      db.run(`INSERT OR IGNORE INTO data_sections (id, name, is_custom) VALUES (?, ?, ?)`,
        [section.id, section.name, section.is_custom]);
    } catch (e) {
      console.log('[数据库] 跳过已存在的板块:', section.id);
    }
  });

  // 保存到文件
  saveDatabase();

  console.log('[数据库] 表初始化完成（含数据支持模块）');
}

// 保存数据库到文件
function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(fullDbPath, buffer);
}

// ========== 报价操作 ==========

function getAllQuotations() {
  const stmt = db.prepare('SELECT * FROM quotations ORDER BY created_at DESC');
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function addQuotation(quote) {
  const now = Date.now();
  db.run(`
    INSERT INTO quotations (id, bank_name, rating, category, tenor, yield_rate, weekday, maturity_date, maturity_weekday, volume, remarks, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    quote.id,
    quote.bank_name || '',
    quote.rating || '',
    quote.category || '',
    quote.tenor,
    quote.yield_rate || '',
    quote.weekday || '',
    quote.maturity_date || '',
    quote.maturity_weekday || '',
    quote.volume || '',
    quote.remarks || '',
    now,
    now
  ]);

  saveDatabase();

  return { ...quote, created_at: now, updated_at: now };
}

function updateQuotation(id, updates) {
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key !== 'id') {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return null;

  fields.push('updated_at = ?');
  values.push(Date.now());
  values.push(id);

  db.run(`UPDATE quotations SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDatabase();

  // 返回更新后的数据
  const stmt = db.prepare('SELECT * FROM quotations WHERE id = ?');
  stmt.bind([id]);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function deleteQuotation(id) {
  db.run('DELETE FROM quotations WHERE id = ?', [id]);
  saveDatabase();
  return { id };
}

function deleteAllQuotations() {
  db.run('DELETE FROM quotations');
  saveDatabase();
}

// ========== 期限配置操作 ==========

function getAllMaturities() {
  const stmt = db.prepare('SELECT * FROM maturities');
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function upsertMaturity(mat) {
  db.run(`
    INSERT INTO maturities (tenor, date, weekday)
    VALUES (?, ?, ?)
    ON CONFLICT(tenor) DO UPDATE SET date = excluded.date, weekday = excluded.weekday
  `, [mat.tenor, mat.date, mat.weekday]);
  saveDatabase();
  return mat;
}

// ========== 系统配置操作 ==========

function getConfig(key) {
  const stmt = db.prepare('SELECT value FROM system_config WHERE key = ?');
  stmt.bind([key]);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject().value;
  }
  stmt.free();
  return result;
}

function setConfig(key, value) {
  db.run(`
    INSERT INTO system_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, value]);
  saveDatabase();
  return { key, value };
}

// ========== 数据支持模块操作 ==========

// 获取所有板块
function getAllSections() {
  const stmt = db.prepare('SELECT * FROM data_sections ORDER BY is_custom DESC, created_at ASC');
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// 创建板块
function createSection(id, name, isCustom = false) {
  db.run(`INSERT INTO data_sections (id, name, is_custom) VALUES (?, ?, ?)`,
    [id, name, isCustom ? 1 : 0]);
  saveDatabase();
  return { id, name, is_custom: isCustom ? 1 : 0 };
}

// 删除板块（级联删除文件和数据分析）
function deleteSection(id) {
  // 先删除关联的文件和分析数据
  db.run('DELETE FROM data_files WHERE section_id = ?', [id]);
  db.run('DELETE FROM analysis_data WHERE section_id = ?', [id]);
  db.run('DELETE FROM data_sections WHERE id = ?', [id]);
  saveDatabase();
  return { id };
}

// 更新板块
function updateSection(id, name) {
  db.run('UPDATE data_sections SET name = ? WHERE id = ?', [name, id]);
  saveDatabase();
  return { id, name };
}

// 获取板块的所有文件
function getSectionFiles(sectionId) {
  const stmt = db.prepare('SELECT * FROM data_files WHERE section_id = ? ORDER BY uploaded_at DESC');
  stmt.bind([sectionId]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// 添加文件
function addFile(file) {
  const now = Date.now();
  db.run(`
    INSERT INTO data_files (id, section_id, filename, file_type, file_path, file_data, data_date, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    file.id,
    file.section_id,
    file.filename,
    file.file_type,
    file.file_path || '',
    file.file_data || null,
    file.data_date || null,
    now
  ]);
  saveDatabase();
  return { ...file, uploaded_at: now };
}

// 删除文件
function deleteFile(id) {
  db.run('DELETE FROM data_files WHERE id = ?', [id]);
  saveDatabase();
  return { id };
}

// 获取文件（含二进制数据）
function getFileById(id) {
  const stmt = db.prepare('SELECT * FROM data_files WHERE id = ?');
  stmt.bind([id]);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// 获取板块的分析数据
function getSectionAnalysis(sectionId) {
  const stmt = db.prepare('SELECT * FROM analysis_data WHERE section_id = ? ORDER BY created_at DESC');
  stmt.bind([sectionId]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// 添加分析数据
function addAnalysisData(id, sectionId, dataJson) {
  const now = Date.now();
  db.run(`
    INSERT INTO analysis_data (id, section_id, data_json, created_at)
    VALUES (?, ?, ?, ?)
  `, [id, sectionId, JSON.stringify(dataJson), now]);
  saveDatabase();
  return { id, section_id: sectionId, data_json: dataJson, created_at: now };
}

// 删除分析数据
function deleteAnalysisData(id) {
  db.run('DELETE FROM analysis_data WHERE id = ?', [id]);
  saveDatabase();
  return { id };
}

// ========== 发行量统计操作（从 auto-quote 系统获取数据）==========

// 获取指定日期的发行量数据
function getIssuanceByDate(date) {
  const stmt = db.prepare(`
    SELECT bank_name, issue_name, volume, tenor, ref_yield
    FROM temp_quotes
    WHERE issue_date = ?
    ORDER BY bank_name, issue_name
  `);
  stmt.bind([date]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// 获取所有可用的发行日期
function getAvailableIssueDates() {
  const stmt = db.prepare(`
    SELECT DISTINCT issue_date as date
    FROM temp_quotes
    ORDER BY issue_date DESC
  `);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// ========== 同业存单到期量（DM 抓取） ==========

// 写入/更新同业存单发行记录（按 security_id 去重）
function upsertNcdIssuance(rows) {
  if (!rows || rows.length === 0) return { count: 0 };
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ncd_issuance
      (security_id, issuer_name, sec_name, tenor, amount, ref_yield,
       issue_date, start_accrue_date, maturity_date, issue_status, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  let count = 0;
  for (const r of rows) {
    if (!r.security_id) continue;
    stmt.run([
      r.security_id, r.issuer_name ?? null, r.sec_name ?? null, r.tenor ?? null,
      r.amount ?? null, r.ref_yield ?? null, r.issue_date ?? null,
      r.start_accrue_date ?? null, r.maturity_date ?? null,
      r.issue_status ?? null, now
    ]);
    count++;
  }
  stmt.free();
  saveDatabase();
  return { count };
}

// 已入库的发行记录数与发行日范围（用于增量判断）
function getNcdIssuanceState() {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count,
           MIN(issue_date) as min_issue_date,
           MAX(issue_date) as max_issue_date
    FROM ncd_issuance
  `);
  let row = { count: 0, min_issue_date: null, max_issue_date: null };
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

// ===== 类别（bucket）=====
// 「大行国股」= 6 家国有大行 + 12 家股份制银行，是固定名单，按银行名判定即可（既不依赖外部数据、也不会过时）
// 其余银行按 DM 主体评级归入 AAA / AA+ / … ；无评级归「未评级」
const BIG_KEYWORDS = [
  '工商银行', '农业银行', '中国银行', '建设银行', '交通银行', '邮储银行', '邮政储蓄',
  '兴业银行', '浦发银行', '民生银行', '中信银行', '光大银行', '华夏银行',
  '浙商银行', '渤海银行', '恒丰银行', '平安银行', '招商银行', '广发银行',
];
function isBigBank(name) {
  if (!name) return false;
  return BIG_KEYWORDS.some(k => name.includes(k));
}
// 前端可筛的评级桶（与用户确认的筛选项一致）；DM 里偶有 BBB+、数字等非标准值，统一归「其他」
const RATING_BUCKETS = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-'];
function ratingBucket(rating) {
  if (!rating) return '未评级';
  return RATING_BUCKETS.includes(rating) ? rating : '其他';
}
// 用 includes 而非前缀匹配，避免把「中国民生银行」「中国光大银行」误判成国有大行

// 写入/更新银行主体评级
function upsertBankRatings(rows) {
  if (!rows || rows.length === 0) return { count: 0 };
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO bank_rating (bank_name, rating, rating_date, institution, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  let count = 0;
  for (const r of rows) {
    if (!r.bank_name) continue;
    stmt.run([r.bank_name, r.rating ?? null, r.rating_date ?? null, r.institution ?? null, now]);
    count++;
  }
  stmt.free();
  saveDatabase();
  return { count };
}

// 还没有评级的银行（只查这些，避免重复调用）
function getBanksNeedingRating() {
  const stmt = db.prepare(`
    SELECT DISTINCT i.issuer_name
    FROM ncd_issuance i
    LEFT JOIN bank_rating r ON r.bank_name = i.issuer_name
    WHERE i.issuer_name IS NOT NULL AND r.bank_name IS NULL
  `);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject().issuer_name);
  stmt.free();
  return out;
}

// 全部发过存单的银行（强制重抓评级时用）
function getAllNcdIssuers() {
  const stmt = db.prepare(`SELECT DISTINCT issuer_name FROM ncd_issuance WHERE issuer_name IS NOT NULL`);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject().issuer_name);
  stmt.free();
  return out;
}

// 依据 银行名 + 评级 回填 ncd_issuance 的 bucket / rating
function refreshBankMeta() {
  const stmt = db.prepare(`SELECT DISTINCT issuer_name FROM ncd_issuance WHERE issuer_name IS NOT NULL`);
  const names = [];
  while (stmt.step()) names.push(stmt.getAsObject().issuer_name);
  stmt.free();

  const upd = db.prepare(`UPDATE ncd_issuance SET bucket = ?, rating = ? WHERE issuer_name = ?`);
  const getR = db.prepare(`SELECT rating FROM bank_rating WHERE bank_name = ?`);
  let n = 0;
  for (const name of names) {
    let rating = null;
    getR.bind([name]);
    if (getR.step()) rating = getR.getAsObject().rating;
    getR.reset();
    const bucket = isBigBank(name) ? '大行国股' : ratingBucket(rating);
    upd.run([bucket, rating, name]);
    n++;
  }
  getR.free();
  upd.free();
  saveDatabase();
  return { banks: n };
}

// 指定到期日的明细 + 按银行汇总 + 按期限汇总
// 排除 issue_status=3（取消发行）——这些存单实际未发行，不计入到期量
// 实测：不过滤为 1422.1 亿，过滤后 1413.1 亿，与 DM 官方统计一致
const TENOR_ORDER = ['1M', '3M', '6M', '9M', '1Y'];
function getNcdMaturityByDate(date, category) {
  const stmt = db.prepare(`
    SELECT issuer_name, sec_name, tenor, amount, ref_yield, security_id,
           rating, COALESCE(bucket, '未评级') as bucket
    FROM ncd_issuance
    WHERE maturity_date = ? AND (issue_status IS NULL OR issue_status != 3)
    ORDER BY amount DESC
  `);
  stmt.bind([date]);
  let records = [];
  while (stmt.step()) records.push(stmt.getAsObject());
  stmt.free();

  if (category) records = records.filter(r => r.bucket === category);

  const bankMap = {}, tenorMap = {};
  let total = 0;
  for (const r of records) {
    const amt = r.amount || 0;
    total += amt;
    const bank = r.issuer_name || r.sec_name || '未知';
    if (!bankMap[bank]) bankMap[bank] = { bank_name: bank, bucket: r.bucket, rating: r.rating, amount: 0, count: 0 };
    bankMap[bank].amount += amt;
    bankMap[bank].count += 1;
    const t = r.tenor || '其他';
    if (!tenorMap[t]) tenorMap[t] = { tenor: t, amount: 0, count: 0 };
    tenorMap[t].amount += amt;
    tenorMap[t].count += 1;
  }
  const banks = Object.values(bankMap)
    .map(b => ({ ...b, amount: +b.amount.toFixed(2) }))
    .sort((a, b) => b.amount - a.amount);
  const byTenor = Object.values(tenorMap)
    .map(t => ({ ...t, amount: +t.amount.toFixed(2) }))
    .sort((a, b) => {
      const ia = TENOR_ORDER.indexOf(a.tenor), ib = TENOR_ORDER.indexOf(b.tenor);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  return {
    date,
    total_amount: +total.toFixed(2),
    total_count: records.length,
    bank_count: banks.length,
    by_tenor: byTenor,
    banks,
    records,
  };
}

// 到期量按日汇总（区间），可按类别 / 银行筛选
// bank 用 instr() 做字面量模糊匹配（而非 LIKE），避免用户输入 % _ 被当成通配符
function getNcdMaturitySummary(startDate, endDate, category, bank) {
  const params = [startDate, endDate];
  let sql = `
    SELECT maturity_date as date,
           SUM(amount) as total_amount,
           COUNT(*) as total_count,
           COUNT(DISTINCT issuer_name) as bank_count
    FROM ncd_issuance
    WHERE maturity_date >= ? AND maturity_date <= ?
      AND (issue_status IS NULL OR issue_status != 3)`;
  if (category) { sql += " AND COALESCE(bucket, '未评级') = ?"; params.push(category); }
  if (bank) { sql += " AND instr(COALESCE(issuer_name, ''), ?) > 0"; params.push(bank); }
  sql += ' GROUP BY maturity_date ORDER BY maturity_date';

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    r.total_amount = +(r.total_amount || 0).toFixed(2);
    results.push(r);
  }
  stmt.free();
  return results;
}

// 区间内按银行汇总（可按类别 / 银行筛选）
function getNcdMaturityBankSummary(startDate, endDate, category, bank) {
  const params = [startDate, endDate];
  let sql = `
    SELECT COALESCE(issuer_name, sec_name, '未知') as bank_name,
           COALESCE(bucket, '未评级') as bucket,
           SUM(amount) as amount,
           COUNT(*) as count
    FROM ncd_issuance
    WHERE maturity_date >= ? AND maturity_date <= ?
      AND (issue_status IS NULL OR issue_status != 3)`;
  if (category) { sql += " AND COALESCE(bucket, '未评级') = ?"; params.push(category); }
  if (bank) { sql += " AND instr(COALESCE(issuer_name, ''), ?) > 0"; params.push(bank); }
  sql += ' GROUP BY bank_name ORDER BY amount DESC';

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    const r = stmt.getAsObject();
    r.amount = +(r.amount || 0).toFixed(2);
    results.push(r);
  }
  stmt.free();
  return results;
}

// 各类别的存单数量/金额（用于前端筛选下拉的计数展示）
function getNcdCategoryOptions() {
  const stmt = db.prepare(`
    SELECT COALESCE(bucket, '未评级') as bucket, COUNT(*) as count, ROUND(SUM(amount), 1) as amount
    FROM ncd_issuance
    WHERE issue_status IS NULL OR issue_status != 3
    GROUP BY bucket
  `);
  const out = {};
  while (stmt.step()) { const r = stmt.getAsObject(); out[r.bucket] = { count: r.count, amount: r.amount }; }
  stmt.free();
  return out;
}

// 有到期数据的日期列表
function getNcdMaturityDates() {
  const stmt = db.prepare(`
    SELECT DISTINCT maturity_date as date
    FROM ncd_issuance
    WHERE maturity_date IS NOT NULL AND (issue_status IS NULL OR issue_status != 3)
    ORDER BY maturity_date DESC
  `);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject().date);
  stmt.free();
  return results;
}

// 按银行统计发行量（指定日期范围内）
function getIssuanceByBank(startDate, endDate) {
  const stmt = db.prepare(`
    SELECT bank_name,
           COUNT(*) as count,
           SUM(CAST(REPLACE(REPLACE(volume, '亿元', ''), '亿', '') AS REAL) || 0) as total_volume
    FROM temp_quotes
    WHERE issue_date >= ? AND issue_date <= ?
    GROUP BY bank_name
    ORDER BY total_volume DESC
  `);
  stmt.bind([startDate, endDate]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// 把发行量里的简称和 DM 到期里的全称归一，便于匹配同一家银行
// 例：26建设银行 / 中国建设银行股份有限公司 → 建设银行
function normalizeBankKey(name) {
  return String(name || '')
    .replace(/^\d+/, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/股份有限公司|有限责任公司|有限公司/g, '')
    .replace(/^中国/, '')
    .replace(/^邮储/, '邮政储蓄')
    .replace(/^浦发/, '上海浦东发展')
    .replace(/农村商业银行|农商银行|农商行/g, '农商')
    .replace(/农村合作银行|农合银行/g, '农合')
    .replace(/\s/g, '')
    .trim();
}

// 区间内按银行汇总到期量（ncd_issuance = DM 抓取的存单发行记录，按到期日聚合）
function getNcdMaturityBankTotals(startDate, endDate) {
  const stmt = db.prepare(`
    SELECT COALESCE(issuer_name, sec_name, '未知') as bank_name, SUM(amount) as amount
    FROM ncd_issuance
    WHERE maturity_date >= ? AND maturity_date <= ?
      AND (issue_status IS NULL OR issue_status != 3)
    GROUP BY bank_name
  `);
  stmt.bind([startDate, endDate]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// 把到期量匹配到发行银行上：先精确，再互相包含（覆盖「微众银行 / 前海微众银行」这类简称差）
function matchMaturityToBanks(banks, maturityRows) {
  const rows = maturityRows.map(r => ({ key: normalizeBankKey(r.bank_name), amount: r.amount || 0 }));
  const out = {};
  for (const b of banks) {
    const key = normalizeBankKey(b.bank_name);
    let amount = 0;
    for (const r of rows) {
      if (r.key && (r.key === key || r.key.includes(key) || key.includes(r.key))) amount += r.amount;
    }
    out[b.bank_name] = amount;
  }
  return out;
}

// 银行发行量 vs 每日到期：净发行 = 区间发行量 − 区间到期量
function getIssuanceBankCompare(startDate, endDate) {
  const current = getIssuanceByBank(startDate, endDate);
  const maturityTotals = matchMaturityToBanks(current, getNcdMaturityBankTotals(startDate, endDate));

  return {
    period: { start: startDate, end: endDate },
    banks: current.map(item => {
      const totalVolume = +(item.total_volume || 0).toFixed(2);
      const maturityVolume = +(maturityTotals[item.bank_name] || 0).toFixed(2);
      return {
        bank_name: item.bank_name,
        count: item.count,
        total_volume: totalVolume,
        maturity_volume: maturityVolume,
        net_volume: +(totalVolume - maturityVolume).toFixed(2)
      };
    })
  };
}

// 获取发行量矩阵数据（按银行 × 日期 × 期限）
function getIssuanceMatrix(startDate, endDate) {
  const stmt = db.prepare(`
    SELECT bank_name, issue_date, tenor,
           COUNT(*) as count,
           SUM(CAST(REPLACE(REPLACE(volume, '亿元', ''), '亿', '') AS REAL) || 0) as total_volume
    FROM temp_quotes
    WHERE issue_date >= ? AND issue_date <= ?
    GROUP BY bank_name, issue_date, tenor
    ORDER BY bank_name, issue_date, tenor
  `);
  stmt.bind([startDate, endDate]);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();

  // 获取日期列表和银行列表
  const stmtDates = db.prepare(`
    SELECT DISTINCT issue_date as date FROM temp_quotes
    WHERE issue_date >= ? AND issue_date <= ?
    ORDER BY issue_date ASC
  `);
  stmtDates.bind([startDate, endDate]);
  const dates = [];
  while (stmtDates.step()) {
    dates.push(stmtDates.getAsObject().date);
  }
  stmtDates.free();

  const stmtBanks = db.prepare(`
    SELECT bank_name, SUM(CAST(REPLACE(REPLACE(volume, '亿元', ''), '亿', '') AS REAL) || 0) as total
    FROM temp_quotes
    WHERE issue_date >= ? AND issue_date <= ?
    GROUP BY bank_name
    ORDER BY total DESC
  `);
  stmtBanks.bind([startDate, endDate]);
  const banks = [];
  while (stmtBanks.step()) {
    const row = stmtBanks.getAsObject();
    banks.push({ bank_name: row.bank_name, total: row.total });
  }
  stmtBanks.free();

  // 获取所有期限列表
  const stmtTenors = db.prepare(`
    SELECT DISTINCT tenor FROM temp_quotes
    WHERE issue_date >= ? AND issue_date <= ? AND tenor != ''
    ORDER BY tenor
  `);
  stmtTenors.bind([startDate, endDate]);
  const tenors = [];
  while (stmtTenors.step()) {
    tenors.push(stmtTenors.getAsObject().tenor);
  }
  stmtTenors.free();

  return { dates, banks: banks.map(b => b.bank_name), tenors, data: results };
}

// 月度统计
function getMonthlyStats(yearMonth) {
  const stmt = db.prepare(`
    SELECT bank_name,
           COUNT(*) as count,
           SUM(CAST(REPLACE(REPLACE(volume, '亿元', ''), '亿', '') AS REAL) || 0) as total_volume
    FROM temp_quotes
    WHERE issue_date LIKE ?
    GROUP BY bank_name
    ORDER BY total_volume DESC
  `);
  stmt.bind([yearMonth + '%']);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// 同步发行量数据（从 auto-quote 系统）
function syncIssuanceData(quotes) {
  // 只清除本次同步涉及日期的旧数据，保留手工录入的其他日期数据
  const affectedDates = [...new Set(quotes.map(q => q.issue_date).filter(Boolean))];
  for (const date of affectedDates) {
    db.run('DELETE FROM temp_quotes WHERE issue_date = ?', [date]);
  }

  // 插入新数据
  const stmt = db.prepare(`
    INSERT INTO temp_quotes (bank_name, issue_name, volume, tenor, ref_yield, issue_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const quote of quotes) {
    stmt.run([
      quote.bank_name,
      quote.issue_name || '',
      quote.volume || '',
      quote.tenor || '',
      quote.ref_yield || '',
      quote.issue_date
    ]);
  }

  saveDatabase();
  return { success: true, count: quotes.length };
}

// 追加发行量数据（不覆盖已有数据，用于手动录入）
function addIssuanceRecords(records) {
  const stmt = db.prepare(`
    INSERT INTO temp_quotes (bank_name, issue_name, volume, tenor, ref_yield, issue_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const r of records) {
    if (!r.bank_name || !r.issue_date) continue;
    stmt.run([
      r.bank_name,
      r.issue_name || '',
      r.volume || '',
      r.tenor || '',
      r.ref_yield || '',
      r.issue_date
    ]);
    count++;
  }

  saveDatabase();
  return { success: true, count };
}

// ========== 到期量统计操作（从 quotation 表获取）==========

// 获取所有到期日期
function getMaturityDates() {
  const stmt = db.prepare(`
    SELECT DISTINCT maturity_date as date
    FROM quotations
    WHERE maturity_date IS NOT NULL AND maturity_date != ''
    ORDER BY maturity_date DESC
  `);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

// 获取指定日期的到期明细
function getMaturityByDate(date) {
  const stmt = db.prepare(`
    SELECT bank_name, tenor, yield_rate, volume
    FROM quotations
    WHERE maturity_date = ?
    ORDER BY bank_name, tenor
  `);
  stmt.bind([date]);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

// 获取月度到期统计
function getMonthlyMaturityStats(yearMonth) {
  const monthPrefix = yearMonth.replace('-', '/');
  const stmt = db.prepare(`
    SELECT bank_name, COUNT(*) as count
    FROM quotations
    WHERE maturity_date LIKE ?
    GROUP BY bank_name
    ORDER BY count DESC
  `);
  stmt.bind([monthPrefix + '%']);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

// 获取到期量矩阵数据（按银行 × 日期）
function getMaturityMatrix(startDate, endDate) {
  const stmt = db.prepare(`
    SELECT bank_name, maturity_date as issue_date, tenor,
           COUNT(*) as count,
           0 as total_volume
    FROM quotations
    WHERE maturity_date IS NOT NULL AND maturity_date != ''
      AND maturity_date >= ? AND maturity_date <= ?
    GROUP BY bank_name, maturity_date, tenor
    ORDER BY bank_name, maturity_date, tenor
  `);
  stmt.bind([startDate, endDate]);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();

  // 获取日期列表
  const stmtDates = db.prepare(`
    SELECT DISTINCT maturity_date as date FROM quotations
    WHERE maturity_date IS NOT NULL AND maturity_date != ''
      AND maturity_date >= ? AND maturity_date <= ?
    ORDER BY maturity_date ASC
  `);
  stmtDates.bind([startDate, endDate]);
  const dates = [];
  while (stmtDates.step()) dates.push(stmtDates.getAsObject().date);
  stmtDates.free();

  // 获取银行列表
  const stmtBanks = db.prepare(`
    SELECT bank_name, COUNT(*) as total
    FROM quotations
    WHERE maturity_date IS NOT NULL AND maturity_date != ''
      AND maturity_date >= ? AND maturity_date <= ?
    GROUP BY bank_name
    ORDER BY total DESC
  `);
  stmtBanks.bind([startDate, endDate]);
  const banks = [];
  while (stmtBanks.step()) banks.push(stmtBanks.getAsObject().bank_name);
  stmtBanks.free();

  // 获取期限列表
  const stmtTenors = db.prepare(`
    SELECT DISTINCT tenor FROM quotations
    WHERE maturity_date IS NOT NULL AND maturity_date != ''
      AND maturity_date >= ? AND maturity_date <= ? AND tenor != ''
    ORDER BY tenor
  `);
  stmtTenors.bind([startDate, endDate]);
  const tenors = [];
  while (stmtTenors.step()) tenors.push(stmtTenors.getAsObject().tenor);
  stmtTenors.free();

  return { dates, banks, tenors, data: results };
}

export {
  initDatabase,
  saveDatabase,
  getAllQuotations,
  addQuotation,
  updateQuotation,
  deleteQuotation,
  deleteAllQuotations,
  getAllMaturities,
  upsertMaturity,
  getConfig,
  setConfig,
  // 数据支持模块
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
  upsertNcdIssuance,
  getNcdIssuanceState,
  getNcdMaturityByDate,
  getNcdMaturitySummary,
  getNcdMaturityBankSummary,
  getNcdMaturityDates,
  // 银行主体评级 / 类别
  upsertBankRatings,
  getBanksNeedingRating,
  getAllNcdIssuers,
  refreshBankMeta,
  getNcdCategoryOptions
};
