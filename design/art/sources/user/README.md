# User-supplied photography processing record

These masters originate from photographs supplied directly by the repository
owner. The original camera files remain outside the repository. Only stripped,
downsampled WebP masters are checked in, so original EXIF and precise location
metadata are not redistributed.

The corridor and sundial transformations were performed locally with
[ASCII Magic](https://www.ascii-magic.com/) as a design-time tool, then passed
through ImageMagick 7 for deterministic crop, color, and encoding work. The All
Souls panorama uses a deterministic ImageMagick ordered-dither treatment; its
additional character lattice is rendered as accessible HTML/CSS on the docs
page rather than baked into the photograph.

| Concept | Local source | Treatment | Checked-in master |
| --- | --- | --- | --- |
| One controlled path | `IMG_5670.jpeg` | **Diagonal**, 4:5 crop, image backdrop | `corridor-diagonal-master.webp` |
| Status over time | `IMG_5095.jpeg` | **Characters** using `0123456789:/\\|+*.-`, image backdrop | `sundial-characters-master.webp` |
| Institutional memory | `2EA03BBC-03EA-462D-AF36-CBE5F4F1BF2F.jpg` | Centered 16:9 crop, grayscale contrast curve, `o8x8,6` ordered dither, mapped from `#03140d` to `#d9e1d2` | `all-souls-lattice-master.webp` |

The two browser exports were stripped, converted to grayscale,
contrast-stretched, and mapped from `#03140d` to `#a6ffcb`. The sundial
treatment uses a centered 4:5 crop chosen to remove modern foreground clutter
and keep the dial as the visual center. The All Souls master preserves the
panorama's full 16:9 composition and uses a warmer paper highlight so the
photograph contributes more than phosphor green to the page. The resulting
masters are the deterministic source of record; the interactive ASCII Magic
processing itself is not claimed to be reproducible.

`scripts/art/render-user-art.sh` regenerates the deployable AVIF and WebP files
from these masters and verifies their dimensions, checksums, and byte budgets.
