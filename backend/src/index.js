import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

import apiRouter from './routes/api.js';
import dataRouter from './routes/data.js';
import { setupSocket } from './socket.js';
import { initDatabase } from './database.js';

// 加载环境变量
dotenv.config();

const app = express();
const httpServer = createServer(app);

// 配置 CORS - 允许所有本地端口和服务器
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));

// 中间件
app.use(express.json());

// API 路由
app.use('/api', apiRouter);
app.use('/api/data', dataRouter);

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
    let PORT = process.env.PORT || 3000;
    let HOST = process.env.HOST || '127.0.0.1';
    httpServer.listen(PORT, HOST, () => {
      console.log(`
╔═══════════════════════════════════════════════════╗
║     NCD 报价管理系统后端服务启动成功               ║
╠═══════════════════════════════════════════════════╣
║  监听地址：  ${HOST}:${PORT}
║  HTTP API:    http://${HOST}:${PORT}              ║
║  WebSocket:  ws://${HOST}:${PORT}                ║
║  健康检查：    http://${HOST}:${PORT}/health        ║
╚═══════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('[错误] 启动失败:', error);
    process.exit(1);
  }
}

startServer();
