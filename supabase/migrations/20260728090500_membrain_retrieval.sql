-- ===========================================================================
-- Project Genesis — 0006 MemBrain retrieval surface
--
-- Two functions form the ONLY read path used by search and by AI context
-- assembly. Keeping retrieval behind a stable signature is what allows the
-- ranking strategy to evolve (vector, hybrid, reranking) without any
-- application change.
--
-- Both are SECURITY INVOKER: RLS on membrain_entries still applies, so a
-- caller can never retrieve knowledge for an organisation they are not
-- assigned to, even by calling the RPC directly with a forged organisation id.
-- ===========================================================================

create or replace function public.membrain_search(
  p_organisation_id uuid,
  p_query text default null,
  p_category_ids uuid[] default null,
  p_tag_ids uuid[] default null,
  p_statuses public.membrain_status[] default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  summary text,
  status public.membrain_status,
  importance smallint,
  category_id uuid,
  version integer,
  updated_at timestamptz,
  rank real,
  headline text,
  total_count bigint
)
language sql
stable
as $$
  with normalised as (
    select nullif(trim(coalesce(p_query, '')), '') as q
  ),
  matched as (
    select
      e.*,
      case
        when n.q is null then 0::real
        else
          ts_rank(e.search_vector, websearch_to_tsquery('english', n.q))
          + (extensions.similarity(e.title, n.q) * 0.5)
      end as rank
    from public.membrain_entries e
    cross join normalised n
    where e.organisation_id = p_organisation_id
      and (p_category_ids is null or e.category_id = any (p_category_ids))
      and (p_statuses is null or e.status = any (p_statuses))
      and (
        p_tag_ids is null
        or exists (
          select 1 from public.membrain_entry_tags et
          where et.entry_id = e.id and et.tag_id = any (p_tag_ids)
        )
      )
      and (
        n.q is null
        or e.search_vector @@ websearch_to_tsquery('english', n.q)
        -- The trigram operator must be schema-qualified explicitly. Functions
        -- here pin `search_path = ''` for security, which means a bare `%`
        -- resolves against nothing and the function fails at call time — not at
        -- create time. OPERATOR(extensions.%) is the only correct form.
        or e.title operator(extensions.%) n.q
      )
  )
  select
    m.id,
    m.title,
    m.summary,
    m.status,
    m.importance,
    m.category_id,
    m.version,
    m.updated_at,
    m.rank,
    case
      when nullif(trim(coalesce(p_query, '')), '') is null then left(coalesce(m.summary, m.body), 220)
      else ts_headline(
        'english',
        coalesce(m.summary, m.body),
        websearch_to_tsquery('english', p_query),
        'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=8,MaxWords=26'
      )
    end as headline,
    count(*) over () as total_count
  from matched m
  order by m.rank desc, m.importance desc, m.updated_at desc
  limit greatest(least(coalesce(p_limit, 25), 100), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------------------
-- AI context retrieval: active knowledge only, importance-weighted, ordered so
-- that the application can fill a token budget from the top down.
-- ---------------------------------------------------------------------------
create or replace function public.membrain_context(
  p_organisation_id uuid,
  p_query text default null,
  p_limit integer default 12
)
returns table (
  id uuid,
  title text,
  summary text,
  body text,
  importance smallint,
  category_key text,
  category_label text,
  version integer,
  updated_at timestamptz,
  rank real
)
language sql
stable
as $$
  with normalised as (
    select nullif(trim(coalesce(p_query, '')), '') as q
  )
  select
    e.id,
    e.title,
    e.summary,
    e.body,
    e.importance,
    c.key as category_key,
    c.label as category_label,
    e.version,
    e.updated_at,
    case
      when n.q is null then 0::real
      else ts_rank(e.search_vector, websearch_to_tsquery('english', n.q))
    end as rank
  from public.membrain_entries e
  cross join normalised n
  left join public.membrain_categories c on c.id = e.category_id
  where e.organisation_id = p_organisation_id
    and e.status = 'active'
    and (
      n.q is null
      or e.search_vector @@ websearch_to_tsquery('english', n.q)
      or e.importance >= 4  -- non-negotiable knowledge is always in context
    )
  order by
    case when n.q is null then 0 else 1 end desc,
    e.importance desc,
    (case when n.q is null then 0::real else ts_rank(e.search_vector, websearch_to_tsquery('english', n.q)) end) desc,
    e.updated_at desc
  limit greatest(least(coalesce(p_limit, 12), 50), 1);
$$;

-- Retrieval telemetry. SECURITY DEFINER because read-only roles (reviewers)
-- must still be able to consume knowledge without holding write privileges.
create or replace function public.membrain_mark_retrieved(p_entry_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    return;
  end if;

  update public.membrain_entries e
  set retrieval_count = e.retrieval_count + 1,
      last_retrieved_at = now()
  where e.id = any (p_entry_ids)
    and app.is_org_member(e.organisation_id);
end;
$$;

revoke all on function public.membrain_mark_retrieved(uuid[]) from public;
grant execute on function public.membrain_mark_retrieved(uuid[]) to authenticated;
