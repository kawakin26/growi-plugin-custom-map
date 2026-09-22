# Extension and Developer Guide

For developers, explaining build procedures, architecture, and extension considerations.

## Required Environment

- Node.js
- npm

## Setup and Build

```bash
npm install
npm run build
```

- Entry is `client-entry.tsx` at the repository root (placed at the root to align the Vite manifest key with GROWI's expectations). Implementation is divided into `src/`.
- Build uses [Vite](https://vitejs.dev/) (`vite build`, same configuration as the official script plugin).
- Build artifacts are output to `dist/`:
  - `dist/assets/client-entry-*.js`: Bundled plugin body
  - `dist/.vite/manifest.json`: Build manifest (**essential for GROWI to resolve injected scripts**)

```{important}
GROWI does **not build the repository** at installation. It uses files included in the ZIP as-is, so **build and commit `dist/` (including `.vite/manifest.json` and `assets/`) before pushing**. Without the manifest, GROWI detects the plugin but doesn't inject `<script>`, and the syntax won't be applied.
```

## Project Structure

```
.
├── client-entry.tsx       # Entry (each feature started with independent try-catch)
├── src/
│   ├── common.ts          # Shared utilities (attachment resolution + asset registration API client)
│   ├── viewer.ts          # Display feature (directive conversion + map modal)
│   ├── editor.ts          # GUI editing feature (floating button + marker placement UI)
│   └── register.ts        # Map asset registration (CAD orientation registration, original image registration UI)
├── dist/                  # Build artifacts (commit target)
├── docs/                  # Detailed documentation (Sphinx / MyST Markdown)
├── vite.config.ts
├── package.json
├── tsconfig.json
├── LICENSE
├── README.md              # Japanese version (canonical)
└── README.en.md           # English version (translation)
```

## Architecture

### Feature Modules and Risk Isolation

`client-entry.tsx` starts each feature with **independent try-catch**. This design (risk isolation) ensures that if one breaks, others aren't affected. Editing and registration features depend on DOM, so they might break with GROWI updates, but the display feature continues working in that case.

```{list-table}
:header-rows: 1
:widths: 22 20 58

* - Module
  - Startup Function
  - Role
* - `src/viewer.ts`
  - `activateViewer`
  - Convert the `:::custom-map` syntax to a map modal for display. The core feature during viewing.
* - `src/editor.ts`
  - `activateEditor`
  - Floating button on the edit screen. "Create Map" = new insertion, "Edit Map" = load existing `:::custom-map` in page body, re-edit, and overwrite save.
* - `src/register.ts`
  - `activateRegister`
  - Floating button on stock page. Register CAD under specified orientation as alternative name, register image as-is. Deletion disabled via UI.
* - `src/common.ts`
  - —
  - Display and edit shared utilities (attachment resolution, configuration reading, label text color judgment, asset registration API client, etc.).
```

### How the Editing Feature Starts

GROWI script plugins have no official extension points for extending editor toolbar or commands (only `growiFacade.markdownRenderer` is public). So the editing feature **doesn't depend on editor toolbar DOM; instead, detects edit screen (URL hash `#edit` + CodeMirror display) and displays a floating button on screen corner**.

Syntax insertion saves the cursor position (DOM Range) right before opening, restores it at insertion, and uses `execCommand('insertText')`. If `execCommand` fails, it falls back to clipboard and guides manual pasting. When GROWI updates change DOM structure or insertion method, this detection log and clipboard fallback are the starting point for fixes.

## Extension Considerations

### Handling GROWI API Differences

The plugin obtains page IDs and attachment lists using GROWI APIs (`/_api/v3/page`, `/_api/v3/attachment/list`). If response structures differ by GROWI version, adjust the data extraction in `src/common.ts`'s `getPageIdByPath` / `getAttachmentsForPage`. Checking actual responses in the browser developer tools Network tab is the quickest approach.

### Changes to Image Resolution Logic

The resolution order for floor plans and reference photos follows "Image Resolution Order" in {doc}`syntax-reference` and is implemented in `src/common.ts` / `src/viewer.ts`. Don't break the staged fallback: registered assets priority → on-the-fly conversion → attachment resolution → static path.

### Security Note (XSS)

When rendering **user-derived values** like filenames and page paths to DOM, avoid string concatenation to `innerHTML`; use `textContent` or DOM node generation (this plugin implements this approach for XSS protection).

## Building Documentation

For build procedures of this detailed documentation itself, see `docs/README.md`. Source is MyST Markdown (`docs/ja/*.md`), convertible to HTML / PDF (lualatex) / Markdown.
