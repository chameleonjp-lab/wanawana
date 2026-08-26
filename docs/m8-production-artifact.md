# M8 本番成果物の検査

CIは `npm run check` で一度だけ `dist/` を作り、その直後に `npm run verify:dist` を実行する。後段で再ビルドしないため、検査したものと公開対象を同じにできる。

検査では、公開先 `/wanawana/` とContent Security Policy（CSP）metaを確認する。HTMLが参照するCSS・JavaScriptと、Vite manifestに列挙された `assets/` を実際に読み、参照切れを失敗にする。1.0ではService Workerを登録・同梱しない。

この検査はブラウザの実機性能やタップ操作を代替しない。公開前には、iPhone縦持ちでタイトル、練習、戦闘、停止、復帰、結果、再戦の流れを確認する。
