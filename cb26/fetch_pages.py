#!/usr/bin/env python3
"""Download every CBpage image linked from a page (default: evan.vaportrash.net/asic)."""
import argparse, os, re, sys, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (coloring-book-fetcher)"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://evan.vaportrash.net/asic")
    ap.add_argument("--out", default="raw")
    ap.add_argument("--match", default="CBpage")
    args = ap.parse_args()

    req = urllib.request.Request(args.url, headers=UA)
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")

    # src/href/srcset attributes plus bare urls in inline css/js
    cands = re.findall(r'(?:src|href|data-src)\s*=\s*["\']([^"\']+)["\']', html, re.I)
    cands += re.findall(r'url\(\s*["\']?([^"\')]+)', html, re.I)
    for ss in re.findall(r'srcset\s*=\s*["\']([^"\']+)["\']', html, re.I):
        cands += [p.strip().split()[0] for p in ss.split(",") if p.strip()]

    seen, urls = set(), []
    for c in cands:
        if args.match.lower() not in c.lower():
            continue
        full = urllib.parse.urljoin(args.url, c)
        if full not in seen:
            seen.add(full)
            urls.append(full)

    if not urls:
        sys.exit(f"No images matching {args.match!r} found at {args.url}")

    os.makedirs(args.out, exist_ok=True)
    for u in urls:
        name = os.path.basename(urllib.parse.urlparse(u).path)
        dest = os.path.join(args.out, name)
        urllib.request.urlretrieve(u, dest) if not os.path.exists(dest) else None
        print(f"{name:40s} {os.path.getsize(dest):>9,} bytes")
    print(f"\n{len(urls)} image(s) -> {args.out}/")


if __name__ == "__main__":
    main()
