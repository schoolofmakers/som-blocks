#!/usr/bin/env python3
"""Write the placeholder PWA icons (public/icons/icon-{192,512}.png).

Standard library only (zlib + struct), so no image dependency enters the project.
A solid accent square with a lighter inner square; replace with real artwork later.

Usage: python3 scripts/make-placeholder-icons.py
"""

import struct
import zlib
from pathlib import Path

ACCENT = (0x0E, 0x74, 0x90)  # matches theme_color in vite.config.ts
INNER = (0xFF, 0xFF, 0xFF)
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"


def chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def icon(size: int) -> bytes:
    # Inner square sits inside the maskable safe zone (central 80%).
    lo, hi = int(size * 0.3), int(size * 0.7)
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter type: none
        for x in range(size):
            row.extend(INNER if lo <= x < hi and lo <= y < hi else ACCENT)
        rows.append(bytes(row))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        path = OUT_DIR / f"icon-{size}.png"
        path.write_bytes(icon(size))
        print(f"wrote {path.relative_to(OUT_DIR.parent.parent)}")


if __name__ == "__main__":
    main()
