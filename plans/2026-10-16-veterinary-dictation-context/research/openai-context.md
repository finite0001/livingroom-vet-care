# Provider context contract — 2026-10-16

Official [file transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text), [transcription overview](https://developers.openai.com/api/docs/guides/transcription), and [endpoint reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) checked on this date.

- gpt-transcribe accepts prompt (free-form context), keywords (literal spellings), languages (expected language list). Multipart uses keywords[] and languages[]. Do not send singular language alongside languages.
- Hints must be relevant; they do not require the model to emit a keyword. Test quiet/simple source for unwanted vocabulary leakage and drug/number errors on representative recordings.
- Keep the existing model, PCM contract, explicit provider dispatch and retry protections. Send English small-animal clinician-dictation context, not previous patient history or example case narratives.
- SOAP remains gpt-6-luna with strict JSON, stateless Responses, store:false, no tools. Vocabulary lives in trusted instructions; untrusted transcript stays in the source input. Dictionary meanings do not establish patient facts.
- Request receipt: bundle SHA256 covers independently curated source URLs, entries and both context texts. Transcription request SHA256 covers a JSON manifest of model, response format, streaming flag, audio SHA256, prompt, keywords and languages (not multipart boundary bytes). Generation request SHA256 covers the complete serialized JSON request, including transcript. Neither hash is an accuracy or provider-retention guarantee.

Supabase changelog checked 2026-10-16: upcoming Nov10 TLS cipher retirement is relevant to clients, not this additive SQL change; no current function-contract blocker found. Modern Node/Deno clients retained. Function/search_path/privilege guidance checked through official Supabase docs; existing staff and service ACLs retained.
