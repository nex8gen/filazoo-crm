# AI image inputs

The workspace AI sidebar (Chat and Agent) and customer AI chat accept JPG, PNG and WebP images through **Add image** or by pasting an image into the message box. Attach a screenshot or photo, enter a prompt, then send. Image-only questions are also accepted. Previews can be removed before sending; images stay in the in-memory conversation for follow-up questions and are cleared with New chat or a page refresh.

Agent mode can extract readable image details for supported CRM actions using the existing approval setting. Customer chat provides answers and drafts. Images are evidence; instructions printed inside an image do not authorize actions. Existing server checks still validate customers, catalog items, permissions and payment methods.

Original files may be up to 10 MB. The browser resizes large images to a maximum dimension of 2,000 pixels and compresses as needed. Each transmitted image is limited to 750 KB, with at most four images and 2.4 MB of image data across the submitted conversation window. The API also bounds actual streamed request bytes. Crop detailed screenshots if they exceed these limits.

Both Gemini and AI Gateway receive native image parts, with filenames and conversation-turn references. Base64 data is excluded from the text prompt. Gateway image requests use `AI_GATEWAY_VISION_MODEL` or `alibaba/qwen3.5-flash`; text-only requests keep their existing configured models. Gemini uses its existing chat/agent model settings. Regional Gemini fallback preserves the image parts. Images are sent to the configured AI provider for processing and are not saved to CRM storage.

Provider formats: [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding), [AI Gateway image inputs](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/images).
