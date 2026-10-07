import { describe, expect, it } from "vitest";
import {
  apply,
  applyCommand,
  createGame,
  legalSpectatorCells,
  moveCamel,
  rankRacers,
  redactGameForViewer,
  resolveRoll,
  timeoutTurn,
} from "./engine.js";
import { createRng } from "./rng.js";
import type { CamelId, Config, GameEvent, GameState, RacerId } from "./types.js";

/** 一局 n 人的对局，玩家 p1…pn，p1 先手；再用 overrides 改成想要的局面。 */
function game(overrides: Partial<GameState> = {}, playerCount = 3, config: Partial<Config> = {}): GameState {
  const players = Array.from({ length: playerCount }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` }));
  return { ...createGame(players, 42, config), currentPlayer: 0, ...overrides };
}

/** 把没写到的骆驼放到远处不相干的格子，保证 7 只骆驼都在场上。 */
function board(stacks: Record<number, CamelId[]>): Record<number, CamelId[]> {
  const placed = new Set(Object.values(stacks).flat());
  const spare: Record<number, CamelId[]> = { ...stacks };
  const parking = [1, 2, 3, 13, 14, 15, 16].filter((pos) => !(pos in stacks));
  for (const camel of ["red", "yellow", "blue", "green", "purple", "black", "white"] as CamelId[]) {
    if (placed.has(camel)) continue;
    const pos = parking.shift()!;
    spare[pos] = [camel];
  }
  return spare;
}

function coinsOf(state: GameState, id: string): number {
  return state.players.find((player) => player.id === id)!.coins;
}

describe("开局", () => {
  it("赛跑骆驼在 1–3 格，疯狂骆驼在 14–16 格，每人 3 金币和 5 张终局卡", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const state = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], seed);
      const cells = Object.entries(state.stacks);
      for (const [key, stack] of cells) {
        const pos = Number(key);
        for (const camel of stack) {
          if (camel === "black" || camel === "white") expect(pos).toBeGreaterThanOrEqual(14);
          else expect(pos).toBeLessThanOrEqual(3);
        }
      }
      expect(cells.flatMap(([, stack]) => stack).sort()).toEqual(["black", "blue", "green", "purple", "red", "white", "yellow"]);
      expect(state.players.every((player) => player.coins === 3 && player.finishCards.length === 5)).toBe(true);
      expect(state.diceInPyramid).toHaveLength(6);
      expect(state.legTickets.red).toEqual([5, 3, 2, 2]);
    }
  });

  it("人数必须在 3–8 之间；6 人起自动开启合伙", () => {
    const make = (count: number) => createGame(Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `P${index}` })), 1);
    expect(() => make(2)).toThrow();
    expect(() => make(9)).toThrow();
    expect(make(5).config.enablePartnership).toBe(false);
    expect(make(6).config.enablePartnership).toBe(true);
  });

  it("同一种子、同一串动作得到同一局", () => {
    const players = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
    const run = () => {
      let state = createGame(players, 7);
      for (let index = 0; index < 30 && state.phase === "playing"; index += 1) {
        state = applyCommand(state, state.players[state.currentPlayer]!.id, { type: "ROLL" });
      }
      return state;
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(first.log!.length).toBeGreaterThan(5);
  });
});

describe("骆驼移动（规格书用例 1–10、18）", () => {
  it("#1 带着上方的骆驼一起走：[红,蓝,黄] 蓝 2", () => {
    const state = game({ stacks: board({ 5: ["red", "blue", "yellow"] }) });
    moveCamel(state, "blue", 2, 1, []);
    expect(state.stacks[5]).toEqual(["red"]);
    expect(state.stacks[7]).toEqual(["blue", "yellow"]);
  });

  it("#2 落点有骆驼时叠在最上面", () => {
    const state = game({ stacks: board({ 5: ["red"], 7: ["green"] }) });
    moveCamel(state, "red", 2, 1, []);
    expect(state.stacks[7]).toEqual(["green", "red"]);
    expect(state.stacks[5]).toBeUndefined();
  });

  it("#3 嘘面：板主 +1，退一格放到原有骆驼最下面", () => {
    const state = game({ stacks: board({ 4: ["red"], 5: ["green"] }), spectators: [{ owner: "p2", pos: 6, side: "boo" }] });
    const events: GameEvent[] = [];
    moveCamel(state, "red", 2, 1, events);
    expect(state.stacks[5]).toEqual(["red", "green"]);
    expect(state.stacks[6]).toBeUndefined();
    expect(coinsOf(state, "p2")).toBe(4);
    expect(events.map((event) => event.type)).toEqual(["UnitMoved", "SpectatorTriggered", "UnitMoved"]);
  });

  it("#4 第 16 格欢呼：板主 +1，红越线，游戏结束", () => {
    const state = game({ stacks: { 14: ["red"], 3: ["yellow", "blue"], 2: ["green", "purple"], 12: ["black"], 11: ["white"] }, spectators: [{ owner: "p2", pos: 16, side: "cheer" }] });
    const events: GameEvent[] = [];
    resolveRoll(state, "p1", "red", 2, undefined, events);
    expect(coinsOf(state, "p2")).toBeGreaterThanOrEqual(4);
    expect(state.stacks[17]).toEqual(["red"]);
    expect(state.phase).toBe("finished");
    expect(events.some((event) => event.type === "SpectatorTriggered")).toBe(true);
  });

  it("#5 特例 1：只有黑上方有赛跑骆驼，掷白 2 也移动黑", () => {
    const state = game({ stacks: board({ 10: ["black", "red"], 12: ["white"] }) });
    resolveRoll(state, "p1", "gray", 2, "white", []);
    expect(state.stacks[8]).toEqual(["black", "red"]);
    expect(state.stacks[12]).toEqual(["white"]);
    expect(state.rolledThisLeg[0]).toMatchObject({ die: "gray", color: "white", moved: "black" });
  });

  it("#6 特例 2：没有赛跑骆驼时，移动压在上面的那只", () => {
    const state = game({ stacks: board({ 12: ["white", "black"] }) });
    resolveRoll(state, "p1", "gray", 1, "white", []);
    expect(state.stacks[11]).toEqual(["black"]);
    expect(state.stacks[12]).toEqual(["white"]);
  });

  it("#7 [黑,红,白] 掷白 1：只有黑上方有赛跑骆驼 → 整堆退到第 8 格", () => {
    const state = game({ stacks: board({ 9: ["black", "red", "white"] }) });
    resolveRoll(state, "p1", "gray", 1, "white", []);
    expect(state.stacks[8]).toEqual(["black", "red", "white"]);
    expect(state.stacks[9]).toBeUndefined();
  });

  it("#8 [黑,白,红] 掷黑 1：两只上方都有赛跑骆驼，白直接压在黑上 → 移动白", () => {
    const state = game({ stacks: board({ 9: ["black", "white", "red"] }) });
    resolveRoll(state, "p1", "gray", 1, "black", []);
    expect(state.stacks[8]).toEqual(["white", "red"]);
    expect(state.stacks[9]).toEqual(["black"]);
  });

  it("#9 赛跑骆驼载着疯狂骆驼前进", () => {
    const state = game({ stacks: board({ 8: ["blue", "black"] }) });
    resolveRoll(state, "p1", "blue", 3, undefined, []);
    expect(state.stacks[11]).toEqual(["blue", "black"]);
  });

  it("#10 疯狂骆驼停在欢呼面：沿逆时针再退 1 格", () => {
    const state = game({ stacks: board({ 9: ["white"] }), spectators: [{ owner: "p3", pos: 7, side: "cheer" }] });
    moveCamel(state, "white", 2, -1, []);
    expect(state.stacks[6]).toEqual(["white"]);
    expect(coinsOf(state, "p3")).toBe(4);
  });

  it("疯狂骆驼停在嘘面：顺时针进 1 格，放到最下面", () => {
    const state = game({ stacks: board({ 9: ["white"], 8: ["green"] }), spectators: [{ owner: "p3", pos: 7, side: "boo" }] });
    moveCamel(state, "white", 2, -1, []);
    expect(state.stacks[8]).toEqual(["white", "green"]);
  });

  it("#18 疯狂骆驼载着赛跑骆驼退到第 0 格：越线，游戏结束，该赛跑骆驼排最后", () => {
    const state = game({ stacks: board({ 2: ["white", "purple"], 5: ["red"], 6: ["blue"], 7: ["green"], 8: ["yellow"] }) });
    resolveRoll(state, "p1", "gray", 2, "white", []);
    expect(state.stacks[0]).toEqual(["white", "purple"]);
    expect(state.phase).toBe("finished");
    expect(state.finalResult!.ranking.at(-1)).toBe("purple");
  });

  it("crazyCrossEndsGame 关闭时，逆时针越过第 1 格绕回第 16 格继续", () => {
    const state = game({ stacks: board({ 2: ["white"], 5: ["red"], 6: ["blue"], 7: ["green"], 8: ["yellow"], 9: ["purple"], 10: ["black"] }) }, 3, { crazyCrossEndsGame: false });
    resolveRoll(state, "p1", "gray", 3, "white", []);
    expect(state.stacks[15]).toEqual(["white"]);
    expect(state.phase).toBe("playing");
  });
});

describe("排名", () => {
  it("先比位置，同格越上面越靠前；夹着的疯狂骆驼不影响", () => {
    expect(rankRacers({ 3: ["red", "black", "blue"], 5: ["green"], 1: ["yellow", "purple"], 14: ["white"] }))
      .toEqual(["green", "blue", "red", "purple", "yellow"]);
  });

  it("#16 两只先后越线到 17、18：18 格者为冠军", () => {
    expect(rankRacers({ 17: ["red"], 18: ["blue"], 10: ["green", "yellow"], 4: ["purple"] })[0]).toBe("blue");
    expect(rankRacers({ 18: ["red", "blue"], 10: ["green", "yellow"], 4: ["purple"] })[0]).toBe("blue");
  });
});

describe("行动", () => {
  it("#11 观众板合法格：第 3 格有骆驼、第 5 格有他人观众板", () => {
    const state = game({ stacks: { 3: ["red", "blue", "yellow", "green", "purple"], 15: ["black"], 16: ["white"] }, spectators: [{ owner: "p2", pos: 5, side: "cheer" }] });
    const legal = legalSpectatorCells(state, "p1");
    for (const pos of [1, 3, 4, 5, 6]) expect(legal).not.toContain(pos);
    for (const pos of [2, 7, 8]) expect(legal).toContain(pos);
    const rng = createRng(1);
    expect(() => apply(state, "p1", { type: "PLACE_SPECTATOR", pos: 4, side: "boo" }, rng)).toThrow();
    expect(apply(state, "p1", { type: "PLACE_SPECTATOR", pos: 7, side: "boo" }, rng).state.spectators).toHaveLength(2);
  });

  it("移动自己的观众板时把旧板视为已拿起；可以在原格翻面，但不能原样放回", () => {
    const state = game({ stacks: { 1: ["red", "blue", "yellow", "green", "purple"], 15: ["black"], 16: ["white"] }, spectators: [{ owner: "p1", pos: 5, side: "cheer" }] });
    const rng = createRng(1);
    expect(apply(state, "p1", { type: "PLACE_SPECTATOR", pos: 6, side: "cheer" }, rng).state.spectators).toEqual([{ owner: "p1", pos: 6, side: "cheer" }]);
    expect(apply(state, "p1", { type: "PLACE_SPECTATOR", pos: 5, side: "boo" }, rng).state.spectators).toEqual([{ owner: "p1", pos: 5, side: "boo" }]);
    expect(() => apply(state, "p1", { type: "PLACE_SPECTATOR", pos: 5, side: "cheer" }, rng)).toThrow();
  });

  it("#12 某色下注票拿完后不能再拿；票按 5→3→2→2 被拿走", () => {
    let state = game();
    const rng = createRng(3);
    const order = ["p1", "p2", "p3", "p1"];
    for (const player of order) state = apply(state, player, { type: "TAKE_LEG_BET", camel: "red" }, rng).state;
    expect(state.players[0]!.legBets).toEqual([{ camel: "red", value: 5 }, { camel: "red", value: 2 }]);
    expect(state.legTickets.red).toEqual([]);
    expect(() => apply(state, "p2", { type: "TAKE_LEG_BET", camel: "red" }, rng)).toThrow("拿完");
  });

  it("没轮到时不能行动；非掷骰行动直接轮到下一位", () => {
    const state = game();
    const rng = createRng(3);
    expect(() => apply(state, "p2", { type: "ROLL" }, rng)).toThrow("还没轮到你");
    expect(apply(state, "p1", { type: "TAKE_LEG_BET", camel: "blue" }, rng).state.currentPlayer).toBe(1);
  });

  it("终局下注：每色只能下一次，放下后从手里移除", () => {
    let state = game();
    const rng = createRng(3);
    state = apply(state, "p1", { type: "BET_OVERALL", camel: "green", pile: "winner" }, rng).state;
    expect(state.players[0]!.finishCards).not.toContain("green");
    expect(state.winnerPile).toEqual([{ owner: "p1", camel: "green" }]);
    state = { ...state, currentPlayer: 0 };
    expect(() => apply(state, "p1", { type: "BET_OVERALL", camel: "green", pile: "loser" }, rng)).toThrow();
  });

  it("掷骰：拿一张金字塔票，骰子离开池子", () => {
    const state = game();
    const { state: next, events } = apply(state, "p1", { type: "ROLL" }, createRng(9));
    expect(next.players[0]!.pyramidTickets).toBe(1);
    expect(next.diceInPyramid).toHaveLength(5);
    expect(next.rolledThisLeg).toHaveLength(1);
    expect(events[0]!.type).toBe("DieRolled");
  });

  it("超时自动替当前玩家掷骰", () => {
    const state = game();
    const next = timeoutTurn(state);
    expect(next.players[0]!.pyramidTickets).toBe(1);
    expect(next.events[0]).toEqual({ type: "TurnTimedOut", player: "p1" });
    expect(next.currentPlayer).toBe(1);
  });
});

describe("赛段结算", () => {
  /** 前 4 颗骰子已掷完，下一颗就是第 5 颗。 */
  function lastDie(overrides: Partial<GameState>, playerCount = 3): GameState {
    return game({
      diceInPyramid: ["purple", "gray"],
      rolledThisLeg: (["red", "yellow", "blue", "green"] as RacerId[]).map((die) => ({ die, value: 1, moved: die })),
      ...overrides,
    }, playerCount);
  }

  it("下注票按名次、金字塔票每张 +1，然后重置；#17 没掷的骰子也回池、观众板收回", () => {
    const state = lastDie({
      stacks: board({ 10: ["red"], 9: ["blue"], 8: ["green"], 7: ["yellow"], 4: ["purple"] }),
      spectators: [{ owner: "p3", pos: 12, side: "cheer" }],
      legTickets: { red: [2], blue: [3, 2, 2], green: [5, 3, 2, 2], yellow: [5, 3, 2, 2], purple: [5, 3, 2, 2] },
    });
    state.players[0]!.legBets = [{ camel: "red", value: 5 }, { camel: "red", value: 3 }];
    state.players[1]!.legBets = [{ camel: "blue", value: 5 }];
    state.players[2]!.legBets = [{ camel: "red", value: 2 }];
    state.players[2]!.pyramidTickets = 2;
    const events: GameEvent[] = [];
    resolveRoll(state, "p1", "purple", 1, undefined, events);
    const scored = events.find((event) => event.type === "LegScored");
    expect(scored).toBeDefined();
    // p1: 5+3 + 金字塔票 1；p2: 第 2 名 +1；p3: +2 + 2 张金字塔票
    expect(state.players.map((player) => player.coins)).toEqual([3 + 9, 3 + 1, 3 + 4]);
    expect(state.leg).toBe(2);
    expect(state.diceInPyramid).toHaveLength(6);
    expect(state.spectators).toEqual([]);
    expect(state.legTickets.red).toEqual([5, 3, 2, 2]);
    expect(state.players.every((player) => player.legBets.length === 0 && player.pyramidTickets === 0)).toBe(true);
    // 骆驼位置不变；下一赛段由掷第 5 颗的下一位开始
    expect(state.stacks[5]).toEqual(["purple"]);
    expect(state.currentPlayer).toBe(1);
  });

  it("#14 只有 1 金币却持有 3 张亏损票：结算后变为 0", () => {
    const state = lastDie({ stacks: board({ 10: ["red"], 9: ["blue"], 8: ["green"], 7: ["yellow"], 4: ["purple"] }) });
    state.players[1]!.coins = 1;
    state.players[1]!.legBets = [{ camel: "green", value: 5 }, { camel: "yellow", value: 5 }, { camel: "purple", value: 5 }];
    resolveRoll(state, "p1", "purple", 1, undefined, []);
    expect(coinsOf(state, "p2")).toBe(0);
  });

  it("#13 第 5 颗骰让骆驼越线：只结算一次赛段，然后终局，不重置", () => {
    const state = lastDie({ stacks: board({ 15: ["purple"], 9: ["blue"], 8: ["green"], 7: ["yellow"], 4: ["red"] }) });
    state.players[1]!.legBets = [{ camel: "purple", value: 5 }];
    const events: GameEvent[] = [];
    resolveRoll(state, "p1", "purple", 3, undefined, events);
    expect(events.filter((event) => event.type === "LegScored")).toHaveLength(1);
    expect(events.at(-1)!.type).toBe("GameEnded");
    expect(state.phase).toBe("finished");
    expect(state.leg).toBe(1);
    expect(state.rolledThisLeg).toHaveLength(5);
    expect(coinsOf(state, "p2")).toBe(8);
  });

  it("合伙：额外拿伙伴最好的一张票（不为负），不算金字塔票", () => {
    const six = lastDie({
      stacks: board({ 10: ["red"], 9: ["blue"], 8: ["green"], 7: ["yellow"], 4: ["purple"] }),
      partners: { p2: "p3", p3: "p2", p4: "p5", p5: "p4" },
    }, 6);
    six.players[2]!.legBets = [{ camel: "red", value: 5 }, { camel: "green", value: 3 }];
    six.players[2]!.pyramidTickets = 3;
    six.players[4]!.legBets = [{ camel: "purple", value: 5 }];
    resolveRoll(six, "p1", "purple", 1, undefined, []);
    const result = six.legResults[0]!;
    expect(result.payouts.find((payout) => payout.player === "p2")!.partner).toBe(5);
    expect(result.payouts.find((payout) => payout.player === "p4")!.partner).toBe(0);
    expect(coinsOf(six, "p2")).toBe(3 + 5);
  });

  it("合伙行动：双方都必须尚未结伴，5 人局不能用", () => {
    const rng = createRng(1);
    const six = game({}, 6);
    const next = apply(six, "p1", { type: "PARTNER", target: "p4" }, rng).state;
    expect(next.partners).toEqual({ p1: "p4", p4: "p1" });
    expect(() => apply({ ...next, currentPlayer: 1 }, "p2", { type: "PARTNER", target: "p1" }, rng)).toThrow("对方");
    expect(() => apply(game({}, 5), "p1", { type: "PARTNER", target: "p2" }, rng)).toThrow();
  });
});

describe("终局", () => {
  it("#15 冠军牌堆 A 错、B 对、C 对：A −1，B +8，C +5；垫底牌堆独立计数", () => {
    const state = game({
      stacks: board({ 14: ["blue"], 9: ["red"], 8: ["green"], 7: ["yellow"], 4: ["purple"] }),
      winnerPile: [{ owner: "p1", camel: "red" }, { owner: "p2", camel: "blue" }, { owner: "p3", camel: "blue" }],
      loserPile: [{ owner: "p3", camel: "purple" }, { owner: "p1", camel: "purple" }],
    });
    const events: GameEvent[] = [];
    resolveRoll(state, "p1", "blue", 3, undefined, events);
    const ended = events.at(-1)!;
    expect(ended.type).toBe("GameEnded");
    const result = state.finalResult!;
    expect(result.winnerPile.map((reveal) => reveal.delta)).toEqual([-1, 8, 5]);
    expect(result.loserPile.map((reveal) => reveal.delta)).toEqual([8, 5]);
    // p1 掷骰拿了 1 张金字塔票：3 + 1 − 1 + 5
    expect(state.players.map((player) => player.coins)).toEqual([8, 11, 16]);
    expect(result.winners).toEqual(["p3"]);
  });

  it("猜对第 6 个及以后每人 +1；并列最高金币都算赢", () => {
    const pile = Array.from({ length: 7 }, (_, index) => ({ owner: `p${(index % 3) + 1}`, camel: "blue" as RacerId }));
    const state = game({ stacks: board({ 14: ["blue"], 9: ["red"], 8: ["green"], 7: ["yellow"], 4: ["purple"] }), winnerPile: pile });
    resolveRoll(state, "p1", "blue", 3, undefined, []);
    expect(state.finalResult!.winnerPile.map((reveal) => reveal.delta)).toEqual([8, 5, 3, 2, 1, 1, 1]);
    const tie = game({ stacks: board({ 14: ["blue"], 9: ["red"], 8: ["green"], 7: ["yellow"], 4: ["purple"] }) });
    tie.players[0]!.coins = 2;
    resolveRoll(tie, "p1", "blue", 3, undefined, []);
    expect(tie.finalResult!.winners).toEqual(["p1", "p2", "p3"]);
  });

  it("结束后不能再行动", () => {
    const state = game({ stacks: board({ 15: ["blue"] }) });
    resolveRoll(state, "p1", "blue", 3, undefined, []);
    expect(() => apply(state, "p2", { type: "ROLL" }, createRng(1))).toThrow("结束");
  });
});

describe("信息可见性", () => {
  it("别人看不到种子、手中终局卡和牌堆颜色；自己下的自己看得到；终局后全部公开", () => {
    let state = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], 5);
    state = { ...state, currentPlayer: 0 };
    state = applyCommand(state, "a", { type: "BET_OVERALL", camel: "red", pile: "winner" });
    const forB = redactGameForViewer(state, "b");
    expect(forB.seed).toBeUndefined();
    expect(forB.rngState).toBeUndefined();
    expect(forB.log).toBeUndefined();
    expect(forB.winnerPile).toEqual([{ owner: "a", camel: null }]);
    expect(forB.players[0]!.finishCards).toEqual([null, null, null, null]);
    expect(forB.events[0]).toMatchObject({ type: "OverallBetPlaced", camel: null });
    const forA = redactGameForViewer(state, "a");
    expect(forA.winnerPile).toEqual([{ owner: "a", camel: "red" }]);
    expect(forA.players[0]!.finishCards).toHaveLength(4);
    const finished = redactGameForViewer({ ...state, phase: "finished" }, "b");
    expect(finished.winnerPile).toEqual([{ owner: "a", camel: "red" }]);
  });
});

describe("整局模拟", () => {
  it("随机行动的 300 局都能正常结束，金币不为负", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const count = 3 + (seed % 6);
      let state = createGame(Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `P${index}` })), seed);
      const pick = createRng(seed * 7919);
      for (let step = 0; step < 2000 && state.phase === "playing"; step += 1) {
        const player = state.players[state.currentPlayer]!;
        const roll = pick.next();
        const options: Parameters<typeof applyCommand>[2][] = [{ type: "ROLL" }];
        if (roll < 0.25) {
          const camel = (["red", "yellow", "blue", "green", "purple"] as RacerId[])[pick.int(5)]!;
          if (state.legTickets[camel].length) options.unshift({ type: "TAKE_LEG_BET", camel });
        } else if (roll < 0.35) {
          const cells = legalSpectatorCells(state, player.id);
          if (cells.length) options.unshift({ type: "PLACE_SPECTATOR", pos: pick.pick(cells), side: pick.next() < 0.5 ? "cheer" : "boo" });
        } else if (roll < 0.45 && player.finishCards.length) {
          options.unshift({ type: "BET_OVERALL", camel: player.finishCards[0]!, pile: pick.next() < 0.5 ? "winner" : "loser" });
        }
        try {
          state = applyCommand(state, player.id, options[0]!);
        } catch {
          state = applyCommand(state, player.id, { type: "ROLL" });
        }
      }
      expect(state.phase).toBe("finished");
      expect(state.players.every((player) => player.coins >= 0)).toBe(true);
      expect(Object.values(state.stacks).flat()).toHaveLength(7);
    }
  });
});
