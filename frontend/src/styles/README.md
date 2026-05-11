# Frontend Styles Boundary Contract

本文件定義 `frontend/src/styles/` 的樣式責任邊界，避免 CSS 回到單檔混雜。

## 入口與載入順序

- 入口檔：`/Users/matt/MDREPROT2/frontend/src/styles.css`
- 載入順序固定：
  1. `base.css`
  2. `layout.css`
  3. `tabs.css`
  4. `workspace.css`
  5. `runtime-strip.css`

原則：越前面越通用，越後面越專用；不要在前層覆蓋後層專用規則。

## 各層責任

### `base.css`

責任：
- 全域 token（`:root` 變數）
- reset 與元素基礎（`*`, `body`, `input/select/textarea`, `table`）
- 通用 UI primitive（`.btn*`, `.badge*`, `.field`, `.status-bar`, `.grid-2`）
- 全域動畫 keyframes（`rise`, `drift`）

不放：
- 任何特定工作區（workbench / runtime strip / tab 區）專用樣式

### `layout.css`

責任：
- 殼層與版面結構（`.page`, `.layout`, `.panel`, `.panel-*`）
- ambient 背景與工作台主框架（`.workbench-*` 主容器）
- command deck 的版面網格（`.command-grid`, `.command-cell*`）
- 與版面相關的 RWD 切欄規則

不放：
- tab active 狀態視覺
- rawdata/result/pivot 等 workspace 內容細節
- runtime strip 專用視覺

### `tabs.css`

責任：
- 所有 tab row 與 tab button 狀態（`role="tab"`, `aria-selected`）
- tab 尺寸/密度微調（例如 `.tab-row .btn`）

不放：
- 版面 grid
- workspace 內容區塊樣式
- runtime strip 卡片樣式

### `workspace.css`

責任：
- workbench 內容工作區共用樣式（overview/rawdata/pivot/result/ssp/tab4）
- insight/metric/recent 區塊
- rawdata 編修相關（`row-badge`, `input-invalid`, `cell-error`）
- workspace debug 區與資料表容器（`.table-wrap`, `.workspace-debug`）

不放：
- shell layout 結構
- tab active 規則
- runtime strip 專用區塊

### `runtime-strip.css`

責任：
- `RuntimeUtilityStrip` 全部專用樣式
- runtime 摘要列、展開卡片、actions 列與對應 RWD

不放：
- 通用 `.panel` / `.btn` 基礎定義
- 一般 workspace 樣式

## 新增樣式判定流程

1. 先判斷是否可重用既有 class；可重用就不要新增。
2. 若是跨頁通用 primitive，放 `base.css`。
3. 若是殼層結構與區塊排版，放 `layout.css`。
4. 若是 tab/segmented 狀態，放 `tabs.css`。
5. 若是工作區內容（含 rawdata/result/pivot/ssp/tab4），放 `workspace.css`。
6. 若只屬 runtime strip，放 `runtime-strip.css`。

## 禁止事項

- 禁止把 runtime strip 樣式混回 `workspace.css`。
- 禁止把 tab active 狀態散落到 `layout.css` 或 `workspace.css`。
- 禁止在 `base.css` 寫 feature-specific selector（例如 `.tab4-*`, `.ssp-*`）。
- 禁止新增第二套路由導向樣式系統（例如另開 CSS-in-JS 覆寫同一批 class）而不先開卡。

## 驗收建議

- 至少跑一次 `pnpm -C frontend build`
- 若涉及互動視覺層，建議加跑 browser acceptance smoke
