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
      uploaded_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (section_id) REFERENCES data_sections(id) ON DELETE CASCADE
    )
  `);

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

  // 初始化默认板块
  const defaultSections = [
    { id: 'maturity_date', name: '到期日', is_custom: 0 },
    { id: 'issuance_volume', name: '发行量', is_custom: 0 },
    { id: 'maturity_volume', name: '到期量', is_custom: 0 },
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
    INSERT INTO data_files (id, section_id, filename, file_type, file_path, file_data, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    file.id,
    file.section_id,
    file.filename,
    file.file_type,
    file.file_path || '',
    file.file_data || null,
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

export {
  initDatabase,
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
  deleteAnalysisData
};
