# Frege type system

The public-site prototype uses three voices with deliberately separate jobs:

- **Migra Italic** is the expressive display accent. It appears only on the
  pivotal clause in the hero and closing statement, where its directional,
  wing-like forms echo Hesperus without turning the whole site into a fashion
  editorial.
- **Newsreader** carries the primary editorial hierarchy and remains the
  deterministic serif fallback everywhere. Its variable webfont is bundled
  under the SIL Open Font License.
- **Departure Mono** labels interfaces, status, provenance, and evidence. It is
  a technical annotation voice, not the default paragraph face.

## Migra deployment gate

The repository does not distribute Migra. During local design work the CSS may
resolve an installed `Migra Italic` face with `local()`; other environments fall
back to Newsreader. Before enabling the redesigned public site in production:

1. Purchase the appropriate Migra web license for `frege.dev`.
2. Add the licensed, subsetted WOFF2 file to `public/fonts/` without committing
   any trial-only desktop file.
3. Change the `Migra Frege` source in `app/public-v2.module.css` from `local()`
   to that WOFF2 URL, retaining Newsreader as the fallback.
4. Record the licensed file and applicable notice in `THIRD_PARTY_NOTICES.md`.

This keeps the local direction visible now without treating a free-to-try font
as production-redistributable software.
