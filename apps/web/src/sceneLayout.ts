import type { DecorKind } from "./art.js";

/**
 * 沙盘上的装饰摆放（单位：格，9×9 沙盘，赛道占 2–7）。
 * size 是立牌高度（格）；tall 的装饰挡在赛道前面时会变半透明。
 */
export interface DecorPlacement {
  readonly kind: DecorKind;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly flip?: boolean;
  readonly tall?: boolean;
}

export const DECOR: readonly DecorPlacement[] = [
  // 默认视角从西南往东北看：高的装饰（看台、帐篷、棕榈、方尖碑）放在北边和东边，前排只放矮的岩石和灌木。
  { kind: "stand", x: 4.6, y: 0.9, size: 1.35, tall: true },
  { kind: "tent", x: 7.5, y: 1.15, size: 1.1, tall: true },
  { kind: "tent", x: 8.35, y: 3.6, size: 0.95, flip: true, tall: true },
  { kind: "palm", x: 0.85, y: 0.9, size: 1.9, tall: true },
  { kind: "palm", x: 1.5, y: 0.5, size: 1.5, flip: true, tall: true },
  { kind: "palm", x: 8.45, y: 6.1, size: 1.7, flip: true, tall: true },
  { kind: "palm", x: 6.3, y: 0.55, size: 1.45, tall: true },
  { kind: "obelisk", x: 8.5, y: 0.5, size: 1.7, tall: true },
  { kind: "obelisk", x: 0.5, y: 4.6, size: 1.35, tall: true },
  // 终点线两侧的旗子
  { kind: "flag", x: 1.55, y: 2.55, size: 1.35, tall: true },
  { kind: "flag", x: 1.55, y: 3.45, size: 1.35, flip: true, tall: true },
  // 金字塔门口的火盆
  { kind: "brazier", x: 3.95, y: 5.95, size: 0.6 },
  { kind: "brazier", x: 5.05, y: 5.95, size: 0.6 },
  // 前排和两侧的岩石、灌木
  { kind: "rocks", x: 2.2, y: 8.35, size: 0.6 },
  { kind: "rocks", x: 6.9, y: 8.5, size: 0.5, flip: true },
  { kind: "rocks", x: 0.55, y: 7.4, size: 0.7 },
  { kind: "rocks", x: 8.5, y: 8.4, size: 0.55, flip: true },
  { kind: "shrub", x: 1.2, y: 6.1, size: 0.42 },
  { kind: "shrub", x: 4.6, y: 8.55, size: 0.4, flip: true },
  { kind: "shrub", x: 7.7, y: 7.6, size: 0.38 },
  { kind: "shrub", x: 3.2, y: 0.5, size: 0.36, flip: true },
  { kind: "shrub", x: 3.4, y: 3.4, size: 0.3 },
  { kind: "shrub", x: 5.7, y: 3.35, size: 0.28, flip: true },
];
