import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { TRACK_LENGTH, type CamelId, type DieId, type CrazyId, type Spectator } from "@camel/game";
import { camelArt, groundArt, spectatorArt } from "./art.js";
import { DRAG_THRESHOLD, clamp, distance, midpoint, useElementSize, useTween, useWheel, wheelZoomFactor, type Point } from "./gestures.js";
import { BOARD_UNITS, MARGIN, camelHeading, cellCenter, cellGrid, displayCell, spriteDirection } from "./trackGeometry.js";

/**
 * 2.5D 赛道：CSS 3D 画地面、16 格赛道和中间的金字塔，可以拖动旋转、调倾角、缩放。
 * 骆驼和观众是始终正对镜头的立牌，按视角换 8 个朝向的贴图。
 *
 * 每只骆驼三层：位置层（跟着格子平移，带过渡）→ 立牌层（抵消场景旋转，拖动时不能有过渡）
 * → 抬升层（同一格里叠第几只，沿立牌自己的竖直方向往上错开，带过渡）。
 * 叠放写在立牌平面里，倾角怎么调，骆驼都正好压在下面那只背上。
 */

export interface DieFx {
  readonly key: number;
  readonly die: DieId;
  readonly value: number;
  readonly color?: CrazyId;
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
  /** 可以点的格子（放观众板时的合法格）。 */
  readonly selectableCells?: ReadonlySet<number>;
  readonly onCellClick?: (pos: number) => void;
  /** 金字塔可以点（轮到我时点它掷骰）。 */
  readonly pyramidActive?: boolean;
  readonly onPyramidClick?: () => void;
  readonly ownerName: (playerId: string) => string;
  readonly ownerColor: (playerId: string) => string;
  readonly myId: string;
  /** 叠在画面上的额外内容（例如提示条）。 */
  readonly overlay?: ReactNode;
}

interface View {
  spin: number;
  tilt: number;
  zoom: number;
  panX: number;
  panY: number;
}

const DEFAULT_VIEW: View = { spin: -24, tilt: 56, zoom: 1, panX: 0, panY: 0 };
const TILT_RANGE = [20, 72] as const;
const ZOOM_RANGE = [0.6, 3] as const;
const ZOOM_STEP = 1.4;
/** 透视距离 = 场景边长的这么多倍。 */
const PERSPECTIVE_RATIO = 2.4;

/** 金字塔：底边和高（单位：格）。 */
const PYRAMID_BASE = 2.3;
const PYRAMID_HEIGHT = 1.55;
/** 骆驼立牌的边长（格），以及叠放时每只往上错开多少（占立牌高度的比例）。 */
const CAMEL_SIZE = 1.12;
const STACK_LIFT = 0.36;
const SPECTATOR_SIZE = 0.9;

type Gesture =
  | { kind: "rotate" | "pan"; start: Point; view: View; moved: boolean; button: number }
  | { kind: "pinch"; startDistance: number; anchor: Point; view: View };

const CAMEL_NAMES: Record<CamelId, string> = {
  red: "红", yellow: "黄", blue: "蓝", green: "绿", purple: "紫", black: "黑", white: "白",
};
export const DIE_NAMES: Record<DieId, string> = { red: "红", yellow: "黄", blue: "蓝", green: "绿", purple: "紫", gray: "灰" };

function Track3D(props: Track3DProps) {
  const { stacks, spectators, walking, cheeringAt, dieFx, selectableCells, onCellClick, pyramidActive, onPyramidClick, ownerName, ownerColor, myId, overlay } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const frame = useElementSize(frameRef);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const tween = useTween<{ spin: number; tilt: number; zoom: number; panX: number; panY: number }>((value) => setView(value));

  // 按默认倾角定 1 倍大小：倾斜后地面在屏幕上变矮，金字塔和骆驼又往上冒一截。
  const defaultTilt = (DEFAULT_VIEW.tilt * Math.PI) / 180;
  const heightFactor = Math.cos(defaultTilt) * 1.05 + 0.32;
  const baseSize = Math.max(240, Math.min(frame.width * 0.86, (frame.height * 0.9) / heightFactor));
  const size = baseSize * view.zoom;
  const unit = size / BOARD_UNITS;

  const limit = (next: View): View => {
    const zoom = clamp(next.zoom, ZOOM_RANGE[0], ZOOM_RANGE[1]);
    const room = baseSize * zoom * 0.6;
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

  /** 转 90°：转到最近的整 45° 再加减，按钮转几次之后角度还是整齐的。 */
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

  /** 点击交给浏览器在 3D 里判定（只有一层地面，立牌都不接收点击）。 */
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

  // 立牌：抵消场景的 rotateX(tilt) rotateZ(spin)，正对镜头。
  const billboard = `rotateZ(${-view.spin}deg) rotateX(${-view.tilt}deg)`;
  const at = (x: number, y: number, z = 0) => `translate3d(${x * unit}px, ${y * unit}px, ${z * unit}px)`;
  /** 立牌的位置用场景边长的百分比：缩放时场景变大，百分比不变，不会触发 left/top 的过渡。 */
  const place = (x: number, y: number): CSSProperties => ({ left: `${(x / BOARD_UNITS) * 100}%`, top: `${(y / BOARD_UNITS) * 100}%` });
  /** 立牌贴图：底边中点落在锚点上。 */
  const standee = (sizeUnits: number): CSSProperties => ({ width: sizeUnits * unit, height: sizeUnits * unit, left: (-sizeUnits * unit) / 2, top: -sizeUnits * unit });

  // 每只骆驼所在的格子和高度（越线后的位置画回赛道上对应的格子）。
  const camels: { camel: CamelId; pos: number; height: number }[] = [];
  for (const [key, stack] of Object.entries(stacks)) {
    stack.forEach((camel, height) => camels.push({ camel, pos: Number(key), height }));
  }
  camels.sort((a, b) => a.camel.localeCompare(b.camel)); // 元素顺序固定，React 才能复用节点做过渡

  const cells = Array.from({ length: TRACK_LENGTH }, (_, index) => index + 1);
  const pyramidCenter = BOARD_UNITS / 2;
  const slant = Math.hypot(PYRAMID_HEIGHT, PYRAMID_BASE / 2);
  const elevation = (Math.atan2(PYRAMID_HEIGHT, PYRAMID_BASE / 2) * 180) / Math.PI;
  // 光从左上方来：四个面明暗不同，转动时跟着地面一起转。
  const faceShade = [0.78, 0.62, 0.9, 1];

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
      onPointerLeave={() => setHoverCell(null)}
      onContextMenu={(event) => event.preventDefault()}
      style={{ "--unit": `${unit}px` } as CSSProperties}
    >
      <div className="ct-panner" style={{ perspective: `${baseSize * PERSPECTIVE_RATIO * view.zoom}px`, transform: `translate(${view.panX}px, ${view.panY}px)` }}>
        <div
          className="ct-scene"
          style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, transform: `rotateX(${view.tilt}deg) rotateZ(${view.spin}deg)` }}
        >
          <div className="ct-ground" style={{ backgroundImage: `url(${groundArt.sand})`, backgroundSize: `${unit * 2}px ${unit * 2}px` }} />

          {cells.map((pos) => {
            const { col, row } = cellGrid(pos);
            const classes = ["ct-cell"];
            if (selectableCells?.has(pos)) classes.push("selectable");
            if (hoverCell === pos) classes.push("hover");
            return (
              <div
                key={pos}
                className={classes.join(" ")}
                data-cell={pos}
                style={{ left: (MARGIN + col) * unit, top: (MARGIN + row) * unit, width: unit, height: unit, backgroundImage: `url(${groundArt.tile})` }}
              >
                <span className="ct-cell-number">{pos}</span>
              </div>
            );
          })}

          {/* 终点线：在第 16 格和第 1 格之间 */}
          <div className="ct-finish" style={{ left: MARGIN * unit, top: (MARGIN + 1) * unit - unit * 0.07, width: unit, height: unit * 0.14 }} />

          {/* 观众板落在地上的那块底座：俯视时也看得出是哪一面 */}
          {spectators.map((spectator) => {
            const { col, row } = cellGrid(spectator.pos);
            return (
              <div
                key={`pad-${spectator.owner}`}
                className={`ct-spectator-pad ${spectator.side}`}
                style={{ left: (MARGIN + col + 0.12) * unit, top: (MARGIN + row + 0.12) * unit, width: unit * 0.76, height: unit * 0.76, borderColor: ownerColor(spectator.owner) }}
              />
            );
          })}

          {/* 金字塔：四个三角面 */}
          {[0, 1, 2, 3].map((side) => (
            <div
              key={side}
              className={pyramidActive ? "ct-pyramid-face active" : "ct-pyramid-face"}
              data-pyramid="1"
              style={{
                left: (pyramidCenter - PYRAMID_BASE / 2) * unit,
                top: (pyramidCenter - slant) * unit,
                width: PYRAMID_BASE * unit,
                height: slant * unit,
                backgroundImage: `url(${groundArt.brick})`,
                backgroundSize: `${unit * 0.75}px ${unit * 0.75}px`,
                "--shade": faceShade[side],
                transform: `rotateZ(${side * 90}deg) translateY(${(PYRAMID_BASE / 2) * unit}px) rotateX(${-elevation}deg)`,
              } as CSSProperties}
            />
          ))}

          {/* 观众立牌 */}
          {spectators.map((spectator) => {
            const center = cellCenter(spectator.pos);
            const art = spectatorArt[spectator.side];
            const cheering = cheeringAt !== undefined && displayCell(cheeringAt) === spectator.pos;
            return (
              <div key={`sp-${spectator.owner}`} className="ct-anchor" style={place(center.x, center.y + 0.28)}>
                <div className="ct-billboard" style={{ transform: billboard }}>
                  <div className={cheering ? "ct-spectator cheering" : "ct-spectator"} style={{ ...standee(SPECTATOR_SIZE), position: "absolute", backgroundImage: `url(${art})` }}>
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
            const center = cellCenter(pos);
            const direction = spriteDirection(camelHeading(camel, pos), view.spin);
            const art = camelArt(camel);
            const moving = walking.has(camel);
            const walk = moving ? art.walk?.[direction] : undefined;
            const sprite: CSSProperties = walk
              ? { backgroundImage: `url(${walk.url})`, backgroundSize: `${walk.frames * 100}% 100%`, "--frames": walk.frames } as CSSProperties
              : { backgroundImage: `url(${art.still[direction]})`, backgroundSize: "100% 100%" };
            return (
              <div key={camel} className="ct-anchor ct-camel-anchor" style={place(center.x, center.y + 0.12)}>
                <div className="ct-billboard" style={{ transform: billboard }}>
                  <div className="ct-lift" style={{ ...standee(CAMEL_SIZE), transform: `translateY(${-height * STACK_LIFT * 100}%) translateZ(${height * 2}px)` }}>
                    <div
                      className={["ct-camel", moving ? "walking" : "", walk ? "animated" : ""].join(" ")}
                      style={{ ...(art.filter ? { filter: art.filter } : {}), ...sprite }}
                      aria-label={`${CAMEL_NAMES[camel]}骆驼，第 ${displayCell(pos)} 格`}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* 掷出的骰子从金字塔顶冒出来 */}
          {dieFx && (
            <div key={dieFx.key} className="ct-anchor" style={{ transform: at(pyramidCenter, pyramidCenter, PYRAMID_HEIGHT) }}>
              <div className="ct-billboard" style={{ transform: billboard }}>
                <div className={`ct-die-fx die-${dieFx.die}`} style={{ "--die": `${Math.round(unit * 0.55)}px` } as CSSProperties}>
                  <span className={`ct-die die-${dieFx.color ?? dieFx.die}`}>{dieFx.value}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

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
