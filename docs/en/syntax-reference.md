# Syntax Reference

Complete attributes for the `:::custom-map` syntax. Maps created with GUI also follow this specification as Markdown, allowing manual fine-tuning.

## Basic Structure

The syntax uses Markdown's [directive syntax](https://github.com/remarkjs/remark-directive) (`remark-directive`). Container attributes correspond to **overall floor plan settings**, and each line in the body's bullet list corresponds to **one marker**.

````md
:::custom-map{file="1F_floor_plan.png" cx="50" cy="40" scale="2" rotate="90" link="Open 1st Floor Guide" restore="15"}
- x=30 y=40 label="Reception" photo="reception.jpg" color="#ff3b30"
- x=70 y=55 label="Conference Room A" photo="room_a.jpg" desc="By reservation|Ext. 101"
- x=20 y=80 label="Emergency Exit" photo="exit.jpg" color="#34c759" desc="Keep locked|Contact security at night"
:::
````

```{tip}
If a value contains spaces, enclose it in double quotes (e.g., `label="Meeting Room 1"`).
```

## Floor Plan Overall Settings (Container Attributes)

```{list-table}
:header-rows: 1
:widths: 14 66 20

* - Attribute
  - Description
  - Default
* - `file`
  - **Registered asset name** of the floor plan (required, recommended. Automatically filled when selected via GUI). For backward compatibility, original filenames (`.png`, `.dxf`, `.jww`, etc.) can also be specified, but may not resolve in confidential operations
  - —
* - `src`
  - Reference page path to search for floor plan images
  - Default page
* - `cx`
  - Initial display center X coordinate (% of image, 0-100)
  - `50`
* - `cy`
  - Initial display center Y coordinate (% of image, 0-100)
  - `50`
* - `scale`
  - Initial magnification. Coefficient relative to the magnification that fits the image in the display window
  - `1`
* - `rotate`
  - Floor plan overall rotation angle (one of `0`, `90`, `180`, `270`. Clockwise, in degrees). Used to correct orientation misalignment
  - `0`
* - `link`
  - Text on the button that opens the floor plan
  - `Open Map`
* - `restore`
  - Time (in seconds) before minimized markers automatically restore
  - `15`
* - `pinSize`
  - Marker pin diameter (px, common to entire map). Clamped to 6-48
  - `12`
* - `labelSize`
  - Marker label text size (px, common to entire map). Clamped to 8-40
  - `12`
```

### Coordinate System

Both `cx` / `cy` and each marker's `x` / `y` are **percentages (0-100) relative to the original image**. The top-left of the image corresponds to `(0, 0)` and the bottom-right to `(100, 100)`. Even when rotation (`rotate`) is applied, coordinates are always **interpreted relative to the original image before rotation**, so marker positions don't shift when orientation changes.

### Rotation Accumulation

`rotate` is applied via CSS at display time. If a CAD registered asset (described later) has orientation baked in, the syntax's `rotate` is **applied on top of that**. This allows a division of labor: bake the permanent baseline orientation at registration time, and adjust temporary per-page orientation with the syntax's `rotate`.

## Individual Marker Settings (Bullet List)

```{list-table}
:header-rows: 1
:widths: 14 66 20

* - Key
  - Description
  - Default
* - `x`
  - Marker horizontal position (% of image, 0-100, **required**)
  - `50`
* - `y`
  - Marker vertical position (% of image, 0-100, **required**)
  - `50`
* - `label`
  - Label text displayed on the marker
  - None
* - `photo`
  - Original filename of reference photo displayed on right-click/long-tap
  - None
* - `photoSrc`
  - Page path to search for reference photo
  - Page where syntax was written → floor plan resolution destination
* - `desc`
  - Description/warning text (use `\|` for line breaks). When set, the pin **blinks**, and the text is displayed in the right-click/long-tap popup
  - None
* - `color`
  - Pin and label color (CSS color)
  - `#ff3b30`
```

### Multiple Photos and Photo-specific Descriptions (Sublist Method)

You can attach multiple reference photos to a single marker with descriptions for each photo. Under the marker line, write a sublist with 2-space indentation.

````md
- x=30 y=40 label="Reception" desc="Ext. 101"
  - photo="reception_1.jpg" desc="Front view"
  - photo="reception_2.jpg" desc="Reception desk close-up"
````

- Each line in the sublist corresponds to one photo (not dependent on numbering; each can be added, deleted, or reordered per line).
- The `desc` on the photo line is a comment for that specific photo (distinguished by nesting from the marker's `desc`).

## Image Resolution Order

Shows how names specified in the syntax are resolved to actual files. For detailed operations, see {doc}`admin-guide`.

- **Floor plan (`file`)**:
  1. **Registered assets** (CAD-baked SVG or original images) resolved to **API delivery URL** (highest priority when `file` matches a registered name. Both CAD and images, even in confidential stock pages, display and are independent of viewer permissions)
  2. Unregistered CAD converted **on-the-fly** by conversion API
  3. Unregistered resolved through traditional attachment resolution (`src` specified page → default stock page `/media-library`) → static path
- **Reference photos (`photo`)**: `photoSrc` specified page → the page where the syntax was written → same resolution destination as the floor plan (attachment resolution)

Attachment resolution matches `originalName` / `fileName` from the attachment list of the target page to resolve the URL. If not found, falls back to `/images/maps/{filename}`.

```{important}
Attachment file view permissions follow **the page where the attachment originates** (when not using the conversion API). Users without view permissions for the stock page cannot see images. Create stock pages with public visibility accessible to everyone you want to share with. When using registered assets (with conversion API), this restriction does not apply.
```
