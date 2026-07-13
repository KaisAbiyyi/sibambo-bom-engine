#!/usr/bin/env bash
# package.sh — Package bom_engine_plugin as a SketchUp extension (.rbz)
# Run from the BOM Engine directory:
#   bash bom_engine_plugin/package.sh

set -e

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$PLUGIN_DIR")"
VERSION="3.0.0"
OUT_NAME="bom_engine_plugin_v${VERSION}.rbz"
OUT_PATH="${ROOT_DIR}/${OUT_NAME}"

echo "Packaging BOM Engine plugin..."
echo "  Source : ${PLUGIN_DIR}"
echo "  Output : ${OUT_PATH}"

cd "${PLUGIN_DIR}"

# Create ZIP, then rename to .rbz
zip -r "${OUT_PATH}.zip" "bom_engine_loader.rb" "bom_engine/" \
    --exclude "*.DS_Store" \
    --exclude "*__MACOSX*" \
    --exclude "*.git*" \
    --exclude "bom_engine/tests/*"

mv "${OUT_PATH}.zip" "${OUT_PATH}"

echo ""
echo "Done: ${OUT_PATH}"
echo ""
echo "Install in SketchUp:"
echo "  Window > Extension Manager > Install Extension > select ${OUT_NAME}"
