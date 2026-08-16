# M8 GitHub Pages公開の境界

`Deploy GitHub Pages` は、build jobで `dist/` を一度だけ作り、型チェック・テスト・本番成果物検査を通した後にPages artifactへ保存する。deploy jobはソースから再ビルドせず、そのartifactだけを公開する。

通常jobは `contents: read` だけを持つ。Pagesへの書き込みとIDトークンの権限はdeploy jobだけに与える。外部Actionは完全なcommit SHAで固定し、タグの移動や自動更新で検査対象と公開物が変わらないようにする。

公開前の確認では、GitHubリポジトリのSettings → PagesでSourceをGitHub Actionsに設定する。初回はActionsの `Deploy GitHub Pages` を手動実行できる。公開先は `/wanawana/` で、Service Workerのscopeも同じ範囲に限定する。
