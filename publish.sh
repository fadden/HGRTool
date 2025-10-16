#!/usr/bin/env bash
#
# Run this from the top-level project directory to publish a new release.
#
# Currently we just copy the contents of the "src" directory one level up,
# to make it the web site root.  Everything not in the "src" directory is
# removed first.
#
set -e  # halt on error
#set -x  # show commands as they are executed

cd docs
echo "--- cleaning"
touch xyzzy     # ensure there's always something to remove
find . -mindepth 1 -name src -prune -o -print0 | xargs -0 rm -rf
echo "--- copying"
cd src
cp -rn * ..
echo "--- done"
exit 0
