# ASCII Magic processing record

These checked-in masters are local browser treatments of the generated base
artwork recorded in `../generated/PROMPTS.md`. The transformations were made in
[ASCII Magic](https://www.ascii-magic.com/) during a local browser session.
ASCII Magic is a design-time processing tool, not a runtime dependency, and no
ASCII Magic application code or example artwork is bundled here.

| Frege concept | Generated input | ASCII Magic treatment | Checked-in master |
| --- | --- | --- | --- |
| Fragmentation | `../generated/fragmentation-base.webp` | **Atkinson** with **Original colors** | `fragmentation-atkinson-master.webp` |
| Context gate | `../generated/context-gate-base.webp` | **Lines** with **Original backdrop** | `context-lines-master.webp` |
| Provenance | `../generated/provenance-base.webp` | **Diamond** with **Original backdrop** | `provenance-diamonds-master.webp` |
| Persistence | `../generated/persistence-base.webp` | **Dots** with **Original backdrop** | `persistence-dots-master.webp` |

The browser PNG exports were converted locally into stripped WebP masters at
quality 90, with the longest edge limited to 1920 pixels. Browser-tool output
can vary with application versions and interactive settings, so this processing
step is not claimed to be exactly regenerable. The checked-in `*-master.webp`
files are the deterministic inputs for `scripts/art/render-system-art.sh`.

Two additional ASCII Magic treatments derived from user-supplied photographs
are documented separately in `../user/README.md`; they are not generated-system
artwork and are rendered by `scripts/art/render-user-art.sh`.
