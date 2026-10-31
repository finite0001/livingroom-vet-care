"""Use the existing owner budget for the CLI's final migration receipt only."""
import hashlib

ORIGINAL_SHA = '15c0a7fe4016ba039189d49c1a4ef671af4a870c8fc6fbdbeb4da01a1f959c8e'
SECONDS = 30
SUFFIX = (b'\n-- All installation checks have completed; only the CLI receipt remains.\n'
          b"SET LOCAL statement_timeout='30s';\n")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(raw):
    if not raw.endswith(SUFFIX):
        return raw
    original = raw[:-len(SUFFIX)]
    if sha(original) != ORIGINAL_SHA:
        raise ValueError('Complete PR318 source inverse required')
    return original


def derive(raw):
    original = canonical(raw)
    if sha(original) != ORIGINAL_SHA:
        raise ValueError('Exact PR318 source required for the receipt budget')
    if b"SET LOCAL statement_timeout='8s';" not in original:
        raise ValueError('Original installation/application limit required')
    result = original + SUFFIX
    if canonical(result) != original:
        raise ValueError('Whole receipt-budget inverse failed')
    return result
