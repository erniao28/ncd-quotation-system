# 多项目部署隔离指南

## 问题背景

同一台服务器上部署多个项目时，存在以下风险：
- 其他项目的 AI 助手可能误改 Nginx 配置
- 静态文件目录 `/var/www/html/` 可能被覆盖
- 防火墙规则可能被修改
- PM2 服务可能冲突

---

## 推荐架构

### 方案一：路径前缀隔离（推荐）

使用同一 IP，不同路径前缀访问各项目：

```
http://121.40.35.46/          → NCD 报价系统
http://121.40.35.46/cd/       → CD 报价系统
http://121.40.35.46/kaguess/  → Kaguess 系统
```

**Nginx 配置示例**：

```nginx
# NCD 项目（根路径）
server {
    listen 80;
    server_name 121.40.35.46;

    location / {
        root /var/www/ncd-quotation;
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /socket.io {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

### 方案二：独立目录隔离

每个项目使用独立的前端目录：

```bash
/var/www/
├── ncd-quotation/     # NCD 前端
├── cd-quotation/      # CD 前端
├── kaguess/           # Kaguess 前端
└── html/              # 默认目录（备用）
```

**优点**：
- 物理隔离，不会互相覆盖
- 每个项目独立管理
- 回滚不影响其他项目

---

## 配置保护清单

### NCD 项目关键配置

| 配置文件 | 路径 | 是否保护 |
|----------|------|----------|
| Nginx 配置 | `/etc/nginx/sites-available/ncd-quotation` | ⚠️ 高优先级 |
| Nginx 启用链接 | `/etc/nginx/sites-enabled/ncd-quotation` | ⚠️ 高优先级 |
| PM2 服务 | `ncd-backend` | ⚠️ 中优先级 |
| 后端 .env | `/root/ncd-quotation-system/backend/.env` | ⚠️ 中优先级 |
| 数据库 | `/root/ncd-quotation-system/backend/data/ncd_data.db` | ⚠️ 高优先级 |

### 保护建议

1. **配置前备份** - 修改任何配置前，先下载备份
2. **添加注释** - 在配置文件头部添加"禁止修改"注释
3. **权限控制** - 限制配置文件修改权限
4. **版本控制** - 所有配置纳入 Git 管理

---

## 部署检查清单

### 部署新项目前

- [ ] 确认 NCD 配置已备份 (`E:/file/backup/ncd-quotation-system/`)
- [ ] 确认新项目使用独立的 Nginx 配置文件
- [ ] 确认新后端绑定 `127.0.0.1` 而非 `0.0.0.0`
- [ ] 确认 PM2 服务名称不冲突
- [ ] 确认前端目录不覆盖现有项目

### 部署完成后

- [ ] NCD 服务正常 (`pm2 list` 显示在线)
- [ ] Nginx 配置有效 (`nginx -t` 通过)
- [ ] 各网站访问正常
- [ ] WebSocket 连接正常

---

## 紧急恢复流程

1. **确认问题**
   ```bash
   ssh root@121.40.35.46 "pm2 list"
   ssh root@121.40.35.46 "nginx -t"
   ```

2. **从备份恢复**
   ```bash
   cd E:/file/backup/ncd-quotation-system/scripts
   bash restore-to-server.sh
   ```

3. **验证服务**
   - 访问 http://121.40.35.46/
   - 检查 API 响应
   - 测试 WebSocket 连接

---

## 附录：常用命令

```bash
# 查看 Nginx 配置
ssh root@121.40.35.46 "cat /etc/nginx/sites-available/ncd-quotation"

# 查看 PM2 状态
ssh root@121.40.35.46 "pm2 list"
ssh root@121.40.35.46 "pm2 logs ncd-backend"

# 备份当前配置
ssh root@121.40.35.46 "cp /etc/nginx/sites-available/ncd-quotation /root/ncd-quotation-backup.conf"

# 恢复配置
ssh root@121.40.35.46 "cp /root/ncd-quotation-backup.conf /etc/nginx/sites-available/ncd-quotation"
ssh root@121.40.35.46 "nginx -t && nginx -s reload"
```

---

**文档版本**: 1.0
**最后更新**: 2026-03-16
