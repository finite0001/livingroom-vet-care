# Client document page

The `/shared/:grantId#token` entry opens separately from the marketing/staff application. It strips the fragment and query before dynamic application loading, retains the capability only in memory, and starts no staff authentication or external font requests. A reload requires reopening the original message. Close/pagehide abort outstanding retrieval and clear visible documents and temporary object URLs.

The recipient explicitly opens the manifest, then views or downloads selected artifacts. Each action POSTs to `retrieve-document-link` with omitted credentials, no referrer, no caching and no redirects. The client validates the manifest identity/order/size/type and checks exact artifact size, MIME and SHA-256 before use. HTML previews have an empty sandbox plus an embedded deny-by-default CSP; frozen server reports also require their own policy for downloaded copies. No reusable Storage URL is exposed.

Vercel shared-path headers request no-store, no-referrer and no indexing. Server eligibility, revocation, expiry and retrieval budgets remain authoritative. Forwarded original links convey access; downloaded copies cannot be revoked. This UI is not an invoice payment flow.

Validation: six focused browser cases cover explicit opening, URL/storage/auth isolation, reload, sandbox script/network denial, original byte download, changed eligibility, corrupted bytes, wrong MIME and wrong manifest identity. Existing foundation/clinical/navigation checks cover the bootstrap change. These use synthetic browser responses; actual private Storage and HTTP authorization evidence belongs to the backend implementation. No hosted deployment or message send is implied.

Staff preparation/attestation and SMS queue materialization are a separate remaining increment. This route alone does not commission public retrieval or outbound SMS.
