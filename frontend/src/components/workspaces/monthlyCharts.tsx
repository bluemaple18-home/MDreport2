import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MonthlyChartMetricRow, MonthlyChartsSnapshot, MonthlyNetworkUsageRow } from "../../types";
import { formatAmount, formatNumber, formatPercent } from "../../utils/format";
import { DataStateBlock } from "../ui";

type Props = {
  snapshot?: MonthlyChartsSnapshot;
  busy: boolean;
};

type ChartSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
  formatter: (value: unknown) => string;
};

type LegendItem = {
  label: string;
  color: string;
  kind?: "bar" | "line";
};

const BLUE = "#4472c4";
const ORANGE = "#ed7d31";
const YELLOW = "#ffc000";
const GRAY = "#a5a5a5";
const RED = "#e60000";
const FORMAT_COLORS = [BLUE, ORANGE, GRAY, YELLOW, "#70ad47", "#5b9bd5", "#9966cc"];

const FORMAT_LABELS: Record<string, string> = {
  "一般廣告": "展示型",
  "創意廣告": "創意型",
  "影音摩天": "影音型",
  "preroll": "影音型",
  "DOOH北流": "DOOH",
};

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function monthLabel(month: string): string {
  const parts = month.split("-");
  return parts.length === 2 ? `${Number(parts[1])}月` : month;
}

function formatFormatName(name: unknown): string {
  const text = String(name || "");
  return FORMAT_LABELS[text] || text || "未分類";
}

function formatWan(value: unknown): string {
  return `${formatNumber(Math.round(n(value) / 10000))} 萬`;
}

function formatWholeRate(numerator: unknown, denominator: unknown): string {
  const den = n(denominator);
  if (den <= 0) return "-";
  return `${Math.round((n(numerator) / den) * 100)}%`;
}

function metricRate(row: MonthlyChartMetricRow): number {
  const request = n(row.request);
  return request > 0 ? (n(row.impress) / request) * 100 : 0;
}

function rowsForMonths<T extends { month?: string }>(rows: T[], months: string[]): T[] {
  const monthSet = new Set(months);
  return rows.filter((row) => monthSet.has(String(row.month || "")));
}

function niceWanStep(maxWan: number, intervals = 4): number {
  const rawStep = Math.max(1, maxWan / intervals);
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const ratio = rawStep / power;
  if (ratio <= 1) return power;
  if (ratio <= 2) return 2 * power;
  if (ratio <= 2.5) return 2.5 * power;
  if (ratio <= 5) return 5 * power;
  return 10 * power;
}

function compactWanAxisMax(maxWan: number): number {
  const padded = Math.max(1, maxWan * 1.08);
  const power = 10 ** Math.floor(Math.log10(padded));
  const ratio = padded / power;
  let roundedRatio = 10;
  if (ratio <= 1.2) roundedRatio = 1.2;
  else if (ratio <= 1.5) roundedRatio = 1.5;
  else if (ratio <= 2) roundedRatio = 2;
  else if (ratio <= 2.5) roundedRatio = 2.5;
  else if (ratio <= 3) roundedRatio = 3;
  else if (ratio <= 4) roundedRatio = 4;
  else if (ratio <= 5) roundedRatio = 5;
  else if (ratio <= 6) roundedRatio = 6;
  else if (ratio <= 8) roundedRatio = 8;
  return roundedRatio * power;
}

function pathFromValues(values: number[], xForIndex: (index: number) => number, yForValue: (value: number) => number): string {
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${xForIndex(index).toFixed(2)} ${yForValue(value).toFixed(2)}`)
    .join(" ");
}

const COPY_STYLE = `
  .monthly-copy-payload{font-family:Arial,"Microsoft JhengHei",sans-serif;color:#111;background:#fff}
  .monthly-copy-payload h3{font-size:22px;margin:0 0 8px;font-weight:400}
  .monthly-copy-payload table{border-collapse:collapse;width:100%;font-size:16px;font-weight:400}
  .monthly-copy-payload th,.monthly-copy-payload td{border:1px solid #d9d9d9;padding:7px 10px;text-align:center}
  .monthly-copy-payload svg{max-width:100%;height:auto}
  .monthly-copy-payload .monthly-chart-table-wrap{max-height:none;overflow:visible}
`;

function collectDocumentCss(): string {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");
}

async function imageFromSvg(svg: string): Promise<HTMLImageElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("copy image render failed"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderSvgElementToPngBlob(svgEl: SVGSVGElement): Promise<Blob> {
  const rect = svgEl.getBoundingClientRect();
  const viewBox = svgEl.viewBox.baseVal;
  const width = Math.max(1, Math.ceil(rect.width || viewBox.width || 960));
  const height = Math.max(1, Math.ceil(rect.height || viewBox.height || 540));
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `${collectDocumentCss()}\n${COPY_STYLE}`;
  defs.appendChild(style);
  clone.insertBefore(defs, clone.firstChild);
  const markup = new XMLSerializer().serializeToString(clone);
  const image = await imageFromSvg(markup);
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("copy canvas unavailable");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("copy image encode failed"));
      }
    }, "image/png");
  });
}

function normalizeCanvasColor(value: string): string {
  return value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent" ? value : "#ffffff";
}

function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}...`;
}

async function renderTableElementToPngBlob(table: HTMLTableElement): Promise<Blob> {
  await document.fonts?.ready.catch(() => undefined);
  const rows = Array.from(table.rows);
  const colCount = Math.max(1, ...rows.map((row) => row.cells.length));
  const colWidths = Array.from({ length: colCount }, (_, columnIndex) => {
    const widths = rows.map((row) => Math.ceil(row.cells[columnIndex]?.getBoundingClientRect().width || 0));
    return Math.max(72, ...widths);
  });
  const rowHeights = rows.map((row) => Math.max(32, Math.ceil(row.getBoundingClientRect().height || 0)));
  const width = colWidths.reduce((sum, value) => sum + value, 0);
  const height = rowHeights.reduce((sum, value) => sum + value, 0);
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("copy canvas unavailable");
  }
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  rows.forEach((row, rowIndex) => {
    let x = 0;
    Array.from(row.cells).forEach((cell, columnIndex) => {
      const cellWidth = colWidths[columnIndex] || 72;
      const cellHeight = rowHeights[rowIndex] || 32;
      const style = window.getComputedStyle(cell);
      ctx.fillStyle = normalizeCanvasColor(style.backgroundColor);
      ctx.fillRect(x, y, cellWidth, cellHeight);
      ctx.strokeStyle = style.borderBottomColor || "#d9d9d9";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cellWidth, cellHeight);
      const fontSize = Math.max(12, Number.parseFloat(style.fontSize) || 16);
      ctx.font = `400 ${fontSize}px Arial, "Microsoft JhengHei", sans-serif`;
      ctx.fillStyle = normalizeCanvasColor(style.color || "#111111");
      ctx.textBaseline = "middle";
      const paddingX = 10;
      const align = style.textAlign === "right" ? "right" : style.textAlign === "left" ? "left" : "center";
      ctx.textAlign = align;
      const textX = align === "right" ? x + cellWidth - paddingX : align === "left" ? x + paddingX : x + cellWidth / 2;
      ctx.fillText(fitCanvasText(ctx, cell.textContent?.trim() || "", cellWidth - paddingX * 2), textX, y + cellHeight / 2);
      x += cellWidth;
    });
    y += rowHeights[rowIndex] || 32;
  });
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("copy table image encode failed"));
      }
    }, "image/png");
  });
}

async function renderNetworkSummaryElementToPngBlob(el: HTMLElement): Promise<Blob> {
  await document.fonts?.ready.catch(() => undefined);
  const table = (el.matches(".monthly-network-summary-table") ? el : el.querySelector(".monthly-network-summary-table")) as HTMLElement | null;
  if (!table) {
    throw new Error("network summary table unavailable");
  }
  const tableRect = table.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(Math.max(table.scrollWidth, tableRect.width)));
  const height = Math.max(1, Math.ceil(Math.max(table.scrollHeight, tableRect.height)));
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("copy canvas unavailable");
  }
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  Array.from(table.children).forEach((child) => {
    const cell = child as HTMLElement;
    const rect = cell.getBoundingClientRect();
    const x = rect.left - tableRect.left;
    const y = rect.top - tableRect.top;
    const cellWidth = rect.width;
    const cellHeight = rect.height;
    const style = window.getComputedStyle(cell);
    ctx.fillStyle = normalizeCanvasColor(style.backgroundColor);
    ctx.fillRect(x, y, cellWidth, cellHeight);
    ctx.strokeStyle = style.borderBottomColor || "#000000";
    ctx.lineWidth = Math.max(1, Number.parseFloat(style.borderBottomWidth) || 1);
    ctx.strokeRect(x, y, cellWidth, cellHeight);

    const text = cell.textContent?.trim() || "";
    const fontSize = Math.max(12, Number.parseFloat(style.fontSize) || 24);
    ctx.font = `400 ${fontSize}px Arial, "Microsoft JhengHei", sans-serif`;
    ctx.textBaseline = "middle";
    const align = style.justifyContent === "flex-start" || style.textAlign === "left" ? "left" : "center";
    ctx.textAlign = align;
    const paddingX = Math.max(10, Number.parseFloat(style.paddingLeft) || 10);
    const textX = align === "left" ? x + paddingX : x + cellWidth / 2;
    const textY = y + cellHeight / 2 + 1;
    const fitted = fitCanvasText(ctx, text, cellWidth - paddingX * 2);
    if (cell.querySelector("mark")) {
      const metrics = ctx.measureText(fitted);
      const markWidth = Math.min(cellWidth - paddingX * 2, metrics.width + 8);
      const markX = align === "left" ? textX - 4 : textX - markWidth / 2;
      ctx.fillStyle = "#ffff00";
      ctx.fillRect(markX, textY - fontSize / 2 - 2, markWidth, fontSize + 4);
    }
    ctx.fillStyle = normalizeCanvasColor(style.color || "#111111");
    ctx.fillText(fitted, textX, textY);
  });

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("copy network summary image encode failed"));
      }
    }, "image/png");
  });
}

async function renderElementToPngBlob(el: HTMLElement): Promise<Blob> {
  if (el.querySelector(".monthly-network-summary-table") || el.matches(".monthly-network-summary-table")) {
    return renderNetworkSummaryElementToPngBlob(el);
  }
  const svgOnly = el.querySelector("svg");
  if (svgOnly && !el.querySelector("table")) {
    return renderSvgElementToPngBlob(svgOnly as SVGSVGElement);
  }
  const table = el.querySelector("table");
  if (table) {
    return renderTableElementToPngBlob(table as HTMLTableElement);
  }
  await document.fonts?.ready.catch(() => undefined);
  const rect = el.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(Math.max(el.scrollWidth, rect.width)));
  const clone = el.cloneNode(true) as HTMLElement;
  const measureRoot = document.createElement("div");
  measureRoot.className = "monthly-copy-payload";
  measureRoot.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${width}px`,
    "background:#fff",
    "color:#111",
    "padding:12px",
    "box-sizing:border-box",
    "font-family:Arial,\"Microsoft JhengHei\",sans-serif",
    "z-index:-1",
  ].join(";");
  measureRoot.appendChild(clone);
  document.body.appendChild(measureRoot);
  try {
    const height = Math.max(1, Math.ceil(measureRoot.scrollHeight));
    const css = `${collectDocumentCss()}\n${COPY_STYLE}`;
    const style = document.createElement("style");
    style.textContent = css;
    const renderRoot = document.createElement("div");
    renderRoot.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    renderRoot.className = "monthly-copy-payload";
    renderRoot.style.cssText = [
      `width:${width}px`,
      `min-height:${height}px`,
      "background:#fff",
      "color:#111",
      "padding:12px",
      "box-sizing:border-box",
      "font-family:Arial,\"Microsoft JhengHei\",sans-serif",
    ].join(";");
    renderRoot.appendChild(style);
    renderRoot.appendChild(measureRoot.firstElementChild?.cloneNode(true) || document.createElement("div"));
    const markup = new XMLSerializer().serializeToString(renderRoot);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<foreignObject width="100%" height="100%">${markup}</foreignObject>`,
      "</svg>",
    ].join("");
    const image = await imageFromSvg(svg);
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("copy canvas unavailable");
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("copy image encode failed"));
        }
      }, "image/png");
    });
  } finally {
    measureRoot.remove();
  }
}

function AssetGroup({
  titlePrefix,
  titleHighlight,
  titleSuffix = "",
  children,
  className = "",
}: {
  titlePrefix: string;
  titleHighlight: string;
  titleSuffix?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`monthly-asset-group ${className}`}>
      <header className="monthly-asset-header">
        <div>
          <h2>
            {titlePrefix}
            <em>{titleHighlight}</em>
            {titleSuffix}
          </h2>
        </div>
      </header>
      <div className="monthly-asset-body">{children}</div>
    </section>
  );
}

function CopyableAsset({
  id,
  title,
  copied,
  onCopy,
  toolbar,
  children,
}: {
  id: string;
  title: string;
  copied: boolean;
  onCopy: (id: string) => void;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="monthly-copyable-asset">
      <header className="monthly-copyable-header">
        <h3>{title}</h3>
        <button type="button" className="monthly-copy-button" onClick={() => onCopy(id)}>
          {copied ? "已複製圖片" : "複製圖片"}
        </button>
      </header>
      {toolbar ? <div className="monthly-copyable-toolbar">{toolbar}</div> : null}
      <div id={id} className="monthly-copyable-body">
        {children}
      </div>
    </section>
  );
}

function SvgLegend({
  items,
  x,
  y,
  itemWidth = 132,
  columns,
  rowHeight = 26,
}: {
  items: LegendItem[];
  x: number;
  y: number;
  itemWidth?: number;
  columns?: number;
  rowHeight?: number;
}) {
  return (
    <g className="monthly-svg-legend">
      {items.map((item, index) => {
        const itemX = x + (columns ? index % columns : index) * itemWidth;
        const itemY = y + (columns ? Math.floor(index / columns) * rowHeight : 0);
        return (
          <g key={`${item.label}-${index}`} transform={`translate(${itemX} ${itemY})`}>
            {item.kind === "line" ? (
              <>
                <line x1={0} x2={24} y1={0} y2={0} stroke={item.color} className="monthly-svg-legend-line" />
                <circle cx={12} cy={0} r={4} fill={item.color} />
              </>
            ) : (
              <rect x={0} y={-8} width={18} height={16} fill={item.color} />
            )}
            <text x={30} y={6}>{item.label}</text>
          </g>
        );
      })}
    </g>
  );
}

function ComboChartWithTable({
  title,
  months,
  bars,
  line,
  lineDomain,
}: {
  title: string;
  months: string[];
  bars: ChartSeries[];
  line: ChartSeries;
  lineDomain?: [number, number];
}) {
  const width = 980;
  const height = 410;
  const left = 138;
  const right = 94;
  const top = 26;
  const bottom = 102;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const groups = Math.max(months.length, 1);
  const maxBar = Math.max(1, ...bars.flatMap((series) => series.values));
  const lineMin = lineDomain?.[0] ?? Math.max(0, Math.min(...line.values, 0) * 0.9);
  const lineMax = lineDomain?.[1] ?? Math.max(1, Math.max(...line.values, 1) * 1.1);
  const groupW = plotW / groups;
  const barW = Math.min(54, (groupW * 0.58) / Math.max(1, bars.length));
  const groupX = (index: number) => left + groupW * index + groupW / 2;
  const yBar = (value: number) => top + plotH - (Math.max(value, 0) / maxBar) * plotH;
  const yLine = (value: number) => top + plotH - ((value - lineMin) / Math.max(lineMax - lineMin, 1)) * plotH;

  return (
    <div className="monthly-slide-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = top + (plotH / 4) * tick;
          const value = maxBar - (maxBar / 4) * tick;
          return (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y} y2={y} className="monthly-slide-grid" />
              <text x={left - 12} y={y + 5} textAnchor="end" className="monthly-slide-axis">
                {formatNumber(Math.round(value))}
              </text>
            </g>
          );
        })}
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = top + (plotH / 4) * tick;
          const value = lineMax - ((lineMax - lineMin) / 4) * tick;
          return (
            <text key={tick} x={width - right + 14} y={y + 5} className="monthly-slide-axis">
              {formatPercent(value)}
            </text>
          );
        })}
        {months.map((month, monthIndex) => (
          <g key={month}>
            {bars.map((series, seriesIndex) => {
              const x = groupX(monthIndex) - (barW * bars.length) / 2 + seriesIndex * barW;
              const y = yBar(series.values[monthIndex] || 0);
              return (
                <rect
                  key={series.key}
                  x={x}
                  y={y}
                  width={barW * 0.86}
                  height={top + plotH - y}
                  fill={series.color}
                />
              );
            })}
            <text x={groupX(monthIndex)} y={top + plotH + 36} textAnchor="middle" className="monthly-slide-month">
              {month.slice(0, 7)}
            </text>
          </g>
        ))}
        <path
          d={pathFromValues(line.values, groupX, yLine)}
          fill="none"
          stroke={line.color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <SvgLegend
          x={left + 80}
          y={height - 28}
          itemWidth={170}
          items={[
            ...bars.map((series) => ({ label: series.label, color: series.color, kind: "bar" as const })),
            { label: line.label, color: line.color, kind: "line" },
          ]}
        />
      </svg>
    </div>
  );
}

function ChartDataTable({ months, rows }: { months: string[]; rows: ChartSeries[] }) {
  return (
    <div className="monthly-slide-data-table">
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th>
                <i style={{ background: row.color }} />
                {row.label}
              </th>
              {months.map((month, index) => (
                <td key={month}>{row.formatter(row.values[index] || 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StackedBarsChart({
  title,
  months,
  rows,
  metric,
}: {
  title: string;
  months: string[];
  rows: MonthlyNetworkUsageRow[];
  metric: "dailyRequest" | "dailyImpress";
}) {
  const width = 620;
  const height = 360;
  const left = 88;
  const top = 34;
  const bottom = 82;
  const plotW = width - left - 34;
  const plotH = height - top - bottom;
  const maxValue = Math.max(1, ...rows.map((row) => n(row.main?.[metric]) + n(row.child?.[metric])));
  const yMaxWan = compactWanAxisMax(maxValue / 10000);
  const tickStepWan = yMaxWan / 4;
  const yMaxValue = yMaxWan * 10000;
  const groupW = plotW / Math.max(months.length, 1);
  const barW = Math.min(82, groupW * 0.52);

  return (
    <div className="monthly-stacked-card">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <text x={left - 12} y={18} textAnchor="end" className="monthly-slide-axis monthly-axis-unit">
          單位：萬
        </text>
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = top + (plotH / 4) * tick;
          const valueWan = yMaxWan - tickStepWan * tick;
          return (
            <g key={tick}>
              <line x1={left} x2={width - 20} y1={y} y2={y} className="monthly-slide-grid" />
              <text x={left - 10} y={y + 5} textAnchor="end" className="monthly-slide-axis">
                {formatNumber(Math.round(valueWan))}
              </text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const mainValue = n(row.main?.[metric]);
          const childValue = n(row.child?.[metric]);
          const mainH = (mainValue / yMaxValue) * plotH;
          const childH = (childValue / yMaxValue) * plotH;
          const x = left + groupW * index + groupW / 2 - barW / 2;
          const yMain = top + plotH - mainH;
          const yChild = yMain - childH;
          const totalValue = mainValue + childValue;
          const latest = index === rows.length - 1;
          return (
            <g key={row.month}>
              {latest ? <rect x={x - 18} y={yChild - 18} width={barW + 36} height={mainH + childH + 36} fill="none" stroke={RED} strokeWidth={4} /> : null}
              <rect x={x} y={yMain} width={barW} height={mainH} fill={BLUE} />
              {childH > 0 ? <rect x={x} y={yChild} width={barW} height={childH} fill={ORANGE} /> : null}
              <text x={x + barW / 2} y={yMain + mainH / 2 + 6} textAnchor="middle" className="monthly-stacked-main-label">
                {formatNumber(Math.round(mainValue / 10000))}
              </text>
              {childH > 0 ? (
                <text x={x + barW / 2} y={yChild + childH / 2 + 6} textAnchor="middle" className="monthly-stacked-child-label">
                  {formatNumber(Math.round(childValue / 10000))}
                </text>
              ) : null}
              <text x={x + barW / 2} y={yChild - 10} textAnchor="middle" className="monthly-stacked-total-label">
                {formatNumber(Math.round(totalValue / 10000))}萬
              </text>
              <text x={x + barW / 2} y={top + plotH + 36} textAnchor="middle" className="monthly-slide-axis">
                {months[index]}
              </text>
            </g>
          );
        })}
        <SvgLegend
          x={left + 72}
          y={height - 28}
          itemWidth={142}
          items={[
            { label: "主聯播網", color: BLUE },
            { label: "子聯播網", color: ORANGE },
          ]}
        />
      </svg>
    </div>
  );
}

function NetworkUsageSummaryTable({
  months,
  monthly,
  rows,
}: {
  months: string[];
  monthly: MonthlyChartMetricRow[];
  rows: MonthlyNetworkUsageRow[];
}) {
  const monthlyByMonth = new Map(monthly.map((row) => [row.month, row]));
  const usageByMonth = new Map(rows.map((row) => [row.month, row]));
  const valueFor = (month: string, section: "total" | "tw" | "main" | "child", metric: "dailyRequest" | "dailyImpress") => {
    if (section === "total") {
      return n(monthlyByMonth.get(month)?.[metric]);
    }
    const usage = usageByMonth.get(month);
    const source = section === "tw" ? usage?.tw || usage?.total : usage?.[section];
    return n(source?.[metric]);
  };
  const fillRateFor = (month: string, section: "total" | "tw" | "main" | "child") => {
    const request = valueFor(month, section, "dailyRequest");
    const impress = valueFor(month, section, "dailyImpress");
    return formatWholeRate(impress, request);
  };
  const twShareFor = (month: string) => {
    const totalRequest = valueFor(month, "total", "dailyRequest");
    const twRequest = valueFor(month, "tw", "dailyRequest");
    const twShare = totalRequest > 0 ? Math.round((twRequest / totalRequest) * 100) : 0;
    return `${twShare}%：${Math.max(0, 100 - twShare)}%`;
  };
  const cells = (render: (month: string) => ReactNode, className = "") =>
    months.map((month) => (
      <div key={month} className={className}>
        {render(month)}
      </div>
    ));
  const englishMonthLabel = (month: string) => {
    const labels = ["Jan.", "Feb.", "Mar.", "Apr.", "May.", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
    const index = Number(month.slice(5, 7)) - 1;
    return labels[index] || month;
  };

  return (
    <div
      className="monthly-network-summary-table"
      role="table"
      aria-label="每月整體流量分析表"
      style={{ gridTemplateColumns: `minmax(190px, 1.25fr) repeat(${Math.max(months.length, 1)}, minmax(130px, 1fr))` }}
    >
      <div className="monthly-network-year">2026</div>
      {months.map((month) => (
        <div key={month} className="monthly-network-month">
          {englishMonthLabel(month)}
        </div>
      ))}
      <div className="monthly-network-section">Total</div>
      <div className="monthly-network-row-label">Ave.日請求</div>
      {cells((month) => <span>{formatWan(valueFor(month, "total", "dailyRequest"))}</span>)}
      <div className="monthly-network-row-label">Ave.日使用imps</div>
      {cells((month) => <span>{formatWan(valueFor(month, "total", "dailyImpress"))}</span>)}
      <div className="monthly-network-row-label">Fill Rate</div>
      {cells((month) => <span>{fillRateFor(month, "total")}</span>)}
      <div className="monthly-network-row-label monthly-network-share-label">TW:海外請求占比</div>
      {cells((month) => <span>{twShareFor(month)}</span>, "monthly-network-share-cell")}
      <div className="monthly-network-row-label">TW-Ave.日請求</div>
      {cells((month) => <mark>{formatWan(valueFor(month, "tw", "dailyRequest"))}</mark>)}
      <div className="monthly-network-row-label">TW-Ave.日使用imps</div>
      {cells((month) => <span>{formatWan(valueFor(month, "tw", "dailyImpress"))}</span>)}
      <div className="monthly-network-row-label">TW-Fill Rate</div>
      {cells((month) => <span>{fillRateFor(month, "tw")}</span>)}
      <div className="monthly-network-section">主聯播網</div>
      <div className="monthly-network-row-label">TW-Ave.日請求</div>
      {cells((month) => <mark>{formatWan(valueFor(month, "main", "dailyRequest"))}</mark>)}
      <div className="monthly-network-row-label">TW-Ave.日使用imps</div>
      {cells((month) => <span>{formatWan(valueFor(month, "main", "dailyImpress"))}</span>)}
      <div className="monthly-network-row-label">TW-Fill Rate</div>
      {cells((month) => <span>{fillRateFor(month, "main")}</span>)}
      <div className="monthly-network-section">子聯播網</div>
      <div className="monthly-network-row-label">TW-Ave.日請求</div>
      {cells((month) => <mark>{formatWan(valueFor(month, "child", "dailyRequest"))}</mark>)}
      <div className="monthly-network-row-label">TW-Ave.日使用imps</div>
      {cells((month) => <span>{formatWan(valueFor(month, "child", "dailyImpress"))}</span>)}
      <div className="monthly-network-row-label">TW-Fill Rate</div>
      {cells((month) => <span>{fillRateFor(month, "child")}</span>)}
    </div>
  );
}

function formatPieSlice(cx: number, cy: number, radius: number, start: number, end: number): string {
  const startX = cx + radius * Math.cos(start);
  const startY = cy + radius * Math.sin(start);
  const endX = cx + radius * Math.cos(end);
  const endY = cy + radius * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${startX.toFixed(2)} ${startY.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)} Z`;
}

function FormatInvestmentChart({
  snapshot,
  month,
  months,
  copiedAssetId,
  onCopy,
  onMonthChange,
}: {
  snapshot: MonthlyChartsSnapshot;
  month: string;
  months: string[];
  copiedAssetId: string;
  onCopy: (id: string) => void;
  onMonthChange: (month: string) => void;
}) {
  const formatNames = (snapshot.adFormats.names || []).filter((name) => {
    return months.some((m) => (snapshot.adFormats.byMonth[m] || []).some((row) => row.adFormat === name && n(row.dailyInvestment) > 0));
  });
  const selectedRows = snapshot.adFormats.byMonth[month] || [];
  const pieTotal = Math.max(1, selectedRows.reduce((sum, row) => sum + n(row.dailyInvestment), 0));
  let angle = -Math.PI / 2;
  const width = 640;
  const height = 456;
  const left = 104;
  const top = 28;
  const plotW = width - left - 28;
  const plotH = height - top - 146;
  const maxValue = Math.max(
    1,
    ...months.flatMap((m) => (snapshot.adFormats.byMonth[m] || []).map((row) => n(row.dailyInvestment))),
  );
  const groupW = plotW / Math.max(months.length, 1);
  const barW = Math.min(30, (groupW * 0.72) / Math.max(formatNames.length, 1));

  return (
    <div className="monthly-format-investment">
      <CopyableAsset id="monthly-asset-format-bars" title="圖表" copied={copiedAssetId === "monthly-asset-format-bars"} onCopy={onCopy}>
        <div className="monthly-slide-chart">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="廣告形式 DSP 日均投資額">
            {[0, 1, 2, 3, 4].map((tick) => {
              const y = top + (plotH / 4) * tick;
              const value = maxValue - (maxValue / 4) * tick;
              return (
                <g key={tick}>
                  <line x1={left} x2={width - 28} y1={y} y2={y} className="monthly-slide-grid" />
                  <text x={left - 10} y={y + 5} textAnchor="end" className="monthly-slide-axis">
                    {formatNumber(Math.round(value))}
                  </text>
                </g>
              );
            })}
            {months.map((m, monthIndex) => {
              const rows = snapshot.adFormats.byMonth[m] || [];
              const cx = left + groupW * monthIndex + groupW / 2;
              return (
                <g key={m}>
                  {formatNames.map((name, formatIndex) => {
                    const value = n(rows.find((row) => row.adFormat === name)?.dailyInvestment);
                    const h = (value / maxValue) * plotH;
                    const x = cx - (barW * formatNames.length) / 2 + formatIndex * barW;
                    return <rect key={name} x={x} y={top + plotH - h} width={barW * 0.82} height={h} fill={FORMAT_COLORS[formatIndex % FORMAT_COLORS.length]} />;
                  })}
                  <text x={cx} y={top + plotH + 36} textAnchor="middle" className="monthly-slide-month">
                    {m.slice(0, 7)}
                  </text>
                </g>
              );
            })}
            <SvgLegend
              x={52}
              y={height - 58}
              itemWidth={190}
              columns={3}
              items={formatNames.map((name, index) => ({
                label: formatFormatName(name),
                color: FORMAT_COLORS[index % FORMAT_COLORS.length],
              }))}
            />
          </svg>
        </div>
      </CopyableAsset>
      <CopyableAsset id="monthly-asset-format-table" title="數據表" copied={copiedAssetId === "monthly-asset-format-table"} onCopy={onCopy}>
        <ChartDataTable
          months={months}
          rows={formatNames.map((name, index) => ({
            key: name,
            label: formatFormatName(name),
            color: FORMAT_COLORS[index % FORMAT_COLORS.length],
            values: months.map((m) => n((snapshot.adFormats.byMonth[m] || []).find((row) => row.adFormat === name)?.dailyInvestment)),
            formatter: formatAmount,
          }))}
        />
      </CopyableAsset>
      <CopyableAsset
        id="monthly-asset-format-pie"
        title="占比"
        copied={copiedAssetId === "monthly-asset-format-pie"}
        onCopy={onCopy}
        toolbar={
          <div className="monthly-copyable-month-control">
            <span>Top 月份</span>
            <div className="monthly-chart-month-tabs" role="tablist" aria-label="單月素材月份">
              {months.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={month === m ? "is-active" : ""}
                  onClick={() => onMonthChange(m)}
                >
                  {monthLabel(m)}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="monthly-pie-card">
          <svg viewBox="0 0 640 430" role="img" aria-label="廣告形式 DSP 日均投資額占比">
            <text x={320} y={34} textAnchor="middle" className="monthly-pie-title">
              {month} 廣告形式 DSP 日均投資額
            </text>
            {selectedRows.map((row, index) => {
              const cx = 260;
              const cy = 184;
              const radius = 92;
              const value = n(row.dailyInvestment);
              const slice = (value / pieTotal) * Math.PI * 2;
              const start = angle;
              const end = angle + slice;
              angle = end;
              const percent = Math.round((value / pieTotal) * 100);
              const mid = start + slice / 2;
              const lineStartX = cx + (radius + 2) * Math.cos(mid);
              const lineStartY = cy + (radius + 2) * Math.sin(mid);
              const lineMidX = cx + (radius + 20) * Math.cos(mid);
              const lineMidY = cy + (radius + 20) * Math.sin(mid);
              const rightSide = Math.cos(mid) >= 0;
              const labelX = rightSide ? 474 : 96;
              const labelY = Math.min(278, Math.max(82, lineMidY));
              const lineEndX = rightSide ? labelX - 8 : labelX + 8;
              return (
                <g key={String(row.adFormat || index)}>
                  <path d={formatPieSlice(cx, cy, radius, start, end)} fill={FORMAT_COLORS[index % FORMAT_COLORS.length]} />
                  {percent >= 4 ? (
                    <>
                      <polyline
                        points={`${lineStartX.toFixed(1)},${lineStartY.toFixed(1)} ${lineMidX.toFixed(1)},${lineMidY.toFixed(1)} ${lineEndX.toFixed(1)},${labelY.toFixed(1)}`}
                        className="monthly-pie-label-line"
                      />
                      <text x={labelX} y={labelY + 5} textAnchor={rightSide ? "start" : "end"} className="monthly-pie-label">
                        {formatFormatName(row.adFormat)}, {percent}%
                      </text>
                    </>
                  ) : null}
                </g>
              );
            })}
            <g className="monthly-svg-legend">
              {selectedRows.map((row, index) => (
                <g key={`pie-legend-${String(row.adFormat || index)}`} transform={`translate(${92 + (index % 3) * 158} ${350 + Math.floor(index / 3) * 34})`}>
                  <rect x={0} y={-8} width={18} height={16} fill={FORMAT_COLORS[index % FORMAT_COLORS.length]} />
                  <text x={30} y={6}>{formatFormatName(row.adFormat)}</text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      </CopyableAsset>
    </div>
  );
}

function DailyIndicatorChart({
  title,
  rows,
  months,
  assetBaseId,
  copiedAssetId,
  onCopy,
}: {
  title: string;
  rows: MonthlyChartMetricRow[];
  months: string[];
  assetBaseId: string;
  copiedAssetId: string;
  onCopy: (id: string) => void;
}) {
  const chartRows = months.map((month) => rows.find((row) => row.month === month) || {
    month,
    request: 0,
    impress: 0,
    click: 0,
    profit: 0,
    advertiser_mu: 0,
    grossProfit: 0,
    mediaCostRate: 0,
    ctr: 0,
    dspEcpm: 0,
    dspEcpc: 0,
    dailyInvestment: 0,
    dailyRequest: 0,
    dailyImpress: 0,
    dailyClick: 0,
  });
  const fillRates = chartRows.map(metricRate);
  const fillMax = Math.max(4, Math.ceil(Math.max(...fillRates, 1) + 1));
  return (
    <div className="monthly-indicator-layout">
      <CopyableAsset id={`${assetBaseId}-chart`} title="圖表" copied={copiedAssetId === `${assetBaseId}-chart`} onCopy={onCopy}>
        <ComboChartWithTable
          title={title}
          months={months}
          bars={[
            { key: "req", label: "Req", color: BLUE, values: chartRows.map((row) => n(row.dailyRequest)), formatter: formatNumber },
            { key: "imps", label: "Imps", color: ORANGE, values: chartRows.map((row) => n(row.dailyImpress)), formatter: formatNumber },
          ]}
          line={{ key: "fillrate", label: "Fillrate", color: YELLOW, values: fillRates, formatter: formatPercent }}
          lineDomain={[0, fillMax]}
        />
      </CopyableAsset>
      <CopyableAsset id={`${assetBaseId}-data-table`} title="圖表數據表" copied={copiedAssetId === `${assetBaseId}-data-table`} onCopy={onCopy}>
        <ChartDataTable
          months={months}
          rows={[
            { key: "req", label: "Req", color: BLUE, values: chartRows.map((row) => n(row.dailyRequest)), formatter: formatNumber },
            { key: "imps", label: "Imps", color: ORANGE, values: chartRows.map((row) => n(row.dailyImpress)), formatter: formatNumber },
            { key: "fillrate", label: "Fillrate", color: YELLOW, values: fillRates, formatter: formatPercent },
          ]}
        />
      </CopyableAsset>
      <CopyableAsset id={`${assetBaseId}-kpi-table`} title="CPC / CTR 表" copied={copiedAssetId === `${assetBaseId}-kpi-table`} onCopy={onCopy}>
        <table className="monthly-side-kpi">
          <thead>
            <tr>
              <th>全部</th>
              {months.map((month) => <th key={month}>{monthLabel(month)}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>CPC</th>
              {chartRows.map((row) => <td key={row.month}>{formatAmount(row.dspEcpc)}</td>)}
            </tr>
            <tr>
              <th>CTR</th>
              {chartRows.map((row) => <td key={row.month}>{formatPercent(row.ctr)}</td>)}
            </tr>
          </tbody>
        </table>
      </CopyableAsset>
    </div>
  );
}

function MetricTable({
  rows,
  columns,
  labelKey,
}: {
  rows: MonthlyChartMetricRow[];
  columns: Array<{ key: keyof MonthlyChartMetricRow; label: string; format: (value: unknown) => string }>;
  labelKey: "zoneName" | "campaignName";
}) {
  return (
    <div className="monthly-chart-table-wrap">
      <table className="monthly-chart-table">
        <thead>
          <tr>
            <th>{labelKey === "zoneName" ? "版位" : "訂單"}</th>
            {columns.map((column) => <th key={String(column.key)}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.month}-${String(row[labelKey] || index)}`}>
              <td>{String(row[labelKey] || "")}</td>
              {columns.map((column) => <td key={String(column.key)}>{column.format(row[column.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonthlyChartsWorkspace({ snapshot, busy }: Props) {
  const [activeMonth, setActiveMonth] = useState<string>("");
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [copiedAssetId, setCopiedAssetId] = useState<string>("");
  const [copyNotice, setCopyNotice] = useState<string>("");
  const months = snapshot?.months || [];
  const monthsKey = months.join("|");

  useEffect(() => {
    setSelectedMonths(months);
  }, [monthsKey]);

  const visibleMonths = selectedMonths.filter((month) => months.includes(month));
  const effectiveMonths = visibleMonths.length > 0 ? visibleMonths : months;
  const effectiveMonth = activeMonth && effectiveMonths.includes(activeMonth) ? activeMonth : effectiveMonths[effectiveMonths.length - 1] || "";
  const topZones = snapshot?.topZonesByMonth[effectiveMonth] || [];
  const topCampaigns = snapshot?.topCampaignsByMonth[effectiveMonth] || [];
  const monthly = rowsForMonths(snapshot?.monthly || [], effectiveMonths);
  const creativeTrafficDaily = rowsForMonths(snapshot?.trafficDaily?.creative || [], effectiveMonths);
  const networkUsage = rowsForMonths(snapshot?.networkUsage || [], effectiveMonths);
  const totalRequest = useMemo(() => monthly.reduce((sum, row) => sum + n(row.request), 0), [monthly]);
  const selectedMonthLabel = effectiveMonths.length === months.length ? "所選月份" : effectiveMonths.map(monthLabel).join(" / ");
  const latest = monthly[monthly.length - 1];
  const mediaRates = monthly.map((row) => n(row.mediaCostRate));
  const mediaRateDomain = mediaRates.some((rate) => rate > 60 || rate < 50) ? undefined : ([50, 60] as [number, number]);
  const toggleMonth = (month: string) => {
    setSelectedMonths((current) => {
      const active = current.filter((item) => months.includes(item));
      if (active.includes(month)) {
        return active.length > 1 ? active.filter((item) => item !== month) : active;
      }
      return months.filter((item) => item === month || active.includes(item));
    });
  };
  const selectAllMonths = () => setSelectedMonths(months);
  const clearCopyFeedbackLater = (assetId: string) => {
    window.setTimeout(() => {
      setCopiedAssetId((current) => (current === assetId ? "" : current));
      setCopyNotice("");
    }, 1600);
  };
  const copyAsset = async (assetId: string) => {
    const el = document.getElementById(assetId);
    if (!el) return;
    const html = `<style>${COPY_STYLE}</style><div class="monthly-copy-payload">${el.innerHTML}</div>`;
    const text = el.innerText || "";
    try {
      const png = await renderElementToPngBlob(el);
      if (!("ClipboardItem" in window) || !navigator.clipboard?.write) {
        throw new Error("image clipboard unavailable");
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": png,
        }),
      ]);
      setCopiedAssetId(assetId);
      setCopyNotice("");
      clearCopyFeedbackLater(assetId);
    } catch {
      try {
        if ("ClipboardItem" in window && navigator.clipboard.write) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob([text], { type: "text/plain" }),
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(text);
        }
      } catch {
        await navigator.clipboard.writeText(text);
      }
      setCopiedAssetId("");
      setCopyNotice("圖片複製失敗，已改複製文字/HTML。");
      clearCopyFeedbackLater(assetId);
    }
  };

  return (
    <div className="monthly-charts-shell">
      <DataStateBlock loading={busy && !snapshot} empty={!busy && !snapshot} />
      {snapshot ? (
        <>
          <div className="monthly-charts-toolbar">
            <div>
              <h2>月報簡報素材</h2>
              <p>{snapshot.source}｜全資料：{months.map(monthLabel).join(" / ")}</p>
            </div>
            {copyNotice ? <div className="monthly-copy-notice" role="status">{copyNotice}</div> : null}
            <div className="monthly-toolbar-controls">
              <div className="monthly-month-control">
                <span>截圖月份</span>
                <div className="monthly-chart-month-tabs" aria-label="截圖月份">
                  {months.map((month) => (
                    <button
                      key={month}
                      type="button"
                      className={effectiveMonths.includes(month) ? "is-active" : ""}
                      onClick={() => toggleMonth(month)}
                      aria-pressed={effectiveMonths.includes(month)}
                    >
                      {monthLabel(month)}
                    </button>
                  ))}
                  <button type="button" onClick={selectAllMonths}>全選</button>
                </div>
              </div>
            </div>
          </div>

          <div className="monthly-chart-kpis">
            <span><b>{formatAmount(latest?.mediaCostInvestment || 0)}</b>最新月總投資</span>
            <span><b>{formatAmount(latest?.profit || 0)}</b>最新月媒體成本</span>
            <span><b>{formatNumber(totalRequest)}</b>{selectedMonthLabel}總請求</span>
            <span><b>{formatPercent(latest?.ctr || 0)}</b>最新月 CTR</span>
          </div>

          <AssetGroup
            titlePrefix="mF聯播網 "
            titleHighlight="媒體成本"
            titleSuffix="分析"
          >
            <div className="monthly-material-stack">
              <CopyableAsset id="monthly-asset-media-cost-chart" title="圖表" copied={copiedAssetId === "monthly-asset-media-cost-chart"} onCopy={copyAsset}>
                <ComboChartWithTable
                  title="媒體成本分析"
                  months={effectiveMonths}
                  bars={[
                    { key: "investment", label: "總投資量", color: BLUE, values: monthly.map((row) => n(row.mediaCostInvestment)), formatter: formatAmount },
                    { key: "cost", label: "媒體成本", color: ORANGE, values: monthly.map((row) => n(row.profit)), formatter: formatAmount },
                  ]}
                  line={{ key: "costRate", label: "媒體成本比", color: YELLOW, values: mediaRates, formatter: formatPercent }}
                  lineDomain={mediaRateDomain}
                />
              </CopyableAsset>
              <CopyableAsset id="monthly-asset-media-cost-table" title="圖表數據表" copied={copiedAssetId === "monthly-asset-media-cost-table"} onCopy={copyAsset}>
                <ChartDataTable
                  months={effectiveMonths}
                  rows={[
                    { key: "investment", label: "總投資量", color: BLUE, values: monthly.map((row) => n(row.mediaCostInvestment)), formatter: formatAmount },
                    { key: "cost", label: "媒體成本", color: ORANGE, values: monthly.map((row) => n(row.profit)), formatter: formatAmount },
                    { key: "costRate", label: "媒體成本比", color: YELLOW, values: mediaRates, formatter: formatPercent },
                  ]}
                />
              </CopyableAsset>
            </div>
          </AssetGroup>

          <AssetGroup
            titlePrefix="mF聯播網 "
            titleHighlight="TW流量規模與使用"
            titleSuffix=" 分析"
          >
            <div className="monthly-stacked-pair">
              <CopyableAsset id="monthly-asset-network-request" title="日請求（供給）" copied={copiedAssetId === "monthly-asset-network-request"} onCopy={copyAsset}>
                <StackedBarsChart title="日請求（供給）" months={effectiveMonths} rows={networkUsage} metric="dailyRequest" />
              </CopyableAsset>
              <CopyableAsset id="monthly-asset-network-impress" title="日曝光（使用）" copied={copiedAssetId === "monthly-asset-network-impress"} onCopy={copyAsset}>
                <StackedBarsChart title="日曝光（使用）" months={effectiveMonths} rows={networkUsage} metric="dailyImpress" />
              </CopyableAsset>
            </div>
            <CopyableAsset id="monthly-asset-network-summary-table" title="每月整體流量表" copied={copiedAssetId === "monthly-asset-network-summary-table"} onCopy={copyAsset}>
              <NetworkUsageSummaryTable months={effectiveMonths} monthly={monthly} rows={networkUsage} />
            </CopyableAsset>
          </AssetGroup>

          <AssetGroup
            titlePrefix="mF聯播網 - 廣告形式 "
            titleHighlight="DSP日均投資額"
          >
            <FormatInvestmentChart
              snapshot={snapshot}
              month={effectiveMonth}
              months={effectiveMonths}
              copiedAssetId={copiedAssetId}
              onCopy={copyAsset}
              onMonthChange={setActiveMonth}
            />
          </AssetGroup>

          <AssetGroup
            titlePrefix="MF聯播網各項日均指標 - "
            titleHighlight="全部廣告類型"
          >
            <DailyIndicatorChart
              title="全部廣告類型日均指標"
              rows={monthly}
              months={effectiveMonths}
              assetBaseId="monthly-asset-all-daily"
              copiedAssetId={copiedAssetId}
              onCopy={copyAsset}
            />
          </AssetGroup>

          <AssetGroup
            titlePrefix="MF聯播網各項日均指標 - "
            titleHighlight="創意型流量池"
          >
            <DailyIndicatorChart
              title="創意型流量池日均指標"
              rows={creativeTrafficDaily}
              months={effectiveMonths}
              assetBaseId="monthly-asset-creative-daily"
              copiedAssetId={copiedAssetId}
              onCopy={copyAsset}
            />
          </AssetGroup>

          <AssetGroup
            titlePrefix={monthLabel(effectiveMonth)}
            titleHighlight="Top 清單"
            titleSuffix=""
          >
            <div className="monthly-chart-grid-two">
              <CopyableAsset id="monthly-asset-top-zones" title={`${monthLabel(effectiveMonth)} Top 版位`} copied={copiedAssetId === "monthly-asset-top-zones"} onCopy={copyAsset}>
                <MetricTable
                  rows={topZones}
                  labelKey="zoneName"
                  columns={[
                    { key: "advertiser_mu", label: "投資額", format: formatAmount },
                    { key: "profit", label: "媒體成本", format: formatAmount },
                    { key: "impress", label: "曝光", format: formatNumber },
                    { key: "ctr", label: "CTR", format: formatPercent },
                  ]}
                />
              </CopyableAsset>
              <CopyableAsset id="monthly-asset-top-campaigns" title={`${monthLabel(effectiveMonth)} Top 訂單`} copied={copiedAssetId === "monthly-asset-top-campaigns"} onCopy={copyAsset}>
                <MetricTable
                  rows={topCampaigns}
                  labelKey="campaignName"
                  columns={[
                    { key: "advertiser_mu", label: "投資額", format: formatAmount },
                    { key: "profit", label: "媒體成本", format: formatAmount },
                    { key: "impress", label: "曝光", format: formatNumber },
                    { key: "dspEcpc", label: "CPC", format: formatAmount },
                  ]}
                />
              </CopyableAsset>
            </div>
          </AssetGroup>
        </>
      ) : null}
    </div>
  );
}
