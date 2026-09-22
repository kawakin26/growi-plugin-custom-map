# Production Deployment Checklist

This checklist guides administrators through the steps required to deploy **growi-plugin-custom-map** to a production GROWI instance.

## Pre-Deployment

- [ ] **Code Review**: All code changes reviewed and tested
- [ ] **Build Artifacts Present**: Verify `dist/assets/` and `dist/.vite/manifest.json` exist and are committed
  ```bash
  npm run build  # If not already built
  git add dist/
  git commit -m "Build artifacts"
  ```
- [ ] **Documentation Up-to-Date**: `docs/ja/` and `docs/en/` reflect current features
- [ ] **CHANGELOG Updated**: New version documented in `CHANGELOG.md`
- [ ] **Version Bumped**: `package.json` version matches release tag

## GROWI Environment Setup

### Required GROWI Version
- [ ] GROWI **v7.0 or later** (uses `/api/v3` endpoints)
- [ ] Verify GROWI is accessible and stable

### Stock Page for Images
- [ ] Create stock page (default: `/media-library`)
  ```
  /media-library → Page for storing floor plan images and reference photos
  ```
- [ ] Set appropriate visibility
  - **Easy operation** (no CAD or without API): Public visibility (all users can see)
  - **Confidential operation** (using registered assets): Restricted to MAP editor group only

## Conversion API Setup (Optional but Recommended for CAD)

- [ ] **Deployment Decision**: Do you need CAD conversion support?
  - [ ] Yes → Deploy [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api)
  - [ ] No → Skip API deployment, document in configuration

- [ ] **If Using API**:
  - [ ] API server deployed and running (separate server or same host)
  - [ ] GROWI can reach API endpoint (`https://...`)
  - [ ] Reverse proxy (Apache/Nginx) configured if needed
  - [ ] **GROWI Access Token** generated with scopes:
    - [ ] `read:features:page`
    - [ ] `read:features:attachment`
  - [ ] Token stored securely (`.env` on API server, never in browser scripts)
  - [ ] API health check passes: `GET {cadConvertApi}/health`

## Plugin Installation & Configuration

### Install Plugin
- [ ] GROWI Admin Screen → **Plugins**
- [ ] Register repository URL: `https://github.com/kawakin26/growi-plugin-custom-map`
- [ ] **Do NOT include `.git` at end** (GROWI will fail to download)
- [ ] Install and enable the plugin
- [ ] Verify plugin loads without errors in browser console

### Configure (GROWI Custom Script)
- [ ] GROWI Admin → **Customization** → **Custom Script** field
- [ ] Add configuration:

```javascript
window.GROWI_CUSTOM_MAP_CONFIG = {
  // Stock page for images (matches page created earlier)
  defaultSrc: '/media-library',

  // CAD conversion API endpoint (if using API; otherwise omit)
  // cadConvertApi: 'https://<domain>/cad/convert',

  // Optional: customize pin size when minimized
  minimizedPinSize: 24,
};
```

- [ ] Save and verify configuration loads
- [ ] Hard refresh browser (`Ctrl+Shift+R` or `Cmd+Shift+R`) to clear cache

## Image Preparation

### Attach Floor Plans
- [ ] Create subdirectories on stock page (e.g., `/media-library/1F`, `/media-library/2F`)
- [ ] Upload floor plan images (PNG, JPEG, etc.)
- [ ] **Note original filenames** for syntax `file=` attribute
- [ ] Verify images are viewable with current user permissions
- [ ] **For CAD files** (if using API):
  - [ ] Upload DXF or JWW to stock page
  - [ ] Test conversion: API server can retrieve and convert

### Register Assets (If Using API)
- [ ] On stock page, click **"📋 Register Map Assets"** button
- [ ] Register frequently-used floor plans with confirmed orientations
  - [ ] Select CAD file → choose orientation (0/90/180/270°) → enter registration name → register
  - [ ] Example: `1F_north-up.jww` for 1st floor oriented north
- [ ] Verify registered assets appear in list and display correctly

## Testing in Production

### Smoke Tests
- [ ] Create test page (e.g., `/sandbox/map-test`)
- [ ] Write map syntax manually:
  ```
  :::custom-map{file="floor_plan_image.png"}
  - x=50 y=50 label="Test Marker"
  :::
  ```
- [ ] View the page and click **"Open Map"** button
- [ ] Verify map displays and marker appears
- [ ] Test marker minimization (left-click)
- [ ] Test marker info popup (right-click)

### GUI Tests
- [ ] Open test page in **edit mode**
- [ ] Click **"🛠️ Create Map"** button
- [ ] Select floor plan from GUI dropdown
- [ ] Place marker on image
- [ ] Save and verify syntax is inserted
- [ ] Edit the map with **"🖊️ Edit Map"** button
- [ ] Verify changes persist

### CAD Tests (If Using API)
- [ ] **Method 1** (API Fetch): Reference registered asset
  - [ ] Map displays registered asset via API endpoint
- [ ] **Method 2** (Browser POST): Create map with CAD
  - [ ] GUI should show registered CAD in dropdown
  - [ ] Select and place → verify converts and displays
- [ ] **Method 3** (Public URL): Configure via custom script to test
  - [ ] Fallback behavior if Method 1 fails

### Permission Tests
- [ ] **Stock Page Confidentiality**:
  - [ ] Viewer user (no stock page access) opens page with map
  - [ ] Map displays correctly (if using registered assets)
  - [ ] Without API/assets: viewers cannot see images (expected)
- [ ] **Editor User**: Can create/edit maps as expected

## Performance & Monitoring

### Baseline Metrics
- [ ] Measure initial page load time (with and without maps)
- [ ] Monitor browser console for errors
- [ ] Check API response times (if using conversion API)

### Caching Verification (If Using API)
- [ ] First map request: note latency (includes conversion)
- [ ] Reload same map: verify faster (cached)
- [ ] Modify CAD file on stock page
- [ ] Re-request map: should convert again (new hash)

### Logging & Alerts
- [ ] API server logs configured (Docker: check `docker compose logs`)
- [ ] Errors captured and alerting enabled if needed

## Rollback Plan

- [ ] **If Critical Issue**:
  - [ ] Disable plugin from GROWI admin screen
  - [ ] Remove custom script (window.GROWI_CUSTOM_MAP_CONFIG)
  - [ ] Maps will not display, but GROWI continues functioning
  - [ ] Re-enable plugin after fix and bump version
- [ ] **If API Issue**:
  - [ ] Comment out `cadConvertApi` in custom script (falls back to image-only mode)
  - [ ] Existing maps with registered assets still display
  - [ ] Without API, only static images work (no new CAD conversion)

## Post-Deployment

- [ ] **Documentation**: 
  - [ ] Update internal wiki/runbooks with:
    - [ ] Where maps are used
    - [ ] How to add new maps
    - [ ] Troubleshooting steps
  - [ ] Link to project README and docs

- [ ] **Training**:
  - [ ] Brief content editors on map creation procedure
  - [ ] Link to {doc}`user-guide` and {doc}`syntax-reference`

- [ ] **Backup Strategy**:
  - [ ] If using API: Set up regular backups of `/data/cache` directory (asset metadata and SVG cache)
  - [ ] Document restore procedure

- [ ] **Monitoring**:
  - [ ] Set up health check alerts for conversion API (if deployed)
  - [ ] Monitor error logs
  - [ ] Track feature usage (e.g., number of maps created)

## Security Review

- [ ] **Stock Page Visibility**:
  - [ ] If confidential: only editors can view
  - [ ] Verify registered assets still display to restricted viewers ✓ (API bypasses permissions)

- [ ] **Conversion API** (if deployed):
  - [ ] `ADMIN_TOKEN` configured for write endpoints
  - [ ] `CORS_ORIGINS` limited to GROWI domain
  - [ ] Reverse proxy IP-restricts write paths (Apache/Nginx)
  - [ ] SSL/TLS enabled
  - [ ] Rate limiting considered (proxy-level or API level)

- [ ] **Custom Script**:
  - [ ] `GROWI_CUSTOM_MAP_CONFIG` does **NOT** contain any secrets
  - [ ] Token never embedded in browser-visible config
  - [ ] Only `defaultSrc` and `cadConvertApi` endpoint (public-safe values)

- [ ] **Permissions**:
  - [ ] No privilege escalation via map creation
  - [ ] Map display respects original attachment permissions (if not using API)
  - [ ] Registered assets bypass permissions by design (documented)

## Troubleshooting

### Common Issues

**Map button not appearing:**
- [ ] Plugin enabled in admin screen?
- [ ] Browser cache cleared?
- [ ] Custom script reloaded?
- [ ] Check browser console for errors

**"Map file not found":**
- [ ] Verify `file=` filename matches attachment or registered asset
- [ ] Is stock page viewable by current user?
- [ ] For CAD: is API configured and running?

**GUI buttons not working:**
- [ ] Are you in edit mode (`#edit` in URL)?
- [ ] Try force reload browser
- [ ] Check console for JavaScript errors

**CAD conversion fails:**
- [ ] API running? Check `GET {cadConvertApi}/health`
- [ ] GROWI token valid and has correct scopes?
- [ ] File size within limit (`MAX_FILE_SIZE` on API)?

For more detailed troubleshooting, see {doc}`admin-guide` troubleshooting section.

## Sign-Off

- [ ] **Testing Lead**: Maps function correctly in all scenarios
- [ ] **Security Lead**: Security review passed
- [ ] **Operations Lead**: Monitoring and backups in place
- [ ] **Product Owner**: Feature meets business requirements
- [ ] **Go/No-Go Decision**: Production deployment approved

---

**Deployment Date**: _______________

**Deployed By**: _______________

**Production URL**: _______________

**Notes**:
```



```
