# 服务器部署规范

> **重要：** 部署任何项目前必须遵循此流程，确保数据安全和服务正常运行。

---

## 部署前必看

### 1. 项目清单：`BACKEND_PROJECTS.md`
**位置：** `E:\file\project_ai\cc_test\BACKEND_PROJECTS.md`

**内容：**
- 所有后端项目清单
- 每个项目的端口、数据库路径、PM2 进程名
- Nginx 路径映射
- 快速检查命令

**用途：** 快速了解当前有哪些项目，避免配置冲突

---

### 2. 数据保护：`DATA_PROTECTION.md`
**位置：** `E:\file\project_ai\cc_test\DATA_PROTECTION.md`

**内容：**
- 各项目数据文件位置
- 备份命令和恢复流程
- 自动备份脚本使用方法

**用途：** 部署前先备份数据，防止丢失

---

## 部署检查清单

部署任何项目前，必须完成：

- [ ] **备份所有数据库** - 参考 DATA_PROTECTION.md
- [ ] **确认 PM2 进程名称** - 避免冲突
- [ ] **确认 Nginx 配置** - 检查路径映射
- [ ] **测试健康检查** - 验证服务正常
- [ ] **验证数据完整** - 确认备份可恢复

---

## 服务器信息

| 项目 | 信息 |
|------|------|
| **服务器 IP** | `121.40.35.46` |
| **SSH 配置** | `~/.ssh/config` 中的 `ncd-server` |
| **认证方式** | `~/.ssh/id_ncd_ai` |

---

## 快速命令

### 查看所有服务状态
```bash
ssh root@121.40.35.46 "pm2 list"
```

### 备份所有数据
```bash
cd E:/file/project_ai/cc_test
./backup-all.sh
```

### 检查所有 API 健康状态
```bash
# NCD
curl -s http://121.40.35.46:3000/health

# 爬虫
curl -s http://121.40.35.46:3002/health

# Chat
curl -s http://121.40.35.46:3457/health
```

---

## 新增项目时

在 `BACKEND_PROJECTS.md` 中添加新项目信息：

```markdown
### X. [项目名称]
| 项目 | 信息 |
|------|------|
| **PM2 进程名** | `xxx-server` |
| **端口** | `300X` |
| **数据库** | `/path/to/data.db` |
| **Nginx 路径** | `/xxx` → `localhost:300X` |
```

并在 `DATA_PROTECTION.md` 中添加数据备份命令。

---

## 简单记

- **部署前看** `DATA_PROTECTION.md` - 备份数据
- **日常维护看** `BACKEND_PROJECTS.md` - 查询配置
