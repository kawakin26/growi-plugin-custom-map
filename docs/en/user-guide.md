# User Manual

Instructions for general users (page viewers and editors) on map display operations and procedures for creating and editing maps using GUI. For detailed syntax specifications, see {doc}`syntax-reference`.

## Displaying Maps (Viewing)

When you open a page with `:::custom-map` syntax written on it, a launch button (default text is "Open Map") appears. Click the button to open the floor plan in a modal.

### Modal Display Operations

```{list-table}
:header-rows: 1
:widths: 40 60

* - Operation
  - Action
* - Click launch button
  - Display floor plan in modal
* - Drag / Single-finger swipe
  - Move display position (pan)
* - Scroll wheel / Two-finger pinch
  - Zoom in/out with cursor (center point) as center
* - Left-click/tap marker or label
  - Minimize or restore marker and label (toggle)
* - Right-click/long-tap marker or label
  - Display reference photo and description in popup
* - Click background / × button
  - Close
```

### Marker Minimization and Auto-restore

When you left-click or tap a marker or label, it becomes **minimized** and the label is hidden, leaving only a blinking pin. Use this when you want to check part of the floor plan that was hidden by the label. While minimized, the pin displays at a fixed size (default 24px) independent of the syntax `pinSize`, displayed slightly larger for visibility.

After the number of seconds specified by `restore` (default 15 seconds) elapses, the minimized marker **automatically restores** to its original state.

### Markers with Description Text

Markers with description or warning text (`desc`) have a **blinking pin** to indicate their presence. Open the popup with a right-click or long-tap to view reference photos and descriptions.

## Creating Maps (GUI)

You can create maps using GUI without manually writing syntax.

1. Open the page in **edit mode**, and **place your cursor at the position where you want to insert the syntax**. The syntax will be inserted at the **cursor position just before clicking the button**.
2. Click the **"🛠️ Create Map"** button in the bottom right of the screen.
3. Select a floor plan (when selected, the `file` attribute is automatically filled in).
   - **With Conversion API**: Select from the list of registered map assets (CAD/images registered by MAP editors). You can filter by registration name or original filename. The `file` field will contain the registration name.
   - **Without Conversion API (Easy Operation)**: Select from the list of images attached to the stock page (default `/media-library`). The `file` field will contain the attachment filename.
4. **Click on the floor plan to place markers** (you can zoom with scroll wheel/pinch to specify precise positions).
5. In the right panel, enter the **label, reference photo, color, and description** for the selected marker (you can also fine-tune the X/Y coordinates). You can delete unnecessary markers.
6. If needed, adjust **overall map settings** (launch button text, auto-restore seconds, initial view center/scale, rotation). When you change rotation using the `0° / 90° / 180° / 270°` buttons, the preview updates immediately.
7. **Confirm and Insert** inserts the `:::custom-map` syntax at the cursor position.

```{important}
The syntax is inserted at the cursor position **immediately before clicking the "🛠️ Create Map" button**. Make sure the cursor is positioned correctly before clicking the button (place your cursor on the line or paragraph where you want to insert, then click the button). If the cursor is inside an existing `:::custom-map` block, to prevent erroneous insertion, new insertion does not occur; instead, a message suggesting "Edit Map" is displayed.
```

```{note}
**With Conversion API**, the GUI map list is obtained from map assets registered with the API (`GET /assets`). This allows general editors to select maps even in confidential operations where the stock page (`/media-library`) is limited to edit group viewing. If you want to use a diagram not in the list, ask a MAP editor to register it from "Register Map Assets".

**Without Conversion API**, the list of images attached to the stock page (default `/media-library`) is displayed as-is. In this operation mode, the images in the list follow the view permissions of the stock page, so the stock page must be made public (not confidential).
```

### Dragging Markers to Move

Markers that have been placed can be repositioned by dragging. Dragging is recognized when moved 5px or more, and even during rotation, zoom, or pan, coordinates are correctly calculated relative to the original image. Clicks below the threshold are handled as "selection" as before. When you drag a selected marker, the X/Y input fields in the right panel are updated immediately.

## Editing Existing Maps (GUI)

You can edit maps already inserted in a page using GUI.

1. Open the page in **edit mode**.
2. Click the **"🖊️ Edit Map"** button in the bottom right of the screen.
3. From the list of maps (``:::custom-map` blocks) on this page, select the map you want to edit.
4. Edit markers by adding, moving, or deleting them, and adjust labels, colors, descriptions, rotation, initial display, etc. using GUI.
5. **Save Changes** to **overwrite the original syntax in the same location** (the page reloads after saving).

```{important}
"Edit Map" targets **saved page content**. If you have unsaved changes in the edit, please save the page first before using "Edit Map" (to prevent loss of unsaved changes).
```

```{note}
The list shows only maps that reference registered assets (registration names) as edit targets. Maps using the old method (directly referencing raw filenames from media-library) are shown as "not registered assets" and cannot be edited. In that case, create a new one with the new method using "Create Map".
```

## Adding Photos and Descriptions to Markers

Each marker can have reference photos (`photo`) and description text (`desc`).

- **Reference photo**: Displays an image in the popup from right-click/long-tap. Specified by filename, resolved from attachments on the page where the syntax was written or from the page specified by `photoSrc`.
- **Description text**: Use `|` (pipe) for line breaks. Suitable for brief notes such as reservation requirements, extension numbers, or warnings. Markers with descriptions have blinking pins.

You can also upload photos and crop them (trim) from the edit GUI. Click "⬆ Upload Image" in the photo field to register the selected image as an attachment to the current page and auto-reflect in `photo`. You can also specify a crop range in a crop modal before uploading.

## FAQ on Common Operations

- **Where will the map be inserted?** At the cursor position immediately before clicking the "Create Map" button.
- **Map not displayed**: See "Troubleshooting" in {doc}`admin-guide`. Most often caused by filename mismatches in `file` or stock page view permissions.
- **Want to fix the diagram orientation?** Use the `rotate` attribute in the syntax to rotate it at display time. If you want to permanently register a CAD with the correct orientation, a MAP editor can burn the orientation in using "Register Map Assets" and re-register under an alternative name (see {doc}`admin-guide`).
