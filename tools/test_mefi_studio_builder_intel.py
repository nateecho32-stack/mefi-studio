"""npm-test discovery shim: the builder outcome reporting contracts live in
tools/test_builder_intel.py (the A-Eyes overseer directive names that file);
this module re-exports them so ``python -m unittest discover -s tools
-p "test_mefi_studio_*.py"`` runs them too. The import tries the discovery
spelling first (``tools/`` on sys.path), then the package spelling so
``python -m unittest tools.test_mefi_studio_builder_intel`` also works."""
try:
    from test_builder_intel import *  # noqa: F401,F403
except ImportError:  # imported as tools.test_mefi_studio_builder_intel
    from .test_builder_intel import *  # noqa: F401,F403

if __name__ == "__main__":
    import unittest

    unittest.main()
