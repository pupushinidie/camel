# 沙丘赛驼（Dune Derby）

3–8 人的骆驼赛跑押注桌游，网页联机版。规则按《骆驼大赛网络版：规则与实现规格》（第二版规则：5 只赛驼 + 2 只逆行的疯骆驼）实现；名字、美术和规则说明文字都是自己的。

线上地址：<https://gulugagame.com/camel/>

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3005，网页 :5178
npm test             # 规则引擎（规格书 18 个用例 + 300 局随机模拟）和赛道几何
npm run typecheck
```

一个人测试：`node scripts/test-bot.mjs host 3 2` 会让机器人建一个 3 人房、拉一个机器人进来并打印房间码，你在网页里用房间码加入凑满 3 人后自动开局。机器人轮到自己时大多掷骰，偶尔下注、放观众板。`BOT_DELAY_MS` 调思考时间，`BOT_IDLE=1` 只挂着不动。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game/src/engine.ts` | 规则引擎：`apply(state, playerId, command, rng) → { state, events }`，纯函数；开局、四种（6 人以上五种）行动、骆驼移动和堆叠、灰骰特例、观众板、赛段结算、终局结算、按玩家视角隐藏信息 |
| `packages/game/src/types.ts` | 状态、行动、事件的类型（基本照规格书的参考结构） |
| `apps/server` | Socket.IO 房间、断线用原昵称回到座位、60 秒回合计时（超时自动掷骰）、语音信令、每局的种子和动作序列写进 `logs/games.jsonl` |
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

## 部署

服务器上 `~/camel`，pm2 进程 `camel`（端口 3005），网页在 `/var/www/camel`，Caddy `handle_path /camel/*`。本机运行 `~/projects/deploy.sh camel`（服务器拉 GitHub 上的 main）。

## 服务器上的启动方式

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`），每个游戏省下一百多 MB 内存。端口和密钥存在 pm2 里，不进仓库；`deploy.sh` 照旧 `pm2 restart`。改了 `ecosystem.config.cjs` 之后，要在服务器上带着原来的环境变量 `pm2 delete` 再 `pm2 start ecosystem.config.cjs` 一次。
