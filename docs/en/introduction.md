# Introduction

## Purpose of This Plugin

`growi-plugin-custom-map` is a plugin for GROWI that allows you to embed **floor plans (floor maps) and markers** within wiki documents. You can place markers like Google Maps pins on a floor plan and attach labels, reference photos, and descriptions to each marker. It is intended for uses such as building guide maps, equipment layout diagrams, and emergency evacuation route diagrams—situations where you want to place information at specific locations on a diagram.

The floor plan is referenced by its **original filename at upload time**. While GROWI manages attached files with random IDs, this plugin allows you to specify them with human-readable names like `file="1F_floor_plan.png"`.

## What It Can Do (Overview)

- **Floor plan display**: Open a floor plan specified in the syntax in a modal, and move and zoom with drag, wheel/pan, and pinch gestures.
- **Marker placement**: Place multiple markers on a single floor plan, specifying position, label, color, reference photo, and description.
- **Creation and editing via GUI**: Without manually writing syntax, you can click a floor plan from a floating button in the edit screen to place markers and auto-generate syntax. You can also select and re-edit an existing map.
- **Rotation**: Rotate the entire floor plan in 90-degree increments for display (corrects shooting and scanning angle misalignment).
- **CAD drawings (optional)**: By setting up a separate conversion API, you can convert DXF/JWW CAD drawings to SVG and display them. You can also register diagrams with confirmed orientations under alternative names.

## Overall Picture (Components)

This plugin consists of independent modules for each feature.

```{list-table}
:header-rows: 1
:widths: 20 80

* - Module
  - Role
* - `viewer`
  - Interprets the `:::custom-map` syntax and displays it as a map modal. The core feature that operates during viewing.
* - `editor`
  - Displays a floating button on the edit screen and handles GUI-based new map creation and existing map editing.
* - `register`
  - UI for registering CAD and images as "registered assets" under alternative names on stock pages. Only enabled when conversion API is configured.
* - `common`
  - Shared utilities for the above (attachment resolution, configuration reading, label text color judgment, etc.).
```

Each feature is activated via an **independent try-catch at the entry point**, so even if the editing or registration features break due to a GROWI update, the display feature continues to work.

## Two-stage Operation: With and Without Conversion API

This plugin has a **two-stage operation model** depending on whether you use a CAD conversion API. This distinction appears repeatedly throughout the documentation.

```{list-table}
:header-rows: 1
:widths: 22 39 39

* -
  - With Conversion API
  - Without Conversion API (Easy Operation)
* - Image storage location
  - API server storage (imported at registration)
  - GROWI page attachments
* - Reference path
  - API delivery (independent of GROWI permissions)
  - GROWI standard `/attachment/{id}` (follows view permissions)
* - Stock page confidentiality
  - Possible (maps display even if only edit groups can view)
  - Not possible (image page must be made public)
* - CAD drawings
  - Display and orientation registration possible
  - Not used (images only)
```

- If you want to **use it easily** and don't handle CAD, you can start without the conversion API. Simply attach images to the stock page (default `/media-library`) and reference them by name from the syntax.
- If you want to **handle CAD** or **keep the stock page confidential while only showing maps**, install the conversion API ([growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api)).

For detailed configuration, see {doc}`admin-guide`.

## What to Read Next

- Want to know how to use it: {doc}`user-guide`
- Want to know the syntax specification: {doc}`syntax-reference`
- Want to deploy and operate it: {doc}`admin-guide`
