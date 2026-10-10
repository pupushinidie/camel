import { describe, expect, it } from "vitest";
import { botAdvice, botCommand } from "./bot.js";
import { apply, applyCommand, createGame, redactGameForViewer } from "./engine.js";
import { createRng } from "./rng.js";
import type { CamelId, GameState, RacerId } from "./types.js";

function players(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` }));
}

/** p1 先手的 n 人局面，再用 overrides 改成想要的样子。 */
function game(overrides: Partial<GameState> = {}, count = 3): GameState {
  return { ...createGame(players(count), 7), currentPlayer: 0, ...overrides };
}

const view = (state: GameState, id = "p1") => redactGameForViewer(state, id);

describe("人机只看自己的视角", () => {
  it("没经过 redactGameForViewer 的状态直接拒绝", () => {
    const state = game();
    expect(() => botCommand(state, "p1")).toThrow(/视角/);
    expect(() => botCommand(view(state), "p1")).not.toThrow();
  });

  it("别人押的终局卡是什么颜色，不影响人机的决定", () => {
    const base = game();
    // 两个局面只差在 p2、p3 押出去的终局卡颜色（p1 看不到）
    const withCards = (winner: RacerId, loser: RacerId): GameState => ({
      ...base,
      players: base.players.map((player) =>
        player.id === "p1" ? player : { ...player, finishCards: (["red", "yellow", "blue", "green", "purple"] as RacerId[]).filter((camel) => camel !== winner && camel !== loser) },
      ),
      winnerPile: [{ owner: "p2", camel: winner }],
      loserPile: [{ owner: "p3", camel: loser }],
    });
    const a = withCards("red", "blue");
    const b = withCards("green", "purple");
    expect(view(a).winnerPile[0]!.camel).toBeNull();
    expect(botAdvice(view(a), "p1")).toEqual(botAdvice(view(b), "p1"));
  });
});

describe("人机的关键决策", () => {
  it("本赛段只剩一颗骰子、领头骆驼稳拿第一时，拿它的 5 元票", () => {
    // 红在 10 格，其余都在 3 格以内；只剩紫骰没掷（第 5 颗），紫最多走到 4
    const stacks: Record<number, CamelId[]> = { 10: ["red"], 2: ["yellow", "blue"], 1: ["purple", "green"], 15: ["black"], 16: ["white"] };
    const state = game({
      stacks,
      diceInPyramid: ["purple", "gray"],
      rolledThisLeg: [
        { die: "red", value: 3, moved: "red" },
        { die: "yellow", value: 1, moved: "yellow" },
        { die: "blue", value: 1, moved: "blue" },
        { die: "green", value: 1, moved: "green" },
      ],
    });
    const advice = botAdvice(view(state), "p1");
    expect(advice.command).toEqual({ type: "TAKE_LEG_BET", camel: "red" });
    expect(advice.value).toBeGreaterThan(4);
    expect(advice.reason).toContain("红");
  });

  it("领头骆驼快到终点、赛段票拿完时，押它的总冠军", () => {
    const stacks: Record<number, CamelId[]> = { 15: ["red"], 5: ["yellow", "blue"], 4: ["purple", "green"], 9: ["black"], 8: ["white"] };
    const empty = { red: [], yellow: [], blue: [], green: [], purple: [] };
    const state = game({ stacks, legTickets: empty });
    const advice = botAdvice(view(state), "p1");
    expect(advice.command).toEqual({ type: "BET_OVERALL", camel: "red", pile: "winner" });
  });

  it("没有划算的下注、观众板也不值 1 枚金币时，掷骰拿金字塔票", () => {
    // 只剩紫骰：紫在 1 格单独一只，2–4 格每格最多被踩 1/3 次；票拿完了，终局卡也押完了
    const stacks: Record<number, CamelId[]> = { 1: ["purple"], 9: ["red"], 8: ["yellow", "blue", "green"], 15: ["black"], 16: ["white"] };
    const state = game({
      stacks,
      diceInPyramid: ["purple", "gray"],
      rolledThisLeg: [
        { die: "red", value: 3, moved: "red" },
        { die: "yellow", value: 1, moved: "yellow" },
        { die: "blue", value: 1, moved: "blue" },
        { die: "green", value: 1, moved: "green" },
      ],
      legTickets: { red: [], yellow: [], blue: [], green: [], purple: [] },
    });
    const noCards: GameState = { ...state, players: state.players.map((player) => (player.id === "p1" ? { ...player, finishCards: [] } : player)) };
    expect(botCommand(view(noCards), "p1")).toEqual({ type: "ROLL" });
  });

  it("6 人局：对方手里有一张稳赢的 5 元票时，和他合伙", () => {
    const stacks: Record<number, CamelId[]> = { 12: ["red"], 2: ["yellow", "blue"], 1: ["purple", "green"], 15: ["black"], 16: ["white"] };
    const base = game({
      stacks,
      diceInPyramid: ["purple", "gray"],
      rolledThisLeg: [
        { die: "red", value: 3, moved: "red" },
        { die: "yellow", value: 1, moved: "yellow" },
        { die: "blue", value: 1, moved: "blue" },
        { die: "green", value: 1, moved: "green" },
      ],
      legTickets: { red: [], yellow: [2], blue: [2], green: [2], purple: [2] },
    }, 6);
    const state: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === "p4" ? { ...player, legBets: [{ camel: "red", value: 5 }] } : player.id === "p1" ? { ...player, finishCards: [] } : player,
      ),
    };
    expect(botCommand(view(state), "p1")).toEqual({ type: "PARTNER", target: "p4" });
  });

  it("每一步都附一句理由", () => {
    let state = createGame(players(4), 11);
    for (let step = 0; step < 40 && state.phase === "playing"; step += 1) {
      const id = state.players[state.currentPlayer]!.id;
      const advice = botAdvice(view(state, id), id, { samples: 60 });
      expect(advice.reason.length).toBeGreaterThan(6);
      state = applyCommand(state, id, advice.command);
    }
  });
});

describe("人机自对弈", () => {
  // 合法性和结束与否不依赖模拟局数，这里用少量模拟跑得快；强度用 qa-reports/tools/bots/sim-camel.ts 测
  for (const count of [3, 4, 5, 6, 7, 8]) {
    for (const chunk of [0, 100, 200]) it(`${count} 人第 ${chunk + 1}–${chunk + 100} 局（共 300 局）：每一步都合法，都能在 600 步内结束`, () => {
      for (let index = chunk; index < chunk + 100; index += 1) {
        let state = createGame(players(count), 5000 + count * 1000 + index);
        let steps = 0;
        while (state.phase === "playing") {
          const id = state.players[state.currentPlayer]!.id;
          const command = botCommand(view(state, id), id, { samples: 4 });
          // apply 不合法会抛错
          const rng = createRng(state.rngState ?? 0);
          const { state: next } = apply(state, id, command, rng);
          state = { ...next, rngState: rng.state };
          steps += 1;
          expect(steps).toBeLessThan(600);
        }
        expect(state.finalResult?.winners.length).toBeGreaterThan(0);
      }
    }, 120_000);
  }
});
