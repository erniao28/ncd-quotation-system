# NCD 报价管理系统

> 银行间存单一级市场报价管理系统 - 多人实时协作编辑

**线上地址**: http://121.40.35.46/

---

## 快速开始

### 本地开发

```bash
# 后端
cd backend
npm install
npm start

# 前端
cd frontend
npm install
npm run dev
```

### 生产部署

```bash
# 1. 拉取代码
git pull origin master

# 2. 构建前端
cd frontend
npm install
npm run build

# 3. 复制 dist 到 nginx 目录
cp -r dist/* /var/www/html/

# 4. 重启服务
nginx -s reload
cd ../backend
pm2 restart ncd-backend  # 或 npm start
```

---

## 功能特性

### 报价管理
- 支持多种报价格式解析（文本、Excel 复制）
- 智能识别银行名、评级、期限、收益率
- 支持模糊匹配和错别字纠正
- 收益率精度支持最多 4 位小数

### 视图模式
| 视图 | 说明 |
|------|------|
| 看板视图 | 按期限分组，卡片式展示 |
| 文字版 | 按期限分组，文本编辑模式 |
| 单条更新 | 所有报价逐条显示，支持时间/收益率排序 |

### 协作功能
- 多人实时在线编辑
- WebSocket 实时同步
- 报价变动自动广播给所有用户

### 操作便捷性
- 单击/拖动批量选中报价
- 一键同步到期日
- 支持选中复制、单行复制、全部复制
- 撤销功能（最多 10 步）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + TypeScript + Vite |
| 后端 | Node.js + Express |
| 实时通信 | Socket.io |
| 数据库 | SQLite (sql.js) |
| 部署 | Nginx |

---

## 数据结构

### 报价 (Quotation)
```typescript
interface Quotation {
  id: string;
  bankName: string;        // 银行名称
  rating: string;          // 评级：AAA/AA+/AA/AA-
  category: string;        // 类别：BIG/AAA/AA+/AA/AA-
  tenor: string;           // 期限：1M/3M/6M/9M/1Y
  yieldRate: string;       // 收益率（含↑↓标记）
  weekday: string;         // 起息日
  maturityDate: string;    // 到期日
  maturityWeekday: string; // 到期星期
  volume: string;          // 募集量
  remarks: string;         // 备注
  createdAt: number;       // 创建时间戳
  updatedAt: number;       // 更新时间戳
}
```

### 类别说明
| 类别 | 说明 |
|------|------|
| BIG | 大行（工农中建交邮储 + 股份行） |
| AAA | AAA 级城商行、农商行 |
| AA+ | AA+ 级银行 |
| AA | AA 级银行 |
| AA- | AA-级及以下银行 |

---

## 常用操作

### 解析报价
支持格式示例：
```
兴业银行 AAA 周一 1M 1.62%
工商银行 BIG 1Y 1.85% 50e
```

### 同步到期日
输入包含到期日的文本，自动解析：
```
(1M 到期日 2025/10/16 周四)
```

### 批量选中
- **单击**：单个选中/取消
- **拖动**：按住鼠标拖动批量选中

---

## 项目结构

```
ncd-quotation-system/
├── README.md              # 本文件
├── SPEC.md                # 技术规格说明书
├── backend/               # 后端代码
│   ├── src/
│   │   ├── index.js       # 入口
│   │   ├── database.js    # 数据库操作
│   │   ├── socket.js      # WebSocket
│   │   └── routes/
│   │       └── api.js     # HTTP API
│   └── data/
│       └── ncd_data.db    # SQLite 数据库
└── frontend/              # 前端代码
    ├── App.tsx            # 主应用
    ├── types.ts           # 类型定义
    ├── components/
    │   └── VisualCard.tsx # 看板视图组件
    └── services/
        ├── api.js         # API 服务
        └── parser.ts      # 报价解析器
```

---

## 更新日志

### 2026-03-07 - v1.2.0
**双击编辑优化**
- 修复收益率输入框无法编辑的问题，使用本地编辑状态实现自由编辑
- 双击编辑时支持删除、插入、自由移动光标
- 按 Enter 或失去焦点时自动提交并退出编辑模式

**选中功能修复**
- 修复 TEXT 视图和 LIST 视图单击选中失效的严重 Bug
- 点击行任意位置（包括输入框）都能选中并复制
- 拖拽选中功能正常工作

**界面优化**
- 银行类别和评级下拉框宽度调整，显示更完整
- 类别选项更新：大行&国股、AAA 城农商、AA+、AA-
- 评级选项增加 AA- 支持

**看板视图增强**
- 当两个面板折叠时，看板自动扩展（宽度 850px → 1100px，放大 110%）
- 边框统一优化：每行有统一的底边框贯穿所有类别列
- 恢复 AA- 类别列支持

**收益率编辑体验优化**
- 手动编辑收益率后，看板视图颜色自动变化（提价红色↑、降价绿色↓）
- 删除功能修复：可以自由删除数字，不再受光标位置限制
- 按 Enter 键自动退出编辑、选中并复制该行

### 2026-03-02
- 收益率精度调整为最多 4 位小数（自动去掉末尾多余的 0）
- 复选框支持单击和拖动批量选中（无需按 Shift）
- 修复 AA+/AA-报价类别显示问题
- 修复更新时间显示问题

### 2026-02-26 ~ 2026-03-01
- 新增"单条更新"标签页
- 恢复"文字版"标签页
- 修复银行名继承和多条报价解析
- 改进收益率识别：支持多种格式输入
- 改进复制功能：支持选中复制、全选、单行复制
- 支持多条报价解析、文字版编辑复制功能
- 支持报价行银行名继承

---

## 维护说明

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 端口冲突 | 修改 backend/.env 中的 PORT |
| 数据丢失 | 检查 backend/data/ncd_data.db 是否存在 |
| 无法连接后端 | 检查后端服务是否运行、防火墙设置 |

### 备份数据
```bash
# 备份数据库
cp backend/data/ncd_data.db ncd_data.db.backup.$(date +%Y%m%d)
```

---

## License

MIT
