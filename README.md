# 沙丘赛驼（Dune Derby）

3–8 人的骆驼赛跑押注桌游，网页联机版。规则按《骆驼大赛网络版：规则与实现规格》（第二版规则：5 只赛驼 + 2 只逆行的疯骆驼）实现；名字、美术和规则说明文字都是自己的。

线上地址：<https://gulugagame.com/camel/>

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3005，网页 :5178
npm test             # 规则引擎（规格书 18 个用例 + 300 局随机模拟）、人机（决策单测 + 每种人数 300 局自对弈）、服务器（观战、挤登录、人机托管）和赛道几何
npm run typecheck
```

一个人测试：`node scripts/test-bot.mjs host 3 2` 会让机器人建一个 3 人房、拉一个机器人进来并打印房间码，你在网页里用房间码加入凑满 3 人后自动开局。机器人轮到自己时大多掷骰，偶尔下注、放观众板。`BOT_DELAY_MS` 调思考时间，`BOT_IDLE=1` 只挂着不动。

## 人机和托管

全站统一的做法（和欲罢不能、花砖物语等一致）：

- 一个人也能开局：房主在等候房间的空座位上点「加人机」，人机按顺序叫咕噜一号…咕噜七号，带「人机」标签，房主可以「移出」。只有「普通」一个难度。
- **托管就是人机代打**（覆盖规格书「超时自动掷骰」的写法）：一回合超时仍然自动掷骰；**连续 2 次超时**转托管，由人机替他行动，直到他自己动一下或点「取消托管」。
- 离线的人轮到时先等 3 秒（刷新、短暂断线来得及回来，不算超时），然后由人机代打；用原昵称加房间码回来，座位交还。
- 人机每一步先等上一步的动画放完（骰子 + 骆驼每格 + 观众板，赛段结算再多 2.5 秒），再想 1 秒左右；环境变量 `BOT_DELAY_SCALE` 调倍数（测试设 0）。

人机策略在 `packages/game/src/bot.ts`：`botCommand(视角状态, 座位)`，输入必须是 `redactGameForViewer` 之后的状态（带种子或随机数状态会直接报错），看不到别人押的终局卡颜色。每次决策随机模拟 500 次「把本赛段掷完、再一直掷到终局」，算出每只骆驼本赛段第 1/2 名、最终冠军/垫底的概率和每格被踩的期望次数，然后比较各行动的期望金币：掷骰 +1；赛段票 = 票面×P(第1) + P(第2) − P(其余)；终局卡 = P(猜中)×预计排到的奖金 − P(猜错)，再扣 0.35 的「越早越不确定」余量；观众板用同一批随机数重算对自己下注和观众板收入的影响；合伙看对方最好那张票的期望。`botAdvice` 同时给一句理由（教程的「提示」用）。

强度（`~/projects/qa-reports/tools/bots/sim-camel.ts`，见交接报告）和耗时：每步平均约 8 ms。

## 新手教程

站内统一做法（参考欲罢不能）：首页和等候房间有「新手教程」入口（第一次来是邀请卡，学过只剩小按钮；地址带 `?tutorial` 直接打开）。教程不连服务器，在浏览器里直接跑规则引擎，牌桌就是真正的 GameBoard，咕噜嘎的对话框叠在上面。

- 剧本 `packages/game/src/tutorial.ts`：固定开局摆法（红叠在黄上、紫叠在蓝上）和 5 次固定掷骰，你 + 咕噜一号 + 咕噜二号三人局，18 步教目标、名次、掷骰、叠罗汉一起走、金字塔票、疯骆驼、终局卡看不到、赛段下注、观众板、赛段结算、押总冠军、终局。行动要「先选再确定」，do 步骤用 `then` 按 GameBoard 报上来的选择（`onSelection`）把高亮从下注票挪到「确定」。单测 `tutorial.test.ts`。
- 网页：共用教练层 `apps/web/src/tutorial/`（从 cantstop 复制，不改逻辑）、`TutorialMode.tsx`、`tutorialGame.ts`（「提示」的说法和「第一次」小贴士）。锚点是 `data-tutorial`：`track`、`ranking`、`roll`、`confirm`、`players`、`player:<座位>`、`piles`、`cell:<格>`、`camel:<颜色>`、`bet:<颜色>`、`spectator:cheer|boo`、`finish:<颜色>`、`pile:winner|loser`、`partner:<座位>`、`hint`、`add-bot`、`cancel-auto`。
- 「提示」只在练习局、或者一个人加人机开的房间里出现（键盘 H），说法来自 `botAdvice` 的理由。剧本进行中不弹赛段结算框（咕噜嘎自己讲）。
- 走查脚本：`~/projects/qa-reports/tools/tut-camel.mjs`（flow / waiting / room，`SHORT=1` 只走到练习局开头）。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game/src/engine.ts` | 规则引擎：`apply(state, playerId, command, rng) → { state, events }`，纯函数；开局、四种（6 人以上五种）行动、骆驼移动和堆叠、灰骰特例、观众板、赛段结算、终局结算、按玩家视角隐藏信息 |
| `packages/game/src/bot.ts` | 人机策略（见上） |
| `packages/game/src/types.ts` | 状态、行动、事件的类型（基本照规格书的参考结构） |
| `apps/server` | Socket.IO 房间、断线用原昵称回到座位、60 秒回合计时（超时自动掷骰，连续 2 次转托管）、人机和托管、语音信令、每局的种子和动作序列写进 `logs/games.jsonl` |
| `apps/web/src/Track3D.tsx` | 2.5D 赛道：CSS 3D 沙盘，拖动旋转、上下拖调倾角、滚轮或双指缩放；骆驼、观众、装饰是正对镜头的立牌，骆驼按视角换 8 个朝向 |
| `apps/web/src/usePlayback.ts` | 按事件播放动画：骰子从金字塔冒出 → 骆驼一格一格走 → 观众板 → 结算 |
| `apps/web/src/GameBoard.tsx` | 对局界面：行动区（先选再确定）、玩家、终局牌堆、动作记录、结算弹窗 |
| `art/` | PixelLab 美术流水线（见下） |

## 规格书没写死、这里这样处理的地方

规格书里标「配置项」的全部用默认值，房主建房时不开放修改（3–8 人、开局 3 金、6 人以上开启合伙、金币不够付时付到 0、逆时针越过第 1 格也结束游戏、回合 60 秒、并列都算赢）。另外：

| # | 问题 | 处理 |
|---|---|---|
| 1 | 观众板能不能留在原格只翻面 | 可以，算一次行动；同格同面原样放回不允许（等于跳过回合）。已和蒲谦确认 |
| 2 | 终局下注扣钱、不够付时怎么算 | 冠军、垫底牌堆各算一次净额，不够付到 0（和赛段结算一致）。已和蒲谦确认 |
| 3 | 自己押出的终局卡颜色 | 自己看得到（别人看不到），等于记性 |
| 4 | 随机数 | 种子由服务器的安全随机数生成；种子、随机数状态和动作序列不发给客户端，否则能算出下一颗骰子 |

## 美术流水线（`art/`）

PixelLab API，密钥只在 `~/.config/pixellab/api_key`，不进仓库。每次调用记进 `art/ledger.jsonl`，`BUDGET_USD` 设上限。生成的原图和中间文件在被 gitignore 的 `art/out/`。

- `selection.json`：每一项选的是哪张（他在画廊里定的 + 我推荐的）。
- `camels.py`：骆驼精灵图。PixelLab 8 方向角色的方向名和画面差一位，只取朝右半边 5 个方向，朝左 3 个用水平翻转；走路动画画布（88×88）和静止图对齐后统一裁边。5 只赛驼共用一只沙色骆驼，只把鞍毯、笼头、流苏的红色换成队色。
- `props.py`：装饰、地面、远景、界面小图导出；下注票上的骆驼剪影按队色换色。
- `fix_seam.py`：远景左右对调后用 bitforge 重画中间接缝，得到能横向无缝重复的一张。
- `gallery.py` + `gallery.html`：选图画廊（`python -m http.server 8766 --directory art/out`）。

## 画面：白天版和夜间版

只有像素风一种画面（原始版本已删掉），配色分夜间（深色，默认）和白天（白底）两种。顶栏「切换白天版 / 切换夜间版」随时切换，只影响自己看到的画面，记在浏览器的 `gm-pixel-theme` 里；gulugagame.com 上的大厅和各个游戏同源，共用这一个选择。

- 夜间配色就是 `app-pixel.css`（首页和等候房间）和 `camel.css`（牌桌）本身。白天版不单独写：`apps/web/day-theme.ts`（Vite 插件）在构建时把这些样式里和颜色有关的声明照抄一份，选择器前加 `:root[data-theme="day"]`，按 `apps/web/day-palette.ts` 的调色表换成白天的颜色。改夜间样式时白天版自动跟着变，只有新出现的深色需要在调色表里补一行。
- 机械换色不合适的地方在 `apps/web/src/theme-day.css` 里手写。
- `index.html` 里一小段脚本在样式生效前就给 `<html>` 加上 `data-theme="day"`，打开页面不会先闪一下深色；切换逻辑和按钮在 `src/theme.tsx`。

## 部署

服务器上 `~/camel`，pm2 进程 `camel`（端口 3005），网页在 `/var/www/camel`，Caddy `handle_path /camel/*`。本机运行 `~/projects/deploy.sh camel`（服务器拉 GitHub 上的 main）。

## 服务器上的启动方式

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`），每个游戏省下约 50 MB 内存（实测，原来被几层包装进程占掉的部分）。端口和密钥存在 pm2 里，不进仓库；`deploy.sh` 照旧 `pm2 restart`。改了 `ecosystem.config.cjs` 之后，要在服务器上带着原来的环境变量 `pm2 delete` 再 `pm2 start ecosystem.config.cjs` 一次。
