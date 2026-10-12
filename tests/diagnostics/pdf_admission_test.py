"""Syntax counterexamples and a real unchanged Chromium PDF, not isolation evidence."""

import hashlib, sys, unittest, zlib
from pathlib import Path

renderer = Path("/opt/lrv-renderer")
if not renderer.exists():
    renderer = Path(__file__).resolve().parents[2] / "services/diagnostic-renderer"
sys.path.insert(0, str(renderer))
from pdf_admission import admit, validate_file, Rejected, MAX_INFLATE


def pdf(extra=b"", stream=b"q\nQ\n", compressed=False, root_extra=b"", page_extra=b""):
    if compressed:
        stream = zlib.compress(stream)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R " + root_extra + b" >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R "
        + page_extra
        + b" >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + (b" /Filter /FlateDecode" if compressed else b"")
        + b" >>\nstream\n"
        + stream
        + b"\nendstream",
    ]
    if extra:
        objects.append(extra)
    result = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets = []
    for n, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += str(n).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(result)
    result += b"xref\n0 " + str(len(objects) + 1).encode() + b"\n0000000000 65535 f \n"
    for at in offsets:
        result += f"{at:010} 00000 n \n".encode()
    result += (
        b"trailer\n<< /Size "
        + str(len(objects) + 1).encode()
        + b" /Root 1 0 R >>\nstartxref\n"
        + str(xref).encode()
        + b"\n%%EOF\n"
    )
    return result


class AdmissionTests(unittest.TestCase):
    def reject(self, data):
        with self.assertRaises(Rejected):
            admit(data)

    def test_simple_actual_structure(self):
        self.assertEqual(admit(pdf())["page_count"], 1)

    def test_compressed_stream(self):
        self.assertEqual(admit(pdf(compressed=True))["stream_count"], 1)

    def test_forbidden_names_even_unreferenced(self):
        for key in [
            "JS",
            "J#53",
            "OpenAction",
            "O#70enAction",
            "AcroForm",
            "EF",
            "Encrypt",
            "URI",
            "Annots",
            "Prev",
            "ObjStm",
        ]:
            with self.subTest(key=key):
                self.reject(pdf(extra=("<< /" + key + " (blocked) >>").encode()))

    def test_duplicate_decoded_key(self):
        self.reject(pdf(root_extra=b"/Ty#70e /Catalog"))

    def test_pdf_strings_are_not_capabilities(self):
        self.assertEqual(
            admit(pdf(extra=b"<< /Title (literal /JS \\(nested\\)) >>"))["page_count"],
            1,
        )

    def test_stream_bytes_are_not_outer_syntax(self):
        self.assertEqual(admit(pdf(stream=b"%%EOF /JS 1 0 obj"))["page_count"], 1)

    def test_trailing_or_incremental_content(self):
        self.reject(pdf() + b"opaque")
        self.reject(pdf(root_extra=b"/Prev 123"))

    def test_broken_xref(self):
        data = pdf()
        self.reject(data.replace(b"0000000015 00000 n", b"0000000016 00000 n"))

    def test_unresolved_reference(self):
        self.reject(pdf(root_extra=b"/ViewerPreferences 999 0 R"))

    def test_bad_stream_length(self):
        self.reject(pdf().replace(b"/Length 4 ", b"/Length 3 "))

    def test_indirect_stream_length(self):
        self.reject(pdf().replace(b"/Length 4 ", b"/Length 5 0 R "))

    def test_unsupported_filter(self):
        self.reject(pdf(compressed=True).replace(b"FlateDecode", b"ASCII85Decode"))

    def test_inflate_capacity(self):
        self.reject(pdf(stream=b"A" * (MAX_INFLATE + 1), compressed=True))

    def test_duplicate_page_tree(self):
        self.reject(pdf().replace(b"[3 0 R]", b"[3 0 R 3 0 R]"))

    def test_wrong_page_count(self):
        self.reject(pdf().replace(b"/Count 1 ", b"/Count 2 "))

    def test_wrong_parent(self):
        self.reject(pdf(page_extra=b"/Parent 1 0 R"))

    def test_wrong_page_size(self):
        self.reject(pdf().replace(b"612 792", b"595 842"))

    def test_unknown_dictionary_key(self):
        self.reject(pdf(extra=b"<< /ArbitraryExtension true >>"))

    def test_page_content_must_be_stream(self):
        self.reject(pdf().replace(b"/Contents 4 0 R", b"/Contents 2 0 R"))

    def test_frozen_sixteen_page_reference(self):
        candidates = [
            Path(__file__).parent / "fixtures/chromium-16-page.pdf",
            Path("/proof/chromium-16-page.pdf"),
        ]
        path = next(p for p in candidates if p.exists())
        before = path.read_bytes()
        result = validate_file(path)
        self.assertEqual(result["page_count"], 16)
        self.assertEqual(result["object_count"], 102)
        self.assertEqual(
            result["sha256"],
            "b6d040504dce9714d059257ce4496853f1d122132602c2c7c8932e197358f771",
        )
        self.assertEqual(before, path.read_bytes())


if __name__ == "__main__":
    unittest.main()
