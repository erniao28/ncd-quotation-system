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
    .threshold(183)
    .png()
    .toBuffer();

  const worker = await getWorker();

  await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
  const headerResult = await worker.recognize(headerImage, {}, { text: true, tsv: true });
  const headerWords = parseTsv(headerResult.data.tsv, 1 / BOARD_SCALE);

  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  const bodyResult = await worker.recognize(bodyImage, {}, { text: true, tsv: true });
  const bodyWords = parseTsv(bodyResult.data.tsv, 1 / BOARD_SCALE, headerBottom);

  for (const word of bodyWords) {
    word.color = sampleWordColor(rgb, width, height, info.channels, word);
  }

  return {
    board: true,
    width,
    height,
    headerBottom,
    headerText: headerResult.data.text || '',
    bodyText: bodyResult.data.text || '',
    headerWords,
    bodyWords,
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
      await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
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
