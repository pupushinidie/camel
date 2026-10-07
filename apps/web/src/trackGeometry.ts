import { TRACK_LENGTH, isCrazy, type CamelId } from "@camel/game";

/**
 * 赛道是 5×5 方阵的外圈，共 16 格，中间 3×3 放金字塔。俯视时顺时针编号：
 *
 *    1  2  3  4  5
 *   16           6
 *   15   金字塔   7
 *   14           8
 *   13 12 11 10  9
 *
 * 终点线在 16 和 1 之间。场景里再往外留一圈沙地，所以整块地面是 7×7 个单位。
 * 坐标单位是「格」，x 向右、y 向下（和 CSS 一致）。
 */
export const RING = 5;
export const MARGIN = 1;
export const BOARD_UNITS = RING + MARGIN * 2;

/** 越线后的位置（17、18… 或 0、−1…）画回赛道上对应的格子。 */
export function displayCell(pos: number): number {
  return ((((pos - 1) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH) + 1;
}

/** 第 n 格在 5×5 方阵里的列、行（0 起）。 */
export function cellGrid(pos: number): { col: number; row: number } {
  const n = displayCell(pos);
  if (n <= 5) return { col: n - 1, row: 0 };
  if (n <= 8) return { col: 4, row: n - 5 };
  if (n <= 13) return { col: 13 - n, row: 4 };
  return { col: 0, row: 17 - n };
}

/** 第 n 格中心在场景里的坐标（单位：格，含外圈沙地）。 */
export function cellCenter(pos: number): { x: number; y: number } {
  const { col, row } = cellGrid(pos);
  return { x: MARGIN + col + 0.5, y: MARGIN + row + 0.5 };
}

/**
 * 骆驼在某格的朝向（度）：0 = 向右（东），90 = 向下（南），180 = 向左，270 = 向上。
 * 赛跑骆驼顺时针跑，朝向下一格；疯狂骆驼逆时针跑，朝向上一格。
 */
export function cellHeading(pos: number, crazy: boolean): number {
  const n = displayCell(pos);
  if (!crazy) {
    if (n <= 4) return 0;
    if (n <= 8) return 90;
    if (n <= 12) return 180;
    return 270;
  }
  if (n === 1 || n >= 14) return 90;
  if (n <= 5) return 180;
  if (n <= 9) return 270;
  return 0;
}

export function camelHeading(camel: CamelId, pos: number): number {
  return cellHeading(pos, isCrazy(camel));
}

/** 贴图的 8 个朝向：south 是正对镜头，east 是朝屏幕右边。 */
export const DIRECTIONS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * 场景绕竖轴转了 spin 度（CSS rotateZ，屏幕上顺时针为正）之后，朝向 heading 的骆驼
 * 在屏幕上朝哪个方向，取最近的 8 方向之一。
 * 屏幕角度 = 朝向 + spin；0° 朝右（east），90° 朝下即朝镜头（south）。
 */
export function spriteDirection(heading: number, spin: number): Direction {
  const screen = (((heading + spin) % 360) + 360) % 360;
  const step = Math.round(screen / 45) % 8;
  const byScreenAngle: Direction[] = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  return byScreenAngle[step]!;
}

/**
 * 按行进方向一格一格走的路径（不含起点），用来播放移动动画。
 * 关闭「逆时针越线结束游戏」时，疯狂骆驼会从第 1 格绕回第 16 格，这时 to 比 from 大。
 */
export function stepPath(from: number, to: number, dir: 1 | -1): number[] {
  let steps = dir > 0 ? to - from : from - to;
  if (steps < 0) steps += TRACK_LENGTH;
  return Array.from({ length: steps }, (_, index) => from + dir * (index + 1));
}
