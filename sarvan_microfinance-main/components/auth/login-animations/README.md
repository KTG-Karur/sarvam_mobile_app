# Generic Declarative Login Animation Specification

This directory contains the brand-agnostic declarative animation system for login transitions.

## Architectural Principles

1. **Animation DATA, Not Executable Code**
   External animations are defined purely as declarative JSON data. They are **never** executable React components, TypeScript files, or JavaScript scripts.

2. **No External Brand References in Source Code**
   The Sarvam codebase contains no hard-coded imports, names, or component files for external projects or tenant brands. Animations are loaded dynamically from validated manifest data.

3. **Strict Runtime Security**
   - The runtime renderer (`DeclarativeAnimationRunner`) parses and renders only approved declarative properties.
   - Arbitrary HTML, dynamic JavaScript execution (`eval()`, `new Function()`), script tags, `javascript:` URIs, and unsanitized styles are strictly forbidden and rejected at validation time.
   - If a manifest is invalid or malformed, the system falls back safely to a standard loading transition without crashing or blocking the login flow.

4. **Accessibility & Reduced Motion**
   - All manifests require a `reducedMotionDurationMs` specification.
   - When the user's operating system requests reduced motion (`prefers-reduced-motion: reduce`), high-intensity motion transforms are automatically replaced by brief opacity cross-fades.

---

## Example Manifest (`animation.json`)

The following is an example of a valid, brand-agnostic JSON animation manifest:

```json
{
  "schemaVersion": "1.0",
  "id": "welcome-pulse",
  "name": "Geometric Welcome Pulse",
  "version": "1.0.0",
  "durationMs": 2200,
  "reducedMotionDurationMs": 400,
  "canvas": {
    "width": 800,
    "height": 600,
    "background": "#0b0f19"
  },
  "layers": [
    {
      "id": "halo-glow",
      "type": "svg-circle",
      "cx": 400,
      "cy": 270,
      "r": 70,
      "fill": "none",
      "stroke": "#38bdf8",
      "strokeWidth": 4,
      "from": {
        "scale": 0.4,
        "opacity": 0
      },
      "to": {
        "scale": 1.2,
        "opacity": 0.8
      },
      "delayMs": 150,
      "durationMs": 1200,
      "easing": "easeOut"
    },
    {
      "id": "check-mark",
      "type": "svg-path",
      "d": "M 370 270 L 392 292 L 434 246",
      "fill": "none",
      "stroke": "#f8fafc",
      "strokeWidth": 6,
      "strokeLinecap": "round",
      "strokeLinejoin": "round",
      "from": {
        "pathLength": 0,
        "opacity": 0
      },
      "to": {
        "pathLength": 1,
        "opacity": 1
      },
      "delayMs": 400,
      "durationMs": 900,
      "easing": "easeInOut"
    },
    {
      "id": "caption-text",
      "type": "text",
      "text": "Verification Successful",
      "x": 400,
      "y": 380,
      "fontSize": 20,
      "fontFamily": "sans-serif",
      "fontWeight": 600,
      "textAnchor": "middle",
      "fill": "#e2e8f0",
      "from": {
        "y": 395,
        "opacity": 0
      },
      "to": {
        "y": 380,
        "opacity": 1
      },
      "delayMs": 800,
      "durationMs": 700,
      "easing": "easeOut"
    }
  ]
}
```

---

## Manifest Schema Reference

### Root Manifest Properties

| Field | Type | Description |
| :--- | :--- | :--- |
| `schemaVersion` | `string \| number` | Version of manifest format specification (e.g. `"1.0"`). |
| `id` | `string` | Alphanumeric identifier (`[a-zA-Z0-9_-]+`). |
| `name` | `string` | Display title for the animation. |
| `version` | `string` | Semantic asset version (e.g. `"1.0.0"`). |
| `durationMs` | `number` | Master duration in milliseconds before completion callback fires. |
| `reducedMotionDurationMs`| `number` | Duration in milliseconds when reduced motion is preferred. |
| `canvas` | `object` | Canvas dimensions (`width`, `height`, optional `background`). |
| `layers` | `array` | Array of declarative animation layer objects. |

### Layer Types

- `svg-path`: Vector path utilizing SVG path string (`d`).
- `svg-circle`: Circle primitive (`cx`, `cy`, `r`).
- `svg-rect`: Rectangle primitive (`x`, `y`, `width`, `height`, optional `rx`, `ry`).
- `svg-group`: Grouping container (`<g>`).
- `text`: Text element (`text`, `fontSize`, `fontFamily`, `fontWeight`, `textAnchor`).
- `image`: Vector/raster image asset (`href` restricted to relative paths or base64 data URIs).

### Animation Keyframes (`from` and `to`)

Keyframe transforms allow animating:
- `x`, `y` (spatial offset)
- `scale`, `scaleX`, `scaleY` (scaling factors)
- `rotation` (degrees)
- `opacity` (0 to 1)
- `pathLength` (0 to 1, for drawing strokes)
- `fillOpacity`, `strokeOpacity` (0 to 1)

### Timing & Easing

- `delayMs`: Milliseconds to wait before starting this layer's animation.
- `durationMs`: Layer animation duration (defaults to manifest duration if omitted).
- `easing`: Easing preset (`"linear"`, `"easeIn"`, `"easeOut"`, `"easeInOut"`, `"backOut"`, etc.) or cubic-bezier 4-number array `[x1, y1, x2, y2]`.
