# NCD 报价系统 - 部署配置与注意事项

## 服务器部署核心配置

### 关键目录
- 项目路径：/root/ncd-quotation-system
- 前端构建输出：/root/ncd-quotation-system/frontend/dist/
- Nginx 静态文件目录：/var/www/html/ ← 必须复制到这里！

### 完整部署流程
1. cd /root/ncd-quotation-system
2. git pull origin master
3. cd frontend && rm -rf dist && npm run build
4. 【关键步骤】cp -r dist/* /var/www/html/
5. pm2 restart ncd-backend
6. 浏览器访问 http://121.40.35.46/ 强制刷新 Ctrl+Shift+R

### 部署清单（每次必查）
- [ ] 前端已重新构建（检查 dist 目录时间戳）
- [ ] 已复制到 /var/www/html/（最容易忘记！）
- [ ] 后端已重启 pm2 restart ncd-backend
- [ ] 浏览器强制刷新

### 常见问题排查
| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 代码更新但页面不变 | /var/www/html/ 是旧文件 | cp -r dist/* /var/www/html/ |
| 新版本功能不生效 | 浏览器缓存 | Ctrl+Shift+R 强制刷新 |
| API 请求失败 | 后端未重启 | pm2 restart ncd-backend |

### 服务器架构
IP 访问 (121.40.35.46)
  ├─ Nginx → /var/www/html/ (NCD 前端静态文件)
  └─ /api/* → localhost:3000 (NCD 后端)

域名访问 (kadegou48.top)
  └─ Nginx → localhost:5173 (kaguess 前端，禁止修改！)

### PM2 服务列表
- ncd-backend - NCD 后端，端口 3000
- kaguess-frontend - kaguess 前端，端口 5173（禁止修改）
- kaguess-server - kaguess 后端，端口 3001（禁止修改）

---

## 本地开发环境配置

### 固定端口
- **NCD 前端**: 5180（固定，避免端口浪费）
- **NCD 后端**: 3000（自动切换）
- **服务器后端**: 121.40.35.46（生产环境）

### 方案 A：前端直连服务器后端（推荐）
前端已配置为：本地环境自动连接服务器后端

```bash
# 只需启动前端
cd E:/file/project_ai/cc_test/cd_test/frontend
npm run dev

# 访问 http://localhost:5180/
# 前端会自动连接服务器后端，数据与服务器同步
```

### 方案 B：本地完整环境（离线开发）
```bash
# Windows 一键启动
start-dev.bat

# 或手动启动
# 1. 启动后端（端口冲突自动切换）
cd backend
node src/index.js

# 2. 启动前端（固定 5180 端口）
cd frontend
npm run dev
```

### 端口保护机制
- NCD 前端固定 5180 端口，不再每次递增
- 如果 5180 被占用，自动尝试 5181
- 后端 3000 被占用时自动尝试 3001、3002...
