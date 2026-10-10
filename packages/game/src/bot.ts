/**
 * 人机（「普通」难度）：按期望收益挑行动，只用自己座位看得到的信息。
 *
 * 输入必须是 redactGameForViewer(game, playerId) 之后的状态：别人押的终局卡颜色、
 * 种子和随机数状态它都看不到。随机数用状态版本号和座位 id 生成，同一局面总是同一个决定。
 *
 * 思路（骆驼大赛的常见算账法）：
 * 1. 蒙特卡洛：把本赛段剩下的骰子随机掷完（含观众板效果），再按新赛段一直掷到有骆驼越线，
 *    得到每只骆驼本赛段第 1/2 名的概率、最终冠军/垫底的概率、每格被骆驼踩到的期望次数。
 * 2. 每个行动的期望金币：
 *    - 掷骰：金字塔票稳拿 +1；
 *    - 拿赛段下注票：票面 × P(第 1) + 1 × P(第 2) − 1 × P(其余)；
 *    - 押冠军 / 垫底：P(猜中) × 预计排到的奖金 − P(猜错) × 1，越早押奖金越高；
 *    - 放观众板：本赛段预计被踩的次数（每次 +1），再用同一批随机数重算一遍对自己下注票的影响；
 *    - 合伙（6 人以上）：对方现有下注票里最好那张的期望（不为负）。
 * 3. 选期望最高的；终局卡押注要比掷骰多出一点余量才押（越早押越不确定）。
 */
import { chooseCrazy, isOffTrack, legalSpectatorCells, moveCamel, rankRacers } from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import {
  CRAZIES,
  RACERS,
  type CamelId,
  type CrazyId,
  type DieId,
  type GameCommand,
  type GameEvent,
  type GameState,
  type OverallPile,
  type RacerId,
  type Spectator,
  type SpectatorSide,
} from "./types.js";

export const CAMEL_LABEL: Record<RacerId, string> = { red: "红", yellow: "黄", blue: "蓝", green: "绿", purple: "紫" };

/** 每次决策的随机模拟局数；本赛段的胜负概率和整局的冠军/垫底概率都从这里来。 */
const SAMPLES = 500;
/** 放观众板时，对几个最常被踩的格子用同一批随机数各重算一遍。 */
const SPECTATOR_CANDIDATES = 3;
const SPECTATOR_SAMPLES = 250;
/** 押终局卡要比掷骰（+1）多出这么多期望才押：越早押越不确定，留着卡以后押更准。 */
const OVERALL_MARGIN = 0.35;
/** 每个赛段掷 5 颗骰子。 */
const DICE_PER_LEG = 5;
const GRAY_FACES: readonly { color: CrazyId; value: number }[] = CRAZIES.flatMap((color) =>
  [1, 2, 3].map((value) => ({ color, value })),
);

export interface BotAdvice {
  readonly command: GameCommand;
  /** 一句玩家听得懂的理由，教程的「提示」按钮用。 */
  readonly reason: string;
  /** 这一步的期望金币（粗略）。 */
  readonly value: number;
}

type Stacks = Record<number, CamelId[]>;

interface SimState {
  stacks: Stacks;
  spectators: Spectator[];
  players: never[];
  config: GameState["config"];
}

function copyStacks(stacks: Stacks): Stacks {
  const out: Stacks = {};
  for (const key in stacks) out[key as unknown as number] = stacks[key as unknown as number]!.slice();
  return out;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 掷一颗骰子并移动（和引擎完全一样的移动规则）；返回是否有骆驼越线，以及落点。 */
function rollOne(sim: SimState, die: DieId, rng: Rng, events: GameEvent[]): boolean {
  if (die === "gray") {
    const face = GRAY_FACES[rng.int(GRAY_FACES.length)]!;
    const crazy = chooseCrazy(sim.stacks, face.color);
    return moveCamel(sim as unknown as GameState, crazy, face.value, -1, events);
  }
  return moveCamel(sim as unknown as GameState, die, 1 + rng.int(3), 1, events);
}

interface Rollout {
  /** 本赛段结算时的名次（本赛段内就结束了也算）。 */
  legRank: RacerId[];
  /** 整局结束时的名次；只模拟本赛段时为空。 */
  finalRank?: RacerId[];
  /** 本赛段每格被骰子移动落到的次数（观众板生效前的落点）。 */
  landings: number[];
  /** 本赛段我的观众板被踩的次数。 */
  myTriggers: number;
}

/** 从当前局面把本赛段掷完；full 为 true 时继续按新赛段掷到有骆驼越线。 */
function rollout(view: GameState, me: string, rng: Rng, full: boolean, spectators: Spectator[]): Rollout {
  const sim: SimState = { stacks: copyStacks(view.stacks), spectators, players: [], config: view.config };
  const landings = new Array<number>(17).fill(0);
  let myTriggers = 0;
  const dice = view.diceInPyramid.slice();
  let toRoll = DICE_PER_LEG - view.rolledThisLeg.length;
  let ended = false;
  const events: GameEvent[] = [];
  while (toRoll > 0 && dice.length > 0) {
    const index = rng.int(dice.length);
    const die = dice[index]!;
    dice.splice(index, 1);
    toRoll -= 1;
    events.length = 0;
    ended = rollOne(sim, die, rng, events);
    const first = events[0];
    if (first && first.type === "UnitMoved" && !isOffTrack(first.to)) landings[first.to]! += 1;
    for (const event of events) if (event.type === "SpectatorTriggered" && event.owner === me) myTriggers += 1;
    if (ended) break;
  }
  const legRank = rankRacers(sim.stacks);
  if (!full) return { legRank, landings, myTriggers };
  if (ended) return { legRank, finalRank: legRank, landings, myTriggers };
  // 之后的赛段：观众板已经收回，6 颗骰子掷 5 颗
  sim.spectators = [];
  const allDice: DieId[] = view.config.enableCrazyCamels ? [...RACERS, "gray"] : [...RACERS];
  for (let leg = 0; leg < 40 && !ended; leg += 1) {
    const pool = allDice.slice();
    for (let n = 0; n < DICE_PER_LEG && !ended; n += 1) {
      const index = rng.int(pool.length);
      const die = pool[index]!;
      pool.splice(index, 1);
      events.length = 0;
      ended = rollOne(sim, die, rng, events);
    }
  }
  return { legRank, finalRank: rankRacers(sim.stacks), landings, myTriggers };
}

interface Odds {
  first: Record<RacerId, number>;
  second: Record<RacerId, number>;
  winner: Record<RacerId, number>;
  loser: Record<RacerId, number>;
  landings: number[];
  myTriggers: number;
}

function zero(): Record<RacerId, number> {
  return { red: 0, yellow: 0, blue: 0, green: 0, purple: 0 };
}

function estimate(view: GameState, me: string, seed: number, samples: number, full: boolean, spectators: Spectator[]): Odds {
  const rng = createRng(seed);
  const odds: Odds = { first: zero(), second: zero(), winner: zero(), loser: zero(), landings: new Array<number>(17).fill(0), myTriggers: 0 };
  for (let i = 0; i < samples; i += 1) {
    const result = rollout(view, me, rng, full, spectators);
    odds.first[result.legRank[0]!] += 1;
    odds.second[result.legRank[1]!] += 1;
    if (result.finalRank) {
      odds.winner[result.finalRank[0]!] += 1;
      odds.loser[result.finalRank[result.finalRank.length - 1]!] += 1;
    }
    result.landings.forEach((count, pos) => {
      odds.landings[pos]! += count;
    });
    odds.myTriggers += result.myTriggers;
  }
  for (const camel of RACERS) {
    odds.first[camel] /= samples;
    odds.second[camel] /= samples;
    odds.winner[camel] /= samples;
    odds.loser[camel] /= samples;
  }
  odds.landings = odds.landings.map((count) => count / samples);
  odds.myTriggers /= samples;
  return odds;
}

/** 一张赛段下注票的期望：第 1 名拿票面，第 2 名 +1，其余 −1。 */
function betEv(odds: Odds, camel: RacerId, value: number): number {
  const p1 = odds.first[camel];
  const p2 = odds.second[camel];
  return value * p1 + p2 - (1 - p1 - p2);
}

/** 我本赛段所有下注票加上观众板的期望，用来比较观众板放在哪里。 */
function myLegValue(view: GameState, me: string, odds: Odds): number {
  const player = view.players.find((candidate) => candidate.id === me)!;
  return player.legBets.reduce((sum, bet) => sum + betEv(odds, bet.camel, bet.value), 0) + odds.myTriggers;
}

/** 一位玩家现有下注票里最好那张的期望（不为负），合伙时伙伴拿这个。 */
function bestBetEv(view: GameState, playerId: string, odds: Odds): number {
  const player = view.players.find((candidate) => candidate.id === playerId);
  if (!player) return 0;
  return Math.max(0, ...player.legBets.map((bet) => betEv(odds, bet.camel, bet.value)));
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

/** 给出这一步的建议和理由。state 必须是这个座位视角（redact 之后）的状态。 */
export function botAdvice(state: GameState, playerId: string, settings: { samples?: number } = {}): BotAdvice {
  if (state.seed !== undefined || state.rngState !== undefined || state.log !== undefined) {
    throw new Error("人机只能看自己座位的视角：先用 redactGameForViewer 处理状态。");
  }
  const samples = settings.samples ?? SAMPLES;
  const spectatorSamples = Math.max(4, Math.round((samples * SPECTATOR_SAMPLES) / SAMPLES));
  const me = state.players.find((player) => player.id === playerId);
  if (!me || state.phase !== "playing" || state.players[state.currentPlayer]?.id !== playerId) {
    return { command: { type: "ROLL" }, reason: "掷骰总是可以的。", value: 1 };
  }
  const seed = hashSeed(`${state.version}:${state.turn}:${playerId}`);
  const odds = estimate(state, playerId, seed, samples, true, state.spectators);

  const options: BotAdvice[] = [];
  options.push({ command: { type: "ROLL" }, value: 1, reason: "掷骰稳拿 1 枚金币（金字塔票），这时没有更划算的下注。" });

  // 赛段下注票
  for (const camel of RACERS) {
    const value = state.legTickets[camel][0];
    if (value === undefined) continue;
    const ev = betEv(odds, camel, value);
    options.push({
      command: { type: "TAKE_LEG_BET", camel },
      value: ev,
      reason: `${CAMEL_LABEL[camel]}骆驼这一段拿第一的机会约 ${pct(odds.first[camel])}，拿 ${value} 元票期望 ${signed(ev)}，比掷骰的 +1 划算。`,
    });
  }

  // 终局卡：冠军 / 垫底
  for (const pile of ["winner", "loser"] as OverallPile[]) {
    const cards = pile === "winner" ? state.winnerPile : state.loserPile;
    const chance = pile === "winner" ? odds.winner : odds.loser;
    for (const camel of RACERS) {
      if (!me.finishCards.includes(camel)) continue;
      const p = chance[camel];
      // 前面已经有的牌：自己的知道颜色，别人的按「大家看法差不多」估计有多少张也猜这一只
      const earlier = cards.reduce((sum, card) => {
        if (card.owner === playerId) return sum + (card.camel === camel ? 1 : 0);
        return sum + Math.min(0.9, p + 0.1);
      }, 0);
      const rank = Math.round(earlier);
      const payout = state.config.overallPayouts[rank] ?? 1;
      const ev = p * payout - (1 - p) * state.config.overallWrongPenalty - OVERALL_MARGIN;
      const label = pile === "winner" ? "总冠军" : "总垫底";
      options.push({
        command: { type: "BET_OVERALL", camel, pile },
        value: ev,
        reason: `${CAMEL_LABEL[camel]}骆驼最后${label}的机会约 ${pct(p)}，${rank === 0 ? "现在押最早，猜中拿" : `前面大约有 ${rank} 张同色，猜中拿`} ${payout}，值得押。`,
      });
    }
  }

  // 观众板：先按被踩次数挑几个格子，再用同一批随机数重算
  const legal = legalSpectatorCells(state, playerId);
  if (legal.length > 0) {
    const mySpectator = state.spectators.find((spectator) => spectator.owner === playerId);
    const baseSeed = seed ^ 0x9e3779b9;
    const baseline = myLegValue(state, playerId, estimate(state, playerId, baseSeed, spectatorSamples, false, state.spectators));
    const ranked = legal
      .map((pos) => ({ pos, hits: odds.landings[pos] ?? 0 }))
      .sort((a, b) => b.hits - a.hits || a.pos - b.pos)
      .slice(0, SPECTATOR_CANDIDATES);
    for (const { pos } of ranked) {
      for (const side of ["cheer", "boo"] as SpectatorSide[]) {
        if (mySpectator && mySpectator.pos === pos && mySpectator.side === side) continue;
        const spectators = [...state.spectators.filter((spectator) => spectator.owner !== playerId), { owner: playerId, pos, side }];
        const after = myLegValue(state, playerId, estimate(state, playerId, baseSeed, spectatorSamples, false, spectators));
        const gain = after - baseline;
        const hits = odds.landings[pos] ?? 0;
        options.push({
          command: { type: "PLACE_SPECTATOR", pos, side },
          value: gain,
          reason: `第 ${pos} 格这一段预计被骆驼踩到 ${Math.round(hits * 10) / 10} 次，每踩一次你拿 1 枚金币，放${side === "cheer" ? "欢呼面" : "嘘面"}还能帮到你的下注。`,
        });
      }
    }
  }

  // 合伙（6 人以上）：拿对方最好的一张票
  if (state.config.enablePartnership && !state.partners[playerId]) {
    const coinsLeader = Math.max(...state.players.filter((player) => player.id !== playerId).map((player) => player.coins));
    for (const target of state.players) {
      if (target.id === playerId || state.partners[target.id]) continue;
      const gain = bestBetEv(state, target.id, odds);
      // 帮了对方：对方领先时少算一点
      const cost = target.coins >= coinsLeader ? 0.6 * bestBetEv(state, playerId, odds) : 0.3 * bestBetEv(state, playerId, odds);
      options.push({
        command: { type: "PARTNER", target: target.id },
        value: gain - cost + 0.2,
        reason: `和${target.name}合伙：赛段结算时能分到他最好的一张下注票，期望 ${signed(gain)}。`,
      });
    }
  }

  let best = options[0]!;
  for (const option of options) if (option.value > best.value + 1e-9) best = option;
  return best;
}

/** 服务器用：这个座位下一步做什么。state 必须是 redactGameForViewer(game, playerId) 的结果。 */
export function botCommand(state: GameState, playerId: string, options: { samples?: number } = {}): GameCommand {
  return botAdvice(state, playerId, options).command;
}
