"""Compatibility entrypoint. The canonical DIG-3.3 suite contains 45 LDR + 20 Karla cases."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from digital_release import main

if __name__ == "__main__":
    main()
