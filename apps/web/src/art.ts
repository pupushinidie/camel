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
const ROOT = `${import.meta.env.BASE_URL}art/`;
/** 拼在每个美术地址后面：每次构建都不同，部署后浏览器会重新取图，不会还显示缓存里的旧图。 */
const V = `?v=${__ART_VERSION__}`;

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
    still: `${ROOT}camels/${folder}/still.png${V}`,
    ...(entry.walkFrames
      ? { walk: { url: `${ROOT}camels/${folder}/walk.png${V}`, frames: entry.walkFrames, directions: (entry.walkDirections ?? []) as Direction[] } }
      : {}),
    ...(placeholder ? { filter: placeholder.filter } : {}),
  };
}

export function directionIndex(direction: Direction): number {
  return DIRECTIONS.indexOf(direction);
}

export const groundArt = {
  sand: `${ROOT}ground/sand.png${V}`,
  tile: `${ROOT}ground/tile.png${V}`,
  brick: `${ROOT}ground/brick.png${V}`,
  strata: `${ROOT}ground/strata.png${V}`,
  backdrop: `${ROOT}ground/backdrop.png${V}`,
  arch: `${ROOT}decor/arch.png${V}`,
};

export const spectatorArt: Record<SpectatorSide, string> = {
  cheer: `${ROOT}spectators/cheer.png${V}`,
  boo: `${ROOT}spectators/boo.png${V}`,
};

/** 沙盘上的装饰立牌。 */
export const DECOR_KINDS = ["palm", "shrub", "rocks", "tent", "stand", "flag", "brazier", "obelisk"] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export function decorArt(kind: DecorKind): string {
  return `${ROOT}decor/${kind}.png${V}`;
}

export const iconArt = {
  coin: `${ROOT}ui/coin.png${V}`,
  pyramidTicket: `${ROOT}ui/pyramid-ticket.png${V}`,
  cardBack: `${ROOT}ui/card-back.png${V}`,
  partner: `${ROOT}ui/partner.png${V}`,
  hero: `${ROOT}ui/hero.png${V}`,
};

/** 赛段下注票：票面上的骆驼剪影是队色（art/props.py 换色）。 */
export function ticketArt(camel: RacerId): string {
  return `${ROOT}ui/ticket-${camel}.png${V}`;
}
