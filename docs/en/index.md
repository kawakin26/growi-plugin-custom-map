# growi-plugin-custom-map Documentation

Detailed documentation for a [GROWI](https://growi.org/) plugin that allows you to reference and display pre-uploaded floor plans (such as building floor diagrams) within wiki documents using **the original filename**.

This documentation has a **Japanese version as the original**. The English version is a translation, and if there are any discrepancies, the Japanese version takes precedence. If you only want to know the overview, please refer to the repository's [README](https://github.com/kawakin26/growi-plugin-custom-map). This documentation provides detailed procedures and references for users, administrators, and developers respectively.

```{toctree}
:maxdepth: 2
:caption: Contents

introduction
user-guide
syntax-reference
admin-guide
extending
```

## Documentation Structure

- **{doc}`introduction`** — The purpose of the plugin, what it can do, and the overall picture. This chapter helps with quick understanding.
- **{doc}`user-guide`** — For general users. Map display operations and procedures for creating and editing maps using GUI.
- **{doc}`syntax-reference`** — Complete attribute reference for `:::custom-map` syntax (useful for both manual writing and auto-generation).
- **{doc}`admin-guide`** — For installers and administrators. Installation, configuration, CAD conversion API integration, confidential operations, security, and troubleshooting.
- **{doc}`extending`** — For developers. Build procedures, architecture, and extension tips.

## Related Documentation

- Conversion API (optional): [growi-cad-convert-api](https://github.com/kawakin26/growi-cad-convert-api)
- License: [MIT License](https://github.com/kawakin26/growi-plugin-custom-map/blob/main/LICENSE) (Copyright (c) 2026 kawakin)
