import { useEffect, useMemo, useRef, useState } from "react";
import type { MonthlyP4MonthPayload, MonthlyP4Snapshot } from "../../types";
import { ActionButton } from "../ui";

type MonthlyP4WorkspaceProps = {
  snapshot?: MonthlyP4Snapshot;
  busy: boolean;
  onSaveInputs: (month: string, inputs: Record<string, number>) => Promise<boolean>;
  onUploadTestTemplate?: (kind: "base" | "check", file: File) => Promise<boolean>;
  onCloseMonth: (month: string) => Promise<{ ok: boolean; message: string }>;
  mode: "maintenance" | "output" | "test";
};

const P4_ROW_GROUPS = [
  {
    section: "multiFORCE\n聯播網\nGross 營收",
    rows: [
      { key: "mf_marketing", label: "內經銷商-營銷處" },
      { key: "mf_strategy", label: "內經銷商-策略部" },
      { key: "external_total", label: "外_經銷商\n(自操+IO)" },
      { key: "hb_revenue", label: "串接收入 (HB)" },
      { key: "external_beiliu_io", label: "外部經銷商\n北流委刊IO" },
    ],
  },
  {
    section: "其他營收",
    rows: [
      { key: "data_fee", label: "數據費:\n外經銷,自操額5%\n數據變現（春樹/TenMax）" },
      { key: "remaining_traffic_revenue", label: "剩餘流量變現\n(無成本)" },
    ],
  },
];

const P4_ITEM_LABELS: Record<string, string> = {
  product_total: "產品處 廣告總營收",
  mf_marketing: "內經銷商-營銷處",
  mf_strategy: "內經銷商-策略部",
  external_total: "外_經銷商(自操+IO)",
  hb_revenue: "串接收入 (HB)",
  external_beiliu_io: "外部經銷商 北流委刊IO",
  data_fee: "數據費",
  remaining_traffic_revenue: "剩餘流量變現",
  mf_total: "mltiFORCE",
};

const P4_METRIC_LABELS: Record<string, string> = {
  target: "目標",
  actual: "實績",
  rate: "達成率",
};

const P4_DIFF_REASON_LABELS: Record<string, string> = {
  value_mismatch: "數值不同",
  missing_in_check_template: "檢核缺格",
  missing_in_candidate: "候選缺格",
};

function fmtAmount(value: number): string {
  return Math.round(value || 0).toLocaleString("en-US");
}

function fmtBytes(value: number): string {
  if (!value) {
    return "-";
  }
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.round(value / 1024)} KB`;
}

function fmtRate(actual: number, target: number): string {
  if (!target) {
    return "-";
  }
  return `${Math.round((actual / target) * 100)}%`;
}

function monthLabel(month: string): string {
  const parsed = month.split("-");
  return parsed.length === 2 ? `${Number(parsed[1])}月` : month;
}

function valueFor(month: MonthlyP4MonthPayload, kind: "targets" | "actuals", key: string): number {
  return Number(month[kind]?.[key] || 0);
}

function buildInputState(snapshot?: MonthlyP4Snapshot): Record<string, number> {
  const active = snapshot?.monthPayloads.find((item) => item.month === snapshot.anchorMonth);
  const out: Record<string, number> = {};
  for (const item of snapshot?.manualInputDefinitions || []) {
    out[item.key] = Number(active?.manualInputs?.[item.key] || 0);
  }
  return out;
}

function defaultSelectedMonths(snapshot?: MonthlyP4Snapshot): string[] {
  return snapshot?.months?.length ? snapshot.months.slice(0, 3) : [];
}

function shiftMonth(month: string, offset: number): string {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1 + offset;
  const shifted = year * 12 + monthIndex;
  const shiftedYear = Math.floor(shifted / 12);
  const shiftedMonth = ((shifted % 12) + 12) % 12;
  return `${shiftedYear.toString().padStart(4, "0")}-${String(shiftedMonth + 1).padStart(2, "0")}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function P4Table({ months }: { months: MonthlyP4MonthPayload[] }) {
  return (
    <table className="monthly-p4-table">
      <thead>
        <tr>
          <th colSpan={3}>產品處 2026績效 (不含電商)</th>
          {months.map((month) => <th key={month.month}>{monthLabel(month.month)}</th>)}
        </tr>
        <tr>
          <th className="monthly-p4-side" rowSpan={4}>產品處<br />廣告總營收<br />(未稅)</th>
          <th>目標</th>
          <th>產品處 廣告總營收</th>
          {months.map((month) => <td key={month.month}>{fmtAmount(valueFor(month, "targets", "product_total"))}</td>)}
        </tr>
        <tr>
          <th>實績</th>
          <th />
          {months.map((month) => <td key={month.month} className="monthly-p4-red">{fmtAmount(valueFor(month, "actuals", "product_total"))}</td>)}
        </tr>
        <tr>
          <th>月 達成率</th>
          <th />
          {months.map((month) => <td key={month.month} className="monthly-p4-red">{fmtRate(valueFor(month, "actuals", "product_total"), valueFor(month, "targets", "product_total"))}</td>)}
        </tr>
      </thead>
      <tbody>
        {P4_ROW_GROUPS.map((group) => (
          group.rows.flatMap((row, idx) => {
            const targetRow = (
              <tr key={`${row.key}-target`}>
                {idx === 0 ? <th className="monthly-p4-section" rowSpan={group.rows.length * 3}>{group.section}</th> : null}
                <th className="monthly-p4-label" rowSpan={3}>{row.label}</th>
                <th>目標</th>
                {months.map((month) => <td key={month.month}>{fmtAmount(valueFor(month, "targets", row.key))}</td>)}
              </tr>
            );
            const actualRow = (
              <tr key={`${row.key}-actual`}>
                <th>實績</th>
                {months.map((month) => <td key={month.month}>{fmtAmount(valueFor(month, "actuals", row.key))}</td>)}
              </tr>
            );
            const rateRow = (
              <tr key={`${row.key}-rate`}>
                <th>達成率</th>
                {months.map((month) => <td key={month.month}>{fmtRate(valueFor(month, "actuals", row.key), valueFor(month, "targets", row.key))}</td>)}
              </tr>
            );
            return [targetRow, actualRow, rateRow];
          })
        ))}
        <tr className="monthly-p4-total">
          <th colSpan={3}>mltiFORCE 總目標</th>
          {months.map((month) => <td key={month.month}>{fmtAmount(valueFor(month, "targets", "mf_total"))}</td>)}
        </tr>
        <tr>
          <th colSpan={3}>mltiFORCE 實際績效</th>
          {months.map((month) => <td key={month.month}>{fmtAmount(valueFor(month, "actuals", "mf_total"))}</td>)}
        </tr>
        <tr>
          <th colSpan={3}>mltiFORCE 達成率</th>
          {months.map((month) => <td key={month.month} className="monthly-p4-red">{fmtRate(valueFor(month, "actuals", "mf_total"), valueFor(month, "targets", "mf_total"))}</td>)}
        </tr>
      </tbody>
    </table>
  );
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const rawLines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const out: string[] = [];
  for (const rawLine of rawLines.length ? rawLines : [""]) {
    let line = "";
    for (const char of rawLine) {
      const next = `${line}${char}`;
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

async function renderElementToPngBlob(element: HTMLElement): Promise<Blob> {
  const table = element.querySelector("table");
  if (!table) {
    throw new Error("找不到可輸出的表格");
  }
  const tableRect = table.getBoundingClientRect();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(tableRect.width * scale);
  canvas.height = Math.ceil(tableRect.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas unavailable");
  }
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, tableRect.width, tableRect.height);

  const cells = Array.from(table.querySelectorAll("th, td"));
  for (const cell of cells) {
    const rect = cell.getBoundingClientRect();
    const style = window.getComputedStyle(cell);
    const x = rect.left - tableRect.left;
    const y = rect.top - tableRect.top;
    const width = rect.width;
    const height = rect.height;
    ctx.fillStyle = style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)" ? style.backgroundColor : "#ffffff";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = style.borderTopColor || "#111111";
    ctx.lineWidth = Math.max(1, Number.parseFloat(style.borderTopWidth || "1"));
    ctx.strokeRect(x, y, width, height);

    const fontSize = Number.parseFloat(style.fontSize || "16") || 16;
    const lineHeight = Number.parseFloat(style.lineHeight || "") || fontSize * 1.2;
    ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    ctx.fillStyle = style.color || "#111827";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = wrapCanvasText(ctx, (cell.textContent || "").trim(), Math.max(20, width - 16));
    const startY = y + (height / 2) - ((lines.length - 1) * lineHeight / 2);
    lines.forEach((line, index) => {
      ctx.fillText(line, x + (width / 2), startY + (index * lineHeight), width - 12);
    });
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("png export failed")), "image/png");
  });
}

async function copyTableFallback(element: HTMLElement): Promise<void> {
  const tableHtml = element.innerHTML;
  const tableText = element.innerText;
  if (navigator.clipboard && "ClipboardItem" in window) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([tableHtml], { type: "text/html" }),
        "text/plain": new Blob([tableText], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.innerHTML = tableHtml;
  document.body.appendChild(container);
  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const ok = document.execCommand("copy");
  selection?.removeAllRanges();
  container.remove();
  if (!ok) {
    await navigator.clipboard?.writeText(tableText);
  }
}

export function MonthlyP4Workspace({ snapshot, busy, onSaveInputs, onUploadTestTemplate, onCloseMonth, mode }: MonthlyP4WorkspaceProps) {
  const captureRef = useRef<HTMLDivElement | null>(null);
  const [inputs, setInputs] = useState<Record<string, number>>(() => buildInputState(snapshot));
  const [selectedMonths, setSelectedMonths] = useState<string[]>(() => defaultSelectedMonths(snapshot));
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const activeMonth = snapshot?.anchorMonth || "";
  const closeMonth = activeMonth ? shiftMonth(activeMonth, -1) : "";
  const months = snapshot?.monthPayloads || [];
  const availableMonths = snapshot?.availableMonths?.length ? snapshot.availableMonths : snapshot?.months || [];

  useEffect(() => {
    setInputs(buildInputState(snapshot));
    setSelectedMonths(defaultSelectedMonths(snapshot));
  }, [snapshot]);

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const previewMonthPayloads = useMemo(() => {
    return months.map((month) => {
      if (month.month !== activeMonth) {
        return month;
      }
      const externalSelf = Number(month.computed.external_self_operated || 0);
      const actuals: Record<string, number> = {
        ...month.actuals,
        external_total: externalSelf + Number(inputs.external_io_momo || 0) + Number(inputs.external_io_live || 0),
        hb_revenue: Number(inputs.hb_revenue || 0),
        external_beiliu_io: Number(inputs.external_beiliu_io || 0),
        remaining_traffic_revenue: Number(inputs.remaining_traffic_revenue || 0),
        data_fee: externalSelf * 0.05 + Number(inputs.data_monetization_adjustment || 0),
      };
      actuals.mf_total =
        Number(actuals.mf_marketing || 0)
        + Number(actuals.mf_strategy || 0)
        + Number(actuals.external_total || 0)
        + Number(actuals.hb_revenue || 0)
        + Number(actuals.external_beiliu_io || 0);
      actuals.other_total = Number(actuals.data_fee || 0) + Number(actuals.remaining_traffic_revenue || 0);
      actuals.product_total = Number(actuals.mf_total || 0) + Number(actuals.other_total || 0);
      return { ...month, actuals, manualInputs: inputs };
    });
  }, [activeMonth, inputs, months]);

  const previewMonths = useMemo(() => {
    const byMonth = new Map(previewMonthPayloads.map((month) => [month.month, month]));
    return selectedMonths
      .map((month) => byMonth.get(month))
      .filter((month): month is MonthlyP4MonthPayload => Boolean(month));
  }, [previewMonthPayloads, selectedMonths]);

  const yearMonths = useMemo(() => {
    const byMonth = new Map(previewMonthPayloads.map((month) => [month.month, month]));
    return availableMonths
      .map((month) => byMonth.get(month))
      .filter((month): month is MonthlyP4MonthPayload => Boolean(month));
  }, [availableMonths, previewMonthPayloads]);

  const maintenanceMonths = useMemo(() => {
    const byMonth = new Map(previewMonthPayloads.map((month) => [month.month, month]));
    return availableMonths
      .filter((month) => !activeMonth || month <= activeMonth)
      .map((month) => byMonth.get(month))
      .filter((month): month is MonthlyP4MonthPayload => Boolean(month));
  }, [activeMonth, availableMonths, previewMonthPayloads]);

  const updateSelectedMonth = (index: number, value: string) => {
    setSelectedMonths((current) => {
      const next = [...current];
      next[index] = value;
      return next.slice(0, 3);
    });
  };

  const handleSave = async () => {
    setStatus("");
    const ok = await onSaveInputs(activeMonth, inputs);
    setStatus(ok ? "已存檔" : "存檔失敗");
  };

  const handleTemplateUpload = async (kind: "base" | "check", file?: File | null) => {
    if (!file || !onUploadTestTemplate) {
      return;
    }
    setStatus(`正在上傳${kind === "base" ? "基礎模板" : "檢核模板"}...`);
    try {
      const ok = await onUploadTestTemplate(kind, file);
      setStatus(ok ? "模板已上傳" : "模板上傳失敗，請看 Result");
    } catch (error) {
      setStatus(`模板上傳失敗：${error instanceof Error ? error.message : "未知錯誤"}`);
    }
  };

  const handleCloseMonth = async () => {
    if (!closeMonth) {
      return;
    }
    const okToClose = window.confirm(`確定關帳 ${monthLabel(closeMonth)}？系統會把該月 raw data 壓縮成月彙總資料。`);
    if (!okToClose) {
      return;
    }
    setStatus("正在關帳...");
    const result = await onCloseMonth(closeMonth);
    setStatus(result.message);
  };

  const handleDownload = async () => {
    if (!captureRef.current) {
      return;
    }
    setStatus("正在產生 PNG...");
    try {
      const blob = await renderElementToPngBlob(captureRef.current);
      const url = URL.createObjectURL(blob);
      setDownloadUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return url;
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `monthly-p4-${selectedMonths.join("-")}.png`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("已送出 PNG 下載");
    } catch (error) {
      setStatus(`下載失敗：${error instanceof Error ? error.message : "無法產生圖片"}`);
    }
  };

  const handleCopy = async () => {
    if (!captureRef.current) {
      return;
    }
    setStatus("正在複製...");
    try {
      if (!navigator.clipboard || !("ClipboardItem" in window)) {
        throw new Error("image clipboard unavailable");
      }
      const blob = await renderElementToPngBlob(captureRef.current);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("已複製 PNG 圖片");
    } catch (_error) {
      try {
        await copyTableFallback(captureRef.current);
        setStatus("圖片複製受限，已改複製表格內容");
      } catch (fallbackError) {
        const text = escapeHtml(fallbackError instanceof Error ? fallbackError.message : "clipboard denied");
        setStatus(`複製失敗：${text}；請改用下載 PNG`);
      }
    }
  };

  if (!snapshot) {
    return <section className="monthly-p4-shell">月報 P4(J) 尚未載入。</section>;
  }

  if (mode === "maintenance" || mode === "test") {
    const isTestMode = mode === "test";
    return (
      <section className="monthly-p4-shell">
        <header className="monthly-p4-toolbar monthly-p4-toolbar-compact">
          <div>
            <h2>{isTestMode ? "P4(J) 月報測試" : "P4(J) 資料維護"}</h2>
            <p>
              {isTestMode
                ? `${activeMonth} 測試手 key；寫入測試資料庫，不影響正式月報。`
                : `${activeMonth} 當月手 key；下方顯示 1 月累積到 ${monthLabel(activeMonth)}。`}
            </p>
          </div>
          <div className="monthly-p4-actions">
            <ActionButton label="存檔" onClick={() => void handleSave()} disabled={busy} />
            {isTestMode ? null : (
              <ActionButton label={`關帳 ${monthLabel(closeMonth)}`} variant="secondary" onClick={() => void handleCloseMonth()} disabled={busy || !closeMonth} />
            )}
          </div>
          {status ? <p className="monthly-p4-status">{status}</p> : null}
        </header>

        {isTestMode ? (
          <section className="monthly-p4-editor monthly-p4-template-uploader">
            <header>
              <h2>測試模板</h2>
              <p>基礎模板與檢核模板分開上傳；只寫入測試資料庫。</p>
            </header>
            <div className="monthly-p4-upload-grid">
              {([
                ["base", "基礎模板"],
                ["check", "檢核模板"],
              ] as const).map(([kind, label]) => {
                const meta = snapshot.testTemplates?.[kind];
                return (
                  <label key={kind} className="monthly-p4-upload-card" htmlFor={`monthly-p4-${kind}-template`}>
                    <span className="monthly-p4-upload-title">{label}</span>
                    <input
                      id={`monthly-p4-${kind}-template`}
                      type="file"
                      accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                      disabled={busy}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        void handleTemplateUpload(kind, file);
                      }}
                    />
                    {meta ? (
                      <span className="monthly-p4-upload-meta">
                        已上傳：{meta.filename} · {fmtBytes(meta.fileSize)} · {meta.snapshot?.entryCount || 0} 格
                      </span>
                    ) : (
                      <span className="monthly-p4-upload-meta">尚未上傳</span>
                    )}
                  </label>
                );
              })}
            </div>
          </section>
        ) : null}

        {isTestMode ? (
          <section className="monthly-p4-editor monthly-p4-diff-panel">
            <header>
              <h2>檢核差異</h2>
              <p>
                {snapshot.diff?.status === "missing_answer"
                  ? "上傳檢核模板後，這裡會列出候選結果與答案不一致的數字。"
                  : `候選 ${snapshot.candidateSnapshot?.entryCount || 0} 格；差異 ${snapshot.diff?.diffCount || 0} 格。`}
              </p>
            </header>
            {snapshot.diff?.diffs?.length ? (
              <div className="monthly-p4-diff-table-wrap">
                <table className="monthly-p4-diff-table">
                  <thead>
                    <tr>
                      <th>月份</th>
                      <th>項目</th>
                      <th>欄位</th>
                      <th>候選</th>
                      <th>答案</th>
                      <th>差額</th>
                      <th>類型</th>
                      <th>來源格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.diff.diffs.slice(0, 120).map((diff) => (
                      <tr key={diff.key}>
                        <td>{diff.month === "total" ? "Total" : monthLabel(diff.month)}</td>
                        <td>{P4_ITEM_LABELS[diff.itemKey] || diff.itemKey}</td>
                        <td>{P4_METRIC_LABELS[diff.metric] || diff.metric}</td>
                        <td>{diff.candidate === null || diff.candidate === undefined ? "-" : fmtAmount(Number(diff.candidate))}</td>
                        <td>{diff.answer === null || diff.answer === undefined ? "-" : fmtAmount(Number(diff.answer))}</td>
                        <td>{diff.delta === null || diff.delta === undefined ? "-" : fmtAmount(Number(diff.delta))}</td>
                        <td>{P4_DIFF_REASON_LABELS[diff.reason || ""] || diff.reason || "-"}</td>
                        <td>{diff.cell}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {snapshot.diff.diffs.length > 120 ? <p className="monthly-p4-upload-meta">只顯示前 120 筆差異。</p> : null}
              </div>
            ) : snapshot.diff?.status === "matched" ? (
              <p className="monthly-p4-status">候選結果與檢核模板一致。</p>
            ) : null}
          </section>
        ) : null}

        <section className="monthly-p4-editor">
          <header>
            <h2>{monthLabel(activeMonth)} {isTestMode ? "測試手 key 欄位" : "手 key 欄位"}</h2>
            <p>{isTestMode ? "這裡是測試資料庫，拿來對歷史月報答案，不會覆蓋正式值。" : "修改後會即時重算下方當月摘要；按存檔後才寫入資料庫。"}</p>
          </header>
          <div className="monthly-p4-input-grid">
            {snapshot.manualInputDefinitions.map((input) => (
              <label key={input.key} className="monthly-p4-input" htmlFor={`monthly-p4-input-${input.key}`}>
                <span>{input.label}</span>
                <input
                  id={`monthly-p4-input-${input.key}`}
                  name={`monthly_p4_${input.key}`}
                  type="number"
                  value={String(inputs[input.key] ?? 0)}
                  onChange={(event) => setInputs((current) => ({ ...current, [input.key]: Number(event.target.value || 0) }))}
                />
              </label>
            ))}
          </div>
        </section>

        {maintenanceMonths.length ? (
          <div className="monthly-p4-capture monthly-p4-current-table">
            <P4Table months={maintenanceMonths} />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="monthly-p4-shell">
      <header className="monthly-p4-toolbar">
        <div>
          <h2>P4(J) 月報輸出</h2>
          <p>主表固定顯示 1~12 月；截圖輸出可挑任意三個月。</p>
        </div>
        <div className="monthly-p4-month-picker" aria-label="截圖月份">
          {[0, 1, 2].map((index) => (
            <label key={index} htmlFor={`monthly-p4-shot-month-${index}`}>
              <span>月份 {index + 1}</span>
              <select
                id={`monthly-p4-shot-month-${index}`}
                name={`monthly_p4_shot_month_${index}`}
                value={selectedMonths[index] || ""}
                onChange={(event) => updateSelectedMonth(index, event.target.value)}
              >
                {availableMonths.map((month) => (
                  <option key={month} value={month}>{monthLabel(month)}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="monthly-p4-actions">
          <ActionButton label="下載三月 PNG" variant="secondary" onClick={() => void handleDownload()} disabled={busy} />
          <ActionButton label="複製三月圖片" variant="ghost" onClick={() => void handleCopy()} disabled={busy} />
        </div>
        {status ? <p className="monthly-p4-status">{status}</p> : null}
        {downloadUrl ? (
          <a
            className="monthly-p4-download-link"
            href={downloadUrl}
            download={`monthly-p4-${selectedMonths.join("-")}.png`}
          >
            下載剛產生的 PNG
          </a>
        ) : null}
      </header>

      <div className="monthly-p4-capture monthly-p4-main-table">
        <P4Table months={yearMonths} />
      </div>

      <section className="monthly-p4-shot-panel">
        <header className="monthly-p4-shot-header">
          <div>
            <h2>三月截圖預覽</h2>
            <p>上方選擇月份後，下載與複製只輸出這張三欄表。</p>
          </div>
          <ActionButton
            label={previewOpen ? "收合預覽" : "展開預覽"}
            variant="ghost"
            onClick={() => setPreviewOpen((current) => !current)}
            disabled={busy}
          />
        </header>
        {previewOpen ? (
          <div className="monthly-p4-capture monthly-p4-shot-capture" ref={captureRef}>
            <P4Table months={previewMonths} />
          </div>
        ) : null}
      </section>

    </section>
  );
}
