> この文書は2026年9月8日の監査時点の記録です。実装後の進捗と検査結果は[改善進捗](quality-improvement-progress.md)を参照してください。

# ワナワナ — 実装監査と改善実装計画

監査日：2026年9月8日（UTC）
対象：[chameleonjp-lab/wanawana](https://github.com/chameleonjp-lab/wanawana)
固定した実装：main / 408bc6b0abf9c99bd18323435af8dbab0703ac16
監査方式：Astra Highによる独立コア監査に、再現試験、計画との照合、画面・連携の確認を統合。本書もAstra Highで独立再点検し、CPU状態保存・長時間検査・点滅上限・公開前試遊人数の4点を補強した。
今回の成果：監査と実装計画。ゲームのソース変更、PR作成、mainへの変更、スコア送信は行っていない。

## 1. 結論と立て直しの方針

**現在は「罠や画面が一通り存在する」段階であり、「仕掛けを考え、相手を誘い、連鎖の結果に納得できるゲーム」としての合格は確認できない。** 当初計画との差は、素材の豪華さだけではない。公平なルール、狙える操作、対戦相手、学習導線、因果が見える演出が同時に不足している。

特に、CPUの遠隔設置、壁を貫通する吹き飛ばし、同時爆発の処理順で変わるダメージ、罠の責任者の誤判定を再現した。これらが残ると、プレイヤーが地形や相手の動きを読んでも、結果を予測できない。追加面ではCPUが壁に止まり、150秒間ほぼ対戦にならないケースも再現した。

**固定tick・整数座標・既存の保存や描画基盤を残し、対戦の中核を段階的に作り直す。** 修正順は「裁定と行動契約 → 人の操作と危険表示 → CPUと練習 → 意図した連鎖の試遊 → 美術・音・最終仕上げ」とする。PixiJSを維持した2D表現で、当初のからくり劇場へ近づけられる。エンジン変更や全面書き換えを先行させる根拠はない。

到達させる体験は次の5場面で定義する。

| 場面 | プレイヤーがすること | ゲームが返す情報・気持ちよさ |
|---|---|---|
| 始める | 名前を決め、すぐ遊び始める | 短い実演、押す場所の明確さ、最初の成功への案内 |
| 仕込む | 罠の順序と向きを考える | 足元の設置予告、向き、費用、準備状態が一致する |
| 誘う | 相手の動きを読み、誘導弾で運ぶ | 狙った方向へ押せる。相手も同じ制約を守る |
| 連鎖する | 準備した罠をつなげる | 実際の発動位置・範囲・1→2→3の順序が見え、音が積み重なる |
| 振り返る | 成功・失敗の理由を知り、再戦する | 「誰がどう運んだか」と次の一手が分かり、すぐ再戦できる |

以後の進捗は、機能数やPR数ではなく、この体験を証明したかで判断する。READMEの「M7を進行中」は工程上の記載であり、M3の遊びの合格を意味しない。

## 2. 監査の基準、実施範囲、限界

### 2.1 正とした計画と変更履歴

基準は、リポジトリ内の[実装計画書 v0.2](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/docs/implementation-plan.md)。初期のアイデア断片より、この文書の150秒・9×13・5罠・ハネ板固定などの具体的契約を優先した。

[PR #61](https://github.com/chameleonjp-lab/wanawana/pull/61)で後から追加された名前入力・共有・オンラインTop10も、現在の対象機能として扱う。旧計画やREADMEにランキング対象外とあることを理由に、実装済み機能を削除する計画にはしない。計画とREADMEの追記が必要である。

添付「実装組織図.txt」の標準分担を読み、今回の監査担当は明示されたAstra Highを優先した。実装へ進む場合の分担は第8節に記す。

### 2.2 実施結果

| 確認 | 結果 | この結果が証明する範囲 |
|---|---|---|
| npm run check | 成功。24ファイル・115テスト合格 | 現在書かれた検査、型検査、ビルドの成立 |
| npm run verify:dist | 成功。15ファイル・参照資源13件を確認 | 配布物の構成・参照・既定の配信境界 |
| 独立したコア再現試験 | 18件を記録 | 特定状態のルール不具合、3面×3難度の無入力対戦 |
| 現行100試合の追加計測 | 2連鎖以上32/100、時間切れ65/100、未装備罠の設置命令307回 | 現行の固定入力行列の性質。人の勝率や意図した連鎖率ではない |
| 公開タイトル画面 | DOMと画面を確認 | 1363×936の観察環境での導線と非表示不具合 |
| ランキング連携 | 呼出コードとDBの関数定義・ゲーム設定を読み取り確認 | RPC引数の整合性、現在の集計・送信契約。実送信の成功率ではない |
| 定期決定性CI | 直近5回の成功を確認 | 当該ワークフローの検査範囲内の成功 |

ローカル実行環境はNode v24.19.0 / npm 11.9.0。CIの固定Node版24.14.0とは異なる。直近の定期実行の一例は[この実行記録](https://github.com/chameleonjp-lab/wanawana/actions/runs/34163501647)。

**未確認**：iPhone 17 Pro実機の操作感、Safari実機性能、スマートフォン寸法でのゲーム中の実描画、初見の人の試遊、音楽・効果音を聴いた印象、オンライン送信の実通信。今回のブラウザではローカル検証ページを開けず、公開ページではタイトルの観察までとした。公開ページの配布commitと監査commitの完全一致も証明していない。モバイル配置・ゲーム中の表示に関する指摘は、実測と静的確認を明記して分ける。

以下の「再現」は実行結果、「静的」はソースで確認した経路、「設計評価」は当初の体験目標に照らした判断、「リスク」は未再現の懸念を表す。性能不足や通信障害を、未測定のまま断定しない。

## 3. 当初計画との差分

| 領域 | 当初の完成条件 | 現在の実装・監査結果 | 改善の方向 |
|---|---|---|---|
| 対戦の核 | 足元設置と誘導を読み合い、因果のある2〜3連鎖 | 遠隔設置、押しの壁抜け、誤帰属を再現 | コアの行動・衝突・因果契約を修復 |
| 公平な同時裁定 | 同じ時刻の効果は共通の状態から判定 | 爆弾のID交換でHP60/80に分岐 | 同時効果を収集して一括適用 |
| 操作 | 短押し自動照準、ドラッグ方向指定、独立した罠方向 | 射撃は常に8方向自動。罠方向は移動入力と結合 | 移動・照準・罠方向を独立させる |
| 隠し情報 | 設置動作、方向を示さない警告、発動後の対処が読める | CPUの観測境界が未分離。敵の導火・発動中ガスが描画対象から外れる | 共通の公開情報から人とCPUへ渡す |
| CPU | 地形を使い、既知情報で2〜3罠を準備する | 単軸直進で壁に停止。罠種類の切替を計画と扱う | 経路・停滞回復・小さな罠計画を導入 |
| 練習 | 自分で仕掛け、人形を誘い、無料で再試行する | 敵の自動配置済み連鎖に自分がかかって進む | 実演と実践を分け、本番操作で合格させる |
| スマホ画面 | 盤面と主要操作が1画面に収まる | 幅優先の盤面と縦積み操作。小画面で幅不足の静的根拠 | 利用可能な幅・高さから全体を同時設計 |
| 美術・演出 | 明るいからくり劇場、2人の輪郭差、8動作、連鎖糸と番号 | 描画部品はあるが暗い盤面・汎用発動輪が中心。独立した勝敗動作なし | 判定を読める演出を先に、作品の美術を後に仕上げる |
| 結果 | 最後の5秒、両者・弾・発動順・責任から学ぶ | 静止図と統計中心。履歴と説明が不足し、再戦が下にある | 決着の原因を短く再現し、再戦を先頭へ |
| 検査 | 成熟盤面、同時裁定、敵対方針、実機、初見試遊 | 大量seedは1件4tick。通常の罠・連鎖・解除を動かさない | 実際に問題が起きる状態と人の成功を測る |

### 3.1 ギャップが拡大した主な理由

1. **工程の合格条件が「機能が存在する」に置き換わった。** 発射回数で練習を合格させる、罠種類が変わればCPU計画とする、時間切れまで進めば対戦試験を合格させる、という検査になっている。
2. **最終的に見せたい一試合を通して検証していない。** 誘導入力・CPU移動・罠の位置・発動表示・結果説明が個別に成立しても、つながった体験は成立しない。
3. **同じルールを複数箇所で解釈している。** CPUが指定できるセル、UIが表示する解除可否、描画が隠す敵罠、集計する連鎖がコアの意味とずれている。
4. **情報の正しさより見た目の部品追加が先行した。** 敵の発動中範囲が見えない問題は、罠の絵を精密にするだけでは解消しない。
5. **人の合格記録が開発判断に接続されていない。** 当初のM3停止条件に対応した初見試遊記録は、今回確認できた資料にはない。未実施と断定せず、証拠未確認として扱う。

個人やモデルの能力を原因とする監査ではない。受入条件と確認方法を変更し、同じ進め方で再び乖離しないようにする。

## 4. 優先度付き監査指摘

P0は対戦の成立・公平性、またはその保証を妨げるもの。該当修正と再確認が終わるまで、改善版を合格済みとして公開しない。P1は学習・操作・理解・継続に大きく影響するもの。P2は作品としての仕上げ。ただし美術を不要と判断する区分ではない。

### 4.1 コア、CPU、入力、練習

| ID / 優先 | 指摘とプレイヤーへの影響 | 根拠・再現 | 修正先 |
|---|---|---|---|
| A01 / P0 | CPUが足元から約3.09マス離れた場所へ設置する。設置動作を見ても罠位置を推測できない | 再現：seed1、45tick時CPU位置(5.4202,6.5)、罠セル(2,5)。19更新後に設置。ai.ts:147,308 / sim.ts:243 | PR02、PR06 |
| A02 / P0 | ハネ板の2.25マス移動が途中の壁を通り抜ける | 再現：gearworks、人物(3.5,3.5)→(5.75,3.5)、途中の壁(4,3)。fixed.ts:119が終点だけで早期帰還 | PR01 |
| A03 / P0 | 同時爆発のIDを交換するだけで被害が変わる | 再現：人物(4.7,6.5)、bombセル(3,6),(4,6)、導火残り1tick。HP60対80。sim.ts:962 | PR01 |
| A04 / P0 | 敵罠を歩いて踏んだ被害者が責任者になる。説明・連鎖・将来の評価を誤る | 再現：owner1のshock→target0、responsibleActor0、18ダメージ。sim.ts:696,761,782 | PR03 |
| A05 / P0相当 | CPUが壁へ入力し続け、試合が成立しないケースがある | 再現：無入力・seed1・3難度。crossroadsは各9000tick中8870tick不動、ringは8829tick不動。両面全難度でイベント0、HP100/100の引き分け。ai.ts:242,347 | PR06 |
| A06 / P1 | CPUが罠の着地点や次罠を計画していない。easyは自分の初期罠だけではダメージを与えられない | 静的：chainPlanningは時間による種類切替。easyはbounceのみ、normalもshockなし装備で実質bounceのみ。ai.ts:119 | PR06 |
| A07 / P1 | CPUへ全WorldStateを渡し、認知境界・記憶・最低反応時間がない | 静的：ai.ts:108,256 / difficulty.ts:57。tick剰余判定では新しい警告へ0tick反応しうる。隠し座標の不正利用自体は未実証 | PR06 |
| A08 / P1 | 誘導弾の狙いとハネ板方向を独立して操作できない。斜め移動は速く、斜め弾は実射程が短い | 静的：types.ts:87、controller.ts:170,174,253、sim.ts:276,1215、fixed.ts:162,223 | PR04 |
| A09 / P1 | 練習が「仕掛けて誘う」技術を教えない | 静的：tutorial.ts:56のカウンタ合格。main.ts:1324で敵bounce＋shockを配置し、自分で踏ませる。通常の資源を消費する | PR07 |
| A10 / P1 | 発見後の解除操作が伝わらず、表示上は解除可能でも無効と扱われる。射撃妨害時間も二重に減る | 静的：sim.ts:407で発見終了→押し直しが必要。main.ts:1234は未発見危険だけで無効表示。sim.ts:183,391で12tick停止を二重減算 | PR04 |
| A11 / P1 | スポーン禁止範囲、退場・復帰中の保護、時間切れ比較が予定と違う | 再現：スポーン足元設置を受理、退場中に爆風20ダメージ、復帰無敵30tickでも移動と発射、HP同値・解除5:0でも引き分け。sim.ts:142,189,983,1235 | PR02、PR03 |
| A12 / P0の証拠不足 | 現在の自動検査が、上記の破綻を合格として通す | 静的・計測：determinism-stress.test.ts:20は1seed4tick、設置・調査・CPU判断なし。balance.test.tsの条件に交絡と非合法装備指定がある | 全PRの回帰検査、PR09、PR12 |

A01の予告セル固定は、人の長押し中の移動にも関係する。「確定時の足元に突然置き換える」修正では、見せた予告と結果がずれる。PR02で予告開始から確定までの契約を明示的に更新する。

A03に加え、sim.ts:1278ではplayer0更新後にCPU側の処理が進み、同一tickでも照準対象の時点が異なる。先後の影響量は未測定だが、共通の開始状態を使う裁定へ併せて修正する。

因果については、モヤの行動制限から後続tickへ続く関係、親効果から1.5秒の期限、連鎖開始後に準備完了した罠の除外を表す状態も不十分である。無限連鎖を再現したという意味ではなく、元計画の契約が状態として表現されていない指摘である。

### 4.2 画面、演出、結果、ランキング

| ID / 優先 | 指摘とプレイヤーへの影響 | 根拠・確認区分 | 修正先 |
|---|---|---|---|
| B01 / P1 | 遊び始める・再戦する操作より、設定・記録・検証が前に出る。保存試合がなくても再開カードが見える | 公開DOM実測：開始ボタン上端1767.7px、ページ高1881px。resume-card is-hiddenでもdisplay:grid。styles.css:45,87 | PR04、PR08 |
| B02 / P0相当 | 未発見の敵ポン玉の導火と、発動中の敵モヤ範囲が見えない経路がある。避けるための情報が欠ける | 静的：main.ts:1096とtrap-render.ts:381が未発見敵罠を除外。sim.ts:753で発動しても発見状態を変更しない | PR05 |
| B03 / P1 | 発動位置・判定範囲・連鎖の順序が演出から分からない | 静的：drawTrapEventに罠種類・実範囲・親イベント・罠中心を渡さず接触点に汎用の輪を描く。main.ts:1156。通常マーカー30tickは元計画の最低36tick未満 | PR05 |
| B04 / P2 | からくり劇場の材質感、2人の演技、設置から勝利までの見せ場が不足する | 静的・設計評価：actor-render.ts:3は6状態。独立した被弾・吹き飛び・勝利・敗北なし。main.ts:1183の毎描画位置差では高頻度描画時に移動と停止が交互になりうる | PR10 |
| B05 / P1 | 結果が次の作戦につながりにくく、スコアが本人の成果と対応しない | 静的：設計図は直近36イベント中心、移動履歴はplayer0のみ、誘導弾の履歴不足。main.ts:304のスコアに両者共通maxChainを使用 | PR03、PR08、PR11 |
| B06 / P1 | ランキング送信と読込の失敗・旧結果の応答を区別しない | 静的：main.ts:345で送信と読込が同じtry、accepted未確認、試合IDによる応答隔離・timeoutなし。実際の障害発生は未確認 | PR11 |
| B07 / P1 | 小画面の盤面と操作の同時表示を保証できない | 静的：幅320時の内側約266pxに対し操作列最低約300px。盤面は幅優先aspect-ratio。装備外も含む5札で2段化。実機でのはみ出し量は未測定 | PR04 |

B04の毎描画差分は、60tickの位置更新に120Hzの描画を合わせる場合、更新のないフレームで停止判定となる設計である。実機でちらつきを観測したとは断定しない。向きも停止時に前の向きを保持せず初期方向へ戻す経路がある。

ランキングの読取監査では、現在のsubmit_scoreとget_best_score_rankingの引数名はクライアントと一致した。wanawanaはsubmission_mode=shared、score_order=descである。「RPCが存在しない」「引数が違う」という故障は確認していない。一方、投稿ごとに集計する現行関数には、このゲーム用の一意な試合IDによる重複防止がない。通信結果不明時の自動再送を追加すると二重計上しうる。

公開可能キーをapikeyとAuthorizationの両方へ入れている点も見直す。[Supabase公式のAPIキー説明](https://supabase.com/docs/guides/getting-started/api-keys)に従い、publishable keyはapikeyとして扱い、認証ユーザーのJWTとは分ける。現行環境で必ず通信失敗するという断定はしない。公開可能キーがソースにあること自体を秘密漏えいとは扱わない。

## 5. 実装前に固定する設計判断

以下は本計画の推奨仕様。元計画への補足・変更箇所を文書へ明記し、コードの都合で暗黙に変えない。

| 項目 | 採用する仕様 | ねらい |
|---|---|---|
| 基本ルール | 150秒、100HP、9×13、固定60tick、弾ダメージ0、罠5種、ハネ板＋追加2種を維持 | 壊れたルールとバランス変更を混ぜず評価する |
| 設置予告 | コアが予告開始時の足元セルを保持。予告中にそのセルから出たら取消。指を離すと受理済み予告を確定し0.30秒動作 | 遠隔設置をなくし、予告と実体を一致させる。セル離脱取消は追加仕様として記録 |
| CPUの設置 | 目的地へ移動してから、人と同じ予告・確定命令を通す | CPUだけの任意座標指定を廃止 |
| 射撃と移動 | 短押しは自動照準、ドラッグは方向指定。当初計画の256方向の整数表を用いる。移動は斜めも同じ速度、射程も方向で変わらない | 狙った誘導と公平な移動を成立させる。coreで実時間・三角関数を使わない |
| 罠の向き | 罠札ドラッグで独立した4方向。短押しは人物の最後の向きを初期方向とし、ドラッグ選択は予告中保持する | 向きを変えるためだけの移動を不要にする。人物の向きは停止しても保持 |
| 調査・解除 | 発見完了で止まり、次は対象と距離を示す「解除」に変える。近づいて押し直し、長押しで解除 | 見つけることと危険な接近を分ける。CPUも同じ状態遷移を使う |
| 発動後の情報 | 未発見の待機罠は隠す。導火開始・ガス発生後は、その公開効果と範囲を両者へ表示する | 公平な回避機会を作る。発見フラグの雑な一括変更で隠し情報を漏らさない |
| 人物の状態 | 通常・退場・復帰保護を一つの状態遷移で定義。退場中は当たり判定なし、復帰後0.5秒は無敵かつ行動不可 | 効果ごとに例外がばらつくのを防ぐ |
| 時間切れ | HP→相手へ与えた帰属付き罠ダメージ→本人に帰属する最大連鎖→解除数→引き分け | 元計画の優劣判定を実装し、画面に比較理由を出す |
| 美術 | 明るい木・塗装金属・真鍮・布の舞台、固定の軽い俯瞰、接地影と奥行き。戦闘中にカメラを振り回さない | 小画面で罠と人物を読みやすくし、作品の個性を戻す |
| 画面 | 初回は名前・開始・短い練習を主導線へ。設定、装備詳細、記録検証は別画面または折り畳み。戦闘は装備中の3札だけを表示 | 名前・共有・ランキングを保ち、遊びを始めやすくする |
| 保存互換性 | 物理・行動・入力・イベント変更は実装版・調整値hash・入力版で管理。互換のない中断・リプレイは理由付きで拒否 | 古い試合を新ルールで誤再生しない。名前や設定等の無関係なデータは維持 |

### 5.1 コードの境界

コアは「受理された操作、判定、因果、公開できる事実」を決める。入力は人の操作を共通命令へ変換する。CPUは公開観測から同じ命令を選ぶ。描画は公開事実を表現し、命中範囲や責任者を独自に再計算しない。

main.tsは2,262行に集中しているため、修正対象に合わせて画面管理・対戦描画・ランキング通信を順に切り出す。一括したファイル移動だけの大規模変更は作らず、各PRで直した振る舞いの責任境界を分離する。

CPU用CpuObservationには、公開地形、自他の公開状態、自分の罠、発見済み罠、共通危険表示、設置動作からの粗い疑い領域だけを渡す。全罠配列を渡して関数内で読まない約束をする方式から、データ自体を渡さない方式へ変える。

連鎖イベントには、原因・責任者・対象・罠中心・接触点・効果範囲・発生tick・親イベント・有効期限を保持する。射撃は原因として残し、罠の連鎖数には加えない。同じ因果データを戦闘演出・結果・集計へ使う。

## 6. 改善実装計画：12本のDraft PR

以下は実装時の作業単位であり、今回PRを作成したという意味ではない。各PRは「問題の再現 → 修正 → 回帰確認」を含む。テストを赤のままmainへ入れない。予測日数より、依存関係と合格条件を優先する。

| 順序 | PR | 主な成果 | 依存・判断点 |
|---:|---|---|---|
| 1 | PR01 衝突と同時裁定 | 壁抜けとID順依存を解消 | 最優先 |
| 2 | PR02 共通行動と復帰 | 足元設置、予告取消、退場・復帰を統一 | PR01 |
| 3 | PR03 因果と勝敗 | 正しい責任者、連鎖、時間切れ理由 | PR01・02 → G0 |
| 4 | PR04 操作とスマホ配置 | 狙える射撃、独立した罠方向、1画面操作 | PR02・03 |
| 5 | PR05 読める危険と連鎖 | 発動後の公開情報、実範囲、番号と仕掛け糸 | PR03・04 |
| 6 | PR06 CPU再構築 | 公平な観測、経路、合法設置、2罠計画 | PR02・03・05 |
| 7 | PR07 練習と初回導線 | 自分の仕掛けで人形を誘導する練習 | PR04・05・06 → G1 |
| 8 | PR08 学べる結果 | 決着の原因、両者の短い再現、即再戦 | PR03・05・07 |
| 9 | PR09 実戦バランスと試遊 | 有効な全装備、対称面、敵対方針、初見記録 | PR06・07・08 → G2 |
| 10 | PR10 美術・音・演技 | からくり劇場としての統一された仕上げ | G2合格後 → G3 |
| 11 | PR11 ランキング連携整理 | 本人の成果、送信状態、古い応答の隔離 | PR03・08。公開前に必須 |
| 12 | PR12 実機・配布物の最終確認 | ブラウザ一致、復旧、保存、5試合性能 | 全PR → G4 |

### PR01：衝突と同時裁定を正す

対象：src/core/fixed.ts、sim.ts、types.ts、tests/core/obstacles.test.ts、sim.test.ts。

作業：移動線分全体と人物半径で最初の壁接触を求める。通常移動・弾押し・ハネ板・爆風を同じ解決へ通す。tick内の同時効果を共通の状態から収集し、ダメージと押しを一括反映する。接触・導火終了・爆発・強制移動・次の接触の位相と同時判定を文書化する。player0とCPUの参照時点も揃える。

受入条件：A02の人物が最初の壁の手前で停止する。A03のID交換で両方が40ダメージとなる。途中の罠を飛び越さず発動し、壁の向こうの罠は発動しない。同時撃破、壁角、重なる爆風を含め、エンティティ配列の順序・意味を保つID置換で結果が変わらない。別IDの生hashを直接比較せず、同じ物理的結果へ正規化して比較する。

提出物：失敗を再現したfixture、修正後のイベント列、処理位相の説明。見た目の変更はこのPRの合格根拠にしない。

### PR02：人とCPUの行動契約、退場・復帰を統一する

対象：src/core/types.ts、sim.ts、ai.tsの命令互換部分、src/input/controller.tsの予告連携、resume.ts、replay.ts、対応するテスト。

作業：予告開始・取消・確定を受理する共通命令を作る。セルはコアが捕捉し、CPUの任意セル指定をなくす。予告セル離脱で取消、確定後0.30秒は移動・射撃停止、成功時のみ消費、押し・状態変化・中断で取消。スポーンから1.5マスの禁止範囲を適用する。退場中の全効果と復帰保護中の全入力・押し・ダメージを一貫させる。CPUはこの段階でも合法命令へ切り替え、経路高度化はPR06で行う。

受入条件：A01の遠隔セル指定を受理しない。予告開始と違うセルに立って確定しても、そこへ勝手に置かず取消となる。指・キーの中断で資源を失わない。人とCPUの同じ状態・命令が同じ可否になる。A11の退場中爆風は無効、復帰0.5秒は入力不可かつ全効果から保護される。新しい禁止範囲に合わせて練習・テストfixtureの開始位置も合法化する。

互換性：入力・中断保存・リプレイの版を更新し、旧版を理由付きで拒否する。既存の設定と名前は保持する。

### PR03：因果・連鎖・勝敗を共通のデータで決める

対象：src/core/types.ts、sim.ts、result.ts、hash.ts、balance.ts、replay.ts、resume.ts。

作業：自発移動・誘導弾・罠の強制移動・行動制限を区別する。自然に敵罠を踏む場合は設置者、弾で押した場合は射手、自分の罠へ自発接触した場合は自分へ帰属させる。次の罠は有効な親から責任者を継承する。90tickの因果期限、連鎖開始後に準備完了した罠の除外、8罠上限を実装する。継続ガスを単に時間が近いだけで他罠につなげない。本人別の対相手ダメージ・連鎖を集計し、時間切れ比較に使う。

受入条件：A04がresponsibleActor1となる。敵罠の利用・自滅・弾起点・ポン玉起点・行動制限起点を別々に検査する。無関係な近接時刻イベントは連鎖しない。HP同値のA11は解除5の側が勝ち、画面にも比較した項目が出る。合法な成熟盤面でイベント上限に達した場合は合格にせず原因を修正する。技術的無効を勝利・戦績・送信対象へ混ぜない。

版管理：罠数値・地形・AI調整値をhash対象へ集約する。現在はtypes/fixedだけが対象で、sim内のダメージ定数等を網羅できていない。すべて自動追跡したと称さず、対象一覧と実装版更新規則を併記する。

### PR04：狙える操作と、スマホで収まる戦闘画面を作る

対象：src/input/controller.ts、src/core/fixed.ts・types.ts・sim.ts、src/styles.css、index.html、src/app/viewport.ts・orientation.ts、main.tsの入力と画面部分。

作業：独立した照準・罠方向の入力を共通命令へ渡す。予告線と実弾は同じ方向表を参照する。斜め移動・弾の距離計算を揃える。「調べる」「近づいて解除」「解除中」「中断」を状態と進捗で示し、危険表示1.6/1.8、解除表示0.8/0.95の境界を分ける。射撃妨害の停止tickを一箇所で減らす。

画面は利用可能な幅と高さから盤面・HUD・3枚の罠札・操作領域を同時に割り付ける。主要ボタン48px以上、移動・射撃パッド96px以上、解除56px以上、端から8px以上、セル22px以上を基準とする。小高さでは罠札を盤面横の縦列へ移すなど、配置を変えて余白を確保する。文字と盤面を一律に縮めない。高さ不足を黙って隠す実装も避ける。

受入条件：320×480、320×568、375×667と、実測したiPhone 17 Proの利用可能領域で、盤面・残HP・時間・全主要操作が画面内にある。縦横スクロール、操作重なり、safe areaへの侵入がない。これはCSS viewportの検査寸法であり、iPhoneの物理仕様を表す数値ではない。2本指で移動しながら照準・設置でき、pointercancel・capture喪失・回転・背景化・日本語入力からの復帰で押しっぱなしや二重発射にならない。

タイトルの先頭へ名前と開始を置き、設定・検証を整理する。保存がない再開カードを確実に非表示にする。デスクトップでは縦長のゲーム領域を配置し、横長ウィンドウというだけで操作不可にしない。タッチ端末の回転時は安全に停止する。

### PR05：危険と連鎖が、実際の判定どおり見えるようにする

対象：src/core/types.ts・sim.ts、src/app/trap-render.ts・motion.ts、main.tsの描画部分、新規の公開表示状態の変換。

作業：待機中の隠し罠と、公開された発動効果を別の表示状態にする。ポン玉は導火0.75秒を逃走可能な予告として、モヤは有効な3.5秒間の範囲として描く。全罠について罠中心・接触点・押し方向・実範囲を区別する。因果付きの仕掛け糸と1→2→3の番号、射撃起点、解除の進捗・中断を表示する。

受入条件：未発見の待機敵罠は見えず、導火やガス発生後は両者に見える。発動表示の範囲はコアの判定半径と一致する。発動の主要輪郭を最低0.6秒、連鎖の糸と番号を連鎖終了後1秒残す。粒を消しても範囲・順序・所有者が読める。「音なし＋軽量＋動きを減らす＋グレースケール」で必要情報と勝敗が変わらない。同時発動を合算し、画面全体で任意の1秒間の点滅を3回以下に制限する。超過する発光は持続する輪郭に置き換える。

提出物：同じseed・同じ場面の通常/軽量/低動作表示。画像の色の一致だけでなく、見えてよい情報と範囲を確認する。

### PR06：CPUを公平な対戦相手へ作り直す

対象：src/core/ai.ts・difficulty.ts・resume.ts・replay.ts・hash.ts、新規のCpuObservation変換・記憶・経路・計画状態、対応するAI・保存・再生テスト。

作業：全WorldStateへのアクセスをやめ、共有の公開情報から観測を作る。設置動作は粗い2×2領域の疑いと期限へ変換する。新しい手掛かりの観測tickから反応待ちを数える。公開地形の経路探索、停滞検出、目標更新を導入する。2罠の役割・設置順・着地点・準備時間・費用・退路を持つ小さな計画を作り、合法に移動して設置する。

難度は、反応猶予、狙いの誤差、計画の深さ、見落としで差をつける。easyにもダメージへつながる分かりやすい計画を持たせる。hardに隠し情報・瞬間反応・資源優遇を与えない。

CPUの記憶、観測履歴、反応待ち、経路、罠計画、乱数状態は決定論的なセッション状態として保存・復元する。中断再開はその状態を継続する。リプレイは記録済みの受理CPU命令を使う方式を維持し、再生中にCPUを再判断させる検査とは区別する。状態の版と、core hash／CPU状態hashの対象を明示する。

受入条件：A05の9試合で壁への移動要求を続けたまま2秒以上停止しない。意図した待機・設置動作とはログで区別する。この2秒は新しい技術的停滞検出の初期上限であり、人の勝率目標ではない。通常CPUが初期装備の合法な2罠を自分で準備し、誘導起点付きで相手へ連鎖させるfixtureが通る。全6装備で使えない罠を命令しない。同じ観測履歴のまま隠し罠の座標を変えても、観測差が生じるまでCPU命令列が変わらない。中断前後で記憶・反応待ち・計画が失われず、停止中は進まない。中断なしと同じ受理命令・結果になり、記録済み命令を用いた再生も一致する。

### PR07：自分で仕掛ける練習と初回の流れを作る

対象：src/core/tutorial.ts、main.tsの練習制御、練習専用の状態・目標判定、タイトル画面。

作業：5秒程度の省略可能な実演から、60〜90秒を目標にした4段階へ導く。①誘導弾で人形を指定領域へ押す、②自分でハネ板を置き人形を乗せる、③次の罠を自分で加え2罠連鎖を起こす、④警告から発見し距離を詰めて解除する。資源無消費、即時リセット、2回失敗でヒント、3回で実演とする。時間切れで説明なく追い出さない。

受入条件：発射回数や設置回数だけでは進まない。他人が用意した罠へ自分が落ちても実践合格にならない。設置者・責任者・対象人形・親イベントから成功を判定する。完了後の初戦は固定3罠で始まり、再び装備選択へ戻さない。練習を飛ばした人も後から1タップで戻れる。

G1では同じ実装を用い、「練習→通常CPU1試合→結果→再戦」まで一本で確認する。初見人数の合格判定は、結果画面も整うG2で実施する。

### PR08：結果を次の作戦につながる画面にする

対象：src/core/result.ts、イベント記録、main.tsの結果・設計図・共有文、新規の結果表示モジュール。

作業：勝敗理由、決着に関わった連鎖、次に変えられる一手を先に示す。「もう一度」を主操作にし、同条件で即再戦する。両者の最後の5秒、弾、罠中心、発動順、設置者、責任者を含む短い再現を作る。全罠の静止設計図と詳細統計は下位に置く。履歴が不足する中断再開試合では不足を表示し、存在しない軌跡を作らない。

共有文とスコア候補には、PR03の本人別集計を使う。計算の意味とランキングの互換性をPR11で確定するまで、新旧スコアを同じ順位表へ混ぜて公開しない。開発用hash・リプレイJSON・性能表示は詳細の中に置く。

受入条件：敵だけの連鎖で本人の最大連鎖を加点しない。自滅・敵の罠利用・弾起点の仕掛けを正しく説明できる。結果直後、画面をスクロールせず再戦できる。モックの集計だけでなく、実際の試合イベントから結果・共有文までを確認する。

### PR09：有効な実戦検査と初見試遊で、遊びの核を判定する

対象：src/core/maps.ts・difficulty.ts、tests/core/balance.test.ts、determinism-stress.test.ts、docs/m7-balance-audit.md、試遊記録。

作業：大歯車劇場のスポーン(2,6)/(7,6)を含め、3面の壁・開始位置を180度対称にする。ハネ板固定の合法な6装備を生成し、正規化前の別装備を命令しない。通常難度の100試合を独立した評価セットとして固定し、3面・6装備の配分を先に記録する。通常以外の難度は別集計する。

通常セットと別に、逃げ続ける・射撃連打・入口待ち・高ダメージ罠偏重・調査の連続妨害の5方針を用意する。各方針を、固定seedと左右交換の組ごとに撃破または9000tickまで実行し、seed数・試合数・総実行tick数を記録する。全組合せを網羅したと呼ぶ場合は実数を示し、100試合に全組合せを押し込んだと称さない。成熟した罠・導火・モヤ・退場を含む開始状態からの検査も同様に終了まで実行し、4tickの初期スモークに置き換えない。

受入条件：未装備命令0、技術的無効0、原因不明の長期停滞0。設置成功/取消、誘導弾命中、解除成功/中断、罠別参加、本人別連鎖、自滅、終了理由を記録する。通常100試合で2罠以上が60試合に達するか判定し、偶然・自滅・CPUのみ・本人が誘導した連鎖を別々に併記する。総連鎖数だけを増やして合格させない。

初見10人で、口頭補助なし練習完了8人、3試合以内の意図した2罠連鎖7人、敗因を説明できる8人を確認する。さらに再戦選択50%以上を初期目標とする。未達時は記録した失敗箇所に戻り、操作・CPU・地形・距離等を一要因ずつ修正する。参加者へ自動連絡はせず、募集・実機試遊は担当者の実施として扱う。

### PR10：からくり劇場の美術・演技・音を仕上げる

対象：src/app/actor-render.ts・trap-render.ts・motion.ts、盤面描画、src/audio/sound.ts、必要最小限の素材。

作業：床・障害物・舞台縁・観客の材質と明度を統一する。2人は道具袋を持つ角のある輪郭と、ゴーグルを持つ丸い輪郭で識別する。待機・移動・設置・解除・被弾・吹き飛び・勝利・敗北の8動作を作り、射撃の予備動作も重ねる。向きと動作状態を固定tick側の表示用状態として保持し、描画頻度から推定しない。

5罠は形だけでなく、設置・準備・待機・発動・終了を見分けられるようにする。接地影と高さで立体感を出し、常時の格子線や装飾を強調しすぎない。音楽は1曲3層、効果音は20〜25種、観客反応は6〜8種を当初の制作目安とし、必要な情報音と装飾音を分ける。音楽・効果音の音量を個別に調整可能にする。

受入条件：人物の主要輪郭24px、罠18px、重要図形の背景との明暗差3:1、通常文字4.5:1を検査する。30/60/120相当の描画頻度で向きや移動動作が不要にリセットされない。演出によって固定tick、入力受付、勝敗を止めない。低動作表示でもヒット・方向・範囲・連鎖順・決着が分かる。同時発動・観客・決着を合算して任意の1秒間の点滅は画面全体で3回以下とし、PR05の制限を装飾追加後も守る。実機の最悪条件で5試合を計測し、重ければ装飾・解像度から調整する。

提出物：同一場面の通常/軽量/低動作表示と、設置→誘導→3連鎖→決着の短い確認動画。素材の制作元・利用権も記録する。

### PR11：ランキングを本人の成果と正しい通信状態に合わせる

対象：main.tsのscoreForRanking・callRankingRpc・submitAndLoadRanking、新規src/services/ranking.ts、ランキング表示。DB変更が必要ならゲーム単位の別変更として具体化する。

作業：まず本人別連鎖を使う計算と、既存の残HP・解除・勝敗加点を文書化する。現行ランキングには異なる面・難度が混在し、スコアをクライアント申告で受けるため、競技としての比較・不正防止には限界がある。今回の改善を理由に認証・大規模サーバー検証を一括導入しない。

推奨は、新計算をバージョン付きランキングとして区別し、旧記録は旧ルールとして保持する。共通DBの他ゲームや既存の集計を一括変更しない。実装時には新しいゲーム内区分・集計先・表示・移行方法を具体的な差分で提示する。区分を安全に作れない場合は、計算だけを先行公開して混在させない。

送信と順位読込の状態を分け、応答のacceptedを確認する。試合・結果表示ごとの識別子で古い応答を破棄し、待ち時間の上限を設ける。既存のasync-operation-gate等の仕組みを必要に応じて使う。名前・共有・Top10を維持する。順位の再読込は可能にするが、送信結果不明時に無条件でスコアを再送しない。一意な試合IDで重複を防ぐ契約を導入する場合だけ、自動再送を許可する。

受入条件：成功、HTTP失敗、accepted=false、送信成功後の順位読込失敗、タイムアウト、再戦後に届く旧応答、二重操作を、実データを書き換えないテスト環境で検査する。現在の試合が古い結果で上書きされず、失敗しても再戦できる。キー・RPCの契約を公式仕様と実際の環境で確認する。

### PR12：本番と同じ配布物で実機・復旧・公開条件を確認する

対象：.github/workflows/ci.yml・pages.yml、ブラウザ試験、保存・復旧試験、docs/m8-*、README、最終監査記録。

作業：重要な回帰fixtureと成熟した試合をChromium/WebKitで再生し、同seed・受理命令列の中間/最終hashを照合する。描画頻度を変えてもコア結果が一致することを確認する。WebGL/Canvas、背景化、回転、capture喪失、音の再開、保存拒否、旧版/破損保存、描画領域喪失・復帰を一連の利用経路で確認する。

受入条件：iPhone 17 Proの本番成果物で、8罠・モヤ2範囲・弾上限・最大装飾を含む150秒の試合を5回連続計測する。当初基準のフレーム間隔p95≤20ms、p99≤34ms、100ms超0回を確認する。端末・OS・Safari版・commit・設定・計測区間を記録し、ブラウザの端末エミュレーションを実機性能合格としない。

iPhone 11 Pro・iPad Pro 2018の軽量基準も元計画の対象として残し、入手できない場合は「未検証」と明記する。確認済みの端末範囲を拡大して表現しない。同一artifactを検査から公開まで使い、既存の配布物検査と公開後スモークを維持する。最終資料には未解決事項と既知の制約を残し、ユーザーの最終判断へ渡す。

## 7. 合格ゲートと検査の再設計

### 7.1 工程を進める条件

| ゲート | 判断時点 | 必須の証拠 | 未達時の戻り先 |
|---|---|---|---|
| G0 ルールが信用できる | PR03後 | 遠隔設置・壁抜け・同時爆発・誤帰属・退場/復帰の再現が解消。勝敗理由が一致 | PR01〜03 |
| G1 一試合としてつながる | PR07後 | 同じプレビューで練習→通常戦→結果→再戦。合法な設置と誘導、動くCPU、公開された危険 | PR04〜07 |
| G2 意図した連鎖が遊びになる | PR09後 | 通常100試合の内訳、5敵対方針、初見10人の7人/8人基準、再戦率 | 操作・CPU・練習・地形。素材の量産を開始しない |
| G3 作品の表現と必要情報が両立する | PR10後 | 統一された舞台・人物・罠、無音/低動作の理解確認、実機5試合性能 | 演出と配置。ルールを遅くして隠さない |
| G4 改善版の公開候補 | PR12後 | P0解消、必要なP1解消、ブラウザ一致、保存復旧、ランキング契約、実機、初見20人以上の記録、独立レビュー | 該当PRへ。未確認を合格扱いしない |

G2の10人は初期判定であり、十分な統計的保証ではない。公開候補では元計画に沿って20人以上の初見試遊記録で、操作開始中央値60秒以内、結果到達85%以上、再戦50%以上、技術的停止のない試合98%以上も確認する。未実施・未達ならG4は未合格とする。限られた範囲の検証版として提示する場合は、その扱いと未確認項目を別途明記する。G2の参加者を含めるか、新規参加者かを記録して混同しない。

55%を超えて勝ち続ける単純方針、選択罠の装備率75%超/25%未満は、元計画の見直しトリガーとして用いる。少数試合の1回の超過を統計的に確定した優劣と呼ばず、試合数・左右交換・再現性を併記する。

### 7.2 検査で測るものを変える

| 検査層 | 必ず通す状態・経路 | 合否の見方 |
|---|---|---|
| コア境界 | 壁角、2.25マス押し、同時爆発、重なった罠、退場、復帰、9000tick境界 | 位置、ダメージ、責任者、受理命令、結果理由を直接照合 |
| 対称性 | IDの意味を保った付替え、配列交換、180度回転＋役割交換 | 同じseed/命令の通常再生hashと、対称変換後の正規化結果を区別 |
| CPU | 同一観測/異なる隠し状態、壁際経路、停滞、全装備、反応遅延、実際の2罠計画 | 見えない情報で命令が変わらず、合法に行動し、計画を実行できる |
| 実戦 | 通常100試合、別枠の5敵対方針、成熟盤面の長時間実行 | 終了だけでなく、誘導・設置・解除・因果付き連鎖・自滅・停滞の分布 |
| 入力と画面 | 2本指、方向ドラッグ、取消、低いviewport、safe area、回転、設定併用 | 表示と実入力が一致し、主要操作が隠れない |
| 継続利用 | 初回、練習、対戦、結果、再戦、中断再開、旧版保存、通信遅延 | 一つの利用経路で二重開始・二重送信・古い表示を起こさない |
| 人の理解 | 何を狙ったか、なぜ負けたか、次に何を変えるか | 観察と本人の説明。hashや自動CPUの結果で代替しない |

現在の大量seed試験は「初期状態の決定性スモーク」として役割を明記して残せる。seed数を増やすことより、罠が準備・発動している状態を検査へ入れることが先である。

試遊記録は、仮ID、初見/経験者、commit、端末・設定、練習完了、意図した連鎖の成否、敗因説明、再戦選択、具体的な詰まりだけを基本とする。名前入力・オンラインランキングとは集計を分離し、試遊の正確な移動履歴を勝手に外部送信しない。

## 8. 実装体制、PRの提出物、判断の残し方

| 責任 | 担当 | 本計画での仕事 |
|---|---|---|
| 作品の最終責任 | ユーザー | ゲームとしての方向、節目の試遊、公開判断 |
| 今回の監査・改善計画レビュー | Astra High | 重大不具合、仕様差、優先順、受入条件の独立確認 |
| 企画・設計・最終判断支援 | Sol High | 添付組織図の標準に沿い、計画の変更理由と遊びの合格を管理 |
| 日常の実装・進行 | Luna Max | 依存順に小さなDraft PRを作り、具体的な再現と修正を提示 |
| 複雑な検査・不具合調査、反復記録 | Luna Max | fixture、CPU計測、実機手順、失敗原因の記録 |
| 原因不明・安全性・重大判断 | Sol Extra High | 同時裁定、隠し情報、保存互換性、連携変更で判断が割れた場合 |
| 公開前の独立レビュー | Sol Highを標準とし、Astra High指定時はその指示を優先 | 実装担当の自己申告だけでG4を通さない |

各PRには、①困っていたプレイ場面、②変えた挙動、③当初仕様を維持/変更した箇所、④再現入力と結果、⑤画面変更なら同じ場面の比較、⑥保存・連携への影響、⑦残る未確認点を添える。ユーザーにはコマンド実行を前提とせず、開けるプレビューと短い確認手順を渡す。

READMEと計画には「実装済み」「自動確認済み」「実機確認済み」「初見試遊合格」を別々に記録する。G2に通っていない段階を、素材や面が増えたことだけで1.0完成相当へ繰り上げない。

この計画ではDraft PRまでを標準の提出単位とする。mainへのマージと公開は、完成した差分・証拠・既知の制約を見られる状態にしてから、既定のユーザー最終判断に従う。

## 9. 実装開始時の最初の指示

> ワナワナの監査基準commit 408bc6bを起点に、まずPR01「衝突と同時裁定」をDraft PRとして実装する。A02の壁抜けとA03の爆弾ID交換を修正前に再現し、swept衝突と同時効果の共通スナップショットで修正する。通常移動・誘導弾・ハネ板・爆風で同じ衝突契約を使う。物理的に等しい状態の正規化結果を比較し、単に配列をID順にするだけで解決としない。保存・リプレイ版への影響を記録する。修正後の証拠と残る既知不具合を添え、mainには直接変更しない。

最初の目標は、壁・位置・発動順をプレイヤーが信用できる試合へ戻すこと。そのうえで、初見でも仕込みと誘導を成功させられる操作・対戦相手・説明を作り、作品の美術を完成させる。

## 10. 根拠となるソース

すべて監査commit固定のリンク。各指摘の行番号はこの版を指す。

| 用途 | ソース |
|---|---|
| 当初仕様と成功指標 | [docs/implementation-plan.md](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/docs/implementation-plan.md) |
| 現在の工程・説明 | [README.md](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/README.md) |
| CPU候補・判断 | [src/core/ai.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/core/ai.ts#L147) |
| 衝突・方向・装備正規化 | [src/core/fixed.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/core/fixed.ts#L99) |
| 行動・発動・裁定・勝敗 | [src/core/sim.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/core/sim.ts#L243) |
| 命令・イベントの型 | [src/core/types.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/core/types.ts#L87) |
| 入力変換 | [src/input/controller.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/input/controller.ts#L170) |
| CPU難度 | [src/core/difficulty.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/core/difficulty.ts) |
| 練習の合格条件 | [src/core/tutorial.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/core/tutorial.ts#L56) |
| 結果集計 | [src/core/result.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/core/result.ts) |
| 地形・スポーン | [src/core/maps.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/core/maps.ts#L27) |
| 画面・描画・結果・ランキング | [src/main.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/main.ts#L304) |
| 画面寸法と非表示 | [src/styles.css](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/styles.css#L87) |
| 人物表現 | [src/app/actor-render.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/app/actor-render.ts) |
| 罠・発動表現 | [src/app/trap-render.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/app/trap-render.ts#L381) |
| 動作軽減・表示期間 | [src/app/motion.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/src/app/motion.ts) |
| 100試合の現行検査 | [tests/core/balance.test.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/tests/core/balance.test.ts#L135) |
| 大量seedの検査範囲 | [tests/core/determinism-stress.test.ts](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/tests/core/determinism-stress.test.ts#L20) |
| 過去のバランス監査 | [docs/m7-balance-audit.md](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/docs/m7-balance-audit.md) |
| CIの範囲 | [.github/workflows/ci.yml](https://github.com/chameleonjp-lab/wanawana/blob/408bc6b0abf9c99bd18323435af8dbab0703ac16/.github/workflows/ci.yml) |


## 11. 再現付録（実装担当向け）

### 11.1 無入力対戦の全9件

seed1、両者は初期装備。人側は9000tickまで無入力、CPUは現在の判断関数を毎tick呼び出した。不動tickには正常な設置動作・待機も含むため、単独ではスタック時間と同一視しない。追加面では壁への接近命令が8400回以上続くことも併せて確認した。

| 面 | 難度 | 結果 | HP 人/CPU | 罠イベント | 最大連鎖 | CPU不動tick / 9000 |
|---|---|---|---|---:|---:|---:|
| gearworks | easy | time-draw | 100/100 | 7 | 1 | 3196 |
| gearworks | normal | cpu-win | 82/100 | 3 | 1 | 8182 |
| gearworks | hard | cpu-win | 82/100 | 3 | 1 | 7887 |
| crossroads | easy | time-draw | 100/100 | 0 | 0 | 8870 |
| crossroads | normal | time-draw | 100/100 | 0 | 0 | 8870 |
| crossroads | hard | time-draw | 100/100 | 0 | 0 | 8870 |
| ring | easy | time-draw | 100/100 | 0 | 0 | 8829 |
| ring | normal | time-draw | 100/100 | 0 | 0 | 8829 |
| ring | hard | time-draw | 100/100 | 0 | 0 | 8829 |

### 11.2 現行100試合の追加計測

現行検査と同じ組合せ・入力を使い、連鎖・時間切れ・未装備罠命令を追加集計した。これは不具合を含む現行版の測定であり、修正後のゲーム品質予測ではない。通常難度だけでは2連鎖以上17/34。元計画の「通常100試合で60以上」と直接比較できる標本ではない。

| 面 / 難度 | 試合数 | 2連鎖以上 | イベント0 | 時間切れ |
|---|---:|---:|---:|---:|
| gearworks/easy | 12 | 4 | 0 | 12 |
| gearworks/normal | 12 | 6 | 0 | 12 |
| gearworks/hard | 12 | 0 | 0 | 12 |
| crossroads/easy | 12 | 6 | 0 | 12 |
| crossroads/normal | 12 | 6 | 0 | 11 |
| crossroads/hard | 10 | 0 | 0 | 0 |
| ring/easy | 10 | 0 | 0 | 0 |
| ring/normal | 10 | 5 | 0 | 6 |
| ring/hard | 10 | 5 | 0 | 0 |

全体：100試合、2連鎖以上32試合、イベント0は0試合、時間切れ65試合、未装備罠の設置命令307回。

### 11.3 再現方法

以下はソース監査のためのスクリプトで、ゲームの改善実装ではない。境界条件はワールドを直接組み立てて検査し、通常対戦はcreateWorldから進めている。DB・ランキング・公開サイトへの通信を行わない。

監査commitをチェックアウトしたwanawanaフォルダの親に、各コードブロックを指定名で保存する。監査時はNode v24.19.0で次のように実行した。ゲームのsrcや既存testsへ上書きする必要はない。

```sh
node astra-core-probes.mjs > astra-core-probes.jsonl
node astra-balance-probes.mjs > astra-balance-probes.json
```

ルールを修正した後は、まず変更前の再現を記録したうえで、PRの正式なfixtureへ移す。新しい命令型や版では、この監査スクリプトも対応する変更が必要になる。

#### astra-core-probes.mjs

```javascript
import {createWorld,advanceWorld} from './wanawana/src/core/sim.ts';
import {chooseCpuDecision} from './wanawana/src/core/ai.ts';
import {cellCenterUnits as c,movePlayerWithObstacles,BOUNCE_PUSH_UNITS} from './wanawana/src/core/fixed.ts';
import {getMapDefinition} from './wanawana/src/core/maps.ts';
const out=(label,value)=>console.log(JSON.stringify({label,...value}));
const trap=(patch={})=>({id:99,owner:1,kind:'shock',direction:1,cellX:3,cellY:6,armingTicks:0,remainingTicks:1800,discoveredBy:[false,true],...patch});
let world=createWorld(1);
for(let i=0;i<45;i++)world=advanceWorld(world,{},chooseCpuDecision(world).command);
let decision=chooseCpuDecision(world);
let next=advanceWorld(world,{},decision.command);
for(let i=0;i<18;i++)next=advanceWorld(next,{},chooseCpuDecision(next).command);
out('remote-placement',{tick:world.tick,cpu:[world.players[1].x/9600,world.players[1].y/9600],command:decision.command,traps:next.traps,placed:next.trapsPlaced});
world=createWorld(2);world={...world,players:[{...world.players[0],x:c(3)-5500},world.players[1]],traps:[trap()]};
next=advanceWorld(world,{moveX:1});out('natural-enemy-trap-credit',{events:next.events,hp:next.players[0].hp});
world=createWorld(3);world={...world,players:[{...world.players[0],x:c(3),y:c(3)},world.players[1]],traps:[trap({kind:'bounce',cellX:3,cellY:3})]};
next=advanceWorld(world);out('bounce-through-wall',{start:[world.players[0].x/9600,world.players[0].y/9600],end:[next.players[0].x/9600,next.players[0].y/9600],wall:[4,3],events:next.events});
world=createWorld(4);next=advanceWorld(world,{placeTrap:'bounce'});out('spawn-placement',{spawn:[world.players[0].x/9600,world.players[0].y/9600],accepted:next.players[0].placement});
world={...createWorld(5),tick:8999,trapsDisarmed:[5,0]};next=advanceWorld(world);out('timeout-tiebreak',{disarms:next.trapsDisarmed,result:next.result});
world=createWorld(6);world={...world,players:[{...world.players[0],respawnInvulnerableTicks:30},world.players[1]]};next=advanceWorld(world,{moveX:1,fire:true});out('invulnerable-actions',{moved:next.players[0].x-world.players[0].x,fired:next.shotsFired[0]});
for(const reverse of [false,true]){
 world=createWorld(7);world={...world,players:[{...world.players[0],x:4.7*9600},world.players[1]],traps:[trap({id:reverse?100:99,kind:'bomb',cellX:3,triggerTicks:1}),trap({id:reverse?99:100,kind:'bomb',cellX:4,triggerTicks:1})]};
 next=advanceWorld(world);out('same-tick-bomb-id-order',{reverse,hp:next.players[0].hp,events:next.events.map(e=>({trap:e.trapId,damage:e.damage,target:e.target})),x:next.players[0].x/9600});
}
world=createWorld(8);world={...world,players:[{...world.players[0],disabledTicks:40},world.players[1]],traps:[trap({kind:'bomb',cellX:2,triggerTicks:1})]};next=advanceWorld(world);out('bomb-hits-absent-player',{hp:next.players[0].hp,disabled:next.players[0].disabledTicks,events:next.events});
for(const map of ['gearworks','crossroads','ring'])for(const difficulty of ['easy','normal','hard']){
 world=createWorld(1,undefined,undefined,map);const reasons={};let moved=0, stationary=0;
 for(let i=0;i<9000&&world.phase==='battle';i++){
  decision=chooseCpuDecision(world,difficulty);reasons[decision.reason]=(reasons[decision.reason]??0)+1;
  next=advanceWorld(world,{},decision.command);
  if(next.players[1].x===world.players[1].x&&next.players[1].y===world.players[1].y)stationary++;else moved++;
  world=next;
 }
 out('idle-match',{map,difficulty,ticks:world.tick,result:world.result,hp:world.players.map(x=>x.hp),placed:world.trapsPlaced,events:world.events.length,maxChain:world.maxChain,cpu:[world.players[1].x/9600,world.players[1].y/9600],stationary,moved,reasons});
}
```

#### astra-balance-probes.mjs

```javascript
import {createWorld,advanceWorld} from './wanawana/src/core/sim.ts';
import {chooseCpuDecision} from './wanawana/src/core/ai.ts';
const loadouts=[['bounce','shock','hatch'],['bounce','shock','bomb'],['bounce','shock','moya'],['bounce','hatch','bomb'],['shock','hatch','moya'],['hatch','bomb','moya']];
const rows=[];
for(let i=0;i<100;i++){
 const scenario=['pressure','hold'][i%2],difficulty=['easy','normal','hard'][Math.trunc(i/2)%3],map=['gearworks','crossroads','ring'][Math.trunc(i/6)%3];
 const playerLoadout=loadouts[i%6],cpuLoadout=loadouts[(i+2)%6];
 let world=createWorld(10000+i,playerLoadout,cpuLoadout,map),rejected=0,attempts=0;
 for(let tick=0;tick<9000&&world.phase==='battle';tick++){
  const p=world.players[0],cpu=world.players[1],h=Math.abs(cpu.x-p.x)>Math.abs(cpu.y-p.y);
  const place=tick>=45&&(tick-45)%180===0?playerLoadout[Math.trunc((tick-45)/180)%playerLoadout.length]:undefined;
  const input={moveX:scenario==='hold'?0:h?Math.sign(cpu.x-p.x):0,moveY:scenario==='hold'?0:h?0:Math.sign(cpu.y-p.y),fire:tick%39===0,...(place?{placeTrap:place,trapDirection:1}:{})};
  if(place){attempts++;if(!world.loadouts[0].includes(place))rejected++;}
  world=advanceWorld(world,input,chooseCpuDecision(world,difficulty).command);
 }
 rows.push({i,scenario,difficulty,map,actualLoadout:world.loadouts[0],requestedLoadout:playerLoadout,result:world.result,tick:world.tick,hp:world.players.map(p=>p.hp),events:world.events.length,maxChain:world.maxChain,placed:world.trapsPlaced,disarmed:world.trapsDisarmed,attempts,loadoutInvalid:rejected});
}
const group={};
for(const r of rows){const key=r.map+'/'+r.difficulty;group[key]??={n:0,chain2:0,events0:0,timeout:0,result:{}};const g=group[key];g.n++;g.chain2+=Number(r.maxChain>=2);g.events0+=Number(r.events===0);g.timeout+=Number(r.tick===9000);g.result[r.result]=(g.result[r.result]??0)+1;}
console.log(JSON.stringify({summary:{n:rows.length,chain2:rows.filter(x=>x.maxChain>=2).length,events0:rows.filter(x=>x.events===0).length,timeout:rows.filter(x=>x.tick===9000).length,loadoutInvalid:rows.reduce((s,r)=>s+r.loadoutInvalid,0)},group,rows},null,2));
```
