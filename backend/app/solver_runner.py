"""Start a solver with OS budgets and without application credentials."""

import os
import resource
import sys

resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
if sys.platform.startswith("linux"):
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
os.execvp(sys.argv[1], sys.argv[1:])
