#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${ROOT_DIR}/design/art/sources/ascii-magic"
OUTPUT_DIR="${ROOT_DIR}/public/art/system"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required (the 'magick' command was not found)." >&2
  exit 1
fi

case "$(magick -version | head -n 1)" in
  "Version: ImageMagick 7"*) ;;
  *)
    echo "ImageMagick 7 is required." >&2
    exit 1
    ;;
esac

export MAGICK_THREAD_LIMIT=1
mkdir -p "${OUTPUT_DIR}"

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "A SHA-256 utility ('shasum' or 'sha256sum') is required." >&2
    exit 1
  fi
}

assert_source() {
  local filename="$1"
  local expected_sha256="$2"
  local source="${SOURCE_DIR}/${filename}"
  local actual_sha256

  if [[ ! -f "${source}" ]]; then
    echo "Missing source master: ${source}" >&2
    exit 1
  fi

  actual_sha256="$(sha256_file "${source}")"
  if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
    echo "Source checksum mismatch for ${filename}." >&2
    echo "Expected ${expected_sha256}; got ${actual_sha256}." >&2
    exit 1
  fi
}

render_avif() {
  local source="$1"
  local output="$2"
  local dimensions="$3"
  local quality="$4"

  magick "${SOURCE_DIR}/${source}" \
    -resize "${dimensions}^" \
    -gravity Center \
    -extent "${dimensions}" \
    -strip \
    -quality "${quality}" \
    "${OUTPUT_DIR}/${output}.avif"
}

render_webp() {
  local source="$1"
  local output="$2"
  local dimensions="$3"
  local quality="$4"
  local method="${5:-}"

  if [[ -n "${method}" ]]; then
    magick "${SOURCE_DIR}/${source}" \
      -resize "${dimensions}^" \
      -gravity Center \
      -extent "${dimensions}" \
      -strip \
      -define "webp:method=${method}" \
      -quality "${quality}" \
      "${OUTPUT_DIR}/${output}.webp"
  else
    magick "${SOURCE_DIR}/${source}" \
      -resize "${dimensions}^" \
      -gravity Center \
      -extent "${dimensions}" \
      -strip \
      -quality "${quality}" \
      "${OUTPUT_DIR}/${output}.webp"
  fi
}

assert_asset() {
  local filename="$1"
  local expected_format="$2"
  local expected_dimensions="$3"
  local maximum_bytes=250000
  local asset="${OUTPUT_DIR}/${filename}"
  local actual_format
  local actual_dimensions
  local actual_bytes

  actual_format="$(magick identify -format '%m' "${asset}")"
  actual_dimensions="$(magick identify -format '%wx%h' "${asset}")"
  actual_bytes="$(wc -c < "${asset}" | tr -d '[:space:]')"

  if [[ "${actual_format}" != "${expected_format}" ]]; then
    echo "Unexpected format for ${filename}: ${actual_format}." >&2
    exit 1
  fi
  if [[ "${actual_dimensions}" != "${expected_dimensions}" ]]; then
    echo "Unexpected dimensions for ${filename}: ${actual_dimensions}." >&2
    exit 1
  fi
  if (( actual_bytes > maximum_bytes )); then
    echo "Asset exceeds ${maximum_bytes} bytes: ${filename} (${actual_bytes})." >&2
    exit 1
  fi

  printf '%s %s %s bytes\n' "${filename}" "${actual_dimensions}" "${actual_bytes}"
}

assert_source context-lines-master.webp \
  9ea08fb00f37aec2df31b0f632afb8cd6107c88240e618ef9049e570909611ff
assert_source fragmentation-atkinson-master.webp \
  c5de15cc27fbf79779a4d3d625ee13fb4b382c3d28395c42418445fae7f7450f
assert_source persistence-dots-master.webp \
  1fe12e7d1836115dd072a4ecc800bd0f4b0179222a6cff5cd90b4c72a934e757
assert_source provenance-diamonds-master.webp \
  68255326da6258dc622d392f27ce9d8542e4719c8af36d8689971e0c5dcff246

# Fragmentation's Atkinson texture is deliberately encoded at a smaller WebP
# fallback size and lower quality to keep its high-entropy dither under budget.
render_avif fragmentation-atkinson-master.webp fragmentation-atkinson 1440x900 42
render_webp fragmentation-atkinson-master.webp fragmentation-atkinson 1200x750 55 6

render_avif context-lines-master.webp context-lines 1440x900 52
render_webp context-lines-master.webp context-lines 1440x900 78

render_avif provenance-diamonds-master.webp provenance-diamonds 900x1400 52
render_webp provenance-diamonds-master.webp provenance-diamonds 900x1400 78

render_avif persistence-dots-master.webp persistence-dots 1600x900 52
render_webp persistence-dots-master.webp persistence-dots 1600x900 78

assert_asset fragmentation-atkinson.avif AVIF 1440x900
assert_asset fragmentation-atkinson.webp WEBP 1200x750
assert_asset context-lines.avif AVIF 1440x900
assert_asset context-lines.webp WEBP 1440x900
assert_asset provenance-diamonds.avif AVIF 900x1400
assert_asset provenance-diamonds.webp WEBP 900x1400
assert_asset persistence-dots.avif AVIF 1600x900
assert_asset persistence-dots.webp WEBP 1600x900
