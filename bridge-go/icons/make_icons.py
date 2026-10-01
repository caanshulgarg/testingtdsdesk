"""python3 icons/make_icons.py - the tray icons: a green or red disc with a white F (16, 20, 24 and 32 pixels, 32-bit)."""
import struct, os
HERE = os.path.dirname(os.path.abspath(__file__))
F = ["11111", "10000", "10000", "11110", "10000", "10000", "10000"]          # 5 x 7
def image(size, rgb):
    px = []
    c = (size - 1) / 2.0; r = size / 2.0 - 0.5
    sc = max(1, size // 10); fw, fh = 5 * sc, 7 * sc; ox, oy = (size - fw) // 2 + sc // 2, (size - fh) // 2
    for y in range(size):
        row = []
        for x in range(size):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            a = 255 if d <= r - 0.5 else (int(255 * (r + 0.5 - d)) if d <= r + 0.5 else 0)
            fx, fy = (x - ox) // sc, (y - oy) // sc
            white = 0 <= x - ox < fw and 0 <= y - oy < fh and F[fy][fx] == "1"
            b, g, rr = (255, 255, 255) if white else (rgb[2], rgb[1], rgb[0])
            row.append(bytes([b, g, rr, a]))
        px.append(b"".join(row))
    xor = b"".join(reversed(px))                           # bottom-up
    andm = b"\0" * (((size + 31) // 32) * 4 * size)
    hdr = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(xor) + len(andm), 0, 0, 0, 0)
    return hdr + xor + andm
def ico(rgb, name):
    sizes = [16, 20, 24, 32]
    imgs = [image(s, rgb) for s in sizes]
    out = struct.pack("<HHH", 0, 1, len(sizes)); off = 6 + 16 * len(sizes)
    for s, im in zip(sizes, imgs):
        out += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(im), off); off += len(im)
    open(os.path.join(HERE, name), "wb").write(out + b"".join(imgs))
ico((22, 163, 74), "green.ico"); ico((220, 38, 38), "red.ico")
print("icons made")
