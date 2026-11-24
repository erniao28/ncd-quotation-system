import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// best_int 版本只有约 1.7MB，识别效果与 20MB 版本一致
const LANG_PATH = path.resolve(__dirname, '../../node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int');
const CACHE_PATH = path.resolve(__dirname, '../../data/ocr-cache');
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

fs.mkdirSync(CACHE_PATH, { recursive: true });

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('chi_sim', 1, {
      langPath: LANG_PATH,
      cachePath: CACHE_PATH,
      logger: () => {},
    }).catch(error => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

// Tesseract worker 一次只能处理一张图，用队列串行化
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

// ---------- 看板图（蓝色表头 + 多期限列）识别 ----------

const BOARD_SCALE = 4;

// 表头是白字蓝底，按“蓝色像素占比”找出表头带
function detectHeaderBottom(data, width, height, channels) {
  const minRowPixels = width * 0.2;
  const maxRow = Math.min(height, Math.round(height * 0.25));
  let lastBlueRow = -1;
  let blueRows = 0;

  for (let y = 0; y < maxRow; y++) {
    let count = 0;
    const rowStart = y * width * channels;
    for (let x = 0; x < width; x += 2) {
      const i = rowStart + x * channels;
      const r = data[i];
      const b = data[i + 2];
      if (b > r + 15 && r < 220 && b > 80) count += 2;
    }
    if (count >= minRowPixels) {
      lastBlueRow = y;
      blueRows++;
    }
  }

  return blueRows >= 3 ? lastBlueRow + 1 : 0;
}

function parseTsv(tsv, scale, topOffset = 0) {
  if (!tsv) return [];
  const words = [];

  for (const line of tsv.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 12 || parts[0] !== '5') continue;

    const text = parts.slice(11).join('\t').trim();
    if (!text) continue;

    const conf = Number(parts[10]);
    if (Number.isFinite(conf) && conf < 0) continue;

    words.push({
      text,
      left: Math.round(Number(parts[6]) * scale),
      top: Math.round(Number(parts[7]) * scale + topOffset),
      width: Math.round(Number(parts[8]) * scale),
      height: Math.round(Number(parts[9]) * scale),
      conf: Number.isFinite(conf) ? conf : 0,
    });
  }

  return words;
}

// ---------- 左侧评级分组（白字蓝底） ----------

const SECTION_LABEL_RE = /国有|股份制|国股|大行|城商|农商|AAA|AA\+|AA-/i;
const SECTION_BAND_CROP = 140;      // 左侧色带裁剪宽度
const SECTION_BAND_TEXT_MAX_X = 108; // 色带内文字的右边界，避免把银行名当成分组标签

// “AAA+”/“AAAA” 这类结果其实就是 AA+（评级里不存在 AAA+），OCR 常把 + 前面多认一个 A
function normalizeSectionText(raw) {
  const text = (raw || '').replace(/\s+/g, '');
  if (!text) return '';
  if (/A{2,}\+/.test(text)) return 'AA+';
  if (/A{2,}-/.test(text)) return 'AA-';
  if (/AAA/i.test(text)) return 'AAA';
  return text;
}

// 色带标签字号小，中文常被认花（如“国有/股份制”→“习有/用份制”），用词典做模糊匹配
const SECTION_VOCAB = ['国有/股份制', '国有大行', '股份制', '国股', '大行', '城商行', '农商行', '民营银行', '外资银行', '政策性银行'];

function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[rows - 1][cols - 1];
}

function matchSectionLabel(raw) {
  const text = normalizeSectionText(raw);
  if (!text) return '';
  if (SECTION_LABEL_RE.test(text)) return text;

  let best = '';
  let bestScore = 0;
  for (const word of SECTION_VOCAB) {
    const score = 1 - editDistance(text, word) / Math.max(text.length, word.length);
    if (score > bestScore) {
      bestScore = score;
      best = word;
    }
  }
  return bestScore >= 0.55 ? best : '';
}

// 分组之间的分界是贯穿色带的白色分隔线
function findSectionDividers(rgb, width, height, channels, headerBottom) {
  const x0 = 3;
  const x1 = Math.min(100, width);
  const minWhite = Math.round((x1 - x0) * 0.8);
  const dividers = [];
  let runStart = -1;

  for (let y = headerBottom; y < height; y++) {
    let white = 0;
    const rowStart = y * width * channels;
    for (let x = x0; x < x1; x++) {
      const i = rowStart + x * channels;
      if (rgb[i] > 235 && rgb[i + 1] > 235 && rgb[i + 2] > 235) white++;
    }
    const isDivider = white >= minWhite;
    if (isDivider && runStart < 0) runStart = y;
    if ((!isDivider || y === height - 1) && runStart >= 0) {
      dividers.push(Math.round((runStart + y - 1) / 2));
      runStart = -1;
    }
  }

  return dividers.filter(d => d > headerBottom + 8 && d < height - 8);
}

// 先找出色带里白字所在的行区间，再逐个裁剪识别（整条窄长色带直接喂 Tesseract 识别不出来）
function findLabelRows(rgb, width, height, channels, headerBottom) {
  const x0 = 3;
  const x1 = Math.min(100, width);
  const rows = [];
  let start = -1;

  for (let y = headerBottom; y < height; y++) {
    let white = 0;
    const rowStart = y * width * channels;
    for (let x = x0; x < x1; x++) {
      const i = rowStart + x * channels;
      if (rgb[i] > 235 && rgb[i + 1] > 235 && rgb[i + 2] > 235) white++;
    }
    const hasText = white >= 6;
    if (hasText && start < 0) start = y;
    if ((!hasText || y === height - 1) && start >= 0) {
      const end = y - 1;
      const center = (start + end) / 2;
      if (center > headerBottom + 12 && center < height - 12 && end - start >= 3) {
        rows.push([start, end]);
      }
      start = -1;
    }
  }

  return rows;
}

// 评级分组是白字蓝底，反色后逐行识别，按 y 坐标还原分组位置
async function recognizeSectionLabels(buffer, width, height, headerBottom, rgb, channels) {
  const rows = findLabelRows(rgb, width, height, channels, headerBottom);
  if (rows.length === 0) return [];

  const bandWidth = Math.min(SECTION_BAND_CROP, width);
  const worker = await getWorker();
  const labels = [];

  const recognizeImage = async (top, image, scale = BOARD_SCALE) => {
    // 单行模式逐块识别；+ / - 和中文类别名都可能在标签里
    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: '',
    });
    const { data } = await worker.recognize(image, {}, { text: true, tsv: true });
    return parseTsv(data.tsv, 1 / scale, top)
      .filter(word => word.left <= SECTION_BAND_TEXT_MAX_X)
      .map(word => word.text)
      .join('')
      .replace(/\s+/g, '');
  };

  const fullCrop = async (top, bottom, whitelist) => {
    const pipeline = sharp(buffer, { failOn: 'none' })
      .removeAlpha()
      .extract({ left: 0, top, width: bandWidth, height: bottom - top })
      .negate()
      .grayscale()
      .normalise()
      .resize({ width: bandWidth * BOARD_SCALE, kernel: 'lanczos3' });
    const image = await pipeline.png().toBuffer();
    if (!whitelist) return recognizeImage(top, image);
    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: whitelist,
    });
    const { data } = await worker.recognize(image, {}, { text: true, tsv: true });
    return parseTsv(data.tsv, 1 / BOARD_SCALE, top)
      .filter(word => word.left <= SECTION_BAND_TEXT_MAX_X)
      .map(word => word.text)
      .join('')
      .replace(/\s+/g, '');
  };

  // “AA+”的加号笔画太细，常规预处理经常丢掉；高倍放大+二值化能稳定保住加号
  const tightCrop = async (start, end, whitelist) => {
    const left = 4;
    const cropWidth = Math.min(76, width - left);
    const top = Math.max(0, start - 6);
    const bottom = Math.min(height, end + 6);
    const image = await sharp(buffer, { failOn: 'none' })
      .removeAlpha()
      .extract({ left, top, width: cropWidth, height: bottom - top })
      .grayscale()
      .resize({ width: cropWidth * 12, kernel: 'lanczos3' })
      .normalise()
      .threshold(235)
      .negate()
      .extend({ top: 12, bottom: 12, left: 12, right: 12, background: '#ffffff' })
      .png()
      .toBuffer();
    if (!whitelist) return recognizeImage(top, image, 12);

    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: whitelist,
    });
    const { data } = await worker.recognize(image, {}, { text: true, tsv: true });
    return parseTsv(data.tsv, 1 / 12, top)
      .filter(word => word.left <= SECTION_BAND_TEXT_MAX_X)
      .map(word => word.text)
      .join('')
      .replace(/\s+/g, '');
  };

  for (const [start, end] of rows) {
    const top = Math.max(0, start - 8);
    const bottom = Math.min(height, end + 8);

    const candidates = [
      await fullCrop(top, bottom, ''),
      await fullCrop(top, bottom, 'AA+ -国有股大行份制城农商金'),
      await tightCrop(start, end, ''),
      await tightCrop(start, end, 'AA+-'),
    ].map(matchSectionLabel).filter(Boolean);

    // 带 +/- 的结果优先（AA+ / AA-），避免把加号丢掉后误判成 AAA
    const text = candidates.find(item => /AA[+-]/.test(item)) || candidates[0];
    if (process.env.OCR_DEBUG) console.log('[OCR] label row', start, end, 'candidates:', JSON.stringify(candidates));
    if (text) {
      labels.push({ text, top: start, bottom: end, center: (start + end) / 2 });
    }
  }

  return labels;
}

function buildSections(labels, dividers, headerBottom, height) {
  // 按分隔线切段；太窄的碎条一般是底边框，丢弃
  const bounds = [headerBottom, ...dividers, height];
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] - bounds[i] >= 40) {
      sections.push({ text: '', top: bounds[i], bottom: bounds[i + 1] });
    }
  }
  if (sections.length === 0) sections.push({ text: '', top: headerBottom, bottom: height });

  for (const label of labels) {
    const section = sections.find(item => label.center >= item.top && label.center < item.bottom);
    if (section) section.text = section.text ? `${section.text} ${label.text}` : label.text;
  }

  // 两段看板只认出一个标签时，按评级自上而下由高到低的惯例推断另一段
  if (sections.length === 2) {
    const [top, bottom] = sections;
    if (top.text && !bottom.text && !/AA\+|AA-/.test(top.text)) {
      bottom.text = 'AA+';
      bottom.inferred = true;
    } else if (bottom.text && !top.text && /AA\+|AA-/.test(bottom.text)) {
      top.text = 'AAA';
      top.inferred = true;
    }
  }

  return sections;
}

// 在原图上取词块颜色，判断收益率标记是红色（↑）还是绿色（↓）
function sampleWordColor(data, width, height, channels, word) {
  const left = Math.max(0, word.left);
  const top = Math.max(0, word.top);
  const right = Math.min(width, word.left + Math.max(word.width, 4));
  const bottom = Math.min(height, word.top + Math.max(word.height, 4));
  let red = 0;
  let green = 0;

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > g + 30 && r > b + 30 && r > 90) red++;
      else if (g > r + 20 && g > b + 20 && g > 70) green++;
    }
  }

  if (red >= 3 && red > green) return 'red';
  if (green >= 3 && green > red) return 'green';
  return 'black';
}

async function recognizeBoard(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) throw new Error('无法读取图片尺寸');

  const { data: rgb, info } = await sharp(buffer, { failOn: 'none' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const headerBottom = detectHeaderBottom(rgb, width, height, info.channels);
  if (headerBottom < 8) {
    return { board: false };
  }

  const headerHeight = Math.min(height, headerBottom + 10);
  const headerImage = await sharp(buffer, { failOn: 'none' })
    .removeAlpha()
    .extract({ left: 0, top: 0, width, height: headerHeight })
    .negate()
    .grayscale()
    .resize({ width: width * BOARD_SCALE, kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const bodyImage = await sharp(buffer, { failOn: 'none' })
    .removeAlpha()
    .extract({ left: 0, top: headerBottom, width, height: height - headerBottom })
    .resize({ width: width * BOARD_SCALE, kernel: 'lanczos3' })
    .grayscale()
    .normalise()
    .threshold(210)
    .png()
    .toBuffer();

  const worker = await getWorker();

  await worker.setParameters({
    tessedit_pageseg_mode: '3',
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: '',
  });
  const headerResult = await worker.recognize(headerImage, {}, { text: true, tsv: true });
  const headerWords = parseTsv(headerResult.data.tsv, 1 / BOARD_SCALE);

  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: '',
  });
  const bodyResult = await worker.recognize(bodyImage, {}, { text: true, tsv: true });
  const bodyWords = parseTsv(bodyResult.data.tsv, 1 / BOARD_SCALE, headerBottom);

  for (const word of bodyWords) {
    word.color = sampleWordColor(rgb, width, height, info.channels, word);
  }

  const labels = await recognizeSectionLabels(buffer, width, height, headerBottom, rgb, info.channels);
  const dividers = findSectionDividers(rgb, width, height, info.channels, headerBottom);
  const sections = buildSections(labels, dividers, headerBottom, height);
  if (process.env.OCR_DEBUG) {
    console.log('[OCR] headerBottom', headerBottom, 'dividers', JSON.stringify(dividers),
      'labels', JSON.stringify(labels), 'sections', JSON.stringify(sections));
  }

  const warnings = [];
  sections.forEach((section, index) => {
    if (!section.text) {
      warnings.push(`第 ${index + 1} 段未识别到评级标签，默认按 AAA 处理，请核对`);
    } else if (section.inferred) {
      warnings.push(`第 ${index + 1} 段未识别到评级标签，已按 ${section.text} 推定，请核对`);
    }
  });

  return {
    board: true,
    width,
    height,
    headerBottom,
    headerText: headerResult.data.text || '',
    bodyText: bodyResult.data.text || '',
    headerWords,
    bodyWords,
    sections,
    warnings,
  };
}

router.post('/ocr', async (req, res) => {
  const { image, mode } = req.body || {};

  if (typeof image !== 'string' || !image) {
    return res.status(400).json({ error: '缺少图片数据' });
  }

  const base64 = image.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0) {
    return res.status(400).json({ error: '图片数据为空' });
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: '图片过大，请压缩后再试' });
  }

  try {
    if (mode === 'board') {
      const result = await enqueue(() => recognizeBoard(buffer));
      return res.json(result);
    }

    const text = await enqueue(async () => {
      const worker = await getWorker();
      await worker.setParameters({
        tessedit_pageseg_mode: '3',
        preserve_interword_spaces: '1',
        tessedit_char_whitelist: '',
      });
      const { data } = await worker.recognize(buffer);
      return data.text || '';
    });
    res.json({ text });
  } catch (error) {
    console.error('[OCR] 识别失败:', error);
    res.status(500).json({ error: '图片识别失败' });
  }
});

export default router;
