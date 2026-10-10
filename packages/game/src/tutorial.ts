/**
 * 新手教程的剧本（沙丘赛驼）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：开局摆法固定，骰子按 TUTORIAL_ROLLS 出，
 * 两个对手（咕噜一号、咕噜二号）按剧本走，所以「黄骆驼背着红骆驼走」「红骆驼踩到你的欢呼板」
 * 「第 5 颗骰子掷出、赛段结算」这几幕一定发生。剧本走完接练习局：对手交给人机，骰子换成普通随机数。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。这款游戏的行动要「先选再确定」，所以 do 步骤可以带 then：
 * 界面上的选择变成 selection 时，高亮换到下一个 anchor（比如先点下注票，再点「确定」）。
 */
import { createGame, legalSpectatorCells } from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import { RACERS, TRACK_LENGTH, type CamelId, type CrazyId, type DieId, type GameCommand, type GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值。
   * 固定的有 track、pyramid、finish-line、ranking、roll、players、piles、confirm；一类里的某一个带参数：
   * cell:<格>、camel:<颜色>、player:<座位>、bet:<颜色>、spectator:cheer|boo、finish:<颜色>、pile:winner|loser。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

/** 「先选再确定」的后续高亮：界面上的选择变成 selection 时，高亮换成 anchor。 */
export interface TutorialFollowUp {
  /** 网页 GameBoard 报出来的当前选择，例如 legBet:red、spectator:cheer:5、overall:red:winner。 */
  readonly selection: string;
  readonly anchor: string;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand; readonly then?: readonly TutorialFollowUp[] })
  /** 对手按剧本自动走这几步，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly GameCommand[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_RIVALS = [
  { id: "p2", name: "咕噜一号" },
  { id: "p3", name: "咕噜二号" },
] as const;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "pyramid",
    say: "五只赛驼要绕金字塔跑一圈，你不操控骆驼，只押谁跑得好。",
    note: "比赛结束时金币最多的人赢。每人开局 3 枚金币。",
  },
  {
    kind: "info", id: "ranking", lesson: "名次", anchor: "ranking",
    say: "这一条是现在的名次。",
    note: "先比谁跑得远；同一格叠在一起时，上面的算领先。",
  },
  {
    kind: "do", id: "roll", lesson: "掷骰", anchor: "roll", expect: { type: "ROLL" },
    say: "点「拿金字塔票并掷骰」。",
    note: "金字塔里随机蹦出一颗骰子，对应颜色的骆驼走 1–3 格。",
  },
  {
    kind: "info", id: "stack", lesson: "叠罗汉一起走", anchor: "cell:4", face: "surprised",
    say: "黄骆驼背着红骆驼一起走了 2 格！",
    note: "骆驼走的时候，驮在它上面的骆驼一起走；落到有骆驼的格子，就叠在最上面。",
  },
  {
    kind: "info", id: "pyramid", lesson: "金字塔票", anchor: `player:${TUTORIAL_SELF}`,
    say: "掷骰的人拿一张金字塔票，这一段结算时 +1 金。",
    note: "一个赛段掷满 5 颗骰子就结算一次，然后骰子收回金字塔重来。",
  },
  {
    kind: "watch", id: "rivals1", lesson: "疯骆驼",
    say: "轮到咕噜一号和咕噜二号，看它们怎么走。",
    moves: [{ type: "ROLL" }, { type: "BET_OVERALL", camel: "red", pile: "winner" }],
  },
  {
    kind: "info", id: "crazy", anchor: "camel:black", face: "surprised",
    say: "灰骰让黑色疯骆驼倒着走了 1 格。",
    note: "黑、白两只疯骆驼逆着跑，不算名次、不能押；落到赛驼头上时，会把赛驼往回带。",
  },
  {
    kind: "info", id: "hidden", lesson: "终局卡", anchor: "piles", face: "think",
    say: "咕噜二号押了一张终局卡，颜色只有它自己知道。",
    note: "终局卡猜最后的总冠军或总垫底，比赛结束时才翻开。",
  },
  {
    kind: "do", id: "legbet", lesson: "赛段下注", anchor: "bet:red", expect: { type: "TAKE_LEG_BET", camel: "red" },
    then: [{ selection: "legBet:red", anchor: "confirm" }],
    say: "红骆驼领先：点红色下注票，再点「确定」。",
    note: "这一段结束时红是第 1 名，你拿票面 5 金；第 2 名 +1；其余 −1。",
  },
  {
    kind: "watch", id: "rivals2",
    say: "越早押越值钱：咕噜一号也押红，只拿到 3 元那张。",
    moves: [{ type: "TAKE_LEG_BET", camel: "red" }, { type: "ROLL" }],
  },
  {
    kind: "do", id: "spectator", lesson: "观众板", anchor: "spectator:cheer", expect: { type: "PLACE_SPECTATOR", pos: 5, side: "cheer" },
    then: [
      { selection: "spectator:cheer", anchor: "cell:5" },
      { selection: "spectator:cheer:5", anchor: "confirm" },
    ],
    say: "放观众板：选「欢呼」，点亮着的第 5 格，再点「确定」。",
    note: "骆驼停在你的观众板上，你 +1 金；欢呼让它再进 1 格，嘘让它退 1 格。",
  },
  {
    kind: "watch", id: "rivals3",
    say: "红骆驼要动了……",
    moves: [{ type: "ROLL" }],
  },
  {
    kind: "info", id: "cheered", anchor: "camel:red", face: "happy",
    say: "红骆驼踩到你的欢呼板：你 +1 金，它又多走 1 格！",
    note: "观众板不能放在有骆驼的格子、第 1 格，也不能挨着别人的观众板；亮着的格子才能放。",
  },
  {
    kind: "watch", id: "rivals4",
    say: "第 5 颗骰子掷出来，这个赛段就结束了。",
    moves: [{ type: "ROLL" }],
  },
  {
    kind: "info", id: "legscore", lesson: "赛段结算", anchor: `player:${TUTORIAL_SELF}`, face: "happy",
    say: "赛段结算：红第 1，你的 5 元票 +5，金字塔票 +1。",
    note: "咕噜一号的 3 元票也赢了。骆驼留在原地，下注票、骰子、观众板都收回，开始下一段。",
  },
  {
    kind: "do", id: "overall", lesson: "押总冠军", anchor: "finish:red", expect: { type: "BET_OVERALL", camel: "red", pile: "winner" },
    then: [
      { selection: "overall:red", anchor: "pile:winner" },
      { selection: "overall:red:winner", anchor: "confirm" },
    ],
    say: "押一张终局卡：点红色，选「押冠军」，再点「确定」。",
    note: "猜中的按先后拿 8、5、3、2、1 金，猜错 −1。越早押越值钱，也越难猜。",
  },
  {
    kind: "info", id: "end", lesson: "终局", anchor: "finish-line", face: "think",
    say: "有骆驼冲过终点线，比赛立刻结束。",
    note: "先结算这一段，再翻开冠军和垫底牌堆，最后金币最多的人赢。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！接下来和两只咕噜把这局打完。",
    note: "拿不准就点「提示」。真实对局里连续两次超时会转成人机托管，点「取消托管」就能收回。",
  },
];

/** 剧本里每一次掷骰：哪颗骰子、几点（灰骰带颜色）。用完以后是普通的随机数。 */
export interface ScriptedRoll {
  readonly die: DieId;
  readonly value: number;
  readonly color?: CrazyId;
}

export const TUTORIAL_ROLLS: readonly ScriptedRoll[] = [
  { die: "yellow", value: 2 }, // 你：黄背着红走到第 4 格
  { die: "gray", value: 1, color: "black" }, // 咕噜一号：黑色疯骆驼倒退 1 格
  { die: "green", value: 1 }, // 咕噜二号
  { die: "red", value: 1 }, // 咕噜一号：红踩到你的欢呼板，再进 1 格
  { die: "blue", value: 1 }, // 咕噜二号：第 5 颗骰子，赛段结算
];

/** 教程开局的摆法：红叠在黄上面、紫叠在蓝上面；疯骆驼在 16、14 格。 */
export const TUTORIAL_STACKS: Readonly<Record<number, readonly CamelId[]>> = {
  1: ["green"],
  2: ["yellow", "red"],
  3: ["blue", "purple"],
  14: ["white"],
  16: ["black"],
};

function players(selfName: string) {
  return [{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_RIVALS.map((rival) => ({ ...rival }))];
}

/** 教程开局：你先手，对手是咕噜一号、咕噜二号，骆驼按 TUTORIAL_STACKS 摆好。 */
export function createTutorialGame(selfName: string, seed = 20261010): GameState {
  const game = createGame(players(selfName), seed);
  game.stacks = Object.fromEntries(Object.entries(TUTORIAL_STACKS).map(([pos, stack]) => [pos, [...stack]]));
  game.currentPlayer = 0;
  return game;
}

/** 练习局重开：随机摆法、随机先手。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame(players(selfName), seed);
}

/** 剧本随机：掷骰时先按 rolls 出（哪颗骰子、几点），用完以后交给普通随机数。 */
export interface TutorialRng extends Rng {
  /** 还剩几次剧本掷骰。 */
  readonly remaining: number;
}

export function createTutorialRng(seed: number, rolls: readonly ScriptedRoll[] = TUTORIAL_ROLLS): TutorialRng {
  const queue = [...rolls];
  const free = createRng(seed);
  // 引擎掷骰：先 pick 一颗骰子，再 int(3)（彩色）或 pick 灰骰的面
  let pending: ScriptedRoll | undefined;
  return {
    next: () => free.next(),
    int: (max) => {
      if (pending && max === 3) {
        const value = pending.value - 1;
        pending = undefined;
        return value;
      }
      return free.int(max);
    },
    pick: <T,>(items: readonly T[]): T => {
      const head = queue[0];
      if (!pending && head && typeof items[0] === "string" && (items as readonly unknown[]).includes(head.die)) {
        pending = queue.shift();
        return head.die as unknown as T;
      }
      if (pending && typeof items[0] === "object") {
        const face = (items as readonly { color: string; value: number }[]).find((item) => item.color === pending!.color && item.value === pending!.value);
        pending = undefined;
        if (face) return face as unknown as T;
      }
      return free.pick(items);
    },
    shuffle: (items) => free.shuffle(items),
    get state() {
      return free.state;
    },
    get remaining() {
      return queue.length + (pending ? 1 : 0);
    },
  };
}

/** 两条命令是不是同一步。 */
export function sameCommand(a: GameCommand, b: GameCommand): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard / Track3D 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。confirm 要等界面上先选好，这里只检查轮到你。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const myTurn = state.phase === "playing" && state.players[state.currentPlayer]?.id === viewer;
  const me = state.players.find((player) => player.id === viewer);
  const [kind, arg] = anchor.split(":") as [string, string | undefined];
  switch (kind) {
    case "track":
    case "pyramid":
    case "finish-line":
    case "ranking":
    case "players":
    case "piles":
      return true;
    case "player":
      return state.players.some((player) => player.id === arg);
    case "camel":
      return Object.values(state.stacks).some((stack) => stack.includes(arg as CamelId));
    case "cell": {
      const pos = Number(arg);
      return Number.isInteger(pos) && pos >= 1 && pos <= TRACK_LENGTH;
    }
    case "roll":
    case "confirm":
      return myTurn;
    case "bet":
      return myTurn && (RACERS as readonly string[]).includes(arg ?? "") && (state.legTickets[arg as (typeof RACERS)[number]]?.length ?? 0) > 0;
    case "spectator":
      return myTurn && (arg === "cheer" || arg === "boo") && legalSpectatorCells(state, viewer).length > 0;
    case "finish":
      return myTurn && (me?.finishCards ?? []).includes(arg as (typeof RACERS)[number]);
    case "pile":
      return myTurn && (arg === "winner" || arg === "loser") && (me?.finishCards ?? []).some((card) => card !== null);
    default:
      return false;
  }
}
