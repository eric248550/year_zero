/**
 * Chart palette validated for the dark surface (#111513) with the dataviz
 * validator: lightness band, chroma floor, CVD separation, contrast all pass.
 * These are darker than the UI accent tokens on purpose. Lives outside the
 * "use client" chart module so server components can use the colours too.
 */
export const CHART = {
  food: "#7aa138",
  water: "#2b9cb2",
  materials: "#cf6a3c",
  knowledge: "#7a86e6",
  runA: "#c48217",
  runB: "#2b9cb2",
  grid: "#1f2622",
  axis: "#74807a",
  ink: "#e8ece6",
  ink2: "#aab4ac",
  surface: "#161b18",
} as const;
