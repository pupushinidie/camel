import { useEffect, useRef, useState } from "react";
import type { CamelId, GameState, Spectator } from "@camel/game";
import type { DieFx } from "./Track3D.js";
import { stepPath } from "./trackGeometry.js";

/** 每走一格的时长（毫秒），和 CSS 里 .ct-anchor 的过渡、跳跃动画一致。 */
export const STEP_MS = 360;
const DIE_MS = 900;
const CHEER_MS = 520;

export interface Playback {
  readonly stacks: Record<number, CamelId[]>;
  readonly spectators: readonly Spectator[];
  readonly walking: ReadonlySet<CamelId>;
  readonly cheeringAt?: number;
  readonly dieFx?: DieFx;
  /** 已经播放完的版本；赛段结算、终局弹窗等动画播完再出。 */
  readonly settledVersion: number;
}

function snapshot(game: GameState): Playback {
  return { stacks: game.stacks, spectators: game.spectators, walking: new Set(), settledVersion: game.version };
}

/** 画面上把一个单位从 from 挪到 to：叠在最上面，或放到最下面（嘘）。 */
function moveVisual(stacks: Record<number, CamelId[]>, unit: CamelId[], to: number, under: boolean): Record<number, CamelId[]> {
  const next: Record<number, CamelId[]> = {};
  for (const [key, stack] of Object.entries(stacks)) {
    const rest = stack.filter((camel) => !unit.includes(camel));
    if (rest.length) next[Number(key)] = rest;
  }
  const existing = next[to] ?? [];
  next[to] = under ? [...unit, ...existing] : [...existing, ...unit];
  return next;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 按事件播放上一个行动：骰子从金字塔冒出 → 骆驼一格一格走 → 观众板欢呼/喝倒彩 → 追加的一格。
 * 只在新状态恰好比上一个多一个版本、并且是掷骰时播放；其余情况（重连、连续多步）直接跳到最终状态。
 * 聊天、语音等也会推送整个房间，game 对象会变但版本不变，这时不打断正在播的动画。
 */
export function usePlayback(game: GameState): Playback {
  const [playback, setPlayback] = useState<Playback>(() => snapshot(game));
  const previous = useRef(game);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const prev = previous.current;
    previous.current = game;
    if (game.version === prev.version) return;
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];

    const roll = game.events.find((event) => event.type === "DieRolled");
    if (game.version !== prev.version + 1 || !roll || roll.type !== "DieRolled" || prefersReducedMotion()) {
      setPlayback(snapshot(game));
      return;
    }

    // 从上一个状态开始，按事件排出每一帧
    const frames: { at: number; state: Playback }[] = [];
    let stacks = prev.stacks;
    const spectators = prev.spectators;
    const base = { spectators, settledVersion: prev.version };
    const dieFx: DieFx = { key: game.version, die: roll.die, value: roll.value, ...(roll.color ? { color: roll.color } : {}) };
    let time = 0;
    frames.push({ at: time, state: { ...base, stacks, walking: new Set(), dieFx } });
    time += DIE_MS;
    let cheeringAt: number | undefined;
    for (const event of game.events) {
      if (event.type === "SpectatorTriggered") {
        cheeringAt = event.pos;
        frames.push({ at: time, state: { ...base, stacks, walking: new Set(), dieFx, cheeringAt } });
        time += CHEER_MS;
      }
      if (event.type !== "UnitMoved") continue;
      const path = stepPath(event.from, event.to, event.dir);
      path.forEach((pos, index) => {
        stacks = moveVisual(stacks, event.camels, pos, event.under && index === path.length - 1);
        frames.push({ at: time, state: { ...base, stacks, walking: new Set(event.camels), dieFx, ...(cheeringAt !== undefined ? { cheeringAt } : {}) } });
        time += STEP_MS;
      });
    }
    frames.push({ at: time, state: snapshot(game) });

    for (const frame of frames) {
      if (frame.at === 0) setPlayback(frame.state);
      else timers.current.push(setTimeout(() => setPlayback(frame.state), frame.at));
    }
  }, [game.version]);

  useEffect(() => () => {
    for (const timer of timers.current) clearTimeout(timer);
  }, []);

  return playback;
}
