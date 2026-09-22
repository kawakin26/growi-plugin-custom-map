.PHONY: help install dev build preview check type-check lint lint-fix format format-check clean

# デフォルトターゲット
.DEFAULT_GOAL := help

help:
	@echo "growi-plugin-custom-map - Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install            Install dependencies"
	@echo ""
	@echo "Development:"
	@echo "  make dev                Start development server (Vite)"
	@echo "  make build              Build for production"
	@echo "  make preview            Preview production build"
	@echo ""
	@echo "Code Quality:"
	@echo "  make type-check         TypeScript type checking"
	@echo "  make lint               ESLint code quality check"
	@echo "  make lint-fix           ESLint auto-fix violations"
	@echo "  make format             Prettier code formatting"
	@echo "  make format-check       Prettier format check only"
	@echo "  make check              Run all checks (type-check + lint + format-check)"
	@echo "  make check-all          Run all checks + build"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean              Clean build artifacts and cache"
	@echo "  make deps               Update dependencies (npm outdated)"

# 依存パッケージをインストール
install:
	npm install

# 開発サーバーを起動
dev:
	npm run dev

# 本番ビルドを実行
build:
	npm run build

# ビルド結果をプレビュー
preview:
	npm run preview

# TypeScript 型チェック
type-check:
	npm run type-check

# ESLint でコード品質をチェック
lint:
	npm run lint

# ESLint で自動修正
lint-fix:
	npm run lint:fix

# Prettier でコード整形
format:
	npm run format

# Prettier で整形必要な部分をチェック
format-check:
	npm run format:check

# 全チェックを実行（型チェック + lint + フォーマット確認）
check:
	npm run check-all

# 全チェック + ビルド を実行（本番前の最終確認）
check-all: type-check lint format-check build
	@echo "✓ All checks passed!"

# ビルド成果物とキャッシュをクリーン
clean:
	rm -rf dist/ node_modules/ .vite/

# 依存パッケージの更新情報を表示
deps:
	npm outdated

# 開発用クイックコマンド：インストール → 開発サーバー起動
setup: install dev

# CI/CD 用：チェック → ビルド
ci: install check-all
