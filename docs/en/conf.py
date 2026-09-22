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

# -- Markdown Output (sphinx-markdown-builder) --------------------------------
# No additional configuration needed.
