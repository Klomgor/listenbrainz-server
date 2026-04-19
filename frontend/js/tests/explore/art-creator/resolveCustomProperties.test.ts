import { resolveCustomProperties } from "../../../src/explore/art-creator/utils";

describe("resolveCustomProperties", () => {
  it("resolves --lb-* custom properties in SVG string", () => {
    const input = `<svg style="--lb-text-color: #ff0000; --lb-bg-color-1: #00ff00; --lb-bg-color-2: #0000ff"><style>text { fill: var(--lb-text-color) !important; } stop:first-child { stop-color: var(--lb-bg-color-1) !important; } stop:nth-child(2) { stop-color: var(--lb-bg-color-2) !important; }</style></svg>`;

    const result = resolveCustomProperties(input);

    expect(result).toContain("fill: #ff0000");
    expect(result).toContain("stop-color: #00ff00");
    expect(result).toContain("stop-color: #0000ff");
    expect(result).not.toContain("var(--lb-");
  });

  it("strips !important from resolved SVG string", () => {
    const input = `<svg style="--lb-text-color: #ff0000"><style>text { fill: var(--lb-text-color) !important; }</style></svg>`;

    const result = resolveCustomProperties(input);

    expect(result).toContain("fill: #ff0000");
    expect(result).not.toContain("!important");
  });

  it("returns original string when no style attribute exists", () => {
    const input = `<svg><text>hello</text></svg>`;
    expect(resolveCustomProperties(input)).toBe(input);
  });

  it("returns original string when no --lb-* properties exist", () => {
    const input = `<svg style="fill: red"><text>hello</text></svg>`;
    const result = resolveCustomProperties(input);
    expect(result).not.toContain("var(--lb-");
    expect(result).not.toContain("!important");
  });

  it("handles multiple occurrences of the same variable", () => {
    const input = `<svg style="--lb-text-color: #ff0000"><style>text { fill: var(--lb-text-color); } .accent { fill: var(--lb-text-color); }</style></svg>`;

    const result = resolveCustomProperties(input);

    expect(result).not.toContain("var(--lb-text-color)");
    // 3 occurrences: 1 in style attribute definition + 2 resolved references
    expect((result.match(/#ff0000/g) || []).length).toBe(3);
  });

  it("handles color values with spaces (e.g. rgb())", () => {
    const input = `<svg style="--lb-text-color: rgb(255, 0, 0)"><style>text { fill: var(--lb-text-color); }</style></svg>`;

    const result = resolveCustomProperties(input);

    expect(result).toContain("fill: rgb(255, 0, 0)");
    expect(result).not.toContain("var(--lb-text-color)");
  });
});
