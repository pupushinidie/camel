import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { TRACK_LENGTH, type CamelId, type CrazyId, type DieId, type Spectator } from "@camel/game";
import { camelSprite, decorArt, directionIndex, groundArt, spectatorArt } from "./art.js";
import decorSizes from "./decor-sprites.json";
import { DRAG_THRESHOLD, clamp, distance, midpoint, useElementSize, useTween, useWheel, wheelZoomFactor, type Point } from "./gestures.js";
import { DECOR } from "./sceneLayout.js";
import { BOARD_UNITS, MARGIN, camelHeading, cellCenter, cellGrid, displayCell, spriteDirection } from "./trackGeometry.js";

/**
 * 2.5D 赛道：一块立体的沙盘（CSS 3D）——有厚度的沙地、16 块凸起的石板赛道、带底座的金字塔、
 * 终点拱门和一圈装饰，背后是跟着视角平移的远景。可以拖动旋转、调倾角、缩放。
 * 骆驼、观众和装饰都是始终正对镜头的立牌，骆驼按视角换 8 个朝向的贴图。
 * 光从西北（左上）照过来：侧面和金字塔各面按朝向分明暗，影子都落向东南。
 *
 * 每只骆驼三层：位置层（left/top 用百分比，跟着格子平移，带过渡）→ 立牌层（抵消场景旋转，拖动时不能有过渡）
 * → 抬升层（同一格里叠第几只，沿立牌自己的竖直方向往上错开，带过渡）。
 */

export interface DieFx {
  readonly key: number;
  readonly die: DieId;
  readonly value: number;
  readonly color?: CrazyId;
}

/** 骆驼落地扬起的一小团沙。 */
export interface DustFx {
  readonly key: number;
  readonly pos: number;
}

export interface Track3DProps {
  /** 当前要画的骆驼堆叠（播放动画时是中间状态）。 */
  readonly stacks: Record<number, CamelId[]>;
  readonly spectators: readonly Spectator[];
  /** 正在走的骆驼：播放走路动画并跳一下。 */
  readonly walking: ReadonlySet<CamelId>;
  /** 刚被踩到的观众板。 */
  readonly cheeringAt?: number;
  readonly dieFx?: DieFx;
  readonly dust?: DustFx;
  /** 可以点的格子（放观众板时的合法格）。 */
  readonly selectableCells?: ReadonlySet<number>;
  readonly onCellClick?: (pos: number) => void;
  /** 金字塔可以点（轮到我时点它掷骰）。 */
  readonly pyramidActive?: boolean;
  readonly onPyramidClick?: () => void;
  readonly ownerName: (playerId: string) => string;
  readonly ownerColor: (playerId: string) => string;
  readonly myId: string;
  /** 叠在画面上的额外内容（例如名次条）。 */
  readonly overlay?: ReactNode;
}

interface View {
  spin: number;
  tilt: number;
  zoom: number;
  panX: number;
  panY: number;
}

const DEFAULT_VIEW: View = { spin: -24, tilt: 58, zoom: 1, panX: 0, panY: 0 };
const TILT_RANGE = [24, 74] as const;
const ZOOM_RANGE = [0.6, 3] as const;
const ZOOM_STEP = 1.4;
/** 透视距离 = 基准尺寸的这么多倍。 */
const PERSPECTIVE_RATIO = 2.4;
/** 1 倍缩放时视口里横向大约放得下多少格；手机上拉近一点，让赛道占满宽度（沙盘两边被裁掉没关系）。 */
const UNITS_ACROSS = 7.8;
const UNITS_ACROSS_NARROW = 6.2;

/** 沙盘厚度、石板抬高、石板之间的缝（单位：格）。 */
const PLINTH_DEPTH = 0.55;
const TILE_LIFT = 0.06;
const TILE_INSET = 0.04;
/** 金字塔：底座边长和高、塔身底边和高。 */
const PLATFORM = 2.7;
const PLATFORM_HEIGHT = 0.14;
const PYRAMID_BASE = 2.25;
const PYRAMID_HEIGHT = 1.5;
/** 骆驼立牌高度（格），叠放时每只往上错开立牌高度的多少。 */
const CAMEL_HEIGHT = 1.1;
const STACK_LIFT = 0.44;
const SPECTATOR_SIZE = 0.95;
/** 终点拱门的宽度（格），高度按图片比例。 */
const ARCH_WIDTH = 1.64;
/** 影子往东南偏多少（格）。 */
const SHADOW_SHIFT = 0.09;
/** 远景图的原始尺寸，以及地平线在图里的高度比例。 */
const BACKDROP = { width: 400, height: 200, horizon: 0.55 };

/** 金字塔四个面、沙盘四个侧面朝南、西、北、东时的明暗（光从西北来）。 */
const FACE_SHADE = [0.72, 0.96, 1, 0.6];
const SIDE_SHADE = [0.62, 0.8, 0.86, 0.54];

type Gesture =
  | { kind: "rotate" | "pan"; start: Point; view: View; moved: boolean; button: number }
  | { kind: "pinch"; startDistance: number; anchor: Point; view: View };

const CAMEL_NAMES: Record<CamelId, string> = {
  red: "红", yellow: "黄", blue: "蓝", green: "绿", purple: "紫", black: "黑", white: "白",
};
export const DIE_NAMES: Record<DieId, string> = { red: "红", yellow: "黄", blue: "蓝", green: "绿", purple: "紫", gray: "灰" };

const DECOR_SIZES = decorSizes as Record<string, { width: number; height: number }>;

/** 漂浮的沙粒：位置和节奏按序号算，每次渲染都一样。 */
const MOTES = Array.from({ length: 22 }, (_, index) => ({
  top: (index * 37) % 100,
  delay: -((index * 1.7) % 14),
  duration: 11 + ((index * 5) % 9),
  size: index % 3 === 0 ? 3 : 2,
}));

function Track3D(props: Track3DProps) {
  const { stacks, spectators, walking, cheeringAt, dieFx, dust, selectableCells, onCellClick, pyramidActive, onPyramidClick, ownerName, ownerColor, myId, overlay } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const frame = useElementSize(frameRef);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const tween = useTween<{ spin: number; tilt: number; zoom: number; panX: number; panY: number }>((value) => setView(value));

  // 1 倍大小按视口定：横向放得下 UNITS_ACROSS 格，纵向按默认倾角留出金字塔和骆驼往上冒的高度。
  const defaultTilt = (DEFAULT_VIEW.tilt * Math.PI) / 180;
  const heightFactor = Math.cos(defaultTilt) + 0.42;
  const across = frame.width < 600 ? UNITS_ACROSS_NARROW : UNITS_ACROSS;
  const baseUnit = Math.max(30, Math.min(frame.width / across, (frame.height * 0.94) / (BOARD_UNITS * heightFactor)));
  const baseSize = baseUnit * BOARD_UNITS;
  const unit = baseUnit * view.zoom;
  const size = baseSize * view.zoom;

  const limit = (next: View): View => {
    const zoom = clamp(next.zoom, ZOOM_RANGE[0], ZOOM_RANGE[1]);
    const room = baseSize * zoom * 0.55;
    return {
      spin: next.spin,
      tilt: clamp(next.tilt, TILT_RANGE[0], TILT_RANGE[1]),
      zoom,
      panX: clamp(next.panX, -room, room),
      panY: clamp(next.panY, -room, room),
    };
  };
  const animateTo = (target: View) => tween.start({ ...view }, { ...limit(target) });

  const frameCenter = (): Point | null => {
    const rect = frameRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  };

  function zoomAroundCenter(factor: number) {
    const zoom = clamp(view.zoom * factor, ZOOM_RANGE[0], ZOOM_RANGE[1]);
    const ratio = zoom / view.zoom;
    animateTo({ ...view, zoom, panX: view.panX * ratio, panY: view.panY * ratio });
  }

  /** 转 90°：先对齐到最近的整 45°，按钮转几次之后角度还是整齐的。 */
  function turn(delta: number) {
    animateTo({ ...view, spin: Math.round(view.spin / 45) * 45 + delta });
  }

  useWheel(frameRef, (event) => {
    event.preventDefault();
    tween.cancel();
    const center = frameCenter();
    if (!center) return;
    setView((current) => {
      const zoom = clamp(current.zoom * wheelZoomFactor(event), ZOOM_RANGE[0], ZOOM_RANGE[1]);
      const dx = event.clientX - center.x;
      const dy = event.clientY - center.y;
      const ratio = zoom / current.zoom;
      return limit({ ...current, zoom, panX: dx - (dx - current.panX) * ratio, panY: dy - (dy - current.panY) * ratio });
    });
  });

  /** 点击交给浏览器在 3D 里判定；立牌、影子和装饰都不接收点击。 */
  function targetAt(clientX: number, clientY: number): { cell?: number; pyramid?: boolean } {
    const element = document.elementFromPoint(clientX, clientY);
    const cell = element?.closest<HTMLElement>("[data-cell]");
    if (cell) return { cell: Number(cell.dataset.cell) };
    if (element?.closest("[data-pyramid]")) return { pyramid: true };
    return {};
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest(".ct-map-controls")) return;
    tween.cancel();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      gesture.current = {
        kind: event.button === 2 || event.shiftKey ? "pan" : "rotate",
        start: { x: event.clientX, y: event.clientY },
        view,
        moved: false,
        button: event.button,
      };
    } else if (pointers.current.size === 2) {
      const center = frameCenter();
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      if (!center) return;
      const mid = midpoint(a, b);
      gesture.current = {
        kind: "pinch",
        startDistance: Math.max(1, distance(a, b)),
        anchor: { x: (mid.x - center.x - view.panX) / view.zoom, y: (mid.y - center.y - view.panY) / view.zoom },
        view,
      };
      for (const id of pointers.current.keys()) frameRef.current?.setPointerCapture(id);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) {
      if (event.pointerType === "mouse" && selectableCells) {
        const { cell } = targetAt(event.clientX, event.clientY);
        const next = cell !== undefined && selectableCells.has(cell) ? cell : null;
        if (next !== hoverCell) setHoverCell(next);
      }
      return;
    }
    // 鼠标键其实已经松开（松开事件丢了，例如在窗口外松手）：当作拖动结束，免得画面一直跟着鼠标转
    if (event.pointerType === "mouse" && event.buttons === 0) {
      handlePointerCancel(event);
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    if (current.kind === "pinch") {
      const center = frameCenter();
      if (!center) return;
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const mid = midpoint(a, b);
      const zoom = clamp((current.view.zoom * distance(a, b)) / current.startDistance, ZOOM_RANGE[0], ZOOM_RANGE[1]);
      setView(limit({ ...current.view, zoom, panX: mid.x - center.x - current.anchor.x * zoom, panY: mid.y - center.y - current.anchor.y * zoom }));
      return;
    }
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (!current.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setHoverCell(null);
    }
    setView(limit(current.kind === "pan"
      ? { ...current.view, panX: current.view.panX + dx, panY: current.view.panY + dy }
      : { ...current.view, spin: current.view.spin + dx * 0.4, tilt: current.view.tilt - dy * 0.3 }));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    const current = gesture.current;
    if (pointers.current.size === 0 || current?.kind === "pinch") gesture.current = null;
    if (current && current.kind !== "pinch" && !current.moved && current.button === 0 && pointers.current.size === 0) {
      const target = targetAt(event.clientX, event.clientY);
      if (target.cell !== undefined && selectableCells?.has(target.cell)) onCellClick?.(target.cell);
      else if (target.pyramid && pyramidActive) onPyramidClick?.();
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    gesture.current = null;
  }

  // ---------- 几何辅助 ----------
  const px = (units: number) => units * unit;
  // 立牌：抵消场景的 rotateX(tilt) rotateZ(spin)，正对镜头。
  const billboard = `rotateZ(${-view.spin}deg) rotateX(${-view.tilt}deg)`;
  /** 立牌和影子的位置用场景边长的百分比：缩放时百分比不变，不会触发 left/top 的过渡。 */
  const place = (x: number, y: number, z = 0): CSSProperties => ({
    left: `${(x / BOARD_UNITS) * 100}%`,
    top: `${(y / BOARD_UNITS) * 100}%`,
    ...(z ? { transform: `translateZ(${px(z)}px)` } : {}),
  });
  /** 立牌贴图：底边中点落在锚点上。 */
  const standee = (width: number, height: number): CSSProperties => ({ width: px(width), height: px(height), left: -px(width) / 2, top: -px(height) });
  /** 场景里某一点离镜头多近（正数在画面下方、更靠近镜头），用来把挡在前面的高装饰调成半透明。 */
  const spinRad = (view.spin * Math.PI) / 180;
  const nearness = (x: number, y: number) => {
    const dx = x - BOARD_UNITS / 2;
    const dy = y - BOARD_UNITS / 2;
    return dx * Math.sin(spinRad) + dy * Math.cos(spinRad);
  };

  // 每只骆驼所在的格子和高度（越线后的位置画回赛道上对应的格子）。
  const camels: { camel: CamelId; pos: number; height: number }[] = [];
  for (const [key, stack] of Object.entries(stacks)) {
    stack.forEach((camel, height) => camels.push({ camel, pos: Number(key), height }));
  }
  camels.sort((a, b) => a.camel.localeCompare(b.camel)); // 元素顺序固定，React 才能复用节点做过渡

  const cells = Array.from({ length: TRACK_LENGTH }, (_, index) => index + 1);
  const center = BOARD_UNITS / 2;
  const slant = Math.hypot(PYRAMID_HEIGHT, PYRAMID_BASE / 2);
  const elevation = (Math.atan2(PYRAMID_HEIGHT, PYRAMID_BASE / 2) * 180) / Math.PI;
  const apex = PLATFORM_HEIGHT + PYRAMID_HEIGHT;
  // 金字塔的影子：底座的东北角、西南角和塔尖投到地上的点围成的三角形（光从西北来）
  const reach = PLATFORM / 2 + 0.75;
  const shadowBox = { left: center - PLATFORM / 2, top: center - PLATFORM / 2, size: PLATFORM / 2 + reach };
  const shadowPoint = (x: number, y: number) => `${((x - shadowBox.left) / shadowBox.size) * 100}% ${((y - shadowBox.top) / shadowBox.size) * 100}%`;
  const pyramidShadow = `polygon(${shadowPoint(center + PLATFORM / 2, center - PLATFORM / 2)}, ${shadowPoint(center + reach, center + reach)}, ${shadowPoint(center - PLATFORM / 2, center + PLATFORM / 2)})`;
  const arch = DECOR_SIZES.arch ?? { width: 106, height: 82 };
  const archHeight = (ARCH_WIDTH * arch.height) / arch.width;

  // 远景：整数倍放大（像素才整齐），宽度不小于视口，所以同一时间只看得到一个太阳。
  // 转一整圈正好滚过一整张（远处的东西移动得慢）；倾角越平，地平线越低。
  const backdropScale = Math.max(2, Math.ceil(frame.width / BACKDROP.width));
  const backdropWidth = BACKDROP.width * backdropScale;
  const backdropHeight = BACKDROP.height * backdropScale;
  const horizon = frame.height * (0.34 + (view.tilt - DEFAULT_VIEW.tilt) * 0.012) + view.panY * 0.3;
  const backdropStyle: CSSProperties = {
    backgroundImage: `url(${groundArt.backdrop})`,
    backgroundSize: `${backdropWidth}px ${backdropHeight}px`,
    backgroundPosition: `${Math.round((-view.spin / 360) * backdropWidth)}px ${Math.round(horizon - backdropHeight * BACKDROP.horizon)}px`,
    // 越接近俯视，天空越不该出现：倾角 46° 以下远景渐隐，只剩底色
    opacity: clamp((view.tilt - 34) / 12, 0, 1),
  };

  const frameClasses = ["ct-frame"];
  if (hoverCell !== null || pyramidActive) frameClasses.push("pointing");

  return (
    <div
      className={frameClasses.join(" ")}
      ref={frameRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onPointerLeave={() => setHoverCell(null)}
      onContextMenu={(event) => event.preventDefault()}
      style={{ "--unit": `${unit}px` } as CSSProperties}
    >
      <div className="ct-backdrop" style={backdropStyle} aria-hidden="true" />
      <div className="ct-panner" style={{ perspective: `${baseSize * PERSPECTIVE_RATIO * view.zoom}px`, transform: `translate(${view.panX}px, ${view.panY}px)` }}>
        <div
          className="ct-scene"
          style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, transform: `rotateX(${view.tilt}deg) rotateZ(${view.spin}deg)` }}
        >
          {/* 沙盘四个侧面：从中心转到四条边上，岩层贴图始终是横的 */}
          {[0, 1, 2, 3].map((side) => (
            <div
              key={`plinth-${side}`}
              className="ct-plinth"
              style={{
                left: 0,
                top: size / 2,
                width: size,
                height: px(PLINTH_DEPTH),
                transformOrigin: "50% 0",
                transform: `rotateZ(${side * 90}deg) translateY(${size / 2}px) rotateX(-90deg)`,
                backgroundImage: `url(${groundArt.strata})`,
                "--shade": SIDE_SHADE[side],
              } as CSSProperties}
            />
          ))}

          {/* 地面：沙地 + 一层暖光 */}
          <div className="ct-ground" style={{ backgroundImage: `url(${groundArt.sand})`, backgroundSize: `${px(2)}px ${px(2)}px` }}>
            <div className="ct-ground-light" />
          </div>

          {/* 赛道：石板落在地上的影子 + 抬高一点的石板 */}
          {cells.map((pos) => {
            const { col, row } = cellGrid(pos);
            const left = px(MARGIN + col + TILE_INSET);
            const top = px(MARGIN + row + TILE_INSET);
            const side = px(1 - TILE_INSET * 2);
            const classes = ["ct-tile"];
            if (selectableCells?.has(pos)) classes.push("selectable");
            if (hoverCell === pos) classes.push("hover");
            return [
              <div key={`shadow-${pos}`} className="ct-tile-shadow" style={{ left: left + px(0.05), top: top + px(0.05), width: side, height: side }} />,
              <div
                key={`tile-${pos}`}
                className={classes.join(" ")}
                data-cell={pos}
                data-tutorial={`cell:${pos}`}
                style={{ left, top, width: side, height: side, transform: `translateZ(${px(TILE_LIFT)}px)`, backgroundImage: `url(${groundArt.tile})` }}
              >
                <span className="ct-cell-number">{pos}</span>
              </div>,
            ];
          })}

          {/* 终点线：第 16 格和第 1 格之间，画在石板上面 */}
          <div className="ct-finish" data-tutorial="finish-line" style={{ left: px(MARGIN), top: px(MARGIN + 1) - px(0.07), width: px(1), height: px(0.14), transform: `translateZ(${px(TILE_LIFT) + 1}px)` }} />

          {/* 观众板落在石板上的底座：俯视时也看得出是哪一面、谁的 */}
          {spectators.map((spectator) => {
            const { col, row } = cellGrid(spectator.pos);
            return (
              <div
                key={`pad-${spectator.owner}`}
                className={`ct-spectator-pad ${spectator.side}`}
                style={{ left: px(MARGIN + col + 0.14), top: px(MARGIN + row + 0.14), width: px(0.72), height: px(0.72), borderColor: ownerColor(spectator.owner), transform: `translateZ(${px(TILE_LIFT) + 1}px)` }}
              />
            );
          })}

          {/* 金字塔：影子、底座、四个三角面（顶上一截金色，南面有门） */}
          <div className="ct-pyramid-shadow" style={{ left: px(shadowBox.left), top: px(shadowBox.top), width: px(shadowBox.size), height: px(shadowBox.size), clipPath: pyramidShadow, transform: `translateZ(${px(TILE_LIFT) + 2}px)` }} />
          <div className="ct-platform-top" data-tutorial="pyramid" style={{ left: px(center - PLATFORM / 2), top: px(center - PLATFORM / 2), width: px(PLATFORM), height: px(PLATFORM), transform: `translateZ(${px(PLATFORM_HEIGHT)}px)`, backgroundImage: `url(${groundArt.brick})`, backgroundSize: `${px(0.5)}px ${px(0.5)}px` }} />
          {[0, 1, 2, 3].map((side) => (
            <div
              key={`platform-${side}`}
              className="ct-platform-side"
              style={{
                left: px(center - PLATFORM / 2),
                top: px(center),
                width: px(PLATFORM),
                height: px(PLATFORM_HEIGHT),
                transformOrigin: "50% 0",
                transform: `translateZ(${px(PLATFORM_HEIGHT)}px) rotateZ(${side * 90}deg) translateY(${px(PLATFORM / 2)}px) rotateX(-90deg)`,
                backgroundImage: `url(${groundArt.brick})`,
                backgroundSize: `${px(0.5)}px ${px(0.5)}px`,
                "--shade": FACE_SHADE[side]! * 0.9,
              } as CSSProperties}
            />
          ))}
          {[0, 1, 2, 3].map((side) => (
            <div
              key={side}
              className={pyramidActive ? "ct-pyramid-face active" : "ct-pyramid-face"}
              data-pyramid="1"
              style={{
                left: px(center - PYRAMID_BASE / 2),
                top: px(center - slant),
                width: px(PYRAMID_BASE),
                height: px(slant),
                backgroundImage: `linear-gradient(to bottom, #ffe7a0 0 6%, #f2c14e 6% 15%, #b8862a 15% 17%, transparent 17%), url(${groundArt.brick})`,
                backgroundSize: `100% 100%, ${px(0.62)}px ${px(0.62)}px`,
                "--shade": FACE_SHADE[side],
                transform: `translateZ(${px(PLATFORM_HEIGHT)}px) rotateZ(${side * 90}deg) translateY(${px(PYRAMID_BASE / 2)}px) rotateX(${-elevation}deg)`,
              } as CSSProperties}
            >
              {side === 0 && <span className="ct-pyramid-door" />}
            </div>
          ))}

          {/* 终点拱门：竖在终点线上的一块面板，不跟镜头转（像真的拱门一样，从侧面看是薄的） */}
          <div
            className="ct-arch"
            style={{
              left: px(MARGIN + 0.5 - ARCH_WIDTH / 2),
              top: px(MARGIN + 1) - px(archHeight),
              width: px(ARCH_WIDTH),
              height: px(archHeight),
              transformOrigin: "50% 100%",
              transform: `translateZ(${px(TILE_LIFT)}px) rotateX(-90deg)`,
              backgroundImage: `url(${groundArt.arch})`,
            }}
          />

          {/* 装饰立牌（挡在赛道前面的高装饰变半透明） */}
          {DECOR.map((decor, index) => {
            const art = DECOR_SIZES[decor.kind] ?? { width: 1, height: 1 };
            const height = decor.size;
            const width = (height * art.width) / art.height;
            const shadowWidth = width * 0.8;
            const shadowHeight = Math.min(width, height) * 0.36;
            const inFront = decor.tall && nearness(decor.x, decor.y) > 2.7;
            return (
              <div key={`decor-${index}`} className="ct-anchor" style={place(decor.x, decor.y)}>
                <div className="ct-shadow" style={{ width: px(shadowWidth), height: px(shadowHeight), left: px(SHADOW_SHIFT * 2 - shadowWidth / 2), top: px(SHADOW_SHIFT * 2 - shadowHeight / 2) }} />
                <div className="ct-billboard" style={{ transform: billboard }}>
                  <div
                    className={inFront ? "ct-decor faded" : "ct-decor"}
                    style={{ ...standee(width, height), backgroundImage: `url(${decorArt(decor.kind)})`, ...(decor.flip ? { transform: "scaleX(-1)" } : {}) }}
                  />
                </div>
              </div>
            );
          })}

          {/* 观众立牌 */}
          {spectators.map((spectator) => {
            const spot = cellCenter(spectator.pos);
            const cheering = cheeringAt !== undefined && displayCell(cheeringAt) === spectator.pos;
            return (
              <div key={`sp-${spectator.owner}`} className="ct-anchor" style={place(spot.x, spot.y + 0.26, TILE_LIFT)}>
                <div className="ct-shadow" style={{ width: px(0.66), height: px(0.26), left: px(SHADOW_SHIFT - 0.33), top: px(SHADOW_SHIFT - 0.13) }} />
                <div className="ct-billboard" style={{ transform: billboard }}>
                  <div className={cheering ? "ct-spectator cheering" : "ct-spectator"} style={{ ...standee(SPECTATOR_SIZE, SPECTATOR_SIZE), backgroundImage: `url(${spectatorArt[spectator.side]})` }}>
                    <span className="ct-spectator-tag" style={{ background: ownerColor(spectator.owner) }}>
                      {spectator.owner === myId ? "我" : ownerName(spectator.owner).slice(0, 4)} {spectator.side === "cheer" ? "+1" : "−1"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 骆驼 */}
          {camels.map(({ camel, pos, height }) => {
            const spot = cellCenter(pos);
            const heading = camelHeading(camel, pos);
            const direction = spriteDirection(heading, view.spin);
            const index = directionIndex(direction);
            const sprite = camelSprite(camel);
            const moving = walking.has(camel);
            const walkSheet = moving && sprite.walk?.directions.includes(direction) ? sprite.walk : undefined;
            const spriteWidth = (CAMEL_HEIGHT * sprite.width) / sprite.height;
            const look: CSSProperties = walkSheet
              ? { backgroundImage: `url(${walkSheet.url})`, backgroundSize: `${walkSheet.frames * 100}% 800%`, backgroundPositionY: `${(index / 7) * 100}%`, "--frames": walkSheet.frames } as CSSProperties
              : { backgroundImage: `url(${sprite.still})`, backgroundSize: "800% 100%", backgroundPositionX: `${(index / 7) * 100}%` };
            return (
              <div key={camel} className="ct-anchor ct-camel-anchor" style={place(spot.x, spot.y + 0.1, TILE_LIFT)}>
                {(height === 0 || moving) && (
                  <div className="ct-shadow" style={{ width: px(0.82), height: px(0.3), left: px(SHADOW_SHIFT - 0.41), top: px(SHADOW_SHIFT - 0.15), transform: `rotateZ(${heading}deg)` }} />
                )}
                <div className="ct-billboard" style={{ transform: billboard }}>
                  <div className="ct-lift" style={{ ...standee(spriteWidth, CAMEL_HEIGHT), transform: `translateY(${-height * STACK_LIFT * 100}%) translateZ(${height * 2}px)` }}>
                    <div
                      className={["ct-camel", moving ? "walking" : "", walkSheet ? "animated" : ""].join(" ")}
                      style={{ ...(sprite.filter ? { filter: sprite.filter } : {}), ...look }}
                      aria-label={`${CAMEL_NAMES[camel]}骆驼，第 ${displayCell(pos)} 格`}
                      data-tutorial={`camel:${camel}`}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* 骆驼落地扬起的沙 */}
          {dust && (() => {
            const spot = cellCenter(dust.pos);
            return (
              <div key={`dust-${dust.key}`} className="ct-anchor" style={place(spot.x, spot.y + 0.2, TILE_LIFT)}>
                <div className="ct-billboard" style={{ transform: billboard }}>
                  <div className="ct-dust" style={{ width: px(0.9), height: px(0.4), left: -px(0.45), top: -px(0.4) }}>
                    {Array.from({ length: 7 }, (_, index) => <i key={index} style={{ "--i": index } as CSSProperties} />)}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 掷出的骰子从金字塔顶冒出来 */}
          {dieFx && (
            <div key={dieFx.key} className="ct-anchor" style={place(center, center, apex)}>
              <div className="ct-billboard" style={{ transform: billboard }}>
                <div className={`ct-die-fx die-${dieFx.die}`} style={{ "--die": `${Math.round(px(0.55))}px` } as CSSProperties}>
                  <span className={`ct-die die-${dieFx.color ?? dieFx.die}`}>{dieFx.value}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ct-motes" aria-hidden="true">
        {MOTES.map((mote, index) => (
          <i key={index} style={{ top: `${mote.top}%`, width: mote.size, height: mote.size, animationDelay: `${mote.delay}s`, animationDuration: `${mote.duration}s` }} />
        ))}
      </div>
      <div className="ct-vignette" aria-hidden="true" />

      {overlay}

      <div className="ct-map-controls">
        <button type="button" onClick={() => turn(-90)} title="逆时针转 90°">左转</button>
        <button type="button" onClick={() => turn(90)} title="顺时针转 90°">右转</button>
        <button type="button" aria-label="放大" disabled={view.zoom >= ZOOM_RANGE[1] - 0.001} onClick={() => zoomAroundCenter(ZOOM_STEP)}>＋</button>
        <button type="button" aria-label="缩小" disabled={view.zoom <= ZOOM_RANGE[0] + 0.001} onClick={() => zoomAroundCenter(1 / ZOOM_STEP)}>−</button>
        <button type="button" onClick={() => animateTo(DEFAULT_VIEW)}>复位</button>
      </div>
      <span className="ct-map-hint">拖动旋转 · 上下拖调角度 · 滚轮或双指缩放</span>
    </div>
  );
}

export default Track3D;
