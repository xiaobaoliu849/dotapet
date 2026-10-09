# Gemini 3.8 Live 升级核对

核对日期：2026-10-09。

实时对话默认模型从 `gemini-3.1-flash-live-preview` 升级为 `gemini-3.8-live`。已有设置中的旧默认模型在加载时迁移，下一次保存设置时写回；密钥、音色与自定义模型保持原值。支持直接填写 `models/...`，避免重复添加资源前缀。

## 官方调用方式

- [3.8 模型与迁移指南](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)：使用 AUDIO 响应和输出转写；不发送 thinkingConfig、旧 affective dialogue 配置或 proactiveAudio=false。当前代码符合这些要求。项目未声明工具，不涉及异步工具调用迁移。
- [WebSocket 协议](https://ai.google.dev/api/live)：继续使用 v1beta BidiGenerateContent；setup 是首帧，收到 setupComplete 才发送音频。转写与 realtimeInputConfig 位于 setup 层，音色和响应模态位于 generationConfig。文本使用明确的 user 角色和 turnComplete=true。
- [Live API 能力指南](https://ai.google.dev/gemini-api/docs/live-api/capabilities)：音频输入为 PCM16 单声道 16 kHz，输出为 24 kHz。保留自动 VAD 与客户端 audioStreamEnd 刷新；后续音频可以重新打开流。同一服务端消息中的所有音频分段和转写均须处理。
- [实时翻译指南](https://ai.google.dev/gemini-api/docs/live-api/live-translate)：翻译继续使用独立的 `gemini-3.5-live-translate-preview`，translationConfig 位于 generationConfig；不发送角色指令和聊天音色。转写位置遵循上面的 WebSocket 协议，翻译指南示例对此有不一致之处。

## 推送前对抗性审查

发现并修复：仅替换默认常量会让已保存的 3.1 配置继续覆盖新默认值；带 models/ 前缀的自定义模型会被重复添加前缀。

验证覆盖：升级后设置页与实际引擎均使用 3.8；密钥和音色保留；翻译配置与自定义模型不被改写；多段音频、输入转写、输出转写与完成标记同时到达；思考文本不进入语音字幕；打断残留被抑制且下一轮音频恢复；静音麦克风不触发空提交；拒绝密钥不改用其他账户。

结果：未发现剩余阻断项。`npm test` 通过（171 项，Google Live 文件内部另有 22 个协议断言）；`npm run smoke` 通过。云端协议测试使用本地 WebSocket 模拟服务，未验证真实 API 账户权限、网络连通性或 3.8 音色与对话效果。
