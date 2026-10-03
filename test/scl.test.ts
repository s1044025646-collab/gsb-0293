import { describe, it, expect } from "vitest";
import { parseScale, validateScale } from "../src/scl.js";
import { ScaleError } from "../src/errors.js";

describe("parseScale 基础语法", () => {
  it("解析两个声明音程 3/2、2/1，隐含首级 1/1", () => {
    const s = parseScale("desc\n 2\n3/2\n2/1\n");
    expect(s.count).toBe(2);
    expect(s.period).toBe(2);
    expect(s.degreeRatios).toEqual([1, 1.5]);
  });

  it("支持注释、行尾注释与空行", () => {
    const text = "! 注释\n\n描述!\n 2  ! c\n3/2  name\n2/1\n";
    expect(parseScale(text).count).toBe(2);
  });

  it("整数按频率比而非音分解释", () => {
    const s = parseScale("d\n 1\n2\n");
    expect(s.intervals[0].ratio).toBe(2);
    expect(s.intervals[0].kind).toBe("integer");
  });

  it("小数按音分 2^(cents/1200) 换算", () => {
    const s = parseScale("d\n 1\n1200.0\n");
    expect(s.intervals[0].ratio).toBeCloseTo(2, 10);
    expect(s.intervals[0].kind).toBe("cents");
  });

  it("N=1，周期即唯一声明行", () => {
    const s = parseScale("d\n 1\n3/1\n");
    expect(s.count).toBe(1);
    expect(s.period).toBe(3);
    expect(s.degreeRatios).toEqual([1]);
  });

  it("音分表示与分数表示等价", () => {
    const a = parseScale("d\n 1\n3/1\n");
    const b = parseScale("d\n 1\n1901.9550008653875\n");
    expect(b.period).toBeCloseTo(a.period, 8);
  });
});

describe("parseScale 拒绝非法输入", () => {
  const cases: [string, string][] = [
    ["计数不符", "d\n 3\n3/2\n2/1\n"],
    ["零分母", "d\n 2\n3/0\n2/1\n"],
    ["非递增", "d\n 2\n2/1\n3/2\n"],
    ["相等非严格递增", "d\n 2\n3/2\n3/2\n"],
    ["周期不大于1", "d\n 1\n1/1\n"],
    ["负音分", "d\n 1\n-200.0\n"],
    ["扩展语法指数", "d\n 1\n2^3\n"],
    ["多个斜杠", "d\n 1\n1/2/3\n"],
    ["空文本", ""],
    ["N=0", "d\n 0\n"]
  ];
  for (const [name, text] of cases) {
    it(`拒绝：${name}`, () => {
      expect(() => parseScale(text)).toThrow(ScaleError);
    });
  }

  it("N 超过 128 被拒绝", () => {
    const lines = Array.from({ length: 129 }, (_, i) => String((i + 1) * 10));
    const text = `d\n 129\n${lines.join("\n")}\n`;
    expect(() => parseScale(text)).toThrowError(/128/);
  });

  it("validateScale 返回摘要", () => {
    const result = validateScale("d\n 2\n3/2\n2/1\n");
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
  });
});
