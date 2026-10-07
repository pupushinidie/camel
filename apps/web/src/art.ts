import type { CamelId, SpectatorSide } from "@camel/game";
import { DIRECTIONS, type Direction } from "./trackGeometry.js";

/**
 * 像素美术的地址。图片放在 public/art 下（PixelLab 生成，art/ 目录里的脚本导出）。
 * 骆驼每个方向一张静止图，走路动画是一行横排精灵图（frames 帧）。
 */
const ROOT = `${import.meta.env.BASE_URL}art/`;

export interface WalkSheet {
  readonly url: string;
  readonly frames: number;
}

export interface CamelArt {
  readonly still: Record<Direction, string>;
  readonly walk?: Partial<Record<Direction, WalkSheet>>;
  /** 正式美术到位之前，用一套样张加滤镜区分颜色。 */
  readonly filter?: string;
}

function directions(folder: string): Record<Direction, string> {
  return Object.fromEntries(DIRECTIONS.map((direction) => [direction, `${ROOT}camels/${folder}/${direction}.png`])) as Record<Direction, string>;
}

// 占位：只有一只红鞍毯样张，其他颜色先用色相滤镜变出来。
const PLACEHOLDER_FILTERS: Record<CamelId, string | undefined> = {
  red: undefined,
  yellow: "hue-rotate(48deg) saturate(1.6)",
  blue: "hue-rotate(205deg) saturate(1.4)",
  green: "hue-rotate(105deg) saturate(1.3)",
  purple: "hue-rotate(265deg) saturate(1.3)",
  black: "grayscale(1) brightness(0.42) contrast(1.4)",
  white: "grayscale(1) brightness(1.45)",
};

export function camelArt(camel: CamelId): CamelArt {
  const filter = PLACEHOLDER_FILTERS[camel];
  return { still: directions("sample"), ...(filter ? { filter } : {}) };
}

export const groundArt = {
  sand: `${ROOT}ground/sand.png`,
  tile: `${ROOT}ground/tile.png`,
  brick: `${ROOT}ground/brick.png`,
};

export const spectatorArt: Record<SpectatorSide, string> = {
  cheer: `${ROOT}spectators/cheer.png`,
  boo: `${ROOT}spectators/boo.png`,
};
