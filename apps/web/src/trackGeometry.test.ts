import { describe, expect, it } from "vitest";
import { camelHeading, cellCenter, cellGrid, displayCell, spriteDirection, stepPath } from "./trackGeometry.js";

describe("赛道几何", () => {
  it("16 格按顺时针排在 5×5 外圈上，相邻格在方阵里也相邻", () => {
    const seen = new Set<string>();
    for (let pos = 1; pos <= 16; pos += 1) {
      const a = cellGrid(pos);
      const b = cellGrid(pos + 1);
      expect(Math.abs(a.col - b.col) + Math.abs(a.row - b.row)).toBe(1);
      seen.add(`${a.col},${a.row}`);
    }
    expect(seen.size).toBe(16);
    expect(cellGrid(1)).toEqual({ col: 0, row: 0 });
    expect(cellGrid(9)).toEqual({ col: 4, row: 4 });
    expect(cellCenter(1)).toEqual({ x: 1.5, y: 1.5 });
  });

  it("越线后的位置画回对应的格子", () => {
    expect(displayCell(17)).toBe(1);
    expect(displayCell(18)).toBe(2);
    expect(displayCell(0)).toBe(16);
    expect(displayCell(-1)).toBe(15);
  });

  it("赛跑骆驼朝下一格，疯狂骆驼朝上一格", () => {
    for (let pos = 1; pos <= 16; pos += 1) {
      const here = cellCenter(pos);
      const ahead = cellCenter(pos + 1);
      const behind = cellCenter(pos - 1);
      const angle = (to: { x: number; y: number }) => ((Math.round((Math.atan2(to.y - here.y, to.x - here.x) * 180) / Math.PI) % 360) + 360) % 360;
      expect(camelHeading("red", pos)).toBe(angle(ahead));
      expect(camelHeading("black", pos)).toBe(angle(behind));
    }
  });

  it("按视角选贴图方向", () => {
    expect(spriteDirection(0, 0)).toBe("east");
    expect(spriteDirection(90, 0)).toBe("south");
    expect(spriteDirection(0, 90)).toBe("south");
    expect(spriteDirection(270, -20)).toBe("north");
    expect(spriteDirection(0, -45)).toBe("north-east");
    expect(spriteDirection(180, 400)).toBe("north-west");
    expect(spriteDirection(180, -45)).toBe("south-west");
  });

  it("移动路径一格一格走，含绕回", () => {
    expect(stepPath(4, 7, 1)).toEqual([5, 6, 7]);
    expect(stepPath(9, 7, -1)).toEqual([8, 7]);
    expect(stepPath(2, 15, -1)).toEqual([1, 0, -1]);
    expect(stepPath(15, 18, 1)).toEqual([16, 17, 18]);
  });
});
