## 確認シナリオ

Windows 上で固定した Pi SDK 1.2.0 を使い、glm-vision を実際の Pi CLI/RPC プロセスへ読み込み、画像説明機能とライフサイクルを検証する。推論は決定的なオフラインfixtureを使う。Pi のホスト、拡張、ローカル provider 通信は実物を使い、Z.AI 画像説明 API だけを fixture に置き換え、loopback 以外への `fetch()` は拒否する。

## 操作手順

1. `npm ci --no-audit --no-fund` で lockfile の依存関係を復元する。
2. `npm run smoke:pi` を実行する。各シナリオは専用の一時 `PI_CODING_AGENT_DIR` / `HOME` を使い、session・ユーザー設定・キャッシュを共有しない。
3. `npm test -- tests/pi-sdk-smoke-rpc.test.ts tests/pi-sdk-smoke-contract.test.ts` を実行し、EPIPE と応答前の child exit が待機 RPC を失敗終了させ、waiter/timer を残さないことを確認する。
4. `docs/verification/pi-sdk-smoke.json` の全 assertion と `docs/verification/pi-sdk-smoke-evidence.json` の実行記録を確認する。

## 期待結果

`npm run smoke:pi` が成功し、次の5ケースがすべて `passed: true` になる。

- `extension_load`: Pi RPC の `get_commands` で拡張コマンドを確認し、status prompt が `handled`、通知が `glm-vision: ON`。
- `happy_path`: 実 Pi の `read` が画像を読み、説明が次の Pi model request に含まれる。Z.AI fixture は1回。
- `error_path`: fixture の HTTP 500 が3回試行され、エラーが扱われ、元画像が次の model request に残る。
- `reload_cleanup`: 別 PID の2つ目の Pi プロセスでも `/glm-vision status` を実行し、RPC の `disposition=handled` と実際の `glm-vision: ON` 通知を検証する。その後、同じプロセスで画像説明の応答を確認し、両プロセスが timeout/error なしで終了する。
- `host_shell`: Windows PowerShell から pinned Pi CLI を起動し、`1.2.0` を取得する。

負ケース回帰では child の stdin に EPIPE を注入してエラーが捕捉されること、未応答 RPC が child exit 時に制限時間を待たず reject され、pending waiter と deadline timer が残らないことを検証する。JSON の上位 `extension_load_errors` と `unhandled_errors` はともに `0`。手動操作は不要で、上記の機能確認はすべてエージェントが実行した。

## 確認コマンド

```text
npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm test
npm test -- tests/pi-sdk-smoke-rpc.test.ts tests/pi-sdk-smoke-contract.test.ts
npm run smoke:pi
npm run validate:package
```

バージョン確認は変更をコミットした後、PR base に対して実行する。

```powershell
$env:BASE_REF = 'origin/main'
npm run version:check
```

## 注意する失敗パターン

- プロセスの exit code `0` だけでは合格ではない。各ケースの意味的 assertion がすべて `true` であること。
- error/reload ケースが成功経路のキャッシュを拾うと、再試行や再読込後の機能を検証できない。ハーネスはケースごとに専用 HOME を使う。
- reload は終了コードや shutdown error の不在だけで判定しない。別プロセスで登録に加え status の実応答（`handled` と `glm-vision: ON`）、画像説明の応答をそれぞれ確認する。
- stdin の EPIPE や child exit で request が reject されない、または pending waiter timer が残る場合は不合格。
- smoke 実行中の外部 provider 通信を許可しない。予期しない非-loopback `fetch()` は失敗として扱い、グローバル Pi 設定は変更しない。
