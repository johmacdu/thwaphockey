# Avatar style test (blocky hockey player)

> **Decision: A (pixel voxel) chosen.** It's the only style that reads "cool, not cute"
> across the full range the character has to serve -- 10U, 12U and 14U. Minecraft/voxel
> has real cred with older kids, where B skews "app mascot" and C (soft/rounded) reads too
> young. A is also the easiest to build and the best fit for the flat-texture + code-shading
> rule. This feeds Phase 1 of `docs/avatar-roadmap.md`.

The three style candidates from the style test in [`docs/avatar-design.md`](../avatar-design.md)
(the player-character work in PR #428). Same prompt each time; only the style line changed.

| File | Style line |
|------|-----------|
| `A-pixel-voxel.png` | pixel-art textures on every block face, 16px per block unit, crisp hard pixel edges, like Minecraft |
| `B-clean-blocks.png` | clean flat-colored blocks, smooth vector-sharp edges, no pixel texture, like a modern toy figure |
| `C-soft-blocks.png` | slightly rounded block edges and bevels, chunky and friendly but still clearly made of boxes |

Generated with the OpenAI image API. **Note:** `gpt-image-1` (named in the design doc) is no
longer accepted by the generations endpoint; these were made with `gpt-image-2.5-sunburst`,
transparent PNG. Re-run the whole set together if regenerating, so the style stays uniform.

## Results against the doc's pass/fail checks

All three **pass** the core tests:

- **Readable at ~120px (roster card size):** yes for all three.
- **Survives a dark plate:** yes for all three (the design doc's thin code-added dark outline would
  make the black gear even safer on dark backgrounds).
- **Buildable from boxes:** A and B are clean box shapes; C's rounded bevels are the hardest to
  reproduce in box-based code (rounded parts "won't survive in code", per the doc).

## Recommendation (final call is Lewie's)

- **A (pixel voxel)** — most Minecraft, and the easiest to build; its flat pixel faces match the
  "flat textures, lighting done in code" rule best. The doc's own lean.
- **B (clean blocks)** — cleanest / most modern-toy look, also very buildable (flat colors + sharp
  edges shade cleanly in code).
- **C (soft blocks)** — friendliest, but the bevels/rounding are the biggest build risk.

A or B are the safe, buildable picks (both honor the code-shading rule); A for max Minecraft, B for a
cleaner modern figure. Per the doc, the real test is asking Lewie which one he'd want.

> Reminder from the doc: these are **style-test images only**. The textures generated *after* a style
> is chosen must be **flat, with no baked-in shadows/highlights**, because the code shades each box
> face itself (top lighter, side darker). These test images have their own lighting and are for
> picking a direction, not for shipping.
