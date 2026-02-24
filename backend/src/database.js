import initSqlJs from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || './data/ncd_data.db';
const fullDbPath = path.resolve(__dirname, '..', dbPath);

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

  // 保存到文件
  saveDatabase();

  console.log('[数据库] 表初始化完成');
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
    INSERT INTO quotations (id, bank_name, rating, tenor, yield_rate, weekday, maturity_date, maturity_weekday, volume, remarks, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    quote.id,
    quote.bank_name || '',
    quote.rating || '',
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

export {
  initDatabase,
  getAllQuotations,
  addQuotation,
  updateQuotation,
  deleteQuotation,
  getAllMaturities,
  upsertMaturity,
  getConfig,
  setConfig
};
