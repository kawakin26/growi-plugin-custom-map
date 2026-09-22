# Sphinx Configuration File (English Version)
#
# Source is MyST Markdown (.md). Convert to HTML / Markdown.
# Build instructions: see docs/README.md

# -- Project Information -------------------------------------------------------

project = "growi-plugin-custom-map"
author = "kawakin"
copyright = "2026, kawakin"
release = "0.1.0"

# Language (English).
language = "en"

# -- General Settings ----------------------------------------------------------

extensions = [
    "myst_parser",
]

# MyST extended features. Enable tables, admonitions, definition lists, etc.
myst_enable_extensions = [
    "colon_fence",     # ::: directive syntax
    "deflist",         # definition lists
    "fieldlist",       # field lists
    "tasklist",        # checkboxes
    "linkify",         # auto-linkify URLs
    "substitution",    # variable substitution
    "attrs_inline",    # inline attributes
]

# Heading anchor depth (h1-h3).
myst_heading_anchors = 3

source_suffix = {
    ".md": "markdown",
}

# Root document.
root_doc = "index"

exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

# -- HTML Output ---------------------------------------------------------------

html_theme = "furo"
html_title = f"{project} Documentation"
html_static_path = ["_static"]

# -- LaTeX (PDF) Output --------------------------------------------------------
#
# Use lualatex so that emoji / arrow glyphs used in UI button names
# (⬆ 📋 → etc.) can be rendered via a fallback font. Built through latexmk.

latex_engine = "lualatex"

latex_documents = [
    (
        root_doc,
        "growi-plugin-custom-map-en.tex",
        "growi-plugin-custom-map Documentation",
        "kawakin",
        "manual",
    ),
]

latex_elements = {
    "papersize": "a4paper",
    "pointsize": "11pt",
    "preamble": r"""
\usepackage{array}
\usepackage{booktabs}
% Wrap long URLs / paths within the page width.
\usepackage{xurl}
% Emoji / symbol fallback (⬆ 📋 → used in UI button names).
% Render glyphs missing from the main font with Symbola (monochrome).
\usepackage{newunicodechar}
\newfontfamily{\emojifont}{Symbola_hint.ttf}[Path=/usr/share/fonts/truetype/ancient-scripts/]
\newunicodechar{⬆}{{\emojifont ⬆}}
\newunicodechar{📋}{{\emojifont 📋}}
\newunicodechar{→}{{\emojifont →}}
% Variation selector (U+FE0F) is invisible in PDF (glyph-composition control char).
\newunicodechar{️}{}
""",
    "figure_align": "H",
}

latex_toplevel_sectioning = "section"

# -- Markdown Output (sphinx-markdown-builder) --------------------------------
# No additional configuration needed.
