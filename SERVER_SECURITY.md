# 服务器安全配置指南

## 概述

本文档说明如何在同一台阿里云服务器上安全地部署多个 Node.js 后端项目。

---

## 安全架构

### 核心原则

1. **后端服务只监听本地回环地址 (127.0.0.1)** - 不直接暴露到公网
2. **Nginx 反向代理** - 所有外部请求通过 Nginx 转发到后端
3. **防火墙隔离** - 只开放必要的端口

### 网络架构图

```
外部用户 → 防火墙 (ufw) → Nginx (80/443) → 后端服务 (127.0.0.1:300x)
                              ↓
                        静态文件 (/var/www/html)
```

---

## 配置步骤

### 1. 配置后端监听地址

#### 修改 `.env` 文件

在每个后端项目的 `backend/.env` 中添加：

```env
PORT=3000
HOST=127.0.0.1
```

#### 修改 `src/index.js`

确保 `listen()` 调用使用 HOST 参数：

```javascript
let PORT = process.env.PORT || 3000;
let HOST = process.env.HOST || '127.0.0.1';

httpServer.listen(PORT, HOST, () => {
  console.log(`服务器启动于 http://${HOST}:${PORT}`);
});
```

#### 验证监听地址

```bash
netstat -tlnp | grep 3000
```

**正确输出**（只监听本地）：
```
tcp   0   0   127.0.0.1:3000   0.0.0.0:*   LISTEN   12345/node
```

**错误输出**（监听所有接口 - 不安全）：
```
tcp   0   0   0.0.0.0:3000   0.0.0.0:*   LISTEN   12345/node
```

---

### 2. 配置 Nginx 反向代理

为每个项目创建独立的 Nginx 配置文件：

```bash
sudo vim /etc/nginx/sites-available/ncd-quotation
```

#### 配置示例

```nginx
server {
    listen 80;
    server_name 121.40.35.46;  # 或域名

    # 前端静态文件
    location / {
        root /var/www/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 代理
    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket 代理（Socket.io）
    location /socket.io {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

#### 启用配置

```bash
sudo ln -s /etc/nginx/sites-available/ncd-quotation /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### 3. 配置防火墙 (ufw)

#### 开放必要端口

```bash
# SSH（必须先开放，否则会被锁在服务器外）
sudo ufw allow 22/tcp

# HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 可选：如果某些项目需要直接访问后端端口（不推荐）
# sudo ufw deny 3000/tcp
# sudo ufw deny 3002/tcp
# sudo ufw deny 3003/tcp
```

#### 启用防火墙

```bash
sudo ufw enable
```

#### 验证状态

```bash
# 方法 1：检查 ufw 状态
sudo ufw status verbose

# 方法 2：检查 iptables 规则（如果 ufw status 失败）
sudo iptables -L -n -v
```

**预期输出**（看到防火墙规则即表示已启用）：
```
Chain ufw-user-input (1 references)
target     prot opt source               public
ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:22
ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:80
ACCEPT     tcp  --  0.0.0.0/0            0.0.0.0/0            tcp dpt:443
```

---

## 多项目共存方案

### 方案 A：路径前缀隔离（推荐）

使用同一个域名，不同路径前缀：

| 项目 | 访问地址 | Nginx 配置 |
|------|----------|-----------|
| NCD 报价 | `http://IP/` | `location /` |
| CD 报价 | `http://IP/cd/` | `location /cd/` |
| Kaguess | `http://IP/kaguess/` | `location /kaguess/` |

**优点**：
- 只需一个域名/IP
- 防火墙配置简单
- 所有项目通过 Nginx 统一管理

**缺点**：
- URL 路径较长
- 需要配置 Nginx 路径重写

---

### 方案 B：端口隔离

每个项目使用不同的 Nginx 监听端口：

| 项目 | 访问地址 | Nginx 配置 |
|------|----------|-----------|
| NCD 报价 | `http://IP:80/` | `listen 80` |
| CD 报价 | `http://IP:8080/` | `listen 8080` |
| Kaguess | `http://IP:8081/` | `listen 8081` |

**优点**：
- 配置简单
- 项目完全隔离

**缺点**：
- 需要开放多个端口
- URL 不美观（带端口号）

---

### 方案 C：域名隔离（最佳）

每个项目使用独立子域名：

| 项目 | 访问地址 | Nginx 配置 |
|------|----------|-----------|
| NCD 报价 | `http://ncd.example.com` | `server_name ncd.example.com` |
| CD 报价 | `http://cd.example.com` | `server_name cd.example.com` |
| Kaguess | `http://kaguess.example.com` | `server_name kaguess.example.com` |

**优点**：
- 最清晰的项目隔离
- URL 简洁
- 可以独立配置 SSL 证书

**缺点**：
- 需要域名和 DNS 配置

---

## 安全检查清单

部署完成后，请验证以下项目：

- [ ] 后端只监听 127.0.0.1（`netstat -tlnp | grep 3000`）
- [ ] Nginx 配置正确（`nginx -t`）
- [ ] 防火墙已启用（`iptables -L -n -v`）
- [ ] SSH 端口已开放（避免被锁在服务器外）
- [ ] 80/443 端口已开放（用户可访问）
- [ ] 后端端口未直接暴露在防火墙（只能通过 Nginx 访问）

---

## 常见问题

### Q: 如果后端端口不开放防火墙，Nginx 还能访问吗？

**可以**。Nginx 和后端都在服务器内部，通过 `localhost` 或 `127.0.0.1` 通信，不经过防火墙。

```
外部用户 → [防火墙] → Nginx (80) → localhost:3000 → 后端
            ↑                        ↑
        只允许 80/443/22        内部通信，不受防火墙影响
```

### Q: 为什么后端要绑定 127.0.0.1 而不是 0.0.0.0？

| 绑定地址 | 含义 | 安全性 |
|----------|------|--------|
| `0.0.0.0` | 监听所有网络接口（公网 IP、内网 IP、127.0.0.1） | 低 - 任何人都可直接访问后端 |
| `127.0.0.1` | 只监听本地回环（服务器内部） | 高 - 只有 Nginx 能访问 |

**建议**：始终绑定 `127.0.0.1`，通过 Nginx 控制外部访问。

### Q: 开启防火墙会影响生产环境用户吗？

**不会**，只要正确配置：

| 端口 | 是否开放 | 影响 |
|------|----------|------|
| 80/443 | ✅ 开放 | 用户可正常访问网站 |
| 22 | ✅ 开放 | 管理员可 SSH 登录 |
| 3000, 3002... | ❌ 拒绝 | 用户无法直接访问后端（也不应该） |

---

## 项目部署清单

每个新项目部署时，请完成以下步骤：

1. [ ] 配置后端 `.env` 文件（`HOST=127.0.0.1`）
2. [ ] 修改后端 `src/index.js`（使用 HOST 参数）
3. [ ] 创建 Nginx 配置文件
4. [ ] 启用 Nginx 配置并重启
5. [ ] 验证后端监听地址正确
6. [ ] （可选）在防火墙拒绝后端端口
7. [ ] 测试访问是否正常

---

## 参考资料

- [Nginx 反向代理配置](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [ufw 防火墙使用指南](https://help.ubuntu.com/community/UFW)
- [Socket.io Nginx 配置](https://socket.io/docs/v4/reverse-proxy/#nginx)

---

**最后更新**: 2026-03-10
**版本**: v1.4.0
