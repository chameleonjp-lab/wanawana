# M8 公開後スモーク検査

`Verify published game` は、Pagesの公開ワークフローが成功した後に公開URLへ接続する。HTML、manifest、Service Workerを読み、HTMLとmanifestが参照するCSS・JavaScriptがすべてHTTP 200で取得できることを確認する。拡張子に対応するContent-Typeも確認するため、別内容をHTTP 200で返す設定を成功扱いにしない。

この検査はブラウザの描画性能やタップ操作を代替しない。公開物の参照切れ、CSP metaの欠落、Service Workerの版分離の失敗を早く見つけるための検査として使う。手動実行もできる。
