export const stockLabelOutputs = [
  { value: "pdf", label: "PDF — 100 × 50 mm, print at actual size" },
  { value: "zpl-8", label: "Zebra ZPL — 203 dpi / 8 dots per mm" },
  { value: "zpl-12", label: "Zebra ZPL — 300 dpi / 12 dots per mm" },
] as const;
export type StockLabelOutput = (typeof stockLabelOutputs)[number]["value"];
export type StockLabelInput = {
  revision: number;
  copies: number;
  output?: StockLabelOutput;
};
