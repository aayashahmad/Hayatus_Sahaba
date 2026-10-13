#!/bin/bash
# OCRs every block of pages that has no text yet (existing pages are never overwritten).
# Usage: scripts/ocr-all-missing.sh   then: node scripts/build-index.mjs
cd "$(dirname "$0")/.."
run() { scripts/ocr-pages.sh "$@"; }
for r in 13-13 16-16 36-47 72-83 108-119 156-179 204-215 231-251 253-263 300-311 324-335 348-359 468-479 504-539 564-575 588-599 636-647; do run 1 ${r%-*} ${r#*-}; done
for r in 15-15 120-131 144-155 216-227 276-299 324-335 420-443 480-491 516-527 552-563 588-599 660-671 684-719; do run 2 ${r%-*} ${r#*-}; done
for r in 16-16 96-107 120-131 148-155 192-203 216-251 324-335 348-359 372-383 408-419 432-443 456-467; do run 3 ${r%-*} ${r#*-}; done
node scripts/build-index.mjs
