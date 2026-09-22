# Sphinx 設定ファイル（日本語版ドキュメント）
#
# ソースは MyST Markdown（.md）。HTML / PDF(LaTeX, lualatex) / Markdown に変換する。
# ビルド手順は docs/README.md を参照。

# -- プロジェクト情報 -------------------------------------------------------

project = "growi-plugin-custom-map"
author = "kawakin"
copyright = "2026, kawakin"
release = "0.1.0"

# 言語（日本語）。PDF の禁則処理・フォント選択にも影響する。
language = "ja"

# -- 一般設定 ---------------------------------------------------------------

extensions = [
    "myst_parser",
]

# MyST の拡張機能。表・注記（admonition）・定義リストなどを使えるようにする。
myst_enable_extensions = [
    "colon_fence",     # ::: によるディレクティブ記法
    "deflist",         # 定義リスト
    "fieldlist",       # フィールドリスト
    "tasklist",        # チェックボックス
    "linkify",         # 生 URL の自動リンク化
    "substitution",    # 変数置換
    "attrs_inline",    # インライン属性
]

# 見出しから自動でアンカーを生成する深さ（h1〜h3）。
myst_heading_anchors = 3

source_suffix = {
    ".md": "markdown",
}

# ルートドキュメント。
root_doc = "index"

exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

# -- HTML 出力 --------------------------------------------------------------

html_theme = "furo"
html_title = f"{project} ドキュメント"
html_static_path = ["_static"]

# -- LaTeX（PDF）出力 -------------------------------------------------------
#
# 日本語 PDF は lualatex + luatexja を使う（CJK フォント埋め込み・禁則処理）。
# latexmk 経由でビルドするため latex_engine を lualatex に設定する。

latex_engine = "lualatex"

latex_documents = [
    (
        root_doc,
        "growi-plugin-custom-map-ja.tex",
        "growi-plugin-custom-map ドキュメント",
        "kawakin",
        "manual",
    ),
]

latex_elements = {
    # 用紙・本文サイズ。
    "papersize": "a4paper",
    "pointsize": "11pt",
    # luatexja-fontspec で日本語フォントを設定。IPAex は TeX Live に同梱。
    "fontpkg": r"""
\usepackage{luatexja-fontspec}
% IPAex フォント（TeX Live 同梱）をファイル名で指定。環境に依存しにくい。
\setmainjfont{ipaexm.ttf}
\setsansjfont{ipaexg.ttf}
""",
    # 追加のプリアンブル。表の体裁・URL 折り返し・絵文字フォールバックなど。
    "preamble": r"""
\usepackage{luatexja}
\usepackage{array}
\usepackage{booktabs}
% 長い URL・パスをページ幅で折り返す。
\usepackage{xurl}
% 絵文字（UI ボタン名に含まれる 🛠 🖊 📋 ⬆ 等）のフォールバック。
% 本文フォントに無いグリフを Symbola（モノクロ）で描画する。
\usepackage{newunicodechar}
\newfontfamily{\emojifont}{Symbola_hint.ttf}[Path=/usr/share/fonts/truetype/ancient-scripts/]
% 絵文字ブロックを luatexja の和文扱いから外して欧文(ALchar)にする。
% これで jfm ではなく newunicodechar / フォールバックフォントが効く。
\ltjdefcharrange{100}{"2B00-"2BFF, "1F000-"1FAFF, "2190-"21FF}
\ltjsetparameter{jacharrange={-100}}
\newunicodechar{🛠}{{\emojifont 🛠}}
\newunicodechar{🖊}{{\emojifont 🖊}}
\newunicodechar{📋}{{\emojifont 📋}}
\newunicodechar{⬆}{{\emojifont ⬆}}
\newunicodechar{→}{{\emojifont →}}
% バリエーションセレクタ（U+FE0F）は PDF では不可視にする（グリフ合成用の制御文字）。
\newunicodechar{️}{}
""",
    # 図版の配置。
    "figure_align": "H",
}

# 章ごとにページ送り（manual クラス）。
latex_toplevel_sectioning = "section"

# ドキュメントクラス。lualatex + luatexja 環境では jreport が最適。
latex_docclass = {
    "jreport": {
        "pointsize": "11pt",
        "preamble": "",  # preamble は latex_elements で指定するので、ここは空でOK
    }
}

# -- Markdown 出力（sphinx-markdown-builder）--------------------------------
# 追加設定は不要（`sphinx-build -b markdown` で使用）。
