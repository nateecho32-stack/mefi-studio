"""npm-test discovery shim: the write-lock serialization contracts live in
tools/test_assistant_write_lock.py (the A-Eyes overseer directive names that
file); this module re-exports them so ``python -m unittest discover -s tools
-p "test_mefi_studio_*.py"`` runs them too. The import tries the discovery
spelling first (``tools/`` on sys.path), then the package spelling so
``python -m unittest tools.test_mefi_studio_assistant_write_lock`` also works."""
try:
    from test_assistant_write_lock import *  # noqa: F401,F403
except ImportError:  # imported as tools.test_mefi_studio_assistant_write_lock
    from .test_assistant_write_lock import *  # noqa: F401,F403

if __name__ == "__main__":
    import unittest

    unittest.main()
