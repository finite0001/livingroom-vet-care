# Inbox workspace integration

The inbox uses server-filtered keyset pages with per-user read flags/counts. Filters reset pagination, metadata updates carry the displayed revision, and stale edits keep their draft for explicit review/reload. Archive preserves message history; deletion is not offered. All read/write cache keys include the actor, and message queue writes invalidate the actor-aware collections.

Conversation history loads 50 messages at a time. The detail screen has a bounded viewport on mobile and desktop, preserving the composer and the reader's position when older messages load. A personal read receipt advances only through the newest rendered message when the tab is visible and the reader is at the bottom. Later arrivals while reading older history remain unread until the latest message is reached. Read errors provide an explicit retry.

Notifications appear at the top and can be dismissed so a long queue error does not cover the Send button.

Validation: combined lint, TypeScript, unit suite and build passed; nine targeted browser scenarios passed after integration, including keyset/filter reset, personal count/read boundaries, stale metadata retention, queue retry/consent and desktop/mobile long-thread scrolling. Existing messages are polled; no provider messages or deployment were performed.

The durable prepared-request/reload recovery and selected-record package workflows are subsequent increments. Their completion remains part of commercial acceptance.
