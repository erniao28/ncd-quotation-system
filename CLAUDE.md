# 远程询问系统使用说明

当您需要询问用户问题时，**必须使用以下命令**，而不是直接在对话框中提问：

## 询问用户

```bash
!ask-user "您的问题内容"
```

这会：
1. 将问题推送到 `http://121.40.35.46/chat/`
2. 用户在网页上看到问题并回复
3. 监控服务自动同步答案回来

## 检查答案

```bash
!check-answer <问题 ID>
```

或直接运行：
```bash
node C:/Users/hufen/.claude/ask-user/check-answer.js --all
```

---

## 重要提醒

⚠️ **不要直接在对话框中问问题**，用户可能看不到！

✅ **必须使用 `!ask-user "问题"`** 才能确保用户收到询问。

---

## ask-user 脚本位置

- `C:/Users/hufen/.claude/ask-user/ask-user.js`
- `C:/Users/hufen/.claude/ask-user/ask-user.bat`
