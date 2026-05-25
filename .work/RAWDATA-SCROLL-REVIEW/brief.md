# RAWDATA-SCROLL-REVIEW

任務ID: RAWDATA-SCROLL-REVIEW
卡片類型｜派工對象: review｜其他 AI reviewer
請讀:
- `/Users/matt/MDREPROT2/frontend/src/components/workspaces/rawdata.tsx`
- `/Users/matt/MDREPROT2/frontend/src/styles/workspace.css`

任務目的:
Review Rawdata 大表 nested vertical scroll 的 handoff 修正。PM 體感問題是：大表內部滾輪推到底後，最右側頁面滾輪沒有順暢接手，像被卡住。

目前改動摘要:
- `rawdata.tsx` 新增 `canScrollVertically()`、`findVerticalScrollHandoffTarget()` 與 `resolveVerticalScrollHandoff()`。
- 已依第一輪 review 修正：`body` / `documentElement` 會映射回 `document.scrollingElement`，祖先 handoff target 需具備 `overflow-y: auto|scroll|overlay`。
- `rawdata.tsx` 在 `rawdata-table-wrap` 掛原生 `wheel` listener；當一次 wheel delta 會跨過表格頂/底時，表格先吃到邊界，剩餘 delta 立即交給第一個可垂直滾動的外層容器。
- `workspace.css` 將 `.rawdata-table-wrap` 設為 `overscroll-behavior-y: auto` 與 `scrollbar-gutter: stable`。
- `workspace.css` 將 DSP/SSP rawdata table max-height 改為 viewport-aware：`min(原高度, calc(100vh - 220px))`。

Reviewer 請重點檢查:
- 這個 handoff 是否可能造成 wheel 事件過度攔截，尤其是 trackpad 慣性滾動。
- `findVerticalScrollHandoffTarget()` 的 `body` / `document.scrollingElement` 特判與 overflow eligibility 是否足夠覆蓋 Chrome/Safari。
- `Element.scrollTop += deltaY` 對 `document.scrollingElement`、一般 div、Chrome/Safari 是否合理。
- `overscroll-behavior-y: auto` 是否符合保留自然 scroll chaining 的目標。
- `calc(100vh - 220px)` 是否會在小螢幕讓表格過矮，或和 command deck / save bar 位置衝突。
- 是否需要改成更成熟的 shared utility / hook，或目前局部修正足夠。
- `resolveVerticalScrollHandoff()` 對大 delta / trackpad 慣性 delta 的分段交接是否會有跳動或過度 `preventDefault()`。

驗證方式:
- 執行 `cd /Users/matt/MDREPROT2/frontend && pnpm typecheck`。
- 執行 `cd /Users/matt/MDREPROT2/frontend && pnpm build`。
- 開啟本機頁面，例如 `http://127.0.0.1:8511/?workflow=dsp&main_tab=dsp_tab3&sub_tab=rawdata&root=%2FUsers%2Fmatt%2FMDREPROT2&manifest=bootstrap.manifest.json&template_version=v1&rule_version=v1&artifact_root=artifacts&period_preset=last_week&period_week_start=2026-05-04&period_week_end=2026-05-10&row_filter=&row_limit=50&env=prod`。
- 用滑鼠滾輪或 trackpad 在大表內往下滾到表格底部，再繼續往下滾，確認最右側頁面滾輪是否接手。
- 反向測試：頁面在下方、大表在頂部時，於大表內繼續往上滾，確認頁面是否接手往上。
- 檢查水平滾動與欄寬調整沒有被垂直 wheel handler 影響。

已知狀態:
- `pnpm --dir frontend exec tsc --noEmit` 通過。
- `pnpm --dir frontend build` 通過。
- Chrome DevTools MCP 驗證：
  - 向下：表格剩 29.25px 到底，丟 `deltaY=120`，表格移動 `29.25`，外層 `.page` 接手移動 `90`。
  - 向上：表格離頂 24.75px，丟 `deltaY=-100`，表格移動 `-24.75`，外層 `.page` 接手移動 `-75`。
- Review note: `main_tab=dsp_tab4&sub_tab=rawdata` 不是有效子頁籤；rawdata 驗證 URL 已改為 `main_tab=dsp_tab3&sub_tab=rawdata`。
- 仍需要 PM 實機/trackpad 體感 review。

限制:
- Worktree 目前已有其他既有修改，特別是 `workspace.css` 內的 `monthly-p4-*` 區塊不是本卡主題；review 請聚焦 rawdata scroll handoff。
- 不要改成「單一垂直滾輪」方案；PM 已明確不要取消大表內部垂直 scroll。

輸出期望:
- 請列出 findings，依嚴重度排序。
- 每個 finding 請附檔案與行號。
- 如果沒有 blocker，請明確說明是否建議保留此方案，或提出更小/更標準的替代實作。
