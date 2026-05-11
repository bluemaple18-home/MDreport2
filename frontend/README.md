# MDREP Frontend

正式前端骨架（React + TypeScript + Vite）。

## 邊界
- 只接 runtime API：`/api/status`、`/api/frame`、`/api/action`
- 不改 SQLite canonical、service transaction、artifact 邏輯
- workbook 仍只作輸出 artifact，不是 canonical source
- Rawdata 編修權限要做成 capability：SSP 先預留 read-only，DSP 才開放 editable，前後端都不能只靠隱藏按鈕

## 共用互動元件原則（固定）
- SSP / DSP / 子頁共用同一份互動元件實作
- 先共用，只有衝突才拆分
- 不為了分離而預先特規化

## FRONTEND-011 契約檔
- 實作契約：`MDREP-FRONTEND-011_IMPLEMENTATION_CONTRACT.md`
- 契約常數：`src/state/runtimeContract.ts`

## 第一批共用元件（已落地）
- `ShellHeader`
- `ModeSwitcher`
- `SubpageSwitcher`
- `FilterBar`
- `TableContainer`
- `StatusBar`
- `SaveBar`
- `ExportBar`
- `DataStateBlock`（loading / empty / error）

## 本地開發
```bash
cd frontend
pnpm install
pnpm dev
```

Vite dev server 預設 proxy 到：
- `http://127.0.0.1:8510`

可用環境變數覆寫：
```bash
VITE_RUNTIME_PROXY_TARGET=http://127.0.0.1:9000 pnpm dev
```

## 腳本
- `pnpm dev`：啟動開發伺服器
- `pnpm build`：型別檢查 + 打包
- `pnpm preview`：預覽打包結果
- `pnpm typecheck`：只跑 TypeScript 型別檢查
