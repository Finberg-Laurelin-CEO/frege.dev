#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_IMAGE="${ROOT_DIR}/design/art/sources/demorgan/evelyn-de-morgan-phosphorus-hesperus-original.jpg"
OUTPUT_DIR="${ROOT_DIR}/public/art/demorgan"
EXPECTED_SOURCE_SHA1="9bf952bb2535883e1e12316620894a93eb6adb91"
MAX_DEPLOY_BYTES=250000

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required (the 'magick' command was not found)." >&2
  exit 1
fi

if [[ ! -f "${SOURCE_IMAGE}" ]]; then
  echo "Missing source image: ${SOURCE_IMAGE}" >&2
  exit 1
fi

sha1_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 1 "$1" | awk '{print $1}'
  elif command -v sha1sum >/dev/null 2>&1; then
    sha1sum "$1" | awk '{print $1}'
  else
    echo "A SHA-1 utility ('shasum' or 'sha1sum') is required." >&2
    exit 1
  fi
}

source_sha1="$(sha1_file "${SOURCE_IMAGE}")"
if [[ "${source_sha1}" != "${EXPECTED_SOURCE_SHA1}" ]]; then
  echo "Source checksum mismatch: expected ${EXPECTED_SOURCE_SHA1}, got ${source_sha1}." >&2
  exit 1
fi

source_dimensions="$(magick identify -format '%wx%h' "${SOURCE_IMAGE}")"
if [[ "${source_dimensions}" != "744x1024" ]]; then
  echo "Source dimensions mismatch: expected 744x1024, got ${source_dimensions}." >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
export MAGICK_THREAD_LIMIT=1

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/frege-demorgan.XXXXXX")"
trap 'rm -rf "${WORK_DIR}"' EXIT

# Five flat inks turn the continuous-tone scan into an unmistakable ordered
# print. The palette deliberately moves from Frege's deep green through moss to
# torch amber and warm paper instead of using a monochrome phosphor treatment.
magick \
  xc:'#021810' \
  xc:'#073b29' \
  xc:'#496344' \
  xc:'#b47a3e' \
  xc:'#ead8ae' \
  +append \
  -filter point \
  -resize '256x1!' \
  -strip \
  "${WORK_DIR}/ink-lut.png"

make_print() {
  local source="$1"
  local output="$2"

  magick "${source}" \
    -colorspace Gray \
    -sigmoidal-contrast '6x47%' \
    -ordered-dither 'o8x8,4' \
    "${WORK_DIR}/ink-lut.png" \
    -clut \
    -colorspace sRGB \
    -strip \
    "${output}"
}

make_desktop_composite() {
  local subject_width

  # A soft, full-bleed field is taken from the painting itself. It provides a
  # continuous surface for overlaid copy without introducing letterbox bars.
  magick "${SOURCE_IMAGE}" \
    -auto-orient \
    -colorspace sRGB \
    -filter Lanczos \
    -resize '1920x1080^' \
    -gravity Center \
    -extent '1920x1080' \
    -blur '0x24' \
    -fill '#021810' \
    -colorize '42%' \
    -strip \
    "${WORK_DIR}/desktop-field.png"

  # The full portrait is preserved at the right edge: both figures and both
  # torches remain present. A broad feather on its left side merges it into the
  # field, avoiding the look of a portrait pasted into a landscape rectangle.
  magick "${SOURCE_IMAGE}" \
    -auto-orient \
    -colorspace sRGB \
    -filter Lanczos \
    -resize 'x1080' \
    -strip \
    "${WORK_DIR}/desktop-subject-base.png"

  subject_width="$(magick identify -format '%w' "${WORK_DIR}/desktop-subject-base.png")"
  magick -size "${subject_width}x1080" xc:white \
    -fill black \
    -draw 'rectangle 0,0 190,1080' \
    -blur '0x76' \
    -strip \
    "${WORK_DIR}/desktop-subject-mask.png"

  magick "${WORK_DIR}/desktop-subject-base.png" \
    "${WORK_DIR}/desktop-subject-mask.png" \
    -alpha off \
    -compose CopyOpacity \
    -composite \
    -strip \
    "${WORK_DIR}/desktop-subject.png"

  magick "${WORK_DIR}/desktop-field.png" \
    "${WORK_DIR}/desktop-subject.png" \
    -gravity East \
    -compose Over \
    -composite \
    -strip \
    "${WORK_DIR}/desktop-composite.png"

  make_print \
    "${WORK_DIR}/desktop-composite.png" \
    "${WORK_DIR}/phosphorus-hesperus-dither.png"
}

make_mobile_composite() {
  # The source is already close to a 3:4 mobile frame. This restrained crop
  # keeps the raised and lowered torches as well as the complete paired figures.
  magick "${SOURCE_IMAGE}" \
    -auto-orient \
    -colorspace sRGB \
    -filter Lanczos \
    -resize '960x1280^' \
    -gravity Center \
    -extent '960x1280' \
    -strip \
    "${WORK_DIR}/mobile-composite.png"

  make_print \
    "${WORK_DIR}/mobile-composite.png" \
    "${WORK_DIR}/phosphorus-hesperus-dither-mobile.png"
}

encode_pair() {
  local source="$1"
  local output_stem="$2"
  local avif_quality="$3"
  local webp_quality="$4"

  magick "${source}" \
    -strip \
    -define heic:speed=5 \
    -quality "${avif_quality}" \
    "${OUTPUT_DIR}/${output_stem}.avif"

  magick "${source}" \
    -strip \
    -define webp:method=6 \
    -quality "${webp_quality}" \
    "${OUTPUT_DIR}/${output_stem}.webp"
}

assert_asset() {
  local filename="$1"
  local expected_format="$2"
  local expected_dimensions="$3"
  local asset="${OUTPUT_DIR}/${filename}"
  local actual_format actual_dimensions actual_bytes

  actual_format="$(magick identify -format '%m' "${asset}")"
  actual_dimensions="$(magick identify -format '%wx%h' "${asset}")"
  actual_bytes="$(wc -c < "${asset}" | tr -d '[:space:]')"

  [[ "${actual_format}" == "${expected_format}" ]] || {
    echo "Unexpected format for ${filename}: ${actual_format}." >&2
    exit 1
  }
  [[ "${actual_dimensions}" == "${expected_dimensions}" ]] || {
    echo "Unexpected dimensions for ${filename}: ${actual_dimensions}." >&2
    exit 1
  }
  (( actual_bytes <= MAX_DEPLOY_BYTES )) || {
    echo "Asset exceeds ${MAX_DEPLOY_BYTES} bytes: ${filename} (${actual_bytes})." >&2
    exit 1
  }
  if magick identify -verbose "${asset}" | grep -q '^  Profiles:'; then
    echo "Unexpected embedded profile in ${filename}." >&2
    exit 1
  fi

  printf '%s %s %s bytes sha256=%s\n' \
    "${filename}" \
    "${actual_dimensions}" \
    "${actual_bytes}" \
    "$(shasum -a 256 "${asset}" | awk '{print $1}')"
}

make_desktop_composite
make_mobile_composite

encode_pair \
  "${WORK_DIR}/phosphorus-hesperus-dither.png" \
  phosphorus-hesperus-dither \
  48 \
  14

encode_pair \
  "${WORK_DIR}/phosphorus-hesperus-dither-mobile.png" \
  phosphorus-hesperus-dither-mobile \
  48 \
  22

assert_asset phosphorus-hesperus-dither.avif AVIF 1920x1080
assert_asset phosphorus-hesperus-dither.webp WEBP 1920x1080
assert_asset phosphorus-hesperus-dither-mobile.avif AVIF 960x1280
assert_asset phosphorus-hesperus-dither-mobile.webp WEBP 960x1280
