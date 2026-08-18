# cb26 — ASIC coloring book

Builds a print-ready coloring book PDF from the `CBpage*` images on
<https://evan.vaportrash.net/asic>.

- grayscale interior pages -> pure two-colour monochrome (1-bit, no dithering)
- the full-colour title page is kept in colour

## Run

```sh
pip install Pillow numpy img2pdf
python3 fetch_pages.py                 # -> raw/
python3 make_book.py                   # -> asic-coloring-book.pdf
```

## How pages are classified

`make_book.py` measures per-pixel hue spread (`max(RGB) - min(RGB)`). A page
is treated as colour only when at least `--colour-ratio` (default 6%) of its
pixels carry real hue, so grayscale art saved in an RGB container is still
thresholded rather than passed through as colour.

Monochrome conversion flattens any transparency onto white, then applies a
per-page Otsu threshold and writes 1-bit output via `point(..., mode="1")` —
Pillow's `convert("1")` is avoided because it dithers, which produces grey
stipple instead of clean line art.

## Options

| flag | default | notes |
|---|---|---|
| `--threshold N` | Otsu per page | fixed 0-255 cutoff; raise to keep more line weight |
| `--colour-ratio F` | `0.06` | lower it if a colour page is being thresholded |
| `--page` | `letter` | `letter`, `a4`, or `native` (image aspect) |
| `--dpi` | `300` | print resolution |
| `--src` / `--out` | `raw` / `asic-coloring-book.pdf` | |

`fetch_pages.py --match` changes the filename filter (default `CBpage`), and
`--url` points at a different page.

## Verified

The pipeline was validated on synthetic stand-ins (colour title page,
anti-aliased grey line art, grey-washed pages, grayscale-in-RGB, and an
alpha-channel page). Result: correct natural page order (`CBpage2` before
`CBpage10`), interior pages embedded at `BitsPerComponent 1` with exactly two
distinct pixel values, and the title page preserved as full-colour RGB.
