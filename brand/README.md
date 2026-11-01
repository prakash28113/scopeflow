# ScopeFlow logo

- `scopeflow-logo-source.png` is the official logo as supplied by the owner (1 Nov 2026).
- `scopeflow-logo.svg` (full logo), `scopeflow-mark.svg` (symbol only) and `scopeflow-logo-white.svg` (for dark backgrounds) are vector tracings of it.
- Colours: ink `#212933`, blue `#005DD4`.

To regenerate everything after changing the source image:

```
pip install --break-system-packages potracer
python3 brand/trace.py      # source PNG → brand/paths.json
python3 brand/build.py      # → SVGs, public/icon.svg, src/components/brand.tsx
node brand/render.mjs       # → app icons and PNG logos
node build/og/render.mjs    # → public/og.png (link preview); bump ?v= in index.html
```
