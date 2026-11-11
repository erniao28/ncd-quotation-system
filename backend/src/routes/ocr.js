import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';

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

router.post('/ocr', async (req, res) => {
  const { image } = req.body || {};

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
    const text = await enqueue(async () => {
      const worker = await getWorker();
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
