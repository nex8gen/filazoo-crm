-- Accelerate substring searches across names, company names, tags and template
-- text, including multilingual text, without changing tokenization behavior.
create extension if not exists pg_trgm with schema extensions;
create index library_documents_search on public.library_documents using gin (search_text extensions.gin_trgm_ops);
