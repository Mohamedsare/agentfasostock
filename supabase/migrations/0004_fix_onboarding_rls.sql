-- Fix onboarding RLS bootstrap.
--
-- A brand-new user has no org yet, so current_org_id() is NULL and the original
-- "id = current_org_id()" check blocked creating their FIRST organization.
-- Allow creating/owning an org via owner_id = auth.uid(), and allow agents that
-- belong to an org you own (covers the window before profiles.org_id is set).

-- organizations: split the catch-all policy into select/insert/update by owner.
drop policy if exists "org_self" on organizations;
drop policy if exists "org_select" on organizations;
drop policy if exists "org_insert" on organizations;
drop policy if exists "org_update" on organizations;

create policy "org_select" on organizations for select to authenticated
  using (id = current_org_id() or owner_id = auth.uid());

create policy "org_insert" on organizations for insert to authenticated
  with check (owner_id = auth.uid());

create policy "org_update" on organizations for update to authenticated
  using (id = current_org_id() or owner_id = auth.uid())
  with check (id = current_org_id() or owner_id = auth.uid());

create policy "org_delete" on organizations for delete to authenticated
  using (owner_id = auth.uid());

-- agents: allow agents in your org OR an org you own (onboarding bootstrap).
drop policy if exists "agents_org" on agents;
create policy "agents_org" on agents for all to authenticated
  using (
    org_id = current_org_id()
    or org_id in (select id from organizations where owner_id = auth.uid())
  )
  with check (
    org_id = current_org_id()
    or org_id in (select id from organizations where owner_id = auth.uid())
  );
