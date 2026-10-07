import { createRng, type Rng } from "./rng.js";
import {
  CRAZIES,
  RACERS,
  TRACK_LENGTH,
  type CamelId,
  type Config,
  type CrazyId,
  type DieId,
  type FinalResult,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LegPayout,
  type LegResult,
  type OverallCard,
  type OverallReveal,
  type Player,
  type RacerId,
} from "./types.js";

/** 规格书「配置项汇总」里的默认值；合伙模块默认在 6 人及以上开启。 */
export function defaultConfig(playerCount: number, overrides: Partial<Config> = {}): Config {
  return {
    minPlayers: 3,
    maxPlayers: 8,
    startingCoins: 3,
    enableCrazyCamels: true,
    legTicketValues: [5, 3, 2, 2],
    overallPayouts: [8, 5, 3, 2, 1],
    overallWrongPenalty: 1,
    enablePartnership: playerCount >= 6,
    allowNegativeCoins: false,
    crazyCrossEndsGame: true,
    coinsVisible: true,
    turnTimeoutSec: 60,
    ...overrides,
  };
}

/** 灰骰 6 面：黑 1–3、白 1–3，等概率。 */
const GRAY_FACES: readonly { color: CrazyId; value: number }[] = CRAZIES.flatMap((color) =>
  [1, 2, 3].map((value) => ({ color, value })),
);

/** 一个赛段掷几颗骰子：有疯狂骆驼时 6 颗里掷 5 颗，没有时 5 颗全掷。两种都是 5 颗。 */
const DICE_PER_LEG = 5;

export function isRacer(camel: CamelId): camel is RacerId {
  return (RACERS as readonly string[]).includes(camel);
}

export function isCrazy(camel: CamelId): camel is CrazyId {
  return (CRAZIES as readonly string[]).includes(camel);
}

/** 越过终点线的位置（顺时针越过 16 或逆时针越过 1）。 */
export function isOffTrack(pos: number): boolean {
  return pos > TRACK_LENGTH || pos < 1;
}

/** 某只骆驼在哪一格、在堆叠里的高度（0 是最下面）。 */
export function findCamel(stacks: Record<number, CamelId[]>, camel: CamelId): { pos: number; height: number } {
  for (const [key, stack] of Object.entries(stacks)) {
    const height = stack.indexOf(camel);
    if (height >= 0) return { pos: Number(key), height };
  }
  throw new Error(`找不到骆驼 ${camel}`);
}

/**
 * 只对 5 只赛跑骆驼排名：先比位置（越线者用未取模的实际位置），同格时越上面越靠前。
 * 堆叠里夹着的疯狂骆驼不影响先后。
 */
export function rankRacers(stacks: Record<number, CamelId[]>): RacerId[] {
  const entries: { camel: RacerId; pos: number; height: number }[] = [];
  for (const [key, stack] of Object.entries(stacks)) {
    stack.forEach((camel, height) => {
      if (isRacer(camel)) entries.push({ camel, pos: Number(key), height });
    });
  }
  return entries
    .sort((a, b) => b.pos - a.pos || b.height - a.height)
    .map((entry) => entry.camel);
}

/**
 * 灰骰决定移动哪只疯狂骆驼（按顺序判定，命中即停）：
 * 1. 恰好只有一只疯狂骆驼上方（同一堆、任意高度）有赛跑骆驼 → 移动它；
 * 2. 一只疯狂骆驼直接压在另一只上面 → 移动上面那只；
 * 3. 否则按骰面颜色。
 */
export function chooseCrazy(stacks: Record<number, CamelId[]>, faceColor: CrazyId): CrazyId {
  const carrying = CRAZIES.filter((crazy) => {
    const { pos, height } = findCamel(stacks, crazy);
    return stacks[pos]!.slice(height + 1).some(isRacer);
  });
  if (carrying.length === 1) return carrying[0]!;
  for (const crazy of CRAZIES) {
    const { pos, height } = findCamel(stacks, crazy);
    const below = height > 0 ? stacks[pos]![height - 1] : undefined;
    if (below && isCrazy(below)) return crazy;
  }
  return faceColor;
}

/** 把一个单位放到某格：默认叠在最上面，under 时放到原有骆驼的最下面。 */
function placeUnit(stacks: Record<number, CamelId[]>, pos: number, unit: CamelId[], under: boolean): void {
  const existing = stacks[pos] ?? [];
  stacks[pos] = under ? [...unit, ...existing] : [...existing, ...unit];
}

/** 拿起某只骆驼和它上方的所有骆驼（保持内部顺序），下方的留在原地。 */
function takeUnit(stacks: Record<number, CamelId[]>, camel: CamelId): { unit: CamelId[]; from: number } {
  const { pos, height } = findCamel(stacks, camel);
  const stack = stacks[pos]!;
  const unit = stack.slice(height);
  if (height === 0) delete stacks[pos];
  else stacks[pos] = stack.slice(0, height);
  return { unit, from: pos };
}

/** 逆时针越过第 1 格时：crazyCrossEndsGame 关闭则绕回第 16 格继续。 */
function wrapIfAllowed(state: GameState, pos: number): number {
  return pos < 1 && !state.config.crazyCrossEndsGame ? pos + TRACK_LENGTH : pos;
}

/**
 * 被骰子选中的骆驼带着它上方所有骆驼前进（dir=1）或后退（dir=-1）steps 格，
 * 停在观众板上时处理一次观众板。返回是否有骆驼越过终点线。
 */
export function moveCamel(state: GameState, camel: CamelId, steps: number, dir: 1 | -1, events: GameEvent[]): boolean {
  const { unit, from } = takeUnit(state.stacks, camel);
  const to = wrapIfAllowed(state, from + dir * steps);
  placeUnit(state.stacks, to, unit, false);
  events.push({ type: "UnitMoved", camels: unit, from, to, dir, cause: "die", under: false });
  if (isOffTrack(to)) {
    // 越线的单位不再触发观众板
    events.push({ type: "CrossedFinish", camels: unit, pos: to });
    return true;
  }

  // 每次移动最多触发一次观众板；放置限制保证不会连锁，这里也只处理一次。
  const spectator = state.spectators.find((candidate) => candidate.pos === to);
  if (!spectator) return false;
  const owner = state.players.find((player) => player.id === spectator.owner);
  if (owner) owner.coins += 1;
  events.push({ type: "SpectatorTriggered", owner: spectator.owner, pos: to, side: spectator.side });

  // 欢呼：沿本次行进方向再走 1 格，叠在最上面；嘘：反方向退 1 格，放到原有骆驼的最下面。
  const stack = state.stacks[to]!;
  state.stacks[to] = stack.slice(0, stack.length - unit.length);
  if (state.stacks[to]!.length === 0) delete state.stacks[to];
  const under = spectator.side === "boo";
  const next = wrapIfAllowed(state, to + (under ? -dir : dir));
  placeUnit(state.stacks, next, unit, under);
  events.push({ type: "UnitMoved", camels: unit, from: to, to: next, dir: (under ? -dir : dir) as 1 | -1, cause: "spectator", under });
  if (isOffTrack(next)) {
    events.push({ type: "CrossedFinish", camels: unit, pos: next });
    return true;
  }
  return false;
}

/** 观众板放到 pos 是否合法；不合法时返回原因。判定时把自己的旧板视为已拿起。 */
export function spectatorError(state: GameState, playerId: string, pos: number): string | null {
  if (!Number.isInteger(pos) || pos < 1 || pos > TRACK_LENGTH) return "观众板只能放在赛道的 1–16 格。";
  if (pos === 1) return "第 1 格不能放观众板。";
  if ((state.stacks[pos]?.length ?? 0) > 0) return "有骆驼的格子不能放观众板。";
  const blocked = state.spectators.some((spectator) => spectator.owner !== playerId && Math.abs(spectator.pos - pos) <= 1);
  if (blocked) return "这一格或相邻格已经有别人的观众板。";
  return null;
}

/** 当前可以放观众板的格子。 */
export function legalSpectatorCells(state: GameState, playerId: string): number[] {
  return Array.from({ length: TRACK_LENGTH }, (_, index) => index + 1)
    .filter((pos) => spectatorError(state, playerId, pos) === null);
}

function clampCoins(state: GameState, coins: number): number {
  return state.config.allowNegativeCoins ? coins : Math.max(0, coins);
}

/** 下注票的结算值：第 1 名 +票面，第 2 名 +1，第 3–5 名 −1。 */
function betDelta(ranking: RacerId[], camel: RacerId, value: number): number {
  if (camel === ranking[0]) return value;
  if (camel === ranking[1]) return 1;
  return -1;
}

/** 赛段结算：下注票按名次、金字塔票每张 +1、合伙收益；金币不够付时付到 0 为止（默认配置）。 */
function scoreLeg(state: GameState): LegResult {
  const ranking = rankRacers(state.stacks);
  const bestBet = (player: Player | undefined) =>
    Math.max(0, ...(player?.legBets ?? []).map((bet) => betDelta(ranking, bet.camel, bet.value)));
  const payouts: LegPayout[] = state.players.map((player) => {
    const bets = player.legBets.map((bet) => ({ ...bet, delta: betDelta(ranking, bet.camel, bet.value) }));
    const partnerId = state.config.enablePartnership ? state.partners[player.id] : undefined;
    const partner = partnerId ? bestBet(state.players.find((candidate) => candidate.id === partnerId)) : 0;
    const net = bets.reduce((sum, bet) => sum + bet.delta, 0) + player.pyramidTickets + partner;
    const before = player.coins;
    const after = clampCoins(state, before + net);
    return { player: player.id, bets, pyramid: player.pyramidTickets, partner, ...(partnerId ? { partnerId } : {}), net, before, after };
  });
  for (const payout of payouts) {
    state.players.find((player) => player.id === payout.player)!.coins = payout.after;
  }
  const result: LegResult = { leg: state.leg, ranking, payouts };
  state.legResults.push(result);
  return result;
}

/** 赛段重置：下注票、金字塔票、骰子、观众板、合伙全部归位；骆驼位置和终局牌堆不动。 */
function resetLeg(state: GameState): void {
  state.leg += 1;
  state.legTickets = Object.fromEntries(RACERS.map((camel) => [camel, [...state.config.legTicketValues]])) as Record<RacerId, number[]>;
  state.diceInPyramid = allDice(state.config);
  state.rolledThisLeg = [];
  state.spectators = [];
  state.partners = {};
  for (const player of state.players) {
    player.legBets = [];
    player.pyramidTickets = 0;
  }
}

/** 从最早放下的卡开始逐张翻开：猜对的按先后拿 8、5、3、2、1，之后每人 +1；猜错的 −1，不占名次。 */
function revealPile(state: GameState, pile: OverallCard[], answer: RacerId): OverallReveal[] {
  let correctCount = 0;
  return pile.map((card) => {
    const camel = card.camel!;
    const correct = camel === answer;
    const delta = correct
      ? state.config.overallPayouts[correctCount++] ?? 1
      : -state.config.overallWrongPenalty;
    return { owner: card.owner, camel, correct, delta };
  });
}

/**
 * 每个牌堆作为一次结算：先汇总每人在这个牌堆的净额，再一次性加减（不够付时付到 0）。
 * 和赛段结算的「金币 = max(0, 原金币 + 本次净额)」一致。
 */
function payReveals(state: GameState, reveals: OverallReveal[]): void {
  for (const player of state.players) {
    const net = reveals.filter((reveal) => reveal.owner === player.id).reduce((sum, reveal) => sum + reveal.delta, 0);
    if (net !== 0) player.coins = clampCoins(state, player.coins + net);
  }
}

/** 有骆驼越线：结算当前赛段（不重置），再结算冠军和垫底牌堆。金币最多者获胜，并列都算赢。 */
function finishGame(state: GameState, events: GameEvent[]): void {
  events.push({ type: "LegScored", result: scoreLeg(state) });
  const ranking = rankRacers(state.stacks);
  const winnerPile = revealPile(state, state.winnerPile, ranking[0]!);
  payReveals(state, winnerPile);
  const loserPile = revealPile(state, state.loserPile, ranking[ranking.length - 1]!);
  payReveals(state, loserPile);
  const best = Math.max(...state.players.map((player) => player.coins));
  const result: FinalResult = {
    ranking,
    winnerPile,
    loserPile,
    winners: state.players.filter((player) => player.coins === best).map((player) => player.id),
  };
  state.finalResult = result;
  state.phase = "finished";
  events.push({ type: "GameEnded", result });
}

function allDice(config: Config): DieId[] {
  return config.enableCrazyCamels ? [...RACERS, "gray"] : [...RACERS];
}

function advanceTurn(state: GameState): void {
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
}

/**
 * 掷出某颗骰子的某个结果后的全部处理：移动（含观众板）→ 越线则终局 →
 * 否则若是本赛段第 5 颗骰子则结算并重置。测试里直接调用它来指定骰面。
 */
export function resolveRoll(state: GameState, playerId: string, die: DieId, value: number, faceColor: CrazyId | undefined, events: GameEvent[]): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  player.pyramidTickets += 1;
  state.diceInPyramid = state.diceInPyramid.filter((candidate) => candidate !== die);

  const moved: CamelId = die === "gray" ? chooseCrazy(state.stacks, faceColor!) : die;
  state.rolledThisLeg.push({ die, value, ...(faceColor ? { color: faceColor } : {}), moved });
  events.push({ type: "DieRolled", player: playerId, die, value, ...(faceColor ? { color: faceColor } : {}), moved });

  const crossed = moveCamel(state, moved, value, die === "gray" ? -1 : 1, events);
  if (crossed) {
    finishGame(state, events);
    return;
  }
  if (state.rolledThisLeg.length >= DICE_PER_LEG) {
    events.push({ type: "LegScored", result: scoreLeg(state) });
    resetLeg(state);
  }
  advanceTurn(state);
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/**
 * 开局：每人 3 金币、5 张终局卡；赛跑骆驼按随机顺序各掷一次落在 1–3 格（后放的叠在上面）；
 * 灰骰两次放疯狂骆驼（1→16、2→15、3→14，第二次忽略颜色）；随机起始玩家。
 */
export function createGame(players: readonly NewPlayer[], seed = Math.floor(Math.random() * 2 ** 32), overrides: Partial<Config> = {}): GameState {
  const config = defaultConfig(players.length, overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  const rng = createRng(seed);
  const stacks: Record<number, CamelId[]> = {};
  for (const camel of rng.shuffle(RACERS)) {
    placeUnit(stacks, 1 + rng.int(3), [camel], false);
  }
  if (config.enableCrazyCamels) {
    const first = rng.pick(GRAY_FACES);
    placeUnit(stacks, TRACK_LENGTH + 1 - first.value, [first.color], false);
    const second = rng.pick(GRAY_FACES);
    const other: CrazyId = first.color === "black" ? "white" : "black";
    placeUnit(stacks, TRACK_LENGTH + 1 - second.value, [other], false);
  }
  const state: GameState = {
    config,
    phase: "playing",
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      coins: config.startingCoins,
      legBets: [],
      pyramidTickets: 0,
      finishCards: [...RACERS],
    })),
    currentPlayer: rng.int(players.length),
    leg: 1,
    turn: 1,
    stacks,
    diceInPyramid: allDice(config),
    rolledThisLeg: [],
    legTickets: Object.fromEntries(RACERS.map((camel) => [camel, [...config.legTicketValues]])) as Record<RacerId, number[]>,
    spectators: [],
    winnerPile: [],
    loserPile: [],
    partners: {},
    legResults: [],
    events: [],
    version: 0,
    seed,
    log: [],
  };
  state.rngState = rng.state;
  return state;
}

function currentPlayerId(state: GameState): string {
  return state.players[state.currentPlayer]!.id;
}

/** 规则引擎主入口：校验并执行一个行动，返回新状态和事件。不修改传入的 state。 */
export function apply(state: GameState, playerId: string, command: GameCommand, rng: Rng): { state: GameState; events: GameEvent[] } {
  if (state.phase !== "playing") throw new Error("对局已经结束。");
  if (currentPlayerId(state) !== playerId) throw new Error("还没轮到你。");
  const next = structuredClone(state);
  const player = next.players.find((candidate) => candidate.id === playerId)!;
  const events: GameEvent[] = [];

  switch (command?.type) {
    case "TAKE_LEG_BET": {
      if (!(RACERS as readonly string[]).includes(command.camel)) throw new Error("没有这种颜色的骆驼。");
      const value = next.legTickets[command.camel].shift();
      if (value === undefined) throw new Error("这种颜色的下注票已经拿完了。");
      player.legBets.push({ camel: command.camel, value });
      events.push({ type: "LegBetTaken", player: playerId, camel: command.camel, value });
      advanceTurn(next);
      break;
    }
    case "PLACE_SPECTATOR": {
      if (command.side !== "cheer" && command.side !== "boo") throw new Error("请选择欢呼面或嘘面。");
      const error = spectatorError(next, playerId, command.pos);
      if (error) throw new Error(error);
      const previous = next.spectators.find((spectator) => spectator.owner === playerId);
      if (previous && previous.pos === command.pos && previous.side === command.side) {
        throw new Error("观众板已经在这里了，换一格或换一面。");
      }
      next.spectators = [
        ...next.spectators.filter((spectator) => spectator.owner !== playerId),
        { owner: playerId, pos: command.pos, side: command.side },
      ];
      events.push({ type: "SpectatorPlaced", player: playerId, pos: command.pos, side: command.side, ...(previous ? { from: previous.pos } : {}) });
      advanceTurn(next);
      break;
    }
    case "ROLL": {
      const die = rng.pick(next.diceInPyramid);
      if (die === "gray") {
        const face = rng.pick(GRAY_FACES);
        resolveRoll(next, playerId, die, face.value, face.color, events);
      } else {
        resolveRoll(next, playerId, die, 1 + rng.int(3), undefined, events);
      }
      break;
    }
    case "BET_OVERALL": {
      if (command.pile !== "winner" && command.pile !== "loser") throw new Error("请选择冠军或垫底牌堆。");
      const index = player.finishCards.indexOf(command.camel);
      if (index < 0) throw new Error("你手里没有这种颜色的终局卡了。");
      player.finishCards.splice(index, 1);
      const card: OverallCard = { owner: playerId, camel: command.camel };
      if (command.pile === "winner") next.winnerPile.push(card);
      else next.loserPile.push(card);
      events.push({ type: "OverallBetPlaced", player: playerId, pile: command.pile, camel: command.camel });
      advanceTurn(next);
      break;
    }
    case "PARTNER": {
      if (!next.config.enablePartnership) throw new Error("6 人及以上才有合伙行动。");
      if (command.target === playerId) throw new Error("不能和自己合伙。");
      if (!next.players.some((candidate) => candidate.id === command.target)) throw new Error("找不到这位玩家。");
      if (next.partners[playerId]) throw new Error("你本赛段已经有伙伴了。");
      if (next.partners[command.target]) throw new Error("对方本赛段已经有伙伴了。");
      next.partners[playerId] = command.target;
      next.partners[command.target] = playerId;
      events.push({ type: "Partnered", player: playerId, target: command.target });
      advanceTurn(next);
      break;
    }
    default:
      throw new Error("未知的行动。");
  }

  next.turn += 1;
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/** 服务端用：用对局里保存的随机数状态执行行动，并记进动作序列。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const { state: next } = apply(state, playerId, command, rng);
  next.rngState = rng.state;
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return next;
}

/** 回合超时（含断线玩家）：自动替当前玩家掷骰，掷骰在赛段内永远合法。 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase !== "playing") return state;
  const playerId = currentPlayerId(state);
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const { state: next } = apply(state, playerId, { type: "ROLL" }, rng);
  next.events = [{ type: "TurnTimedOut", player: playerId }, ...next.events];
  next.rngState = rng.state;
  next.log = [...(state.log ?? []), { player: playerId, command: { type: "TIMEOUT" } }];
  return next;
}

/**
 * 按某位玩家的视角发送：删掉种子、随机数状态和动作序列（否则能算出后面的骰子），
 * 别人手中的终局卡和牌堆里别人下的颜色在终局前隐藏。自己下的那几张自己看得到。
 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const hidden = state.phase !== "finished";
  const hideCard = (card: OverallCard): OverallCard =>
    hidden && card.owner !== viewerId ? { owner: card.owner, camel: null } : card;
  const { seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  return {
    ...rest,
    players: state.players.map((player) => ({
      ...player,
      finishCards: player.id === viewerId || !hidden ? [...player.finishCards] : player.finishCards.map(() => null),
    })),
    winnerPile: state.winnerPile.map(hideCard),
    loserPile: state.loserPile.map(hideCard),
    events: state.events.map((event) =>
      event.type === "OverallBetPlaced" && hidden && event.player !== viewerId ? { ...event, camel: null } : event,
    ),
  };
}
