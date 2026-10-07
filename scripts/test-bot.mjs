// 本地测试用的陪玩机器人（先 npm run dev）。
//   node scripts/test-bot.mjs host [人数] [机器人数]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]   → 以一个机器人身份加入别人的房间
// 机器人轮到自己时随机行动：大多掷骰，偶尔拿下注票、放观众板、终局下注。
// 环境变量 BOT_DELAY_MS 控制每步的思考时间（默认 1500），BOT_IDLE=1 时只挂着不动（等超时自动掷骰）。
import { io } from "socket.io-client";

const URL = process.env.SERVER_URL ?? "http://localhost:3005";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1500);
const IDLE = process.env.BOT_IDLE === "1";
const RACERS = ["red", "yellow", "blue", "green", "purple"];
const NAMES = ["驼铃", "沙丘", "绿洲", "胡杨", "烈日", "月牙", "驿站"];

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  socket.on("room:updated", async (room) => {
    onRoom?.(room, socket);
    const game = room.game;
    if (IDLE || !game || game.phase !== "playing" || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    const me = game.players[game.currentPlayer];
    if (!me || me.id !== seat) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    try {
      const roll = Math.random();
      let command = { type: "ROLL" };
      if (roll < 0.2) {
        const camel = RACERS.filter((c) => game.legTickets[c].length)[Math.floor(Math.random() * 5)];
        if (camel) command = { type: "TAKE_LEG_BET", camel };
      } else if (roll < 0.28) {
        const pos = 2 + Math.floor(Math.random() * 15);
        command = { type: "PLACE_SPECTATOR", pos, side: Math.random() < 0.5 ? "cheer" : "boo" };
      } else if (roll < 0.34 && me.finishCards.length) {
        command = { type: "BET_OVERALL", camel: me.finishCards[0], pile: Math.random() < 0.5 ? "winner" : "loser" };
      }
      let result = await emit("game:command", command);
      if (!result.ok) result = await emit("game:command", { type: "ROLL" });
      if (!result.ok) console.log(name, "行动失败", result.error);
    } finally {
      acting = false;
    }
  });
  socket.on("room:closed", ({ reason }) => { console.log(name, "房间关闭：", reason); process.exit(0); });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const { socket, emit } = bot(arg2 ?? NAMES[0]);
  socket.on("connect", async () => console.log("join", (await emit("room:join", { name: arg2 ?? NAMES[0], code: arg1 })).ok));
} else {
  const capacity = Number(arg1 ?? 3);
  const bots = Number(arg2 ?? capacity - 1);
  let started = false;
  const host = bot(NAMES[0], async (room, socket) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok || result.error);
    }
    void socket;
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity });
    if (!created.ok) { console.log(created.error); process.exit(1); }
    console.log("房间码", created.data.code);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
