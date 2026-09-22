# ドキュメントビルド用 Makefile
#
# 使い方（リポジトリ直下から）:
#   python3 -m venv docs/.venv
#   docs/.venv/bin/pip install -r docs/requirements.txt
#   make -C docs all          # 日本語の HTML / PDF / Markdown をまとめて生成
#   make -C docs html         # HTML だけ
#   make -C docs pdf          # PDF(lualatex) だけ
#   make -C docs markdown     # Markdown だけ
#   make -C docs clean        # 生成物を削除
#
# LANG_DIR で対象言語を切り替える（既定は ja）。英語版が出来たら:
#   make -C docs all LANG_DIR=en

# venv の Python / sphinx-build。venv が無ければシステムの sphinx-build を使う。
VENV_BIN := $(CURDIR)/.venv/bin
SPHINXBUILD := $(if $(wildcard $(VENV_BIN)/sphinx-build),$(VENV_BIN)/sphinx-build,sphinx-build)

LANG_DIR ?= ja
SOURCEDIR := $(LANG_DIR)
BUILDDIR := $(SOURCEDIR)/_build

.PHONY: all html pdf markdown clean help

help:
	@echo "targets: all / html / pdf / markdown / clean"
	@echo "example: make -C docs all LANG_DIR=ja"

all: html pdf markdown
	@echo "==> 生成物: $(BUILDDIR)/{html,pdf,markdown}"

html:
	$(SPHINXBUILD) -b html "$(SOURCEDIR)" "$(BUILDDIR)/html"

# PDF は LaTeX(lualatex) 経由。latex ビルダで .tex を生成し、latexmk で PDF 化する。
pdf:
	$(SPHINXBUILD) -b latex "$(SOURCEDIR)" "$(BUILDDIR)/latex"
	$(MAKE) -C "$(BUILDDIR)/latex" LATEXMKOPTS="-silent"
	@mkdir -p "$(BUILDDIR)/pdf"
	@cp "$(BUILDDIR)/latex"/*.pdf "$(BUILDDIR)/pdf/"
	@echo "==> PDF: $(BUILDDIR)/pdf/"

markdown:
	$(SPHINXBUILD) -b markdown "$(SOURCEDIR)" "$(BUILDDIR)/markdown"

clean:
	rm -rf "$(BUILDDIR)"
