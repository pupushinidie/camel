import type { CamelId, RacerId, SpectatorSide } from "@camel/game";
import sprites from "./camel-sprites.json";
import { DIRECTIONS, type Direction } from "./trackGeometry.js";

/**
 * 像素美术的地址。图片放在 public/art 下（PixelLab 生成，art/ 目录里的脚本导出）。
 *
 * 骆驼是精灵图（art/camels.py 导出，尺寸记在 camel-sprites.json）：
 * - still.png：一行 8 格，顺序同 DIRECTIONS；
 * - walk.png：8 行（方向）× walkFrames 列。
 */
// 图片地址固定；换图后不会被浏览器缓存挡住，靠的是服务器（Caddy）给这些文件加的 Cache-Control: no-cache。
const ROOT = `${import.meta.env.BASE_URL}art/`;

export interface CamelSprite {
  /** 单格的像素宽高。 */
  readonly width: number;
  readonly height: number;
  readonly still: string;
  readonly walk?: { readonly url: string; readonly frames: number; readonly directions: readonly Direction[] };
  /** 正式美术到位之前，用滤镜临时区分颜色。 */
  readonly filter?: string;
}

interface SpriteEntry {
  readonly width: number;
  readonly height: number;
  readonly walkFrames?: number;
  readonly walkDirections?: string[];
}

const SPRITES = sprites as Record<string, SpriteEntry>;

/** 疯骆驼的正式美术到位前，用红鞍毯那只去色顶上。 */
const PLACEHOLDERS: Partial<Record<CamelId, { from: string; filter: string }>> = {
  black: { from: "red", filter: "grayscale(1) brightness(0.42) contrast(1.4)" },
  white: { from: "red", filter: "grayscale(1) brightness(1.45)" },
};

export function camelSprite(camel: CamelId): CamelSprite {
  const placeholder = SPRITES[camel] ? undefined : PLACEHOLDERS[camel];
  const folder = placeholder?.from ?? camel;
  const entry = SPRITES[folder]!;
  return {
    width: entry.width,
    height: entry.height,
    still: `${ROOT}camels/${folder}/still.png`,
    ...(entry.walkFrames
      ? { walk: { url: `${ROOT}camels/${folder}/walk.png`, frames: entry.walkFrames, directions: (entry.walkDirections ?? []) as Direction[] } }
      : {}),
    ...(placeholder ? { filter: placeholder.filter } : {}),
  };
}

export function directionIndex(direction: Direction): number {
  return DIRECTIONS.indexOf(direction);
}

export const groundArt = {
  sand: `${ROOT}ground/sand.png`,
  tile: `${ROOT}ground/tile.png`,
  brick: `${ROOT}ground/brick.png`,
  strata: `${ROOT}ground/strata.png`,
  backdrop: `${ROOT}ground/backdrop.png`,
  arch: `${ROOT}decor/arch.png`,
};

export const spectatorArt: Record<SpectatorSide, string> = {
  cheer: `${ROOT}spectators/cheer.png`,
  boo: `${ROOT}spectators/boo.png`,
};

/** 沙盘上的装饰立牌。 */
export const DECOR_KINDS = ["palm", "shrub", "rocks", "tent", "stand", "flag", "brazier", "obelisk"] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export function decorArt(kind: DecorKind): string {
  return `${ROOT}decor/${kind}.png`;
}

export const iconArt = {
  coin: `${ROOT}ui/coin.png`,
  pyramidTicket: `${ROOT}ui/pyramid-ticket.png`,
  cardBack: `${ROOT}ui/card-back.png`,
  partner: `${ROOT}ui/partner.png`,
  hero: `${ROOT}ui/hero.png`,
};

/** 赛段下注票：票面上的骆驼剪影是队色（art/props.py 换色）。 */
export function ticketArt(camel: RacerId): string {
  return `${ROOT}ui/ticket-${camel}.png`;
}
