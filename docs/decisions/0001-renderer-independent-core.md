# 保持核心与渲染器无关

游戏规则、状态转换、地图和模拟代码放在 `src/core`，且不依赖 Phaser 或 DOM；浏览器输入与呈现通过 `src/presentation` 调用核心 interface。该取舍让规则能够在 Node 环境快速测试，并避免未来更换呈现方式时重写游戏规则。
