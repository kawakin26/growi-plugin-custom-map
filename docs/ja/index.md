# growi-plugin-custom-map ドキュメント

事前にアップロードした平面図（建物内の各フロア図など）を、ウィキ文書内から **オリジナルのファイル名** で参照して表示する [GROWI](https://growi.org/) プラグインの詳細ドキュメントです。

このドキュメントは **日本語版が正規** です。英語版は翻訳であり、齟齬がある場合は日本語版を優先します。概要だけを知りたい場合はリポジトリの [README](https://github.com/kawakin26/growi-plugin-custom-map) を参照してください。本ドキュメントは、利用者・設置者・開発者それぞれ向けの詳しい手順とリファレンスを提供します。

```{toctree}
:maxdepth: 2
:caption: 目次

introduction
user-guide
syntax-reference
admin-guide
extending
```

## ドキュメントの構成

- **{doc}`introduction`** — プラグインの目的、できること、全体像。まず読むと理解が早い章です。
- **{doc}`user-guide`** — 一般利用者向け。地図の表示操作と、GUI での地図の作成・編集手順。
- **{doc}`syntax-reference`** — `:::custom-map` 記法の全属性リファレンス（手書き・自動生成の両方で役立ちます）。
- **{doc}`admin-guide`** — 設置者・管理者向け。インストール、設定、CAD 変換 API 連携、秘匿運用、セキュリティ、トラブルシューティング。
- **{doc}`extending`** — 開発者向け。ビルド手順、アーキテクチャ、拡張の勘所。

## 関連ドキュメント

- 変換 API（任意）: [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api)
- ライセンス: [MIT License](https://github.com/kawakin26/growi-plugin-custom-map/blob/main/LICENSE)（Copyright (c) 2026 kawakin）
