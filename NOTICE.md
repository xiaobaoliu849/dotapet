# 组件与素材说明 / License and attribution

DotaPet 是从作者的 DOTA2 双语词典项目中独立整理的桌宠项目。部分内部类名、配置文件名沿用 VoiceSpirit 命名，以保持数据和行为兼容。

## 项目代码与第三方组件 / Code and dependencies

DotaPet 自有代码采用 MIT 许可。Windows 安装目录提供 `LICENSE` 和本文，Electron 与 Chromium 的许可说明分别为 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`。随应用打包的 npm 依赖位于 `resources/app.asar`，其中保留依赖随包提供的许可文件。`lazy-val` 1.0.5 的包元数据注明作者 Vladimir Krivosheev 和 MIT 许可，发布包未附单独的许可文件。 [项目许可](LICENSE) · [lazy-val 包信息](https://www.npmjs.com/package/lazy-val/v/1.0.5)

## 游戏内容与界面素材 / Game content and artwork

DotaPet 是独立粉丝项目。刀塔英语学堂使用 Dota 2 官方双语数据和补丁文本。团队交流短语沿用作者的 Dota 2 Bilingual Lexicon 项目。每张内置物品图片的来源及 SHA-256 记录在 `src/learning/item-images.json`。 [Valve 数据源](https://www.dota2.com/datafeed/) · [官方中文站](https://www.dota2.com.cn/) · [Valve 图片来源](https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/)

Valve 游戏文本、图像、角色与商标适用相应权利人的条款。Valve 在《Steam 订户协议》第 2.D 节说明了粉丝作品的非商业使用条件。公开数据源和本说明仅用于记录来源。游戏素材的再分发应按其用途核对适用条款或取得所需授权。 [Steam 订户协议 §2.D](https://store.steampowered.com/subscriber_agreement/#2)

应用随附 SVG 桌宠形象，部分形象参考 Dota 2 角色。用户导入的自定义图片保存在本机。新增第三方图片、音频或字体时，请记录来源、权利人和分发许可。

## 学习录音 / Lesson audio

学习 MP3 为 AI 合成录音。历史批次来自作者的 Dota 2 Bilingual Lexicon 音频库，后续补丁批次使用 Microsoft Edge 语音服务生成。`src/learning/audio-manifest.json` 记录原始文件或合成信息。历史录音所读的游戏说明可能与当前课文不同。 [录音来源和验证记录](https://github.com/xiaobaoliu849/dotapet/blob/main/docs/DOTAPAD_AUDIO.md) · [Edge TTS 工具说明](https://github.com/rany2/edge-tts)

补丁录音的脚本包含游戏文本。后续发布或复用录音前，应分别核对脚本内容及语音服务输出的分发条款。现有清单记录的是录音来源和技术校验，尚缺少服务输出的分发授权记录。
