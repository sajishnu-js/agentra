# Theme snapshots

`index.pre-black-base.css` is a byte-for-byte copy of `src/index.css` as it
stood before the "black-dominant base + premium accent gradients" pass.

All seven accents (Brown, Silver, Blue, Green, Nebula, Ember, Opal) and both
light and dark modes are preserved in it exactly as they were. To revert the
look wholesale:

    cp src/theme/legacy/index.pre-black-base.css src/index.css

Nothing imports this file — it is a snapshot, not a live stylesheet, so it
costs nothing at build time.
