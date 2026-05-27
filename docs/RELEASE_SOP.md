# MDreport 更版 SOP

目標：更版時先停掉本機常駐服務，避免舊前台佔用 `8510`、launchd 自動重啟舊版，或每日抓數排程在更版中途寫 DB。

## 服務

- 前台常駐服務：`com.mattkuo.mdreport.ui-shell`
- 每日抓數排程：`com.mattkuo.mdreport.daily-fetch`
- 統一操作腳本：`scripts/service_ops.sh`

## 更版流程

1. 停服務

```bash
scripts/service_ops.sh stop
scripts/service_ops.sh status
```

確認兩個服務都是 `not loaded`。

2. 更新程式與依賴

依更版來源操作，例如套 patch、切換檔案、或拉新版本。若有 Python 依賴變動，用 `uv + .venv`；若有前端依賴變動，用 `pnpm`。

3. 跑基本驗證

```bash
.venv/bin/python -m unittest tests.test_ssp_api tests.test_dsp_api
pnpm -C frontend test:controller-guard
pnpm -C frontend build
bash -n scripts/fetch_previous_day.sh
bash -n scripts/service_ops.sh
```

4. 同步測試與人員 sandbox

```bash
.venv/bin/python scripts/sync_frontend_runtime_db.py \
  --root "$(pwd)" \
  --sandbox matt \
  --sandbox WEN \
  --sandbox Charlotte \
  --sandbox Nathan
```

5. 重啟服務

```bash
scripts/service_ops.sh start
scripts/service_ops.sh status
```

6. 驗證前台

```bash
curl -sS "http://192.168.9.188:8510/api/status?workflow=dsp&env=test&sandbox=WEN"
```

瀏覽器確認：

- `http://192.168.9.188:8510/?env=test&sandbox=matt`
- `http://192.168.9.188:8510/?env=test&sandbox=WEN`
- `http://192.168.9.188:8510/?env=test&sandbox=Charlotte`
- `http://192.168.9.188:8510/?env=test&sandbox=Nathan`

## 回滾或緊急停止

若前台異常、port 被佔、或資料抓取不該繼續：

```bash
scripts/service_ops.sh stop
```

若只要恢復服務：

```bash
scripts/service_ops.sh start
```

## 注意

- 更版期間不要手動開 `app/ui_shell.py` 長期佔用 `8510`；最後一律交給 launchd 管。
- 若要人工抓數，先確認不是更版中途；抓完後要同步 sandbox。
- 每日抓數成功後會自動同步 `matt WEN Charlotte Nathan`。
