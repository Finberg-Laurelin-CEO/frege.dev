#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_IMAGE="${ROOT_DIR}/design/art/sources/hesperus/mengs-hesperus-original.jpg"
OUTPUT_DIR="${ROOT_DIR}/public/art/hesperus"
EXPECTED_SOURCE_SHA1="ae319077f636a5bc6929609ae1baa17c9aa76c78"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required (the 'magick' command was not found)." >&2
  exit 1
fi

if [[ ! -f "${SOURCE_IMAGE}" ]]; then
  echo "Missing source image: ${SOURCE_IMAGE}" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  source_sha1="$(shasum -a 1 "${SOURCE_IMAGE}" | awk '{print $1}')"
elif command -v sha1sum >/dev/null 2>&1; then
  source_sha1="$(sha1sum "${SOURCE_IMAGE}" | awk '{print $1}')"
else
  echo "A SHA-1 utility ('shasum' or 'sha1sum') is required." >&2
  exit 1
fi

if [[ "${source_sha1}" != "${EXPECTED_SOURCE_SHA1}" ]]; then
  echo "Source checksum mismatch: expected ${EXPECTED_SOURCE_SHA1}, got ${source_sha1}." >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"

# A single thread and stripped metadata keep renders reproducible across runs on
# the same ImageMagick build. The source checksum is recorded in SOURCE.md.
export MAGICK_THREAD_LIMIT=1

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/frege-hesperus.XXXXXX")"
trap 'rm -rf "${WORK_DIR}"' EXIT

make_crop() {
  local name="$1"
  local dimensions="$2"
  local gravity="$3"

  magick "${SOURCE_IMAGE}" \
    -auto-orient \
    -colorspace sRGB \
    -filter Lanczos \
    -resize "${dimensions}^" \
    -gravity "${gravity}" \
    -extent "${dimensions}" \
    -strip \
    "${WORK_DIR}/${name}-base.png"
}

make_duotone() {
  local name="$1"

  magick -size 1x256 gradient:'#03140D-#D9E1D2' \
    "${WORK_DIR}/duotone-lut.png"

  magick "${WORK_DIR}/${name}-base.png" \
    -colorspace Gray \
    -sigmoidal-contrast '5x46%' \
    "${WORK_DIR}/duotone-lut.png" \
    -clut \
    -colorspace sRGB \
    -strip \
    "${WORK_DIR}/${name}-duotone.png"
}

make_halftone() {
  local name="$1"

  magick "${WORK_DIR}/${name}-base.png" \
    -colorspace Gray \
    -sigmoidal-contrast '6x48%' \
    -ordered-dither 'o8x8,6' \
    +level-colors '#03140D','#A6FFCB' \
    -colorspace sRGB \
    -strip \
    "${WORK_DIR}/${name}-halftone.png"
}

encode_pair() {
  local source="$1"
  local output_stem="$2"
  local avif_quality="$3"
  local webp_quality="$4"

  magick "${source}" \
    -strip \
    -define heic:speed=1 \
    -quality "${avif_quality}" \
    "${OUTPUT_DIR}/${output_stem}.avif"

  magick "${source}" \
    -strip \
    -define webp:method=6 \
    -quality "${webp_quality}" \
    "${OUTPUT_DIR}/${output_stem}.webp"
}

make_social_card() {
  local subject_width

  # Start with a blurred, darkened crop so the image reaches every edge without
  # competing with social-card copy that will be rendered separately.
  make_crop social-background '1200x630' North
  make_duotone social-background
  magick "${WORK_DIR}/social-background-duotone.png" \
    -blur '0x16' \
    -fill '#03140D' \
    -colorize '34%' \
    "${WORK_DIR}/social-background.png"

  # Preserve the full portrait on the right. A feathered alpha edge merges it
  # into the background instead of creating a visible vertical seam.
  magick "${SOURCE_IMAGE}" \
    -auto-orient \
    -colorspace sRGB \
    -filter Lanczos \
    -resize 'x630' \
    -strip \
    "${WORK_DIR}/social-subject-base.png"
  make_duotone social-subject

  subject_width="$(magick identify -format '%w' "${WORK_DIR}/social-subject-duotone.png")"
  magick -size "${subject_width}x630" xc:white \
    -fill black \
    -draw 'rectangle 0,0 72,630' \
    -blur '0x34' \
    "${WORK_DIR}/social-subject-mask.png"
  magick "${WORK_DIR}/social-subject-duotone.png" \
    "${WORK_DIR}/social-subject-mask.png" \
    -alpha off \
    -compose CopyOpacity \
    -composite \
    "${WORK_DIR}/social-subject.png"

  # The final left-to-right veil guarantees dark negative space for an
  # ImageResponse title while leaving Hesperus and the evening star clear.
  magick -size 630x1200 gradient:'#03140DF2-#03140D00' \
    -rotate -90 \
    "${WORK_DIR}/social-left-veil.png"
  magick "${WORK_DIR}/social-background.png" \
    "${WORK_DIR}/social-subject.png" \
    -gravity East \
    -compose Over \
    -composite \
    "${WORK_DIR}/social-left-veil.png" \
    -gravity Center \
    -compose Over \
    -composite \
    -strip \
    -sampling-factor '4:2:0' \
    -interlace Plane \
    -quality 76 \
    "${OUTPUT_DIR}/hesperus-social-card.jpg"
}

# Desktop is a wide, top-weighted crop so Hesperus, the wings, arrows, and star
# remain legible beside hero copy. Mobile preserves the painting's portrait
# composition and keeps the outstretched hand inside the crop.
make_crop desktop '1440x1080' North
make_crop mobile '960x1280' Center

for viewport in desktop mobile; do
  make_duotone "${viewport}"
  make_halftone "${viewport}"

  # The animated ASCII cascade samples the original color crop so the warm
  # figure, blue drapery, and evening star remain visible beneath the green
  # character field instead of collapsing into a monochrome wash.
  encode_pair \
    "${WORK_DIR}/${viewport}-base.png" \
    "hesperus-color-${viewport}" \
    46 \
    72

  encode_pair \
    "${WORK_DIR}/${viewport}-duotone.png" \
    "hesperus-duotone-${viewport}" \
    46 \
    70

  encode_pair \
    "${WORK_DIR}/${viewport}-halftone.png" \
    "hesperus-halftone-${viewport}" \
    52 \
    34
done

make_social_card

echo "Rendered Hesperus assets to ${OUTPUT_DIR}"
magick identify -format '%f %wx%h %b\n' "${OUTPUT_DIR}"/*.{avif,webp,jpg}
