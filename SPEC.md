# 存单报价管理系统 - 技术规格说明书

## 1. 项目概述

### 1.1 项目背景
- **项目名称**：NCD 报价管理系统（NCD Quotation Manager）
- **项目类型**：多人实时协作的 Web 报价系统
- **核心功能**：支持多人同时在线编辑存单报价，实时同步所有用户的操作
- **目标用户**：银行间市场交易员、报价人员

### 1.2 现状与目标

**现状**：
- 纯前端应用，数据存在浏览器内存中
- 刷新页面数据丢失
- 无法多人同时操作

**目标**：
- 数据持久化存储
- 支持多人同时在线编辑
- 实时同步：一人修改，其他人立刻看到更新

---

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   用户A      │     │   用户B      │     │   用户C      │
│  (浏览器)    │     │  (浏览器)    │     │  (浏览器)    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │   WebSocket + HTTP                    │
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                  后端服务器 (Node.js)                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Express    │  │  Socket.io  │  │   业务逻辑   │ │
│  │  (HTTP API) │  │  (实时同步)  │  │             │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │    SQLite 数据库       │
              │    (ncd_data.db)       │
              └────────────────────────┘
```

### 2.2 技术选型

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 前端框架 | React | 19.x | 现有，保持不变 |
| 构建工具 | Vite | 6.x | 现有，保持不变 |
| 后端运行时 | Node.js | 20.x | LTS 版本 |
| Web 框架 | Express | 4.x | 处理 HTTP 请求 |
| 实时通信 | Socket.io | 4.x | WebSocket 封装，实现实时同步 |
| 数据库 | SQLite | - | 免安装文件数据库（纯 JS 版本） |
| ORM | sql.js | 1.11.0 | SQLite 的 JavaScript 实现，无需编译 |

### 2.3 目录结构

```
ncd-quotation-system/
├── backend/                    # 后端项目
│   ├── src/
│   │   ├── index.js           # 入口文件
│   │   ├── database.js       # 数据库初始化和操作
│   │   ├── socket.js         # WebSocket 事件处理
│   │   └── routes/
│   │       └── api.js        # HTTP API 接口
│   ├── data/
│   │   └── ncd_data.db      # SQLite 数据库文件
│   ├── package.json
│   └── .env                  # 环境变量配置
│
├── frontend/                   # 前端项目（现有）
│   └── [现有文件保持不变]
│
└── SPEC.md                     # 规格说明书
```

---

## 3. 数据库设计

### 3.1 数据表结构

#### 表：quotations（报价数据）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | TEXT | 主键，UUID 格式 |
| bank_name | TEXT | 银行名称 |
| rating | TEXT | 评级 (AAA, AA+) |
| tenor | TEXT | 期限 (1M, 3M, 6M, 9M, 1Y) |
| yield_rate | TEXT | 收益率（含涨跌标记） |
| weekday | TEXT | 起息日（周一~周日） |
| maturity_date | TEXT | 到期日期 |
| maturity_weekday | TEXT | 到期日是周几 |
| volume | TEXT | 成交量 |
| remarks | TEXT | 备注 |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

#### 表：maturities（期限基准日配置）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| tenor | TEXT | 期限 (主键) |
| date | TEXT | 到期日期 |
| weekday | TEXT | 到期日是周几 |

#### 表：system_config（系统配置）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| key | TEXT | 配置键 (主键) |
| value | TEXT | 配置值 |

---

## 4. API 接口设计

### 4.1 HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/quotations | 获取所有报价 |
| POST | /api/quotations | 新增报价 |
| PUT | /api/quotations/:id | 修改报价 |
| DELETE | /api/quotations/:id | 删除报价 |
| GET | /api/maturities | 获取所有期限配置 |
| POST | /api/maturities | 更新期限配置 |
| GET | /api/config/:key | 获取配置 |
| PUT | /api/config/:key | 设置配置 |

### 4.2 WebSocket 事件

| 事件名 | 方向 | 说明 |
|--------|------|------|
| connect | Client→Server | 客户端连接 |
| disconnect | Server→Client | 客户端断开 |
| quotation:add | 双向 | 新增报价 |
| quotation:update | 双向 | 修改报价 |
| quotation:delete | 双向 | 删除报价 |
| maturity:update | 双向 | 更新期限配置 |
| sync:full | Server→Client | 初始化时发送全量数据 |

---

## 5. 功能流程

### 5.1 用户操作流程

```
用户打开网页
      │
      ▼
连接 WebSocket + 拉取全量数据
      │
      ├── 用户输入报价 → 解析 → 发送到后端
      │                     │
      │                     ▼
      │              后端保存到数据库
      │                     │
      │                     ▼
      │              通过 WebSocket 广播给所有用户
      │                     │
      ▼                     ▼
所有用户界面自动更新◄────┘
```

### 5.2 数据同步策略

1. **新增报价**：实时广播给所有客户端
2. **修改报价**：实时广播修改后的数据
3. **删除报价**：实时广播删除通知
4. **连接时**：服务器发送全量数据给新连接的客户端

---

## 6. 部署说明

### 6.1 本地部署

```bash
# 1. 启动后端
cd backend
npm install
npm start

# 2. 启动前端（新终端）
cd frontend
npm run dev
```

### 6.2 访问地址

- 前端：http://localhost:5173
- 后端 API：http://localhost:3000
- WebSocket：ws://localhost:3000

---

## 7. 后续维护

### 7.1 添加新功能步骤

1. 修改数据库（在 database.js 中添加表或 添加后端 API字段）
2.（在 routes/api.js 中添加接口）
3. 添加 WebSocket 事件（如需实时同步）
4. 修改前端调用后端 API

### 7.2 常见维护操作

| 操作 | 位置 |
|------|------|
| 修改端口 | backend/.env |
| 清理数据 | 直接删除 backend/data/ncd_data.db |
| 查看日志 | 后端终端输出 |

---

## 8. 预期效果

- [x] 多人同时打开网页，看到相同数据
- [x] 一人修改报价，其他人的屏幕立刻更新
- [x] 刷新页面后数据仍然存在
- [x] 所有用户看到的数据保持一致

---

## 9. 启动说明

### 9.1 启动后端

```bash
cd E:\file\project_ai\cc_test\backend
npm install
npm start
```

### 9.2 启动前端

```bash
cd C:\gemini\游戏\2.0\1.0\cd\cd1.5
npm install
npm run dev
```

### 9.3 访问

- 前端：http://localhost:5173
- 后端：http://localhost:3000
- 健康检查：http://localhost:3000/health

---

## 10. 项目文件清单

| 路径 | 说明 |
|------|------|
| `cd_test/SPEC.md` | 规格说明书 |
| `cd_test/backend/` | 后端项目 |
| `cd_test/backend/package.json` | 后端依赖配置 |
| `cd_test/backend/src/index.js` | 后端入口 |
| `cd_test/backend/src/database.js` | 数据库操作 |
| `cd_test/backend/src/socket.js` | WebSocket 处理 |
| `cd_test/backend/src/routes/api.js` | HTTP API |
| `cd_test/backend/.env` | 环境变量 |
| `cd_test/frontend/` | 前端项目（你的AI生成的前端） |
| `cd_test/frontend/services/api.js` | 前端 API 服务（新增） |
| `cd_test/frontend/App.tsx` | 主应用（已修改） |

---

## 11. 启动说明（本地）

### 后端
```bash
cd E:\file\project_ai\cc_test\cd_test\backend
npm install
npm start
```

### 前端
```bash
cd E:\file\project_ai\cc_test\cd_test\frontend
npm install
npm run dev
```
