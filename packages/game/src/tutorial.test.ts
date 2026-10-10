import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { apply, legalSpectatorCells, rankRacers, redactGameForViewer } from "./engine.js";
import {
  anchorVisible,
  createPracticeGame,
  createTutorialGame,
  createTutorialRng,
  TUTORIAL_ROLLS,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  type TutorialRng,
} from "./tutorial.js";
import type { GameState } from "./types.js";

const actor = (game: GameState) => game.players[game.currentPlayer]!.id;

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length, rng: TutorialRng = createTutorialRng(1)): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = apply(game, TUTORIAL_SELF, step.expect, rng).state;
    if (step.kind === "watch") for (const move of step.moves) game = apply(game, actor(game), move, rng).state;
  }
  return game;
}

const stepIndex = (id: string) => TUTORIAL_STEPS.findIndex((step) => step.id === id);
const coins = (game: GameState, id: string) => game.players.find((player) => player.id === id)!.coins;

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法、轮到的是对的人，高亮的东西在界面上看得见", () => {
    let game = createTutorialGame("小蒲");
    const rng = createTutorialRng(1);
    for (const step of TUTORIAL_STEPS) {
      if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
      if (step.kind === "do") {
        expect(actor(game), `「${step.id}」不是轮到你`).toBe(TUTORIAL_SELF);
        for (const follow of step.then ?? []) expect(anchorVisible(game, follow.anchor, TUTORIAL_SELF), `「${step.id}」后续高亮 ${follow.anchor} 看不见`).toBe(true);
        if (step.expect.type === "PLACE_SPECTATOR") expect(legalSpectatorCells(game, TUTORIAL_SELF)).toContain(step.expect.pos);
        game = apply(game, TUTORIAL_SELF, step.expect, rng).state;
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          expect(actor(game), `「${step.id}」里轮到了你`).not.toBe(TUTORIAL_SELF);
          game = apply(game, actor(game), move, rng).state;
        }
      }
    }
    // 剧本骰子正好用完：多一颗少一颗，后面的剧情都会错位
    expect(rng.remaining).toBe(0);
  });

  it("关键的几幕一定发生：叠罗汉一起走、疯骆驼倒退、踩到欢呼板、第 5 颗骰子结算", () => {
    const afterRoll = playScript(stepIndex("roll") + 1);
    expect(afterRoll.stacks[4]).toEqual(["yellow", "red"]);
    expect(rankRacers(afterRoll.stacks)[0]).toBe("red");

    const afterCrazy = playScript(stepIndex("rivals1") + 1);
    expect(afterCrazy.stacks[15]).toEqual(["black"]);
    expect(afterCrazy.winnerPile).toHaveLength(1);
    // 你看不到咕噜二号押的颜色
    expect(redactGameForViewer(afterCrazy, TUTORIAL_SELF).winnerPile[0]!.camel).toBeNull();

    const afterBets = playScript(stepIndex("rivals2") + 1);
    expect(afterBets.players.find((player) => player.id === TUTORIAL_SELF)!.legBets).toEqual([{ camel: "red", value: 5 }]);
    expect(afterBets.players.find((player) => player.id === "p2")!.legBets).toEqual([{ camel: "red", value: 3 }]);

    const afterCheer = playScript(stepIndex("rivals3") + 1);
    expect(afterCheer.events.some((event) => event.type === "SpectatorTriggered" && event.owner === TUTORIAL_SELF)).toBe(true);
    expect(afterCheer.stacks[6]).toEqual(["red"]);
    expect(coins(afterCheer, TUTORIAL_SELF)).toBe(4);

    const afterLeg = playScript(stepIndex("rivals4") + 1);
    expect(afterLeg.leg).toBe(2);
    expect(afterLeg.legResults[0]!.ranking.slice(0, 2)).toEqual(["red", "purple"]);
    expect(coins(afterLeg, TUTORIAL_SELF)).toBe(10);
    expect(coins(afterLeg, "p2")).toBe(8);
    expect(coins(afterLeg, "p3")).toBe(5);
    expect(afterLeg.spectators).toEqual([]);
    expect(actor(afterLeg)).toBe(TUTORIAL_SELF);

    const afterOverall = playScript(stepIndex("overall") + 1);
    expect(afterOverall.winnerPile.map((card) => card.owner)).toEqual(["p3", TUTORIAL_SELF]);
  });

  it("剧本本身：步骤 id 不重复，最后一步是唯一的收尾，说明文字不空、不太长", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.trim().length).toBeGreaterThan(0);
      expect(step.say.length).toBeLessThanOrEqual(32);
      // 补充最多两句
      expect((step.note ?? "").split("。").filter((part) => part.trim()).length).toBeLessThanOrEqual(2);
    }
  });

  it("剧本骰子按顺序出，用完以后是普通随机数", () => {
    const rng = createTutorialRng(7);
    let game = createTutorialGame("小蒲");
    const seen: string[] = [];
    for (let index = 0; index < TUTORIAL_ROLLS.length; index += 1) {
      const result = apply(game, actor(game), { type: "ROLL" }, rng);
      const rolled = result.events.find((event) => event.type === "DieRolled");
      if (rolled?.type === "DieRolled") seen.push(`${rolled.die}${rolled.value}${rolled.color ?? ""}`);
      game = result.state;
    }
    expect(seen).toEqual(TUTORIAL_ROLLS.map((roll) => `${roll.die}${roll.value}${roll.color ?? ""}`));
    expect(rng.remaining).toBe(0);
    const values = new Set<number>();
    for (let index = 0; index < 200; index += 1) values.add(rng.int(3));
    expect([...values].sort()).toEqual([0, 1, 2]);
  });

  it("剧本走完接练习局：三家都交给人机，60 局都能正常打完", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 60; seed += 1) {
      const rng = createTutorialRng(seed);
      let game = seed % 2 === 0 ? playScript(TUTORIAL_STEPS.length, rng) : createPracticeGame("小蒲", seed);
      let moves = 0;
      while (game.phase === "playing" && moves < 600) {
        const id = actor(game);
        game = apply(game, id, botCommand(redactGameForViewer(game, id), id, { samples: 8 }), rng).state;
        moves += 1;
      }
      if (game.phase !== "finished" || !game.finalResult) stuck.push(`第 ${seed} 局（${moves} 步）`);
    }
    expect(stuck).toEqual([]);
  }, 60_000);
});
