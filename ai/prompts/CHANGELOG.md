# Prompt Version Changelog

### Version 1.0.0 (`email_draft_v1.md`)
- Initial release of the verified-facts outreach drafting prompt.
- Enforces strict factual grounding: every assertion in `body` must map to an explicit `fact_id`.
- Rejects any external or hallucinated claims regarding compensation, relationships, or experience requirements.
- Outputs structured JSON conforming to `contracts/ai-schemas/draft_output.json`.

### Tone Variant Prompts (AI-11 & AI-21)
- `tone_hr.md` (v1.0.0): Specialized guidelines for corporate recruiters, emphasizing metrics, recruitment workflows, and no false guarantees.
- `tone_tpo.md` (v1.0.0): Specialized guidelines for college placement officers, emphasizing formal, respectful institutional communication.
- `tone_founder.md` (v1.0.0): Specialized guidelines for startup founders, emphasizing peer-to-peer, energetic, problem-solving language.
- Reference evaluation samples recorded in `ai/evals/samples/` adhering to 80–150 word constraints.
- Fully documented in `docs/ai-guide.md` prompt catalog.
