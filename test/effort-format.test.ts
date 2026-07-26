import { describe, expect, it } from "vite-plus/test";

import { formatEffortMetricValue } from "../src/effort-format.js";

describe("formatEffortMetricValue", () => {
  it("preserves enough precision to explain effort cost comparisons", () => {
    expect(formatEffortMetricValue("usd", 0.06902)).toBe("$0.069");
    expect(formatEffortMetricValue("usd", 0.07)).toBe("$0.070");
  });

  it("keeps existing precision outside the sub-dollar comparison range", () => {
    expect(formatEffortMetricValue("usd", undefined)).toBe("n/a");
    expect(formatEffortMetricValue("usd", Number.NaN)).toBe("n/a");
    expect(formatEffortMetricValue("usd", -0.01)).toBe("$-0.0100");
    expect(formatEffortMetricValue("usd", 0)).toBe("$0.00");
    expect(formatEffortMetricValue("usd", 0.0008)).toBe("$0.0008");
    expect(formatEffortMetricValue("usd", 0.01)).toBe("$0.010");
    expect(formatEffortMetricValue("usd", 0.9994)).toBe("$0.999");
    expect(formatEffortMetricValue("usd", 0.9995)).toBe("$1.00");
    expect(formatEffortMetricValue("usd", 1)).toBe("$1.00");
  });
});
