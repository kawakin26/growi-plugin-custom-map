# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-22

### Added

- **Initial Release**: Core floor plan mapping plugin for GROWI
- **Display Feature** (`viewer`): Convert `:::custom-map` syntax to interactive map modal
  - Drag-to-pan, scroll/pinch-to-zoom interactions
  - Left-click/tap to minimize/restore markers
  - Right-click/long-tap to show reference photos and descriptions
  - Auto-restore markers after configurable timeout
- **GUI Editing Feature** (`editor`): Create and edit maps without manual syntax writing
  - Click-on-image marker placement
  - Batch marker operations (add, move, delete)
  - Live preview with rotation and zoom
  - Right-side property panel for labels, photos, colors, descriptions
- **Asset Registration Feature** (`register`): Register CAD/images as persistent assets
  - CAD orientation baking (DXF/JWW to SVG with 0/90/180/270° rotation)
  - Image registration (PNG/JPEG/GIF/WebP/BMP/SVG)
  - Alternative naming for organized asset management
- **CAD Support** (Optional via conversion API):
  - DXF format support (AutoCAD)
  - JWW format support (Jw_cad, Japanese technical drawings)
  - Automatic format detection
- **Coordinate System**:
  - Percentage-based (0-100) relative to original image
  - Rotation-invariant (coordinates always relative to pre-rotation state)
- **Configuration**:
  - Optional CAD conversion API integration (`GROWI_CUSTOM_MAP_CONFIG`)
  - Configurable default stock page for images
  - Customizable pin size, label size, marker restore timing
- **Comprehensive Documentation**:
  - Japanese (`docs/ja/`) and English (`docs/en/`) versions
  - 5 chapters each: introduction, user guide, syntax reference, admin guide, extension guide
  - Sphinx + MyST Markdown source, buildable to HTML/PDF/Markdown

### Technical Details

- **Build Tool**: Vite (ES modules, optimized bundling)
- **Language**: TypeScript + React
- **Entry Point**: `client-entry.tsx` (Vite manifest compatible)
- **Risk Isolation**: Independent try-catch for each feature module
- **Browser Support**: Modern browsers (Chrome, Firefox, Safari, Edge)

### Security

- XSS prevention: Avoid `innerHTML`, use `textContent` and DOM node creation
- Confidential operation mode: Stock page can be hidden while maps display via registered assets
- Attachment permission inheritance when not using API

### Known Limitations

- Complex DXF/JWW entities (SPLINE, HATCH, DIMENSION, INSERT/BLOCK) not supported yet
- Marker text rotation not supported (always horizontal)
- No built-in marker templates (custom SVG via CSS extension possible)

### Dependencies

- Express (via conversion API, optional)
- dxf-parser (via conversion API)
- ezjww WASM (via conversion API)
- IPAex fonts (via conversion API for PDF docs)
- Sphinx + MyST Markdown (documentation build)

---

## Future Roadmap

- [ ] Marker templates and custom shapes
- [ ] Heatmap overlays (e.g., visitor density)
- [ ] Timeline-based marker animations
- [ ] More CAD entity support (SPLINE, BLOCK insertion)
- [ ] Multi-language UI (current: Japanese)
- [ ] Export to PDF with map overlay
- [ ] Integration with external GIS APIs
