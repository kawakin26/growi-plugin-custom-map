# 拡張・開発ガイド

開発者向けに、ビルド手順、アーキテクチャ、拡張の勘所を説明します。

## 必要環境

- Node.js
- npm

## セットアップとビルド

```bash
npm install
npm run build
```

- エントリはリポジトリ直下の `client-entry.tsx`（Vite の manifest キーを GROWI の期待に合わせるため直下に配置）。実装は `src/` に分割されています。
- ビルドには [Vite](https://vitejs.dev/) を使用します（`vite build`、公式スクリプトプラグインと同じ構成）。
- ビルド成果物は `dist/` に出力されます。
  - `dist/assets/client-entry-*.js`: バンドルされたプラグイン本体
  - `dist/.vite/manifest.json`: ビルドマニフェスト（**GROWI が注入するスクリプトを解決するために必須**）

```{important}
GROWI はインストール時にリポジトリを **ビルドしません**。ZIP に含まれるファイルをそのまま使うため、`dist/`（`.vite/manifest.json` と `assets/` を含む）を **ビルドしてコミットしてから** push してください。manifest が無いと、GROWI はプラグインを検出しても `<script>` を注入せず、記法が反映されません。
```

## プロジェクト構成

```
.
├── client-entry.tsx       # エントリ（各機能を独立 try-catch で起動）
├── src/
│   ├── common.ts          # 共通ユーティリティ（添付解決 + アセット登録 API クライアント）
│   ├── viewer.ts          # 表示機能（directive 変換 + 地図モーダル）
│   ├── editor.ts          # GUI 編集機能（フローティングボタン + マーカー配置 UI）
│   └── register.ts        # 地図アセット登録（CAD 向き登録・画像原本登録 UI）
├── dist/                  # ビルド成果物（コミット対象）
├── docs/                  # 詳細ドキュメント（Sphinx / MyST Markdown）
├── vite.config.ts
├── package.json
├── tsconfig.json
├── LICENSE
├── README.md              # 日本語版（正規）
└── README.en.md           # 英語版（翻訳）
```

## アーキテクチャ

### 機能モジュールとリスク分離

`client-entry.tsx` は各機能を **独立した try-catch で起動** します。1 つが壊れても他に影響しないための設計（リスク分離）です。編集・登録機能は DOM に依存するため GROWI のアップデートで壊れる可能性がありますが、その場合でも表示機能は動き続けます。

```{list-table}
:header-rows: 1
:widths: 22 20 58

* - モジュール
  - 起動関数
  - 役割
* - `src/viewer.ts`
  - `activateViewer`
  - 記法 `:::custom-map` を地図モーダルに変換して表示する。閲覧時の中心機能。
* - `src/editor.ts`
  - `activateEditor`
  - 編集画面のフローティングボタン。「地図を作成」＝新規挿入、「地図を編集」＝ページ本文の既存 `:::custom-map` を読み込み再編集・上書き保存。
* - `src/register.ts`
  - `activateRegister`
  - ストックページのフローティングボタン。CAD を向き指定で別名登録、画像を原本のまま登録。削除は UI から廃止。
* - `src/common.ts`
  - —
  - 表示・編集で共有するユーティリティ（添付解決、設定読み取り、ラベル文字色判定、アセット登録 API クライアント等）。
```

### 編集機能の起動方法について

GROWI のスクリプトプラグインには、エディタのツールバーやコマンドを拡張する公式の拡張点がありません（公開されているのは `growiFacade.markdownRenderer`）。そのため編集機能は、エディタのツールバー DOM に依存せず、**編集画面（URL ハッシュ `#edit` ＋ CodeMirror の表示）を検出したら画面隅にフローティングボタンを出す** 方式です。

記法の挿入は、開く直前のカーソル位置（DOM Range）を保存し、挿入時に復元して `execCommand('insertText')` で行います。`execCommand` が失敗した場合はクリップボードへ退避して手動貼り付けを案内します。GROWI のアップデートで DOM 構造や挿入方式が変わった場合は、この検知ログとクリップボード退避を起点に対応します。

## 拡張の勘所

### GROWI の API 差異への対応

プラグインは GROWI の API（`/_api/v3/page`、`/_api/v3/attachment/list`）でページ ID と添付一覧を取得します。GROWI のバージョンでレスポンス構造が異なる場合は、`src/common.ts` の `getPageIdByPath` / `getAttachmentsForPage` の取り出し方を調整します。開発者ツールの Network タブで実際のレスポンスを確認するのが早道です。

### 画像解決ロジックの変更

平面図・参照写真の解決順は {doc}`syntax-reference` の「画像の解決順」に沿って `src/common.ts` / `src/viewer.ts` に実装されています。登録アセット優先 → その場変換 → 添付解決 → 静的パス、という段階的フォールバックを崩さないように変更してください。

### セキュリティ上の注意（XSS）

ファイル名・ページパスなどの **ユーザー由来の値** を DOM に描画する際は、`innerHTML` への文字列連結を避け、`textContent` や DOM ノード生成を使ってください（本プラグインは XSS 対策としてこの方針で実装されています）。

## ドキュメントのビルド

この詳細ドキュメント自体のビルド手順は `docs/README.md` を参照してください。ソースは MyST Markdown（`docs/ja/*.md`）で、HTML / PDF（lualatex）/ Markdown に変換できます。
