# Private CI bootstrap diagnostics

The database job wraps only its scheduler proof and central bootstrap. Each child
keeps its existing execution and cleanup deadlines. Its stdout, stderr and nested
temporary evidence go into a fresh private directory owned by that stage.
The wrapper never searches another job's temporary files or the whole checkout.

After the child stops, the wrapper packages a complete manifest of relative paths,
types, modes, sizes and SHA-256 hashes. Symlinks, hardlinks, special files, changed
files and unsafe paths refuse packaging. Source collection is limited to 2 GiB and
50,000 entries; the compressed archive to 256 MiB; the encrypted envelope to
512 MiB. Sealing has a separate 180-second budget. Overflow fails rather than
truncating evidence or extending the database workload's deadline.

OpenSSL 3 creates binary, non-streaming DER CMS AuthEnvelopedData using AES-256-GCM
and RSA-OAEP with SHA-256/MGF1-SHA-256. A narrow metadata reader checks the exact
profile and single pinned RSA-4096 recipient; OpenSSL performs the cryptography.
Only the public recipient certificate is committed. The dedicated private key is
held locally by the operator and is never uploaded, sent to a runner or installed
as an application secret. The SHA-256 fingerprint of its DER certificate is
`98d6751ac1fec4dea5f303f066ce4960957cd7c8041866b8c47d4cae8391473a`.

Each immediate artifact step uploads only `evidence.cms` and a small allowlisted
`public-status.json`, with 14-day retention and no artifact compression. Sealing
failure can upload a status-only failure receipt. There is no plaintext fallback.
Original child failure remains failure; successful encryption cannot turn it into
PASS. Hard runner loss can still prevent finalization or artifact delivery.

The public status reports fixed error categories, validated run/commit identifiers,
exit status, duration, recipient fingerprint and ciphertext length/hash. It excludes
raw errors, commands, source filenames, SQL, configuration and plaintext hashes.
The private manifest distinguishes the checked-out merge commit from the PR head.
Central bootstrap intentionally leaves its owned database running for later tests;
its status therefore does not claim cleanup. The timer proof must verify cleanup.

## Local evidence review

Download the artifact for the exact GitHub run, attempt and stage. Retain the raw
artifact and GitHub run/job metadata before analysis. Compare the public ciphertext
digest and run/head identifiers to that retained receipt. Authenticated encryption
detects corruption; it does not establish that the originating runner is trusted.

Use `decrypt_verified` in `scripts/ci_bootstrap_crypto.py` with the retained
ciphertext digest, committed recipient certificate, local private-key path and a
new private quarantine directory. The function admits the envelope before reading
it, decrypts into a `.partial` file, requires OpenSSL authentication success, then
checks the full archive manifest and member hashes before promoting the archive.
It never extracts or executes evidence. Confirm the internal run, attempt, stage,
checked-out commit, PR head and source hashes against the retained GitHub/source
receipts before diagnosing the failure. Never pipe decryption directly into `tar`.

The tests use disposable keys and synthetic binary fixtures. They cover wrong keys,
ciphertext/tag corruption, truncation, trailing bytes, alternate algorithms,
multiple recipients, unsafe files, duplicate manifest/member entries and hidden
tar padding. A local Ubuntu OpenSSL 3.0.13 run and Mac OpenSSL 3.6.4 decryption
established interoperability without exporting the dedicated private key.

The original PR #293 startup error was not retained by its first CI attempt.
This change makes the next failure diagnosable; it does not claim that the unknown
startup defect is fixed. Hosted installation and clinical activation remain pending.
