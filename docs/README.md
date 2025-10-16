# Source Tree #

All source code and documentation lives in the "docs" directory tree, which
is what github.io uses as the root of the web site.  The source code lives
in the "src" subdirectory, which is copied one level up with the "publish"
script when we want to publish a new release.

The reason for having all of the files in two places is that it allows the
next version of the software to be developed without disrupting the active
web site.  Users interested in testing the tip-of-tree branch can just add
"src" to the URLs.  Both versions must be present in the git repository
because we're using github.io to host the site.

DO NOT EDIT FILES IN "docs".  Always edit files in "src", and copy them up.
The exception would be for a hotfix that only applies to the currently
published version.

Before releasing a new version with major changes, it might be helpful to
capture the previous version in a subdirectory (e.g. "v1_0"), so that users
who prefer the previous version can still have access to it via a different
URL.
