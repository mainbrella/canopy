#!/usr/bin/env python3
"""Generate the custom image and exported output diagrams (stdlib only)."""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parents[3] / "public/images/blog/custom-images"
PAPER = "#f7f4ec"
INK = "#263238"
MUTED = "#5b686b"
LINE = "#9aa5a2"
BLUE = "#376b8c"
BLUE_PALE = "#e5eef2"
GREEN = "#28734c"
GREEN_PALE = "#e4f0e7"


def svg_start(width: int, height: int) -> list[str]:
    return [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">
<title id="title">Prepared image and independent job output</title>
<desc id="desc">A prepared image with jq launches two independent jobs. Job A writes report.csv and exports a copy to your storage before stopping. Job B starts with jq and no report. Job writes do not change the image.</desc>
<defs>
  <marker id="arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="{BLUE}"/></marker>
  <marker id="arrow-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="{GREEN}"/></marker>
</defs>
<rect width="100%" height="100%" fill="{PAPER}"/>''']


def line(x1, y1, x2, y2, color=LINE, width=1.5, dash=None, marker=None):
    attrs = f'x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}" stroke-linecap="round"'
    if dash:
        attrs += f' stroke-dasharray="{dash}"'
    if marker:
        attrs += f' marker-end="url(#{marker})"'
    return f'<line {attrs}/>'


def path(d, color, width=2, marker=None, dash=None):
    attrs = f'd="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'
    if marker:
        attrs += f' marker-end="url(#{marker})"'
    if dash:
        attrs += f' stroke-dasharray="{dash}"'
    return f'<path {attrs}/>'


def rect(x, y, w, h, fill="none", stroke=LINE, sw=1.5, rx=12, dash=None):
    attrs = f'x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"'
    if dash:
        attrs += f' stroke-dasharray="{dash}"'
    return f'<rect {attrs}/>'


def text(x, y, value, size=15, color=INK, weight=500, anchor="start", family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif", letter=None):
    attrs = f'x="{x}" y="{y}" fill="{color}" font-family="{family}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}"'
    if letter is not None:
        attrs += f' letter-spacing="{letter}"'
    return f'<text {attrs}>{escape(value)}</text>'


def image_icon(cx, cy, scale=1.0):
    # Three offset rounded sheets read as a reusable, published image layer.
    s = scale
    out = []
    out.append(f'<rect x="{cx-31*s:.1f}" y="{cy-22*s:.1f}" width="{59*s:.1f}" height="{39*s:.1f}" rx="6" fill="{PAPER}" stroke="{BLUE}" stroke-width="1.6"/>')
    out.append(f'<rect x="{cx-25*s:.1f}" y="{cy-29*s:.1f}" width="{59*s:.1f}" height="{39*s:.1f}" rx="6" fill="{BLUE_PALE}" stroke="{BLUE}" stroke-width="1.6"/>')
    out.append(f'<rect x="{cx-19*s:.1f}" y="{cy-36*s:.1f}" width="{59*s:.1f}" height="{39*s:.1f}" rx="6" fill="{PAPER}" stroke="{BLUE}" stroke-width="1.8"/>')
    out.append(f'<path d="M {cx-9*s:.1f} {cy-24*s:.1f} h {20*s:.1f} M {cx-9*s:.1f} {cy-16*s:.1f} h {28*s:.1f}" stroke="{BLUE}" stroke-width="1.8" stroke-linecap="round"/>')
    return "".join(out)


def file_icon(x, y, w=48, h=58, color=INK, fill=PAPER, dashed=False):
    fold = min(13, w * 0.27)
    dash = ' stroke-dasharray="4 3"' if dashed else ""
    out = [f'<path d="M {x+1} {y+1} H {x+w-fold-1} L {x+w-1} {y+fold-1} V {y+h-1} Q {x+w-1} {y+h+1} {x+w-3} {y+h+1} H {x+3} Q {x+1} {y+h+1} {x+1} {y+h-1} Z" fill="{fill}" stroke="{color}" stroke-width="1.7"{dash}/>']
    out.append(f'<path d="M {x+w-fold-1} {y+1} V {y+fold-1} H {x+w-1}" fill="none" stroke="{color}" stroke-width="1.5"{dash}/>')
    return "".join(out)


def disk_icon(cx, cy):
    return (f'<ellipse cx="{cx}" cy="{cy-13}" rx="20" ry="7" fill="{GREEN_PALE}" stroke="{GREEN}" stroke-width="1.7"/>'
            f'<path d="M {cx-20} {cy-13} v 27 c 0 4 9 7 20 7 s 20-3 20-7 v-27" fill="{GREEN_PALE}" stroke="{GREEN}" stroke-width="1.7"/>'
            f'<path d="M {cx-20} {cy+1} c 0 4 9 7 20 7 s 20-3 20-7" fill="none" stroke="{GREEN}" stroke-width="1.4"/>'
            f'<ellipse cx="{cx}" cy="{cy-13}" rx="20" ry="7" fill="{GREEN_PALE}" stroke="{GREEN}" stroke-width="1.7"/>')


def desktop():
    e = svg_start(784, 400)
    e += [text(24, 32, "One image, two fresh filesystems", 14, MUTED, 650, letter="0.15")]
    # External storage region is separated from the two machine filesystems.
    e += [line(576, 48, 576, 376, LINE, 1.5, "5 6"), text(591, 32, "Outside the machine", 14, MUTED, 600)]
    # Reusable image.
    e += [image_icon(100, 203), text(100, 250, "Prepared image", 16, INK, 650, "middle"), rect(71, 264, 58, 27, BLUE_PALE, BLUE, 1.2, 13), text(100, 283, "jq", 14, BLUE, 700, "middle", "ui-monospace, SFMono-Regular, Menlo, monospace")]
    # Forked launch arrows from the prepared image.
    e += [path("M 150 199 H 205 V 117 H 245", BLUE, 2.2, "arrow-blue"), path("M 205 199 V 287 H 245", BLUE, 2.2, "arrow-blue")]
    # Job A filesystem.
    e += [rect(252, 63, 296, 137, "#fbfaf6", "#7e8b8a", 1.5, 12), text(270, 88, "Job A · after the report", 16, INK, 650)]
    e += [rect(270, 101, 48, 24, BLUE_PALE, "none", 0, 12), text(294, 118, "jq", 14, BLUE, 700, "middle", "ui-monospace, SFMono-Regular, Menlo, monospace")]
    e += [file_icon(285, 137, 28, 34, INK, PAPER), text(324, 160, "report.csv", 14, INK, 600, family="ui-monospace, SFMono-Regular, Menlo, monospace")]
    # Job B begins from the same image, with a clearly absent report.
    e += [rect(252, 226, 296, 137, "#fbfaf6", "#7e8b8a", 1.5, 12), text(270, 251, "Job B · fresh launch", 16, INK, 650)]
    e += [rect(270, 264, 48, 24, BLUE_PALE, "none", 0, 12), text(294, 281, "jq", 14, BLUE, 700, "middle", "ui-monospace, SFMono-Regular, Menlo, monospace")]
    e += [file_icon(285, 300, 28, 34, MUTED, PAPER, True), text(324, 321, "No report yet", 14, MUTED, 600)]
    # Export is one-way and crosses the explicit boundary.
    e += [path("M 421 171 H 559 Q 568 171 579 171 H 630", GREEN, 2.4, "arrow-green")]
    e += [rect(424, 143, 146, 25, PAPER, "none", 0, 0), text(497, 161, "Download before stop", 14, GREEN, 650, "middle")]
    e += [file_icon(654, 179, 48, 58, GREEN, GREEN_PALE), text(678, 259, "report.csv", 14, INK, 600, "middle", "ui-monospace, SFMono-Regular, Menlo, monospace")]
    e += [disk_icon(678, 314), text(678, 360, "Your storage", 15, INK, 650, "middle")]
    # Source image remains separate; no arrow returns from either job.
    e.append("</svg>")
    return "\n".join(e)


def mobile():
    e = svg_start(350, 550)
    # Source image at top, with two independent launch arrows.
    e += [image_icon(175, 73, .82), text(175, 116, "Prepared image", 17, INK, 650, "middle")]
    e += [rect(146, 125, 58, 26, BLUE_PALE, BLUE, 1.2, 13), text(175, 143, "jq", 14, BLUE, 700, "middle", "ui-monospace, SFMono-Regular, Menlo, monospace")]
    e += [path("M 150 153 C 133 169 92 170 92 188", BLUE, 2.1, "arrow-blue"), path("M 200 153 C 217 169 258 170 258 188", BLUE, 2.1, "arrow-blue")]
    # Two compact but distinct machine filesystems.
    e += [rect(15, 188, 153, 140, "#fbfaf6", "#7e8b8a", 1.5, 11), text(91.5, 214, "Job A", 16, INK, 650, "middle"), text(91.5, 232, "after the report", 14, MUTED, 550, "middle")]
    e += [rect(65, 240, 53, 24, BLUE_PALE, "none", 0, 12), text(91.5, 257, "jq", 14, BLUE, 700, "middle", "ui-monospace, SFMono-Regular, Menlo, monospace")]
    e += [file_icon(43, 269, 27, 34, INK, PAPER), text(78, 291, "report.csv", 14, INK, 600, family="ui-monospace, SFMono-Regular, Menlo, monospace")]
    e += [rect(182, 188, 153, 140, "#fbfaf6", "#7e8b8a", 1.5, 11), text(258.5, 214, "Job B", 16, INK, 650, "middle"), text(258.5, 232, "fresh launch", 14, MUTED, 550, "middle")]
    e += [rect(232, 240, 53, 24, BLUE_PALE, "none", 0, 12), text(258.5, 257, "jq", 14, BLUE, 700, "middle", "ui-monospace, SFMono-Regular, Menlo, monospace")]
    e += [file_icon(213, 269, 27, 34, MUTED, PAPER, True), text(244, 291, "No report", 14, MUTED, 600)]
    # Boundary encloses both independent guest filesystems. Export crosses it once.
    e += [line(14, 340, 336, 340, LINE, 1.5, "5 6"), text(18, 357, "Outside the machine", 14, MUTED, 600)]
    e += [path("M 92 304 V 320 Q 92 329 101 329 H 174 V 400", GREEN, 2.4, "arrow-green")]
    e += [rect(90, 360, 159, 23, PAPER, "none", 0, 0), text(169.5, 377, "Download before stop", 14, GREEN, 650, "middle")]
    e += [file_icon(151, 410, 38, 46, GREEN, GREEN_PALE), text(199, 438, "report.csv", 14, INK, 600, family="ui-monospace, SFMono-Regular, Menlo, monospace")]
    e += [disk_icon(173, 493), text(173, 539, "Your storage", 15, INK, 650, "middle")]
    e.append("</svg>")
    return "\n".join(e)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "image-and-output.svg").write_text(desktop() + "\n", encoding="utf-8")
    (OUT / "image-and-output-mobile.svg").write_text(mobile() + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
