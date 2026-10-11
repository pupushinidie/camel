import { useEffect, useRef } from "react";
import type { CamelId, GameEvent, GameState } from "@camel/game";
import { sfx, synth, useSfxCountdown } from "./gm-sound.js";
import { stepPath } from "./trackGeometry.js";
import { CHEER_MS, DIE_MS, STEP_MS } from "./usePlayback.js";

/**
 * 沙丘赛驼的动作音效：对比前后两次对局快照，按这一步的 events 出声。
 * 掷骰那一步和 usePlayback 的动画同一条时间线：骰子从金字塔冒出 → 骆驼一格一格走（每格一声蹄子）→ 观众板欢呼/嘘 → 叠罗汉落地。
 * 自己的动作 mine=true 响亮，别人的（含观战时所有人的）减半。
 * 第一次拿到快照（进房间、重连、观战刚进来、教程开场）不出声；跳了不止一步（重连、连发）时只响最后一步的结果，不排动画时间线。
 *
 * 引擎事件 → 声音：
 * - DieRolled 掷骰（金字塔）→ dice(1)；灰骰（疯狂骆驼）再加一声骆驼低吼
 * - UnitMoved 骆驼移动 → 起步一声驼铃（招牌，疯狂骆驼倒着走的铃更低）+ 每走一格一声蹄子；
 *   落到别的骆驼上面（叠罗汉）→ 木块磕一下，被嘘到最下面 → 低一点的磕
 * - SpectatorTriggered 骆驼停在观众板上 → 欢呼（上扬的人声）/ 嘘（下行），板主人 +1 金 → coin
 * - LegBetTaken 拿赛段下注票 → draw；SpectatorPlaced 放观众板 → place；OverallBetPlaced 押冠军 / 垫底 → card（扣着放）
 * - Partnered 合伙 → score
 * - CrossedFinish 冲线 → 驼铃连响 + sparkle
 * - LegScored 赛段结算 → 自己赚了 score / 亏了 bust，下一段开始 roundStart
 * - GameEnded 终局 → 翻开终局牌堆 reveal → gameOver(赢/输)
 * - TurnTimedOut 超时 → 自己 timeout，别人 pass（超时会自动掷骰，后面接着掷骰的声音）
 * - 轮到你 → yourTurn（动画播完后）；自己交出回合 → turnPassed
 * - 再来一局 / 练习局重开（version 变小）→ gameStart
 */

/** 开发时记下响了哪个声音，测试脚本读 window.__sfxLog。 */
function play(name: string, fn: () => void, delay = 0) {
  const run = () => {
    if (import.meta.env.DEV) ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push(name);
    fn();
  };
  if (delay > 0) window.setTimeout(run, delay);
  else run();
}

/** 驼铃：铜铃的几个不成整数倍的泛音，敲一下慢慢散开；low = 疯狂骆驼（倒着走）的低铃。 */
function camelBell(mine: boolean, low = false) {
  const v = synth.level(mine);
  const f = (low ? 330 : 520) * synth.jitter(0.03);
  synth.tone(f, { duration: 0.9, volume: 0.13 * v, type: "triangle" });
  synth.tone(f * 2.76, { duration: 0.55, volume: 0.07 * v });
  synth.tone(f * 5.4, { duration: 0.3, volume: 0.04 * v });
  synth.noise({ duration: 0.03, volume: 0.1 * v, filter: "highpass", freq: 3500 });
  // 铃舌回弹的第二下
  synth.tone(f * 1.01, { at: 0.16, duration: 0.6, volume: 0.07 * v, type: "triangle" });
}

/** 一步蹄子踩在沙上。 */
function hoof(v: number, at: number) {
  synth.noise({ at, duration: 0.07, volume: 0.2 * v, filter: "lowpass", freq: 700 * synth.jitter(0.15) });
  synth.tone(130 * synth.jitter(0.1), { at, duration: 0.06, volume: 0.1 * v, type: "triangle" });
}

/** 疯狂骆驼的低吼。 */
function grunt(mine: boolean) {
  const v = synth.level(mine);
  synth.tone(150, { duration: 0.45, volume: 0.16 * v, type: "sawtooth", glideTo: 90 });
  synth.noise({ duration: 0.4, volume: 0.08 * v, filter: "lowpass", freq: 500 });
}

/** 观众：欢呼是一阵上扬的嘈杂声，嘘是往下掉的长音。 */
function crowd(side: "cheer" | "boo", mine: boolean) {
  const v = synth.level(mine);
  if (side === "cheer") {
    synth.noise({ duration: 0.5, volume: 0.16 * v, freq: 900, freqTo: 2200, q: 0.6 });
    [523, 659, 784].forEach((f, i) => synth.tone(f, { at: 0.05 + i * 0.06, duration: 0.3, volume: 0.06 * v, type: "triangle" }));
  } else {
    synth.noise({ duration: 0.55, volume: 0.12 * v, freq: 700, freqTo: 300, q: 0.8 });
    synth.tone(220, { duration: 0.5, volume: 0.1 * v, type: "sawtooth", glideTo: 150 });
  }
}

type Of<T extends GameEvent["type"]> = Extract<GameEvent, { type: T }>;

/** 把一个单位从原位置拿走、放到 to（和 usePlayback 的 moveVisual 一样），返回落点原来有没有别的骆驼。 */
function land(stacks: Record<number, CamelId[]>, unit: CamelId[], to: number, under: boolean): boolean {
  for (const key of Object.keys(stacks)) {
    const rest = stacks[Number(key)]!.filter((camel) => !unit.includes(camel));
    if (rest.length) stacks[Number(key)] = rest;
    else delete stacks[Number(key)];
  }
  const existing = stacks[to] ?? [];
  stacks[to] = under ? [...unit, ...existing] : [...existing, ...unit];
  return existing.length > 0;
}

export function useGameSfx(game: GameState | undefined, selfId: string) {
  const prev = useRef<GameState | undefined>(undefined);

  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before || !game || before.version === game.version) return;

    if (game.version < before.version) {
      play("gameStart", () => sfx.gameStart());
      if (game.phase === "playing" && game.players[game.currentPlayer]?.id === selfId) play("yourTurn", () => sfx.yourTurn(), 700);
      return;
    }

    const events = game.events;
    const find = <T extends GameEvent["type"]>(type: T) => events.find((event): event is Of<T> => event.type === type);
    const isMine = (playerId: string) => playerId !== "" && playerId === selfId;
    const actor = before.players[before.currentPlayer]?.id ?? "";
    const actorMine = isMine(actor);
    // 只比上一个多一步时排动画时间线；跳步时直接响结果
    const timeline = game.version === before.version + 1;
    let at = 0;

    const timedOut = find("TurnTimedOut");
    if (timedOut) {
      play(isMine(timedOut.player) ? "timeout" : "pass", () => (isMine(timedOut.player) ? sfx.timeout() : sfx.pass(false)));
      at = 350;
    }

    for (const event of events) {
      if (event.type === "LegBetTaken") play("draw", () => sfx.draw(isMine(event.player)), at);
      else if (event.type === "SpectatorPlaced") play("place", () => sfx.place(isMine(event.player)), at);
      else if (event.type === "OverallBetPlaced") play("card", () => sfx.card(isMine(event.player)), at);
      else if (event.type === "Partnered") play("score", () => sfx.score(isMine(event.player) || isMine(event.target)), at);
    }

    const rolled = find("DieRolled");
    if (rolled) {
      const mine = isMine(rolled.player);
      const v = synth.level(mine);
      play("dice", () => sfx.dice(1, mine), at);
      if (rolled.die === "gray") play("grunt", () => grunt(mine), at + 350);
      at += timeline ? DIE_MS : 400;
      const stacks: Record<number, CamelId[]> = Object.fromEntries(Object.entries(before.stacks).map(([key, stack]) => [Number(key), [...stack]]));
      let bellRung = false;
      for (const event of events) {
        if (event.type === "SpectatorTriggered") {
          play(event.side === "cheer" ? "cheer" : "boo", () => crowd(event.side, mine), at);
          play("coin", () => sfx.coin(isMine(event.owner)), at + 250);
          if (timeline) at += CHEER_MS;
        } else if (event.type === "UnitMoved") {
          const steps = stepPath(event.from, event.to, event.dir).length;
          const backward = event.dir < 0;
          if (!bellRung || event.cause === "die") play("camelBell", () => camelBell(mine, backward), at);
          bellRung = true;
          const walk = timeline ? steps : Math.min(steps, 1);
          play("hoof", () => { for (let i = 0; i < walk; i += 1) hoof(v, i * (STEP_MS / 1000)); }, at);
          const stacked = land(stacks, event.camels, event.to, event.under);
          const landAt = at + Math.max(0, walk - 1) * STEP_MS + 150;
          if (stacked) play("stack", () => sfx.tile(mine, 1, event.under ? 0.7 : 1.2), landAt);
          if (timeline) at += steps * STEP_MS;
        } else if (event.type === "CrossedFinish") {
          play("camelBell", () => { camelBell(true); window.setTimeout(() => camelBell(true), 220); }, at);
          play("sparkle", () => sfx.sparkle(true), at + 450);
          at += 600;
        }
      }
    }

    const leg = find("LegScored");
    if (leg) {
      const net = leg.result.payouts.find((payout) => payout.player === selfId)?.net ?? 0;
      if (net > 0) play("score", () => sfx.score(true, net >= 5), at + 300);
      else if (net < 0) play("bust", () => sfx.bust(true), at + 300);
      else play("coin", () => sfx.coin(false), at + 300);
      at += 900;
    }

    const ended = find("GameEnded");
    if (ended) {
      play("reveal", () => sfx.reveal(true), at + 200);
      play("gameOver", () => sfx.gameOver(ended.result.winners.includes(selfId)), at + 900);
      return;
    }

    if (leg) {
      play("roundStart", () => sfx.roundStart(), at);
      at += 400;
    }

    const next = game.players[game.currentPlayer]?.id ?? "";
    if (game.phase === "playing" && next !== actor) {
      if (isMine(next)) play("yourTurn", () => sfx.yourTurn(), at + 300);
      else if (actorMine) play("turnPassed", () => sfx.turnPassed(), at + 300);
    }
  }, [game?.version]);
}

/** 自己行动的最后 5 秒每秒一声（gm-sound 的 useSfxCountdown）；开发时也记进 __sfxLog。 */
export function useCountdownSfx(isMyTurn: boolean, secondsLeft: number | null | undefined) {
  useSfxCountdown(isMyTurn, secondsLeft);
  useEffect(() => {
    if (import.meta.env.DEV && isMyTurn && secondsLeft != null && secondsLeft >= 1 && secondsLeft <= 5) {
      ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push("countdown");
    }
  }, [isMyTurn, secondsLeft]);
}
