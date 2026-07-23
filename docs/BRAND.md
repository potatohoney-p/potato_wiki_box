# Brand and Asset Guide

This guide keeps repository, application, release, and community presentation consistent.

## Canonical names

| Context | Use |
| --- | --- |
| Display name | `potato box` |
| Package and executable family | `potato-box` |
| Desktop product name | `potato box` |
| Application identifier | `com.potatobox.app` |
| Project state directory | `.potato-box` |
| Environment variables | `POTATO_BOX_*` |

Use lowercase `potato box` in prose and headings. Use `potato-box` only where spaces are not valid, such as package names, filenames, process identifiers, and URLs. Do not abbreviate the product to PB in user-facing copy.

## Mark

The canonical repository mark is [`assets/brand/potato-box-mark.svg`](../assets/brand/potato-box-mark.svg).

- Keep the five-by-five tile geometry intact.
- Leave clear space equal to at least one tile around the mark.
- Use the SVG at 32 px or larger; use a platform icon from `src-tauri/icons/` where a raster or operating-system icon is required.
- Do not add a potato illustration, rotate the grid, recolor individual tiles arbitrarily, or place text inside the mark.
- On busy imagery, place the mark on a solid white or charcoal field with sufficient contrast.

## Palette

| Role | Hex | Intended use |
| --- | --- | --- |
| Ink | `#242833` | Primary mark tiles, text, high-contrast surfaces |
| Cobalt | `#326BFF` | Navigation, active state, primary connection |
| Emerald | `#13A06F` | Healthy state, completed work, local ownership |
| Amber | `#F39B2F` | Attention, ingest activity, review state |
| Tile gray | `#DDE2EA` | Inactive mark tiles and neutral structure |
| Canvas | `#F7F9FC` | Diagrams and light presentation surfaces |

The product UI may use semantic tokens rather than these literal values. Accessibility contrast and established UI tokens take priority over exact brand color matching.

## Repository assets

| Asset | Purpose |
| --- | --- |
| `assets/readme/potato-box-cover.jpg` | Optimized main README cover |
| `assets/readme/potato-box-cover.png` | Lossless generated cover master |
| `assets/readme/github-social-preview.jpg` | GitHub repository social preview, 1280 x 640 and under 1 MB |
| `assets/readme/knowledge-loop.svg` | Product workflow diagram |
| `assets/readme/workspace-graph.png` | Primary factual product screenshot |
| `assets/readme/linked-page.png` | Inspectable generated-page screenshot |
| `assets/readme/semantic-search.png` | Search screenshot |
| `assets/readme/review-queue.png` | Review workflow screenshot |
| `assets/readme/knowledge-health.png` | Packaged-build health screenshot |

GitHub does not read a social-preview file automatically. After creating the repository, upload `github-social-preview.jpg` under **Settings -> Social preview**.

## Screenshot policy

Repository screenshots must:

1. come from a current packaged build or a clearly identified development build;
2. use a synthetic project with no personal documents, credentials, local paths, or private provider account data;
3. show a complete, working state rather than a generated UI mockup;
4. use the same aspect ratio within each README gallery row;
5. be replaced when navigation, branding, or the represented behavior materially changes;
6. include concise alt text that describes the product state, not visual decoration.

AI-generated artwork can be used for brand presentation, but never as evidence that a product workflow exists. Generation details for the current cover are recorded in [`assets/readme/README.md`](../assets/readme/README.md).

## Voice

- Prefer direct descriptions of user outcomes and observable behavior.
- Distinguish local-first from offline-only.
- Distinguish saved wiki knowledge from transient chat output.
- Do not claim a provider, platform, signature, or release artifact has been verified unless it was exercised.
- Avoid absolute promises such as “perfect,” “zero risk,” or “fully private.”
