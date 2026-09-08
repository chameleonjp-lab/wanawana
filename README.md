# ワナワナ

見えない罠を置き、相手を誘導して連鎖させる1対1のブラウザゲームです。

現在は[2026年9月8日の監査・改善計画](docs/quality-improvement-plan-2026-09-08.md)に従い、対戦ルールの正しさを優先して修正しています。最初の作業は、移動途中の壁との衝突と、同時に起きる効果の一括判定です。[改善進捗と検査結果](docs/quality-improvement-progress.md)に、各作業の状態と残る課題を記録します。

タイトル、通常対戦、停止・再開、練習、3面、5種類の罠、装備選択、CPUの3難度、端末内戦績、結果の設計図、対戦記録の書き出し・照合を実装しています。名前入力、結果共有、オンラインTop10にも対応しています。アカウント同期は扱いません。

CPUの設置・経路・認知、狙う操作、練習内容、発動後の危険表示、連鎖の責任者には後続の修正があります。初見試遊とiPhone実機性能は、計画の各合格条件に従って別途確認します。従来のM7機能一覧だけでゲームとして合格済みとはしていません。

## 開発

```sh
npm ci
npm run dev
```

確認には次を使います。

```sh
npm run check
npm run verify:dist
```

GitHub Pages向けの公開先は `/wanawana/` です。描画はWebGLを優先し、WebGLを開始できない端末ではPixiJSの2次元Canvas描画へ自動切替します。どちらも開始できない場合だけ、対応外の案内を表示します。

公開用のActionsは `dist/` を一度だけ作り、検査済みのPages artifactをそのまま公開します。設定の境界は [`docs/m8-pages-deploy.md`](docs/m8-pages-deploy.md) に記録しています。

Pages公開後は、HTML・manifestと参照資源を公開URLから確認するスモーク検査を自動実行します。境界は [`docs/m8-pages-smoke.md`](docs/m8-pages-smoke.md) に記録しています。
実機性能の測定手順と合否目安は [`docs/m8-performance.md`](docs/m8-performance.md) に記録しています。軽量表示はルールを変えずに描画解像度と発動演出を抑えます。5試合の最終確認は実機で行います。

1.0ではオフライン起動とService Workerによる更新を提供しません。Service Workerは登録せず、将来追加する場合の境界だけを [`docs/m8-offline-updates.md`](docs/m8-offline-updates.md) に残しています。

端末内戦績は `wanawana:v1:summary` に結果確定時だけ保存します。技術的に無効になった試合は戦績へ加えません。保存が拒否された端末でも、メモリ上の集計で試合を続けられます。タイトル画面からワナワナ固有の記録だけを削除できます。

CPU難易度の固定入力監査と、調整を保留している点は [`docs/m7-balance-audit.md`](docs/m7-balance-audit.md) に記録しています。固定入力の結果は人間の勝率ではなく、実装変更を比較するための基準です。
