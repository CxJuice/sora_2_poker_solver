# 空之轨迹2nd 算牌器

包含两个可在浏览器本地使用的策略工具：

- 五张抽牌扑克：按 [`poker_solver_rules.md`](poker_solver_rules.md) 完全枚举 32 种 HOLD / CHANGE 方案，并以 EV 降序给出策略。
- 21 点：按 [`game2/game2_rules.md`](game2/game2_rules.md) 对有限剩余牌堆执行 MDP 规划，递归比较 HIT、STAND 与 DOUBLE DOWN 的精确期望收益。

## 使用

浏览器版使用本地 HTTP 服务打开，以支持后台 Worker 与计算进度条：

使用任意静态文件服务器（例如 VS Code Live Server）启动项目，然后访问其本地地址。页面通过顶部页签切换两个游戏；21 点 MDP 会按剩余牌值分布枚举庄家暗牌与补牌，并在每次 HIT 后重新选择当前期望收益最高的动作。

## 本地牌面资源

- 网页牌面来自项目内的 `card fronts/`。其 52 张 PNG 会规范化复制到 `assets/card-fronts-png/`，再转换为 `assets/cards/` 中的 WebP；网页只加载后者。
- 历史 Block52 转换资源保留在 `assets/cards-png/`，但不再作为网页牌面来源。
- 更新牌面时，运行 `python tools/prepare_card_fronts.py`，再使用 `image-to-webp` 的转换脚本把 `assets/card-fronts-png/*.png` 转为 `assets/cards/*.webp`。

重新生成 Tailwind CSS：

```powershell
npx --yes tailwindcss@3.4.17 --config tailwind.config.js --input tailwind.input.css --output tailwind.css --minify
```

前端牌面将 10 显示为 `10`，内部仍使用 `T` 编码。A 同时支持 `A2345` 低位顺子。
