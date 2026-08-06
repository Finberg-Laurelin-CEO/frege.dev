# Third-Party Notices

Frege depends on third-party software whose applicable license information is
recorded by package manifests, lockfiles, distributed packages, and upstream
projects. Those materials remain subject to their respective licenses. The
Frege proprietary notice does not replace or restrict third-party rights.

## Optional Graphify local integration

The Frege CLI can invoke a separately installed Graphify fork for opt-in local
code-graph indexing and query. Frege does not bundle or redistribute Graphify.

- Fork: https://github.com/Finberg-Laurelin-CEO/graphify-frege
- Pinned fork commit: `46101385b218847cef904ce52ecc4dad209b9f83`
- Upstream: https://github.com/Graphify-Labs/graphify
- Pinned upstream v8 baseline: `07b9143d4b90b1e1cb88dc71423f742a501efd29`
  (Graphify `0.9.34`)
- Licenses: Apache License 2.0; pre-relicense portions are also retained under
  the upstream MIT license

The fork preserves upstream `LICENSE`, `LICENSE-MIT`, and `NOTICE`. Its Frege
modification adds the deterministic local `graphify export frege` command,
schema `frege.graphify.code-graph` version 1, tests, documentation, and a
refreshed `uv.lock` version entry. Modified
upstream files carry a dated modification notice; Frege-owned additions identify
themselves directly. Graphify remains the copyright of Safi Shamsi and the
Graphify contributors; this notice does not imply affiliation or endorsement.

## Departure Mono font files

This repository currently contains these bundled font files:

- `public/fonts/DepartureMono-Regular.otf`
- `public/fonts/DepartureMono-Regular.woff2`

These files match the version 1.500 files published by the
[Departure Mono project](https://github.com/rektdeckard/departure-mono). The
font is copyright 2022–2024 Helena Zhang and distributed under the SIL Open
Font License 1.1. A copy is retained at
`public/fonts/DepartureMono-OFL.txt`.

## Newsreader font files

The Newsreader variable and static font files in `public/fonts/` come from the
[Newsreader project](https://github.com/productiontype/Newsreader), copyright
the Newsreader Project Authors, and are distributed under the SIL Open Font
License 1.1. A copy is retained at `public/fonts/Newsreader-OFL.txt`.

## Hesperus artwork

The Hesperus artwork is derived from an Anton Raphael Mengs painting whose
source record is marked public domain by Wikimedia Commons. Source, download,
transformation, and attribution details are recorded in
`design/art/ARTWORK_NOTICE.md` and `design/art/sources/hesperus/SOURCE.md`.

## Generated system artwork and ASCII Magic processing

Frege's fragmentation, context, provenance, and persistence images began as
AI-tool-generated base artwork made from Frege-directed concepts. They were
subsequently treated with [ASCII Magic](https://www.ascii-magic.com/) during a
local browser design session. ASCII Magic is a design-time processing tool; its
application code and example artwork are not bundled with Frege.

This disclosure records provenance and does not imply affiliation or
endorsement. Concept briefs, the processing map, source-master lineage, and the
rights notice are retained in `design/art/sources/generated/PROMPTS.md`,
`design/art/sources/ascii-magic/README.md`, and
`design/art/ARTWORK_NOTICE.md`.

ASCII Magic was also used as a local design-time processor for two
user-supplied photographs. Their stripped-master lineage is recorded in
`design/art/sources/user/README.md`; the original camera files are not bundled.

## Migra development font

Migra is not bundled in this repository. The local visual prototype may resolve
an installed copy through CSS `local()` and otherwise falls back to Newsreader.
Pangram Pangram requires a web license before Migra font files are embedded on
`frege.dev`; a licensed production webfont must be supplied before that part of
the typography is deployed.

Questions about third-party notices can be sent to
[hello@frege.dev](mailto:hello@frege.dev).
