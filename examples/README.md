# Usage Examples

実装例とサンプル Markdown コード。

## 例1: シンプルな受付フロア図

```markdown
:::custom-map{file="1F_floor_plan.png"}
- x=30 y=40 label="受付" color="#ff3b30"
- x=70 y=55 label="会議室A" color="#34c759"
- x=20 y=80 label="非常口" color="#ff9500"
:::
```

## 例2: 写真と説明付きの施設ガイド

```markdown
:::custom-map{file="facility_map.png" link="施設案内を開く" rotate="90"}
- x=25 y=30 label="入口" photo="entrance.jpg" desc="正面玄関|営業時間: 9:00-18:00"
- x=50 y=50 label="フロント" photo="front_desk.jpg" desc="予約対応|Ext. 101"
- x=75 y=70 label="カフェ" photo="cafe.jpg" desc="営業時間|10:00-17:00"
:::
```

## 例3: 複数参考写真付きマーカー

```markdown
:::custom-map{file="building_1F.jww" cx="50" cy="50" scale="1.5"}
- x=40 y=45 label="エレベーター"
  - photo="elevator_outside.jpg" desc="外観"
  - photo="elevator_inside.jpg" desc="内部"
- x=60 y=60 label="トイレ" color="#5ac8fa"
  - photo="toilet_mens.jpg" desc="男性用"
  - photo="toilet_womens.jpg" desc="女性用"
:::
```

## 例4: GUI作成→手動調整

GUI で作成したマップをコピーして手動調整：

```markdown
:::custom-map{file="2F_office.png" rotate="180"}
- x=10 y=20 label="営業部" color="#ff3b30" desc="営業チーム|Tel: x123"
- x=40 y=50 label="企画部" color="#34c759"
- x=70 y=80 label="IT部" color="#007aff"
:::
```

## 例5: CAD図面（登録アセット）

登録済みアセット `1F_r90.jww` を使用：

```markdown
:::custom-map{file="1F_r90.jww" link="1階案内"}
- x=15 y=25 label="階段" color="#ff9500"
- x=85 y=75 label="窓" color="#5ac8fa"
:::
```

## 例6: 座標系の理解

座標は **元画像に対する相対的な割合（0-100）**：

```markdown
:::custom-map{file="office_layout.png"}
- x=0 y=0 label="左上"        # 画像の左上隅
- x=50 y=50 label="中央"       # 画像の中央
- x=100 y=100 label="右下"     # 画像の右下隅
:::
```

## 例7: 回転と座標の不変性

回転を指定してもマーカー位置は変わらない：

```markdown
:::custom-map{file="floor_plan.png" rotate="0"}
- x=30 y=40 label="マーカー"
:::

:::custom-map{file="floor_plan.png" rotate="90"}
- x=30 y=40 label="同じ位置（見た目は異なる）"
:::
```

## 例8: 大規模ビル全体図

複数階フロア案内：

```markdown
### 1階

:::custom-map{file="1F_floor_plan.png"}
- x=20 y=30 label="受付"
- x=80 y=70 label="カフェ"
:::

### 2階

:::custom-map{file="2F_floor_plan.png"}
- x=40 y=50 label="会議室"
- x=60 y=70 label="オフィス"
:::

### 3階

:::custom-map{file="3F_floor_plan.png"}
- x=30 y=40 label="データセンター"
:::
```

## 例9: インラインスタイル調整

見出しのサイズやピンサイズを個別に調整：

```markdown
:::custom-map{file="map.png" pinSize="16" labelSize="10"}
- x=50 y=50 label="小さいマーカー"
:::

:::custom-map{file="map.png" pinSize="32" labelSize="18"}
- x=50 y=50 label="大きいマーカー"
:::
```

## 例10: セキュリティ考慮（ストックページ秘匿）

ストックページを MAP 編集グループのみ表示に制限した場合、登録アセットのみが一般ユーザーに見える：

```markdown
<!-- 一般ユーザーでも表示可能（登録アセット経由） -->
:::custom-map{file="registered_floor_plan.png"}
- x=30 y=40 label="共有エリア"
:::

<!-- 以下は未登録・直接参照なため、ストックページが秘匿されていると見えない -->
:::custom-map{file="direct_reference.png"}
- x=50 y=50 label="参照できない可能性"
:::
```

---

## 応用パターン

### パターン1: JSON 形式での動的生成

プラグイン外部から JSON で記法を生成：

```javascript
const mapConfig = {
  file: "floor_plan.png",
  cx: 50,
  cy: 50,
  markers: [
    { x: 30, y: 40, label: "A", color: "#ff3b30" },
    { x: 70, y: 60, label: "B", color: "#34c759" },
  ],
};

// これを :::custom-map 記法に変換してページに挿入
```

### パターン2: API 連携（CAD 自動登録）

CI/CD パイプラインで新しい CAD が commit された時、自動登録：

```bash
#!/bin/bash
# CAD を API に登録
curl -X POST https://example.com/cad/assets \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -d '{
    "name": "latest_floor_plan.jww",
    "file": "floor_plan.jww",
    "src": "/media-library",
    "rotate": 90
  }'
```

### パターン3: テンプレート化

複数ページで同じレイアウトを再利用：

```markdown
<!-- _テンプレートページ: /templates/floor-map-template -->

:::custom-map{file="FLOOR_PLAN_FILE" cx="50" cy="50" scale="1"}
- x=MARKER_X y=MARKER_Y label="MARKER_LABEL"
:::

<!-- 実装ページでコピー→プレースホルダーを置き換え -->
```

---

See [User Guide](../docs/en/user-guide.md) and [Syntax Reference](../docs/en/syntax-reference.md) for complete documentation.
