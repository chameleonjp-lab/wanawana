# M8 本番成果物の検査

CIは `npm run check` で一度だけ `dist/` を作り、その直後に `npm run verify:dist` を実行する。後段で再ビルドしないため、検査したものと公開対象を同じにできる。

検査では、公開先 `/wanawana/`、Content Security Policy（CSP）meta、Service Workerの版分離と利用者操作による更新切替を確認する。HTMLが参照するCSS・JavaScriptと、Vite manifestに列挙された `assets/` を実際に読み、参照切れを失敗にする。

この検査はブラウザの実機性能やService Workerの実際のオフライン動作を代替しない。公開前には、オンライン取得後のオフライン再起動、更新待機、必須ファイル欠落時の旧版継続を本番成果物で確認する。
