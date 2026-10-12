"""Narrow, bounded Chromium PDF1.4 admission. Never repairs or rewrites bytes."""

import hashlib, json, math, re, resource, subprocess, sys, zlib, tempfile
from dataclasses import dataclass
from pathlib import Path

MAX_BYTES = 3145728
MAX_OBJECTS = 5000
MAX_PAGES = 40
MAX_DEPTH = 32
MAX_INFLATE = 2097152
MAX_TOTAL_INFLATE = 16777216
WS = b"\x00\x09\x0a\x0c\x0d\x20"
DELIM = WS + b"()<>[]{}/%"
FORBIDDEN = set(
    "OpenAction AA JS JavaScript Launch SubmitForm ImportData GoToR GoToE URI EmbeddedFiles Filespec EF AcroForm XFA RichMedia 3D Encrypt Prev XRefStm ObjStm XRef Annots Names Dests Outlines Metadata AF OCProperties F FFilter FDecodeParms".split()
)
KEYS = set(
    "ViewerPreferences DisplayDocTitle Tabs Type Subtype Pages Kids Count Parent MediaBox CropBox Rotate Resources Contents Font XObject ExtGState ProcSet BBox Matrix FormType Group S CS I K Length Length1 Length2 Length3 Filter DecodeParms BaseFont Encoding ToUnicode DescendantFonts CIDSystemInfo Registry Ordering Supplement CIDToGIDMap DW W FontDescriptor FontName FontFamily FontStretch FontWeight Flags FontBBox ItalicAngle Ascent Descent CapHeight StemV StemH FontFile2 FontFile3 FirstChar LastChar Widths Differences CA ca LC LJ LW ML SA BM AIS SMask Size Root Info ID Title Creator Producer CreationDate ModDate Lang".split()
)
TYPES = {
    "Group",
    "ViewerPreferences",
    "Catalog",
    "Pages",
    "Page",
    "XObject",
    "Font",
    "FontDescriptor",
    "ExtGState",
}
SUBTYPES = {
    "Form",
    "Type0",
    "CIDFontType2",
    "TrueType",
    "Type1C",
    "CIDFontType0C",
    "OpenType",
}


class Rejected(ValueError):
    pass


def require(ok, msg):
    if not ok:
        raise Rejected(msg)


@dataclass(frozen=True)
class Name:
    value: str


@dataclass(frozen=True)
class Ref:
    number: int
    generation: int = 0


class Parser:
    def __init__(self, data):
        self.data = data
        self.pos = 0
        self.nodes = 0

    def skip(self):
        while self.pos < len(self.data):
            if self.data[self.pos] in WS:
                self.pos += 1
            elif self.data[self.pos] == 37:
                while self.pos < len(self.data) and self.data[self.pos] not in b"\r\n":
                    self.pos += 1
            else:
                break

    def keyword(self, word):
        self.skip()
        end = self.pos + len(word)
        require(
            self.data[self.pos : end] == word
            and (end == len(self.data) or self.data[end] in DELIM),
            "PDF keyword/boundary differs",
        )
        self.pos = end

    def name(self):
        require(self.data[self.pos : self.pos + 1] == b"/", "Dictionary name required")
        self.pos += 1
        start = self.pos
        while self.pos < len(self.data) and self.data[self.pos] not in DELIM:
            self.pos += 1
        raw = self.data[start : self.pos]
        require(len(raw) <= 256, "Name limit")
        out = bytearray()
        i = 0
        while i < len(raw):
            if raw[i] == 35:
                require(
                    i + 2 < len(raw)
                    and re.fullmatch(b"[0-9A-Fa-f]{2}", raw[i + 1 : i + 3]) is not None,
                    "Malformed name escape",
                )
                out.append(int(raw[i + 1 : i + 3], 16))
                i += 3
            else:
                out.append(raw[i])
                i += 1
        require(out and all(33 <= x <= 126 for x in out), "Unsupported name encoding")
        result = out.decode("ascii")
        require(result not in FORBIDDEN, "Forbidden PDF capability")
        return Name(result)

    def string(self):
        self.pos += 1
        depth = 1
        out = bytearray()
        while self.pos < len(self.data) and depth:
            c = self.data[self.pos]
            self.pos += 1
            if c == 92:
                require(self.pos < len(self.data), "Truncated string escape")
                c = self.data[self.pos]
                self.pos += 1
                if c in b"\r\n":
                    if c == 13 and self.data[self.pos : self.pos + 1] == b"\n":
                        self.pos += 1
                    continue
                if c in b"01234567":
                    octal = bytes([c])
                    for _ in range(2):
                        if (
                            self.data[self.pos : self.pos + 1]
                            and self.data[self.pos] in b"01234567"
                        ):
                            octal += self.data[self.pos : self.pos + 1]
                            self.pos += 1
                        else:
                            break
                    out.append(int(octal, 8) & 255)
                else:
                    out.append({110: 10, 114: 13, 116: 9, 98: 8, 102: 12}.get(c, c))
            elif c == 40:
                depth += 1
                require(depth <= MAX_DEPTH, "String nesting limit")
                out.append(c)
            elif c == 41:
                depth -= 1
                if depth:
                    out.append(c)
            else:
                out.append(c)
            require(len(out) <= MAX_BYTES, "String byte limit")
        require(depth == 0, "Unclosed string")
        return bytes(out)

    def number(self):
        self.skip()
        m = re.match(rb"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)", self.data[self.pos :])
        require(m is not None, "PDF number required")
        raw = m.group()
        self.pos += len(raw)
        require(
            self.pos == len(self.data) or self.data[self.pos] in DELIM,
            "Unsupported number encoding",
        )
        value = float(raw) if b"." in raw else int(raw)
        require(
            not isinstance(value, float) or math.isfinite(value), "Nonfinite number"
        )
        return value

    def value(self, depth=0):
        require(depth <= MAX_DEPTH, "Object nesting limit")
        self.nodes += 1
        require(self.nodes <= 200000, "Object node limit")
        self.skip()
        require(self.pos < len(self.data), "Truncated object")
        c = self.data[self.pos : self.pos + 1]
        if c == b"/":
            return self.name()
        if c == b"(":
            return self.string()
        if c == b"[":
            self.pos += 1
            items = []
            while True:
                self.skip()
                require(self.pos < len(self.data), "Unclosed array")
                if self.data[self.pos : self.pos + 1] == b"]":
                    self.pos += 1
                    return items
                items.append(self.value(depth + 1))
                require(len(items) <= MAX_OBJECTS * 2, "Array limit")
        if self.data[self.pos : self.pos + 2] == b"<<":
            self.pos += 2
            result = {}
            while True:
                self.skip()
                require(self.pos < len(self.data), "Unclosed dictionary")
                if self.data[self.pos : self.pos + 2] == b">>":
                    self.pos += 2
                    return result
                key = self.name().value
                require(key not in result, "Duplicate decoded dictionary key")
                result[key] = self.value(depth + 1)
                require(len(result) <= 512, "Dictionary key limit")
        if c == b"<":
            self.pos += 1
            end = self.data.find(b">", self.pos)
            require(end >= 0, "Unclosed hex string")
            raw = re.sub(rb"\s", b"", self.data[self.pos : end])
            require(
                re.fullmatch(rb"[0-9A-Fa-f]*", raw) is not None, "Invalid hex string"
            )
            self.pos = end + 1
            if len(raw) % 2:
                raw += b"0"
            return bytes.fromhex(raw.decode())
        for keyword, value in [(b"true", True), (b"false", False), (b"null", None)]:
            end = self.pos + len(keyword)
            if self.data[self.pos : end] == keyword and (
                end == len(self.data) or self.data[end] in DELIM
            ):
                self.pos = end
                return value
        first = self.number()
        after = self.pos
        if isinstance(first, int) and not isinstance(first, bool) and first >= 0:
            try:
                second = self.number()
                self.skip()
                if (
                    isinstance(second, int)
                    and second >= 0
                    and self.data[self.pos : self.pos + 1] == b"R"
                ):
                    self.keyword(b"R")
                    require(second == 0, "Nonzero generation")
                    return Ref(first, second)
            except Rejected:
                pass
            self.pos = after
        return first


def admit(data):
    require(15 < len(data) <= MAX_BYTES, "PDF byte capacity")
    require(data.startswith(b"%PDF-1.4\n"), "Pinned PDF header required")
    end = re.search(rb"startxref\s+([0-9]+)\s+%%EOF[\x00\x09\x0a\x0c\x0d\x20]*\Z", data)
    require(end is not None, "One terminal xref/EOF required")
    offset = int(end.group(1))
    require(0 < offset < end.start(), "Invalid xref offset")
    p = Parser(data)
    p.pos = offset
    p.keyword(b"xref")
    start = p.number()
    size = p.number()
    require(
        start == 0 and isinstance(size, int) and 1 < size <= MAX_OBJECTS + 1,
        "Unsupported xref inventory",
    )
    entries = {}
    for n in range(size):
        p.skip()
        line = re.match(rb"([0-9]{10}) ([0-9]{5}) ([nf])(?: ?\r?\n)", data[p.pos :])
        require(line is not None, "Malformed classic xref entry")
        p.pos += len(line.group())
        at, generation, flag = int(line.group(1)), int(line.group(2)), line.group(3)
        if n == 0:
            require(
                at == 0 and generation == 65535 and flag == b"f",
                "Invalid free xref root",
            )
        elif flag == b"n":
            require(generation == 0 and 0 < at < offset, "Invalid object xref")
            entries[n] = at
        else:
            require(generation in [0, 65535], "Unsupported free generation")
    require(
        entries and len(set(entries.values())) == len(entries),
        "Duplicate object offsets",
    )
    p.keyword(b"trailer")
    trailer = p.value()
    require(isinstance(trailer, dict), "Trailer dictionary required")
    require(
        set(trailer) <= {"Size", "Root", "Info", "ID"}
        and trailer.get("Size") == size
        and isinstance(trailer.get("Root"), Ref),
        "Unsupported trailer",
    )
    p.skip()
    require(p.pos == end.start(), "Incremental or trailing trailer content")
    objects = {}
    streams = {}
    total = 0
    p.pos = 0
    p.skip()
    ordered = sorted(entries.items(), key=lambda x: x[1])
    for n, at in ordered:
        require(p.pos == at, "Unindexed physical object/content")
        require(p.number() == n and p.number() == 0, "Xref object identity differs")
        p.keyword(b"obj")
        value = p.value()
        p.skip()
        if data[p.pos : p.pos + 6] == b"stream":
            require(isinstance(value, dict), "Stream dictionary required")
            p.keyword(b"stream")
            if data[p.pos : p.pos + 2] == b"\r\n":
                p.pos += 2
            else:
                require(data[p.pos : p.pos + 1] == b"\n", "Stream line break required")
                p.pos += 1
            length = value.get("Length")
            require(
                isinstance(length, int)
                and not isinstance(length, bool)
                and 0 <= length <= MAX_BYTES,
                "Direct bounded stream length required",
            )
            raw = data[p.pos : p.pos + length]
            require(len(raw) == length, "Truncated stream")
            p.pos += length
            if data[p.pos : p.pos + 2] == b"\r\n":
                p.pos += 2
            elif data[p.pos : p.pos + 1] in [b"\n", b"\r"]:
                p.pos += 1
            require(
                data[p.pos : p.pos + 9] == b"endstream",
                "Exact stream boundary required",
            )
            p.keyword(b"endstream")
            filter = value.get("Filter")
            require(
                filter is None or filter == Name("FlateDecode"),
                "Unsupported stream filter",
            )
            require("DecodeParms" not in value, "Unsupported decode parameters")
            if filter:
                try:
                    inflater = zlib.decompressobj()
                    decoded = inflater.decompress(raw, MAX_INFLATE + 1)
                except zlib.error:
                    raise Rejected("Invalid compressed stream") from None
                require(
                    len(decoded) <= MAX_INFLATE
                    and inflater.eof
                    and not inflater.unused_data
                    and not inflater.unconsumed_tail,
                    "Compressed stream expansion/trailing limit",
                )
            else:
                decoded = raw
                require(len(decoded) <= MAX_INFLATE, "Raw stream expansion limit")
            total += len(decoded)
            require(total <= MAX_TOTAL_INFLATE, "Total stream expansion limit")
            streams[n] = len(decoded)
        p.keyword(b"endobj")
        p.skip()
        objects[n] = value
    require(
        p.pos == offset and len(objects) == len(entries),
        "Physical object inventory differs",
    )

    def walk(v, depth=0):
        require(depth <= MAX_DEPTH, "Structure depth limit")
        if isinstance(v, Ref):
            require(v.number in objects and v.generation == 0, "Unresolved reference")
        elif isinstance(v, list):
            for child in v:
                walk(child, depth + 1)
        elif isinstance(v, dict):
            require(
                all(k in KEYS or re.fullmatch(r"[FGX][0-9]+", k) for k in v),
                "Unsupported dictionary key",
            )
            if "Type" in v:
                require(
                    isinstance(v["Type"], Name) and v["Type"].value in TYPES,
                    "Unsupported object type",
                )
            if "Subtype" in v:
                require(
                    isinstance(v["Subtype"], Name) and v["Subtype"].value in SUBTYPES,
                    "Unsupported object subtype",
                )
            for child in v.values():
                walk(child, depth + 1)
        elif isinstance(v, Name):
            require(v.value not in FORBIDDEN, "Forbidden PDF name")

    walk(trailer)
    for v in objects.values():
        walk(v)

    def resolve(ref):
        require(
            isinstance(ref, Ref) and ref.number in objects, "Object reference required"
        )
        return objects[ref.number]

    catalog = resolve(trailer["Root"])
    require(
        isinstance(catalog, dict)
        and catalog.get("Type") == Name("Catalog")
        and set(catalog) <= {"Type", "Pages", "Lang", "ViewerPreferences"},
        "Unsupported catalog",
    )
    seen = set()
    pages = []

    def visit(ref, parent=None, depth=0):
        require(
            depth <= MAX_DEPTH and isinstance(ref, Ref) and ref.number not in seen,
            "Cyclic/duplicate page tree",
        )
        seen.add(ref.number)
        node = resolve(ref)
        require(isinstance(node, dict), "Page-tree dictionary required")
        require(node.get("Parent") == parent, "Page parent differs")
        if node.get("Type") == Name("Pages"):
            kids = node.get("Kids")
            require(isinstance(kids, list) and kids, "Page children required")
            count = sum(visit(child, ref, depth + 1) for child in kids)
            require(node.get("Count") == count, "Page count differs")
            return count
        require(node.get("Type") == Name("Page"), "Unexpected page-tree node")
        box = node.get("MediaBox")
        require(
            isinstance(box, list) and box == [0, 0, 612, 792],
            "Pinned Letter page size required",
        )
        require("Contents" in node, "Page content required")
        content = node["Contents"]
        content_refs = content if isinstance(content, list) else [content]
        require(
            content_refs
            and all(isinstance(r, Ref) and r.number in streams for r in content_refs),
            "Page content must reference admitted streams",
        )
        pages.append(ref.number)
        require(len(pages) <= MAX_PAGES, "Page capacity")
        return 1

    visit(catalog.get("Pages"))
    require(pages, "At least one page required")
    require(
        {
            n
            for n, v in objects.items()
            if isinstance(v, dict) and v.get("Type") in [Name("Page"), Name("Pages")]
        }
        == seen,
        "Unreachable page-tree objects",
    )
    return {
        "sha256": hashlib.sha256(data).hexdigest(),
        "byte_length": len(data),
        "page_count": len(pages),
        "object_count": len(objects),
        "stream_count": len(streams),
        "inflated_bytes": total,
        "admission": "chromium-classic-pdf1.4-v1",
    }


def bounded_file(path):
    with Path(path).open("rb") as source:
        data = source.read(MAX_BYTES + 1)
    require(len(data) <= MAX_BYTES, "PDF byte capacity")
    return data


def validate_file(path, qpdf="qpdf"):
    data = bounded_file(path)
    result = admit(data)
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        checked = subprocess.run(
            [qpdf, "--suppress-recovery", "--check", str(path)],
            stdout=stdout,
            stderr=stderr,
            timeout=8,
        )
        require(checked.returncode == 0, "qpdf found errors/warnings")
        require(stdout.tell() + stderr.tell() <= 16384, "qpdf output bound")
    require(
        hashlib.sha256(bounded_file(path)).hexdigest() == result["sha256"],
        "Validation bytes changed",
    )
    result["qpdf_clean"] = True
    return result


if __name__ == "__main__":
    require(sys.platform == "linux", "Isolated Linux admission CLI required")
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2097152, 2097152))
    try:
        print(json.dumps(validate_file(sys.argv[1])))
    except (Rejected, subprocess.TimeoutExpired):
        print("PDF admission failed", file=sys.stderr)
        sys.exit(2)
