/**
 * 沙丘赛驼和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botAdvice, isRacer, type GameState } from "@camel/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "camel";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个按钮（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

const LABEL: Record<string, string> = { red: "红", yellow: "黄", blue: "蓝", green: "绿", purple: "紫" };

/** 「提示」：让人机从你的位置算一步（界面拿到的本来就是你能看到的那份），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase !== "playing") return { say: "这局已经结束了。", anchor: null };
  const current = game.players[game.currentPlayer]!;
  if (current.id !== playerId) return { say: `等 ${current.name} 走完再问我。`, anchor: null };
  let advice;
  try {
    advice = botAdvice(game, playerId);
  } catch {
    return { say: "我会掷骰，稳拿 1 枚金币。", anchor: "roll" };
  }
  const { command, reason } = advice;
  switch (command.type) {
    case "ROLL":
      return { say: "我会掷骰。", note: reason, anchor: "roll" };
    case "TAKE_LEG_BET":
      return { say: `我会拿${LABEL[command.camel]}色下注票。`, note: reason, anchor: `bet:${command.camel}` };
    case "PLACE_SPECTATOR":
      return { say: `我会把观众板放在第 ${command.pos} 格（${command.side === "cheer" ? "欢呼" : "嘘"}）。`, note: reason, anchor: `spectator:${command.side}` };
    case "BET_OVERALL":
      return { say: `我会把${LABEL[command.camel]}色终局卡押在${command.pile === "winner" ? "冠军" : "垫底"}。`, note: reason, anchor: `finish:${command.camel}` };
    case "PARTNER": {
      const target = game.players.find((player) => player.id === command.target)?.name ?? "";
      return { say: `我会和 ${target} 合伙。`, note: reason, anchor: `partner:${command.target}` };
    }
    default:
      return { say: "我会掷骰。", anchor: "roll" };
  }
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "spectator-self": { title: "你的观众板被踩了", text: "骆驼停在你的观众板上，你 +1 金，它再进或退 1 格。每个赛段结束时观众板收回。" },
  "crazy-carry": { title: "疯骆驼把赛驼往回带", text: "黑、白疯骆驼倒着跑，驮在它们身上的赛驼会被一起带回去。" },
  "leg-scored": { title: "赛段结算了", text: "押中第 1 名拿票面，第 2 名 +1，其余 −1；金字塔票每张 +1。金币最少扣到 0。" },
  "stack-ride": { title: "叠在一起的骆驼一起走", text: "被骰子选中的骆驼背着它上面的骆驼一起走；它下面的留在原地。" },
  partner: { title: "6 人以上可以合伙", text: "选一位还没结伴的玩家：这一段结算时，你们各自额外拿对方最好的一张下注票（亏的不算）。" },
  "overall-hidden": { title: "终局卡看不到颜色", text: "别人押的终局卡要到比赛结束才翻开；越早押、猜中拿得越多，猜错 −1。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  for (const event of game.events) {
    if (event.type === "SpectatorTriggered" && event.owner === selfId) ids.push("spectator-self");
    if (event.type === "UnitMoved" && event.cause === "die") {
      if (event.dir === -1 && event.camels.some((camel) => isRacer(camel))) ids.push("crazy-carry");
      else if (event.camels.filter((camel) => isRacer(camel)).length >= 2) ids.push("stack-ride");
    }
    if (event.type === "LegScored" && game.phase === "playing") ids.push("leg-scored");
    if (event.type === "OverallBetPlaced" && event.player !== selfId) ids.push("overall-hidden");
  }
  const myTurn = game.phase === "playing" && game.players[game.currentPlayer]?.id === selfId;
  if (myTurn && game.config.enablePartnership && !game.partners[selfId]) ids.push("partner");
  return ids;
}
