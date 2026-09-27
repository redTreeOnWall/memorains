#!/bin/sh
# Must be run from this directory (uses pwd-relative paths).
# UserServerMessage.ts is intentionally omitted — sync it by hand.
cp ../server/src/interface/HttpMessage.ts ../server/src/interface/DataEntity.ts ../client/src/interface
