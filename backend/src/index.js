import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

import apiRouter from './routes/api.js';
import { setupSocket } from './socket.js';
import { initDatabase } from './database.js';

// 加载环境变量
dotenv.config();

const app = express();
const httpServer = createServer(app);

// 配置 CORS
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));

// 中间件
app.use(express.json());

// API 路由
app.use('/api', apiRouter);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 初始化数据库后启动服务器
async function startServer() {
  try {
    await initDatabase();
    console.log('[数据库] 初始化完成');

    // 初始化 WebSocket
    const io = new Server(httpServer, {
      cors: {
        origin: corsOrigin,
        credentials: true
      }
    });

    setupSocket(io);

    // 启动服务器
    const PORT = process.env.PORT || 3000;
    httpServer.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════╗
║     NCD 报价管理系统后端服务启动成功               ║
╠═══════════════════════════════════════════════════╣
║  HTTP API:    http://localhost:${PORT}              ║
║  WebSocket:  ws://localhost:${PORT}                ║
║  健康检查:    http://localhost:${PORT}/health        ║
╚═══════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('[错误] 启动失败:', error);
    process.exit(1);
  }
}

startServer();
