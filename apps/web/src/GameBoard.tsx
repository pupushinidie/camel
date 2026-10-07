import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  RACERS,
  legalSpectatorCells,
  rankRacers,
  type CamelId,
  type DieId,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LegResult,
  type LobbyRoomSnapshot,
  type OverallPile,
  type Player,
  type RacerId,
  type SpectatorSide,
} from "@camel/game";
import { iconArt, ticketArt } from "./art.js";
import GameRules from "./GameRules.js";
import Track3D, { DIE_NAMES } from "./Track3D.js";
import { socket } from "./socket.js";
import { usePlayback } from "./usePlayback.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onDissolve: () => void;
}

export const CAMEL_LABEL: Record<CamelId, string> = {
  red: "红", yellow: "黄", blue: "蓝", green: "绿", purple: "紫", black: "黑", white: "白",
};

/** 界面小图（金币、票、卡背……）的地址，作为 CSS 变量传给样式表：部署在子路径下也不会找不到图。 */
const ART_VARS = {
  "--img-coin": `url(${iconArt.coin})`,
  "--img-pyramid": `url(${iconArt.pyramidTicket})`,
  "--img-card-back": `url(${iconArt.cardBack})`,
  "--img-partner": `url(${iconArt.partner})`,
  ...Object.fromEntries(RACERS.map((camel) => [`--img-ticket-${camel}`, `url(${ticketArt(camel)})`])),
} as CSSProperties;

/** 玩家的标识色（观众板名牌、牌堆里的卡），避开骆驼的五种颜色。 */
const SEAT_COLORS = ["#e8833a", "#3fb6c9", "#d65db1", "#9ccf4a", "#c9a227", "#8f7ad8", "#e05c5c", "#5b8def"];

type Mode =
  | { kind: "none" }
  | { kind: "spectator"; side: SpectatorSide; pos?: number }
  | { kind: "legBet"; camel: RacerId }
  | { kind: "overall"; camel?: RacerId; pile?: OverallPile }
  | { kind: "partner"; target?: string };

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : "±0";
}

/** 把一条事件写成动作记录里的一句话；返回 null 的不记。 */
function describeEvent(event: GameEvent, name: (id: string) => string, myId: string): string | null {
  switch (event.type) {
    case "LegBetTaken":
      return `${name(event.player)} 拿了${CAMEL_LABEL[event.camel]}色 ${event.value} 金下注票`;
    case "SpectatorPlaced":
      return `${name(event.player)} 把观众板${event.from ? `从第 ${event.from} 格移到` : "放在"}第 ${event.pos} 格（${event.side === "cheer" ? "欢呼 +1" : "嘘 −1"}）`;
    case "OverallBetPlaced":
      return event.player === myId && event.camel
        ? `你把${CAMEL_LABEL[event.camel]}色终局卡押在${event.pile === "winner" ? "冠军" : "垫底"}`
        : `${name(event.player)} 押了一张终局卡在${event.pile === "winner" ? "冠军" : "垫底"}牌堆`;
    case "Partnered":
      return `${name(event.player)} 和 ${name(event.target)} 结成伙伴`;
    case "TurnTimedOut":
      return `${name(event.player)} 超时，自动掷骰`;
    case "DieRolled": {
      if (event.die !== "gray") return `${name(event.player)} 掷出${DIE_NAMES[event.die]}骰 ${event.value}`;
      const face = `灰骰 ${CAMEL_LABEL[event.color!]} ${event.value}`;
      return event.moved === event.color
        ? `${name(event.player)} 掷出${face}，${CAMEL_LABEL[event.moved]}骆驼后退 ${event.value} 格`
        : `${name(event.player)} 掷出${face}，按特例改为${CAMEL_LABEL[event.moved]}骆驼后退 ${event.value} 格`;
    }
    case "SpectatorTriggered":
      return `骆驼踩到 ${name(event.owner)} 的观众板（${event.side === "cheer" ? "欢呼，再进 1 格" : "嘘，退 1 格"}），${name(event.owner)} +1 金`;
    case "CrossedFinish":
      return `${event.camels.map((camel) => CAMEL_LABEL[camel]).join("、")}骆驼越过终点线！`;
    case "LegScored":
      return `第 ${event.result.leg} 赛段结算：${CAMEL_LABEL[event.result.ranking[0]!]}骆驼领先`;
    case "GameEnded":
      return "比赛结束";
    default:
      return null;
  }
}

function GameBoard({ room, busy, error, notice, brand, connection, chat, onCommand, onRematch, onDissolve }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const myId = member?.playerId ?? "";
  const isHost = member?.isHost ?? false;
  const me = game.players.find((player) => player.id === myId);
  const current = game.players[game.currentPlayer];
  const myTurn = game.phase === "playing" && current?.id === myId;
  const secondsLeft = useCountdown(room);
  const playback = usePlayback(game);
  const animating = playback.settledVersion !== game.version;

  const seatColor = (playerId: string) => SEAT_COLORS[Math.max(0, game.players.findIndex((player) => player.id === playerId)) % SEAT_COLORS.length]!;
  const nameOf = (playerId: string) => (playerId === myId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const connected = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId)?.connected ?? false;

  const [mode, setMode] = useState<Mode>({ kind: "none" });
  // 换人或状态更新后，未确认的选择作废
  useEffect(() => setMode({ kind: "none" }), [game.version]);

  // 动作记录：只在本页面累计，重连后从头记
  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const loggedVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === loggedVersion.current) return;
    loggedVersion.current = game.version;
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, nameOf, myId) }))
      .filter((line): line is { key: string; text: string } => line.text !== null);
    setLog((previous) => [...lines.reverse(), ...previous].slice(0, 40));
  }, [game.version]);

  // 赛段结算弹窗：动画播完后弹出最新一次结算
  const [legShown, setLegShown] = useState(game.legResults.length);
  const latestLeg = game.legResults.at(-1);
  const legPopup = !animating && game.phase === "playing" && latestLeg && legShown < game.legResults.length ? latestLeg : undefined;

  const spectatorCells = useMemo(
    () => (myTurn && mode.kind === "spectator" ? new Set(legalSpectatorCells(game, myId)) : undefined),
    [myTurn, mode.kind, game, myId],
  );

  function send(command: GameCommand) {
    setMode({ kind: "none" });
    onCommand(command);
  }

  const canAct = myTurn && !busy;
  const pyramidLeft = game.diceInPyramid.length - (game.config.enableCrazyCamels ? 1 : 0);
  const myPartner = game.partners[myId];

  let prompt = "";
  if (game.phase === "finished") prompt = "比赛结束";
  else if (!myTurn) prompt = `等待 ${current?.name ?? ""} 行动`;
  else if (mode.kind === "spectator") prompt = mode.pos ? `把观众板（${mode.side === "cheer" ? "欢呼 +1" : "嘘 −1"}）放在第 ${mode.pos} 格？` : "点亮的格子可以放观众板";
  else if (mode.kind === "legBet") prompt = `拿${CAMEL_LABEL[mode.camel]}色 ${game.legTickets[mode.camel][0]} 金下注票？`;
  else if (mode.kind === "overall") prompt = mode.camel && mode.pile ? `把${CAMEL_LABEL[mode.camel]}色终局卡押在${mode.pile === "winner" ? "冠军" : "垫底"}？放下后不能收回` : "选一张终局卡和牌堆";
  else if (mode.kind === "partner") prompt = mode.target ? `和 ${nameOf(mode.target)} 结成本赛段伙伴？` : "选一位还没结伴的玩家";
  else prompt = "轮到你了：点金字塔掷骰，或选择其他行动";

  const ready =
    (mode.kind === "spectator" && mode.pos !== undefined) ||
    mode.kind === "legBet" ||
    (mode.kind === "overall" && mode.camel !== undefined && mode.pile !== undefined) ||
    (mode.kind === "partner" && mode.target !== undefined);

  function confirm() {
    if (mode.kind === "spectator" && mode.pos !== undefined) send({ type: "PLACE_SPECTATOR", pos: mode.pos, side: mode.side });
    else if (mode.kind === "legBet") send({ type: "TAKE_LEG_BET", camel: mode.camel });
    else if (mode.kind === "overall" && mode.camel && mode.pile) send({ type: "BET_OVERALL", camel: mode.camel, pile: mode.pile });
    else if (mode.kind === "partner" && mode.target) send({ type: "PARTNER", target: mode.target });
  }

  const myCards = (me?.finishCards ?? []).filter((camel): camel is RacerId => camel !== null);

  return (
    <div className="ct-screen" style={ART_VARS}>
      <header className="ct-topbar">
        {brand}
        <div className="ct-turn">
          <span>第 {game.leg} 赛段</span>
          {game.phase === "playing" && current && (
            <span className={myTurn ? "ct-turn-who mine" : "ct-turn-who"}>
              <i style={{ background: seatColor(current.id) }} />
              {myTurn ? "轮到你" : `轮到 ${current.name}`}
              {secondsLeft !== null && <b className={secondsLeft <= 10 ? "ct-timer low" : "ct-timer"}>{secondsLeft}s</b>}
            </span>
          )}
        </div>
        <div className="ct-topbar-right">
          <GameRules />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>

      <section className="ct-board-area">
        <Track3D
          stacks={playback.stacks}
          spectators={playback.spectators}
          walking={playback.walking}
          {...(playback.cheeringAt !== undefined ? { cheeringAt: playback.cheeringAt } : {})}
          {...(playback.dieFx ? { dieFx: playback.dieFx } : {})}
          {...(playback.dust ? { dust: playback.dust } : {})}
          {...(spectatorCells ? { selectableCells: spectatorCells } : {})}
          onCellClick={(pos) => mode.kind === "spectator" && setMode({ ...mode, pos })}
          pyramidActive={canAct && mode.kind === "none"}
          onPyramidClick={() => send({ type: "ROLL" })}
          ownerName={nameOf}
          ownerColor={seatColor}
          myId={myId}
          overlay={<RankingStrip stacks={playback.stacks} />}
        />
      </section>

      <section className={myTurn ? "ct-actions mine" : "ct-actions"} aria-live="polite">
        <div className="ct-prompt">
          <span>{prompt}</span>
          {myTurn && mode.kind !== "none" && (
            <span className="ct-prompt-buttons">
              <button className="quiet-button" type="button" onClick={() => setMode({ kind: "none" })}>取消</button>
              <button className="primary-button" type="button" disabled={!ready || busy} onClick={confirm}>确定</button>
            </span>
          )}
        </div>
        {(error || notice) && <p className={error ? "ct-feedback error" : "ct-feedback"} role={error ? "alert" : "status"}>{error || notice}</p>}

        <div className="ct-action-grid">
          <div className="ct-action">
            <h3><i className="ct-icon-pyramid" />掷骰 <small>金字塔里还有 {pyramidLeft} 张票</small></h3>
            <button className="primary-button ct-roll" type="button" disabled={!canAct} onClick={() => send({ type: "ROLL" })}>
              拿金字塔票并掷骰 <span>+1 金</span>
            </button>
            <DiceTray game={game} />
          </div>

          <div className="ct-action">
            <h3>赛段下注 <small>押中第 1 名得票面，第 2 名 +1，其余 −1</small></h3>
            <div className="ct-leg-tickets">
              {RACERS.map((camel) => {
                const left = game.legTickets[camel];
                const selected = mode.kind === "legBet" && mode.camel === camel;
                return (
                  <button
                    key={camel}
                    type="button"
                    className={["ct-ticket-pile", `camel-${camel}`, selected ? "selected" : "", `left-${Math.min(left.length, 4)}`].join(" ")}
                    disabled={!canAct || left.length === 0}
                    onClick={() => setMode({ kind: "legBet", camel })}
                    title={left.length ? `剩 ${left.join("、")}` : "已拿完"}
                    aria-label={`${CAMEL_LABEL[camel]}色下注票${left.length ? `，最上面一张 ${left[0]} 金，剩 ${left.length} 张` : "，已拿完"}`}
                  >
                    <strong>{left[0] ?? "—"}</strong>
                    <span>{left.length ? `剩${left.length}` : "拿完"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ct-action">
            <h3>观众板 <small>骆驼停上来时你 +1 金</small></h3>
            <div className="ct-segmented">
              {(["cheer", "boo"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={mode.kind === "spectator" && mode.side === side ? "selected" : ""}
                  disabled={!canAct}
                  onClick={() => setMode({ kind: "spectator", side })}
                >
                  {side === "cheer" ? "欢呼：再进 1 格" : "嘘：退 1 格"}
                </button>
              ))}
            </div>
          </div>

          <div className="ct-action">
            <h3>终局下注 <small>猜最终冠军 / 垫底，越早押越值钱</small></h3>
            <div className="ct-finish-cards">
              {RACERS.map((camel) => {
                const has = myCards.includes(camel);
                const selected = mode.kind === "overall" && mode.camel === camel;
                return (
                  <button
                    key={camel}
                    type="button"
                    className={["ct-finish-card", `camel-${camel}`, selected ? "selected" : "", has ? "" : "used"].join(" ")}
                    disabled={!canAct || !has}
                    onClick={() => setMode({ kind: "overall", camel, ...(mode.kind === "overall" && mode.pile ? { pile: mode.pile } : {}) })}
                    aria-label={`${CAMEL_LABEL[camel]}色终局卡${has ? "" : "（已押出）"}`}
                  />
                );
              })}
            </div>
            <div className="ct-segmented">
              {(["winner", "loser"] as const).map((pile) => (
                <button
                  key={pile}
                  type="button"
                  className={mode.kind === "overall" && mode.pile === pile ? "selected" : ""}
                  disabled={!canAct || myCards.length === 0}
                  onClick={() => setMode({ kind: "overall", pile, ...(mode.kind === "overall" && mode.camel ? { camel: mode.camel } : {}) })}
                >
                  {pile === "winner" ? "押冠军" : "押垫底"}
                </button>
              ))}
            </div>
          </div>

          {game.config.enablePartnership && (
            <div className="ct-action">
              <h3><i className="ct-icon-partner" />合伙 <small>{myPartner ? `本赛段伙伴：${nameOf(myPartner)}` : "结算时额外拿伙伴最好的一张票"}</small></h3>
              <div className="ct-partner-list">
                {game.players.filter((player) => player.id !== myId).map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className={mode.kind === "partner" && mode.target === player.id ? "selected" : ""}
                    disabled={!canAct || Boolean(myPartner) || Boolean(game.partners[player.id])}
                    onClick={() => setMode({ kind: "partner", target: player.id })}
                  >
                    {player.name}{game.partners[player.id] ? "（已结伴）" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="ct-side">
        <Players game={game} myId={myId} seatColor={seatColor} connected={connected} />
        <OverallPiles game={game} myId={myId} nameOf={nameOf} seatColor={seatColor} />
        <section className="ct-panel ct-log">
          <h3>动作记录</h3>
          {log.length === 0 ? <p className="ct-muted">还没有动作。</p> : (
            <ul>{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>
          )}
        </section>
        <div className="ct-chat">{chat}</div>
      </aside>

      {legPopup && <LegResultDialog result={legPopup} nameOf={nameOf} onClose={() => setLegShown(game.legResults.length)} />}
      {game.phase === "finished" && !animating && <FinalDialog game={game} room={room} myId={myId} nameOf={nameOf} onRematch={onRematch} />}
    </div>
  );
}

// ---------- 赛道上方的名次条 ----------

function RankingStrip({ stacks }: { stacks: Record<number, CamelId[]> }) {
  const ranking = rankRacers(stacks);
  return (
    <div className="ct-ranking" aria-label="当前名次">
      {ranking.map((camel, index) => (
        <span key={camel} className={`ct-rank camel-${camel}`}>
          <b>{index + 1}</b>{CAMEL_LABEL[camel]}
        </span>
      ))}
    </div>
  );
}

// ---------- 本赛段骰子 ----------

function DiceTray({ game }: { game: GameState }) {
  const slots = 5;
  return (
    <div className="ct-dice-tray" aria-label="本赛段已掷的骰子">
      {Array.from({ length: slots }, (_, index) => {
        const rolled = game.rolledThisLeg[index];
        if (!rolled) return <span key={index} className="ct-die empty" />;
        const color: DieId | "black" | "white" = rolled.color ?? rolled.die;
        return (
          <span key={index} className={`ct-die die-${color}`} title={`${DIE_NAMES[rolled.die]}骰 ${rolled.value}${rolled.die === "gray" ? `，移动${CAMEL_LABEL[rolled.moved]}骆驼` : ""}`}>
            {rolled.value}
          </span>
        );
      })}
    </div>
  );
}

// ---------- 玩家 ----------

function Players({ game, myId, seatColor, connected }: { game: GameState; myId: string; seatColor: (id: string) => string; connected: (id: string) => boolean }) {
  return (
    <section className="ct-panel ct-players">
      <h3>玩家</h3>
      {game.players.map((player, index) => (
        <PlayerRow key={player.id} game={game} player={player} me={player.id === myId} active={game.phase === "playing" && game.currentPlayer === index} color={seatColor(player.id)} online={connected(player.id)} />
      ))}
    </section>
  );
}

function PlayerRow({ game, player, me, active, color, online }: { game: GameState; player: Player; me: boolean; active: boolean; color: string; online: boolean }) {
  const spectator = game.spectators.find((candidate) => candidate.owner === player.id);
  const partner = game.partners[player.id];
  const inPiles = game.winnerPile.filter((card) => card.owner === player.id).length + game.loserPile.filter((card) => card.owner === player.id).length;
  const classes = ["ct-player"];
  if (active) classes.push("active");
  if (me) classes.push("me");
  if (!online) classes.push("offline");
  return (
    <div className={classes.join(" ")}>
      <div className="ct-player-head">
        <i className="ct-seat" style={{ background: color }} />
        <strong>{player.name}{me && <small>你</small>}{!online && <small>离线</small>}</strong>
        <span className="ct-coins" title="金币"><i className="ct-icon-coin" />{player.coins}</span>
      </div>
      <div className="ct-player-items">
        {player.legBets.map((bet, index) => (
          <span key={index} className={`ct-mini-ticket camel-${bet.camel}`} title={`${CAMEL_LABEL[bet.camel]}色 ${bet.value} 金下注票`}>{bet.value}</span>
        ))}
        {player.pyramidTickets > 0 && <span className="ct-pyramid-count" title="金字塔票"><i className="ct-icon-pyramid" />×{player.pyramidTickets}</span>}
        {spectator && <span className={`ct-spectator-chip ${spectator.side}`} title="观众板">第{spectator.pos}格{spectator.side === "cheer" ? "+1" : "−1"}</span>}
        {partner && <span className="ct-partner-chip" title="本赛段伙伴"><i className="ct-icon-partner" />{game.players.find((candidate) => candidate.id === partner)?.name}</span>}
        <span className="ct-cards-left" title="手中终局卡 / 已押出">终局卡 {player.finishCards.length} · 已押 {inPiles}</span>
      </div>
    </div>
  );
}

// ---------- 冠军 / 垫底牌堆 ----------

function OverallPiles({ game, myId, nameOf, seatColor }: { game: GameState; myId: string; nameOf: (id: string) => string; seatColor: (id: string) => string }) {
  return (
    <section className="ct-panel ct-piles">
      <h3>终局牌堆 <small>按放下先后，最早的在左</small></h3>
      {(["winner", "loser"] as const).map((pile) => {
        const cards = pile === "winner" ? game.winnerPile : game.loserPile;
        return (
          <div key={pile} className="ct-pile">
            <span className="ct-pile-name">{pile === "winner" ? "冠军" : "垫底"}</span>
            <div className="ct-pile-cards">
              {cards.length === 0 && <span className="ct-muted">还没有人押</span>}
              {cards.map((card, index) => (
                <span
                  key={index}
                  className={card.camel ? `ct-pile-card camel-${card.camel}` : "ct-pile-card hidden"}
                  style={{ borderColor: seatColor(card.owner) }}
                  title={`${index + 1}. ${nameOf(card.owner)}${card.camel ? `：${CAMEL_LABEL[card.camel]}` : ""}`}
                >
                  {card.owner === myId ? "我" : nameOf(card.owner).slice(0, 1)}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ---------- 赛段结算 ----------

function LegResultDialog({ result, nameOf, onClose }: { result: LegResult; nameOf: (id: string) => string; onClose: () => void }) {
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel ct-result" role="dialog" aria-modal="true" aria-labelledby="ct-leg-title">
        <h2 id="ct-leg-title">第 {result.leg} 赛段结算</h2>
        <RankingRow ranking={result.ranking} />
        <PayoutTable result={result} nameOf={nameOf} />
        <div className="gm-panel-actions">
          <button type="button" className="primary-button" autoFocus onClick={onClose}>继续比赛</button>
        </div>
      </section>
    </div>
  );
}

function RankingRow({ ranking }: { ranking: RacerId[] }) {
  return (
    <div className="ct-result-ranking">
      {ranking.map((camel, index) => (
        <span key={camel} className={`ct-rank camel-${camel}`}><b>{index + 1}</b>{CAMEL_LABEL[camel]}</span>
      ))}
    </div>
  );
}

function PayoutTable({ result, nameOf }: { result: LegResult; nameOf: (id: string) => string }) {
  return (
    <table className="ct-payouts">
      <thead><tr><th>玩家</th><th>下注票</th><th>金字塔</th><th>合伙</th><th>合计</th><th>金币</th></tr></thead>
      <tbody>
        {result.payouts.map((payout) => (
          <tr key={payout.player}>
            <td>{nameOf(payout.player)}</td>
            <td className="ct-payout-bets">
              {payout.bets.length === 0 ? "—" : payout.bets.map((bet, index) => (
                <span key={index} className={`ct-mini-ticket camel-${bet.camel}`} title={`${CAMEL_LABEL[bet.camel]} ${bet.value}`}>{signed(bet.delta)}</span>
              ))}
            </td>
            <td>{payout.pyramid ? `+${payout.pyramid}` : "—"}</td>
            <td>{payout.partnerId ? signed(payout.partner) : "—"}</td>
            <td className={payout.net >= 0 ? "gain" : "loss"}>{signed(payout.net)}</td>
            <td>{payout.before} → <strong>{payout.after}</strong></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- 终局 ----------

function FinalDialog({ game, room, myId, nameOf, onRematch }: { game: GameState; room: LobbyRoomSnapshot; myId: string; nameOf: (id: string) => string; onRematch: (accept: boolean) => void }) {
  const result = game.finalResult!;
  const lastLeg = game.legResults.at(-1);
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const standings = [...game.players].sort((a, b) => b.coins - a.coins);
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel ct-result ct-final" role="dialog" aria-modal="true" aria-labelledby="ct-final-title">
        <h2 id="ct-final-title">比赛结束</h2>
        <RankingRow ranking={result.ranking} />
        {lastLeg && (
          <details>
            <summary>最后一个赛段（第 {lastLeg.leg} 赛段）结算</summary>
            <PayoutTable result={lastLeg} nameOf={nameOf} />
          </details>
        )}
        {(["winner", "loser"] as const).map((pile) => {
          const reveals = pile === "winner" ? result.winnerPile : result.loserPile;
          return (
            <div key={pile} className="ct-reveal">
              <h3>{pile === "winner" ? `冠军牌堆（${CAMEL_LABEL[result.ranking[0]!]}）` : `垫底牌堆（${CAMEL_LABEL[result.ranking.at(-1)!]}）`}</h3>
              {reveals.length === 0 ? <p className="ct-muted">没有人押。</p> : (
                <ol>
                  {reveals.map((reveal, index) => (
                    <li key={index} className={reveal.correct ? "correct" : "wrong"} style={{ animationDelay: `${index * 0.35}s` }}>
                      <span className={`ct-mini-ticket camel-${reveal.camel}`}>{CAMEL_LABEL[reveal.camel]}</span>
                      {nameOf(reveal.owner)} <b>{signed(reveal.delta)}</b>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
        <ol className="ct-standings">
          {standings.map((player) => (
            <li key={player.id} className={result.winners.includes(player.id) ? "winner" : ""}>
              {result.winners.includes(player.id) ? "🏆 " : ""}{player.name}{player.id === myId ? "（你）" : ""}
              <span className="ct-coins"><i className="ct-icon-coin" />{player.coins}</span>
            </li>
          ))}
        </ol>
        {room.rematch && (
          <div className="ct-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
