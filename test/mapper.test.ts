import { describe, it, expect } from "vitest";
import { parseScale } from "../src/scl.js";
import { frequencyOf, frequencyRange, compareScales } from "../src/mapper.js";
import { floorDiv, freqClose } from "../src/mathUtil.js";
import { ScaleError } from "../src/errors.js";

const pyth = parseScale("Pyth\n 2\n3/2\n2/1\n");
const base = { originKey: 0, referenceKey: 0, referenceHz: 440 };

describe("floorDiv 欧几里得除法", () => {
  it("正差值", () => {
    expect(floorDiv(3, 2)).toEqual({ q: 1, r: 1 });
  });
  it("负差值向下取整而非截断", () => {
    expect(floorDiv(-1, 2)).toEqual({ q: -1, r: 1 });
    expect(floorDiv(-2, 2)).toEqual({ q: -1, r: 0 });
    expect(floorDiv(-3, 2)).toEqual({ q: -2, r: 1 });
  });
});

describe("基本频率映射", () => {
  it("键 1/2/-1 分别为 660/880/330", () => {
    expect(frequencyOf(pyth, base, 1).frequency).toBeCloseTo(660, 6);
    expect(frequencyOf(pyth, base, 2).frequency).toBeCloseTo(880, 6);
    expect(frequencyOf(pyth, base, -1).frequency).toBeCloseTo(330, 6);
  });

  it("负多周期正确", () => {
    expect(frequencyOf(pyth, base, -3).frequency).toBeCloseTo(165, 6);
    expect(frequencyOf(pyth, base, -3)).toMatchObject({ periodIndex: -2, degree: 1 });
  });

  it("相隔 N 键频率比等于周期", () => {
    for (const k of [-7, -1, 0, 5, 30]) {
      const a = frequencyOf(pyth, base, k).frequency;
      const b = frequencyOf(pyth, base, k + 2).frequency;
      expect(b / a).toBeCloseTo(2, 9);
    }
  });

  it("周期起点 K 可平移", () => {
    const shifted = { originKey: 9, referenceKey: 9, referenceHz: 440 };
    expect(frequencyOf(pyth, shifted, 10).frequency).toBeCloseTo(660, 6);
    expect(frequencyOf(pyth, shifted, 8).frequency).toBeCloseTo(330, 6);
  });

  it("参考键 R 不是周期起点时按同一比值归一", () => {
    const r1 = { originKey: 0, referenceKey: 1, referenceHz: 660 };
    expect(frequencyOf(pyth, r1, 0).frequency).toBeCloseTo(440, 6);
    expect(frequencyOf(pyth, r1, 2).frequency).toBeCloseTo(880, 6);
    expect(frequencyOf(pyth, r1, -1).frequency).toBeCloseTo(330, 6);
  });

  it("整体更换参考 Hz 只等比缩放", () => {
    const doubled = { ...base, referenceHz: 880 };
    for (const k of [-3, 0, 1, 4]) {
      expect(frequencyOf(pyth, doubled, k).frequency).toBeCloseTo(
        2 * frequencyOf(pyth, base, k).frequency,
        6
      );
    }
  });

it("N=1 周期三比一", () => {
    const triple = parseScale("t\n 1\n3/1\n");
    const cfg = { originKey: 0, referenceKey: 0, referenceHz: 100 };
    expect(frequencyOf(triple, cfg, 1).frequency).toBeCloseTo(300, 6);
    expect(frequencyOf(triple, cfg, -1).frequency).toBeCloseTo(100 / 3, 6);
    expect(frequencyOf(triple, cfg, -2).frequency).toBeCloseTo(100 / 9, 6);
  });

  it("区间查询", () => {
    const range = frequencyRange(pyth, base, -1, 2);
    expect(range.count).toBe(4);
    expect(range.results.map((r) => r.frequency)).toEqual(
      expect.arrayContaining([330, 440, 660, 880])
    );
  });

  it("非整数键与非法 Hz 被拒绝", () => {
    expect(() => frequencyOf(pyth, base, 1.5)).toThrow(ScaleError);
    expect(() => frequencyOf(pyth, { ...base, referenceHz: 0 }, 1)).toThrow(ScaleError);
    expect(() => frequencyOf(pyth, { ...base, referenceHz: NaN }, 1)).toThrow(ScaleError);
  });

  it("溢出与下溢被诊断", () => {
    const triple = parseScale("t\n 1\n2/1\n");
    const cfg = { originKey: 0, referenceKey: 0, referenceHz: 440 };
    expect(() => frequencyOf(triple, cfg, 20000)).toThrowError(
      expect.objectContaining({ code: "FREQUENCY_OVERFLOW" })
    );
    expect(() => frequencyOf(triple, cfg, -20000)).toThrowError(
      expect.objectContaining({ code: "FREQUENCY_UNDERFLOW" })
    );
  });
});

describe("音阶比较", () => {
  it("十二平均律与纯律在同名键上产生音分差", () => {
    const eq12 = parseScale(
      "12tet\n 12\n100.0\n200.0\n300.0\n400.0\n500.0\n600.0\n700.0\n800.0\n900.0\n1000.0\n1100.0\n1200.0\n"
    );
    const just = parseScale(
      "just\n 12\n100.0\n16/15\n9/8\n6/5\n5/4\n4/3\n45/32\n3/2\n8/5\n5/3\n9/5\n15/8\n"
    );
    const result = compareScales(
      { name: "a", parsed: eq12, config: base },
      { name: "b", parsed: just, config: base },
      0,
      12
    );
    const third = result.rows.find((r) => r.key === 3)!;
    expect(Math.abs(third.centsDifference)).toBeGreaterThan(5);
    expect(freqClose(result.rows[0].leftHz, result.rows[0].rightHz)).toBe(true);
  });
});
