#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${ROOT_DIR}/design/art/sources/user"
OUTPUT_DIR="${ROOT_DIR}/public/art/user"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 is required (the 'magick' command was not found)." >&2
  exit 1
fi

export MAGICK_THREAD_LIMIT=1
mkdir -p "${OUTPUT_DIR}"

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

assert_source() {
  local filename="$1"
  local expected="$2"
  local actual
  actual="$(sha256_file "${SOURCE_DIR}/${filename}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Source checksum mismatch for ${filename}: ${actual}." >&2
    exit 1
  fi
}

render_avif() {
  local source="$1" output="$2" dimensions="$3"
  magick "${SOURCE_DIR}/${source}" \
    -strip -resize "${dimensions}" -define heic:speed=5 -quality 48 \
    "${OUTPUT_DIR}/${output}.avif"
}

render_webp() {
  local source="$1" output="$2" dimensions="$3" quality="$4"
  magick "${SOURCE_DIR}/${source}" \
    -strip -resize "${dimensions}" -quality "${quality}" \
    "${OUTPUT_DIR}/${output}.webp"
}

assert_asset() {
  local filename="$1" expected_format="$2" expected_dimensions="$3"
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
  (( actual_bytes <= 250000 )) || {
    echo "Asset exceeds 250000 bytes: ${filename} (${actual_bytes})." >&2
    exit 1
  }

  printf '%s %s %s bytes\n' "${filename}" "${actual_dimensions}" "${actual_bytes}"
}

assert_source corridor-diagonal-master.webp \
  1d9eef5531a873404f956dbddbf03cf75ec333891f5c1f6f55b4dff6fc9c2106
assert_source sundial-characters-master.webp \
  49d8b6dd1bd83d2604a022c5f5d9745a80b47cae72cd803d78c68496cf143190
assert_source all-souls-lattice-master.webp \
  40ebe7712d5d516e00465f6e07a868b6ad95923f09a478721637ee6c5cc6c076

render_avif corridor-diagonal-master.webp corridor-diagonal 1200x1500
render_webp corridor-diagonal-master.webp corridor-diagonal 1200x1500 78
render_avif sundial-characters-master.webp sundial-characters 1200x1500
render_webp sundial-characters-master.webp sundial-characters 1050x1313 64
render_avif all-souls-lattice-master.webp all-souls-lattice 1920x1080
render_webp all-souls-lattice-master.webp all-souls-lattice 1440x810 46

assert_asset corridor-diagonal.avif AVIF 1200x1500
assert_asset corridor-diagonal.webp WEBP 1200x1500
assert_asset sundial-characters.avif AVIF 1200x1500
assert_asset sundial-characters.webp WEBP 1050x1313
assert_asset all-souls-lattice.avif AVIF 1920x1080
assert_asset all-souls-lattice.webp WEBP 1440x810
