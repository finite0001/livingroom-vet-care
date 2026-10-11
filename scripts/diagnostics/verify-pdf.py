#!/usr/bin/env python3
"""Validate this local synthetic spike's captured bytes; requires pypdf and Poppler."""
import hashlib
import importlib.metadata
import json
import pathlib
import subprocess
from pypdf import PdfReader
from pypdf.generic import DictionaryObject, ArrayObject, IndirectObject

root = pathlib.Path(__file__).resolve().parents[2]
output = root / 'output/pdf/diagnostics-proof'
proof = json.loads((output / 'proof.json').read_text())
path = output / 'synthetic-records.pdf'
raw = path.read_bytes()
assert len(raw) == proof['pdf_bytes']
assert hashlib.sha256(raw).hexdigest() == proof['pdf_sha256']
reader = PdfReader(path, strict=True)
assert not reader.is_encrypted
assert len(reader.pages) == 16, 'Representative fixture pagination changed; inspect all pages again'
seen = set()
forbidden = {'/JS', '/JavaScript', '/OpenAction', '/AA', '/EmbeddedFiles', '/URI'}

def inspect(value):
    if isinstance(value, IndirectObject):
        identity = (value.idnum, value.generation)
        if identity in seen:
            return
        seen.add(identity)
        return inspect(value.get_object())
    if isinstance(value, DictionaryObject):
        assert not forbidden.intersection(value.keys()), 'Unexpected PDF action or embedded object'
        assert value.get('/S') not in ['/JavaScript', '/Launch', '/SubmitForm', '/GoToR']
        for child in value.values():
            inspect(child)
    elif isinstance(value, ArrayObject):
        for child in value:
            inspect(child)

inspect(reader.trailer)
for page in reader.pages:
    assert list(page.mediabox) == [0, 0, 612, 792], 'Letter geometry changed'
text = subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, text=True, check=True).stdout
for marker in ['SYNTHETIC SOAP 8', 'SYNTHETIC observation 45', 'Rabies Vaccination Certificate',
               'Species-neutral location schematic', 'µmol/L', '°C', '0 bpm', 'REVIEW DRAFT']:
    assert marker in text, marker
for marker in ['PRIVATE-STORAGE-PATH', 'PRIVATE AUTHORITY NOTE', 'PRIVATE DESTINATION NOTE']:
    assert marker not in text, marker
result = {'pages': len(reader.pages), 'pdf_sha256': proof['pdf_sha256'],
          'pypdf': importlib.metadata.version('pypdf'), 'letter_pages': True,
          'required_final_rows_and_units_present': True, 'private_path_markers_absent': True,
          'pdf_actions_and_embedded_files_absent': True, 'visual_review_required': True}
(output / 'validation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
