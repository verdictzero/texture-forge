#!/usr/bin/env python3
"""Build a coloring-book PDF: grayscale pages -> pure 2-colour monochrome,
colour pages (the title page) kept in full colour."""
import argparse, io, os, re, sys
import numpy as np
from PIL import Image
import img2pdf

EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".bmp")


def natkey(p):
    """Sort CBpage2 before CBpage10."""
    return [int(t) if t.isdigit() else t.lower()
            for t in re.split(r"(\d+)", os.path.basename(p))]


def colourfulness(im):
    """Fraction of pixels with a real hue, ignoring near-black/near-white."""
    a = np.asarray(im.convert("RGB"), dtype=np.int16)
    spread = a.max(2) - a.min(2)          # per-pixel saturation proxy
    return float((spread > 28).mean())


def otsu(gray):
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total, idx = hist.sum(), np.arange(256)
    w0 = np.cumsum(hist)
    w1 = total - w0
    valid = (w0 > 0) & (w1 > 0)
    s0 = np.cumsum(hist * idx)
    m0 = np.divide(s0, w0, out=np.zeros(256), where=w0 > 0)
    m1 = np.divide(s0[-1] - s0, w1, out=np.zeros(256), where=w1 > 0)
    var = w0 * w1 * (m0 - m1) ** 2
    var[~valid] = -1
    return int(var.argmax())


def to_mono(im, cutoff=None):
    """Flatten transparency onto white, then hard-threshold to 1-bit."""
    if im.mode in ("RGBA", "LA") or "transparency" in im.info:
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    g = np.asarray(im.convert("L"))
    t = otsu(g) if cutoff is None else cutoff
    # point() with mode "1" avoids Pillow's dithering -> pure black/white only
    return Image.fromarray((g > t).astype(np.uint8) * 255).convert("L") \
                .point(lambda v: 255 if v > 127 else 0, mode="1"), t


def encode(im, dpi, jpeg_quality):
    buf = io.BytesIO()
    if im.mode == "1":
        im.save(buf, "PNG", dpi=(dpi, dpi), optimize=True)
    else:
        im.convert("RGB").save(buf, "JPEG", dpi=(dpi, dpi),
                               quality=jpeg_quality, subsampling=0)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="raw")
    ap.add_argument("--out", default="asic-coloring-book.pdf")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--threshold", type=int, default=None,
                    help="0-255 fixed cutoff; default is per-page Otsu")
    ap.add_argument("--colour-ratio", type=float, default=0.06,
                    help="min fraction of hued pixels to call a page colour")
    ap.add_argument("--jpeg-quality", type=int, default=92)
    ap.add_argument("--page", choices=["letter", "a4", "native"], default="letter")
    args = ap.parse_args()

    files = sorted((os.path.join(args.src, f) for f in os.listdir(args.src)
                    if f.lower().endswith(EXT)), key=natkey)
    if not files:
        sys.exit(f"No images found in {args.src}/")

    pages, colour_pages = [], []
    for f in files:
        im = Image.open(f)
        ratio = colourfulness(im)
        if ratio >= args.colour_ratio:
            colour_pages.append(os.path.basename(f))
            pages.append(encode(im, args.dpi, args.jpeg_quality))
            note = f"colour kept  (hue {ratio:.1%})"
        else:
            mono, t = to_mono(im, args.threshold)
            pages.append(encode(mono, args.dpi, args.jpeg_quality))
            ink = 1 - float(np.asarray(mono).mean())
            note = f"mono @ {t:<3d}   (hue {ratio:.1%}, ink {ink:.1%})"
        print(f"  {os.path.basename(f):40s} {im.size[0]:>5}x{im.size[1]:<5} {note}")

    if args.page == "native":
        layout = img2pdf.get_layout_fun()
    else:
        size = (img2pdf.mm_to_pt(210), img2pdf.mm_to_pt(297)) if args.page == "a4" \
            else (img2pdf.in_to_pt(8.5), img2pdf.in_to_pt(11))
        layout = img2pdf.get_layout_fun(pagesize=size, fit=img2pdf.FitMode.into)

    with open(args.out, "wb") as fh:
        fh.write(img2pdf.convert(pages, layout_fun=layout))

    print(f"\n{len(pages)} pages -> {args.out} "
          f"({os.path.getsize(args.out):,} bytes)")
    print(f"full colour: {', '.join(colour_pages) or 'none'}")
    print(f"monochrome : {len(pages) - len(colour_pages)} page(s)")


if __name__ == "__main__":
    main()
