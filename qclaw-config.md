# qclaw 配置说明 - Claude Code 微信联动

## 目标

收到微信回复后，自动调用处理脚本更新问题状态。

---

## 需要配置的内容

在 qclaw 的微信消息处理逻辑中，添加以下代码：

```javascript
const { exec } = require('child_process');

// 当收到微信消息时
function onWechatMessage(message) {
  const userReply = message.content; // 用户回复的文本

  // 调用处理脚本
  exec(`node C:\\Users\\hufen\\.claude\\monitor\\qclaw-handler.js "${userReply.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ 处理失败:', error.message);
    } else {
      console.log('✅ 处理成功:', stdout);
    }
  });
}
```

---

## 测试命令

手动测试：
```bash
node C:\Users\hufen\.claude\monitor\qclaw-handler.js "q_test 是"
```

然后查看 `C:\Users\hufen\.claude\questions.json` 是否有更新。

---

## 文件路径

| 文件 | 路径 |
|------|------|
| 处理脚本 | `C:\Users\hufen\.claude\monitor\qclaw-handler.js` |
| 共享文件 | `C:\Users\hufen\.claude\questions.json` |

---

## 工作流程

```
微信回复 → qclaw 接收 → 调用 handler → 更新 questions.json → Claude 读取执行
```
