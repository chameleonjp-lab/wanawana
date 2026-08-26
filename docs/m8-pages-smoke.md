# M8 公開後スモーク検査

`Verify published game` は、Pagesの公開ワークフローが成功した後に公開URLへ接続する。HTMLとmanifestを読み、HTMLとmanifestが参照するCSS・JavaScriptがすべてHTTP 200で取得できることを確認する。拡張子に対応するContent-Typeも確認するため、別内容をHTTP 200で返す設定を成功扱いにしない。

この検査はブラウザの描画性能やタップ操作を代替しない。公開物の参照切れ、CSP metaの欠落、`/wanawana/` 配下以外の参照を早く見つけるための検査として使う。1.0ではService Workerを登録しないため、オフライン起動と更新切替はこの検査の対象外とする。手動実行もできる。
