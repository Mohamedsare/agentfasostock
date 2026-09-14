-- Product API sources: pagination style + optional incremental filter.
--
-- pagination_style: auto (detected from the response) | page (page/per_page) | offset (limit/offset)
-- incremental_param: query param for "changed since" (e.g. updated_since). NULL = every sync is a
--   full sync — the case for the FasoStock API (/api/v1/stores/{storeId}/products).
--
-- Requires: 0010_product_api_sources. Safe to re-run.

alter table product_sources add column if not exists pagination_style  text not null default 'auto';
alter table product_sources add column if not exists incremental_param text;
