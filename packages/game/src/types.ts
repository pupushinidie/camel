/** 5 只赛跑骆驼，参与排名、可以下注。 */
export const RACERS = ["red", "yellow", "blue", "green", "purple"] as const;
export type RacerId = (typeof RACERS)[number];

/** 2 只疯狂骆驼，永远逆时针跑，不参与排名、不能下注。 */
export const CRAZIES = ["black", "white"] as const;
export type CrazyId = (typeof CRAZIES)[number];

export type CamelId = RacerId | CrazyId;

/** 每只赛跑骆驼一颗骰子，外加一颗灰骰（决定疯狂骆驼）。 */
export type DieId = RacerId | "gray";

/** 赛道 16 格，编号 1–16，终点线在 16 和 1 之间。 */
export const TRACK_LENGTH = 16;

export type SpectatorSide = "cheer" | "boo";
export type OverallPile = "winner" | "loser";

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly startingCoins: number;
  /** false 时是第一版玩法：没有疯狂骆驼和灰骰，5 颗骰子全部掷完才结束赛段。 */
  readonly enableCrazyCamels: boolean;
  /** 每色赛段下注票从上到下的票面。 */
  readonly legTicketValues: readonly number[];
  /** 终局猜对的奖励，按猜对的先后；超出列表的每人 +1。 */
  readonly overallPayouts: readonly number[];
  readonly overallWrongPenalty: number;
  readonly enablePartnership: boolean;
  /** 不够付时是否允许负数；false 时付到 0 为止。 */
  readonly allowNegativeCoins: boolean;
  /** 逆时针越过第 1 格是否结束游戏；false 时绕回第 16 格继续。 */
  readonly crazyCrossEndsGame: boolean;
  readonly coinsVisible: boolean;
  /** 回合计时；超时自动掷骰。 */
  readonly turnTimeoutSec: number;
}

export interface LegBet {
  readonly camel: RacerId;
  readonly value: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  coins: number;
  legBets: LegBet[];
  pyramidTickets: number;
  /** 手中剩余的终局卡。别人看到的是 null（只知道张数）。 */
  finishCards: (RacerId | null)[];
}

export interface Spectator {
  readonly owner: string;
  readonly pos: number;
  readonly side: SpectatorSide;
}

export interface OverallCard {
  readonly owner: string;
  /** 终局前只有放置者本人看得到颜色，别人看到 null。 */
  readonly camel: RacerId | null;
}

export interface RolledDie {
  readonly die: DieId;
  readonly value: number;
  /** 灰骰的骰面颜色。 */
  readonly color?: CrazyId;
  /** 实际被移动的骆驼（灰骰可能因特例移动另一只）。 */
  readonly moved: CamelId;
}

/** 一位玩家在一次赛段结算里的明细。 */
export interface LegPayout {
  readonly player: string;
  /** 每张下注票的结算值（第 1 名 +票面，第 2 名 +1，其余 −1）。 */
  readonly bets: (LegBet & { readonly delta: number })[];
  readonly pyramid: number;
  /** 合伙收益：伙伴最好的一张票（不为负）。 */
  readonly partner: number;
  readonly partnerId?: string;
  /** 本次净额。 */
  readonly net: number;
  readonly before: number;
  readonly after: number;
}

export interface LegResult {
  readonly leg: number;
  /** 结算时的名次，第 1 名在前。 */
  readonly ranking: RacerId[];
  readonly payouts: LegPayout[];
}

/** 终局下注牌堆里一张牌的翻开结果。 */
export interface OverallReveal {
  readonly owner: string;
  readonly camel: RacerId;
  readonly correct: boolean;
  readonly delta: number;
}

export interface FinalResult {
  readonly ranking: RacerId[];
  readonly winnerPile: OverallReveal[];
  readonly loserPile: OverallReveal[];
  readonly winners: string[];
}

export type GameCommand =
  | { readonly type: "TAKE_LEG_BET"; readonly camel: RacerId }
  | { readonly type: "PLACE_SPECTATOR"; readonly pos: number; readonly side: SpectatorSide }
  | { readonly type: "ROLL" }
  | { readonly type: "BET_OVERALL"; readonly camel: RacerId; readonly pile: OverallPile }
  | { readonly type: "PARTNER"; readonly target: string };

/** 每个动作产生的事件，前端按顺序逐条播放动画。 */
export type GameEvent =
  | { readonly type: "LegBetTaken"; readonly player: string; readonly camel: RacerId; readonly value: number }
  | { readonly type: "SpectatorPlaced"; readonly player: string; readonly pos: number; readonly side: SpectatorSide; readonly from?: number }
  | { readonly type: "OverallBetPlaced"; readonly player: string; readonly pile: OverallPile; readonly camel: RacerId | null }
  | { readonly type: "Partnered"; readonly player: string; readonly target: string }
  | { readonly type: "TurnTimedOut"; readonly player: string }
  | { readonly type: "DieRolled"; readonly player: string; readonly die: DieId; readonly value: number; readonly color?: CrazyId; readonly moved: CamelId }
  /**
   * 一个单位（被选中的骆驼和它上面的所有骆驼）从 from 走到 to。
   * cause 为 spectator 时是观众板的追加移动；under 为 true 表示放到落点原有骆驼的最下面。
   */
  | { readonly type: "UnitMoved"; readonly camels: CamelId[]; readonly from: number; readonly to: number; readonly dir: 1 | -1; readonly cause: "die" | "spectator"; readonly under: boolean }
  | { readonly type: "SpectatorTriggered"; readonly owner: string; readonly pos: number; readonly side: SpectatorSide }
  | { readonly type: "CrossedFinish"; readonly camels: CamelId[]; readonly pos: number }
  | { readonly type: "LegScored"; readonly result: LegResult }
  | { readonly type: "GameEnded"; readonly result: FinalResult };

export interface GameState {
  readonly config: Config;
  phase: "playing" | "finished";
  /** 座位顺序。 */
  players: Player[];
  /** 当前玩家在 players 里的下标。 */
  currentPlayer: number;
  /** 第几个赛段，从 1 开始。 */
  leg: number;
  /** 第几个回合（每个行动 +1），用作回合计时的键。 */
  turn: number;
  /** 位置 → 从下到上的骆驼；位置不取模，越线后是 17、18… 或 0、−1…。 */
  stacks: Record<number, CamelId[]>;
  /** 本赛段还没掷的骰子。 */
  diceInPyramid: DieId[];
  rolledThisLeg: RolledDie[];
  /** 各色剩余的赛段下注票，最上面一张在前。 */
  legTickets: Record<RacerId, number[]>;
  spectators: Spectator[];
  /** 按放置先后。 */
  winnerPile: OverallCard[];
  loserPile: OverallCard[];
  /** 本赛段的伙伴，双向记录。 */
  partners: Record<string, string>;
  /** 已结算赛段的记录。 */
  legResults: LegResult[];
  finalResult?: FinalResult;
  /** 最近一个动作产生的事件，和 version 一起给前端播放动画。 */
  events: GameEvent[];
  /** 每个动作 +1；前端据此判断是不是新事件。 */
  version: number;
  /** 以下只在服务端：随机数种子、当前随机数状态、动作序列（用于复盘）。发给客户端前删掉。 */
  seed?: number;
  rngState?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
}
