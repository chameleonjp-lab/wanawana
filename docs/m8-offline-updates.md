# M8 オフライン起動と更新の境界

一度オンラインで同じビルドの必須ファイルを取得した端末は、次回以降に `/wanawana/` をオフラインで開ける。Service Workerのscopeは `/wanawana/` に固定し、キャッシュ名も `wanawana-<buildHash>` だけを使う。ルートscopeや別作品のCache Storageへは触れない。

installでは、同じビルドの `index.html`、Vite manifest、JavaScript、CSS、追加素材を一括取得する。1件でも失敗した版はinstallを失敗させ、現在の版を残す。動作中のHTMLと分割ファイルを別版から補わない。

新しいworkerは待機させ、試合中に `skipWaiting()` や再読み込みを行わない。更新が準備できたことはタイトルまたは結果画面だけに表示し、利用者が「更新して再読み込み」を押したときだけworkerへ切替を依頼する。`controllerchange` を1回確認してから再読み込みするため、試合中の固定tickや中断保存へ更新処理を混ぜない。

Cache Storageの古い `wanawana-<buildHash>` は、新しいworkerのactivateが完了してから同作品のものだけを削除する。更新が失敗した場合は現在版を維持し、キャッシュを全消去して黒画面にしない。

受入条件は、オンライン取得後のオフライン再起動、試合中の更新待機、結果画面での利用者選択による切替、新版必須ファイル欠落時の旧版継続、`/wanawana/` 外の要求と他作品のキャッシュ不変である。初回の完全オフライン起動は保証しない。
