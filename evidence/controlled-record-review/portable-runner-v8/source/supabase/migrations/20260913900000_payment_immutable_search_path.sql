-- This trigger only raises an exception; it does not resolve application objects.
-- Pin its environment without replacing its body, owner, grants or trigger bindings.
alter function public.payment_immutable() set search_path = pg_catalog;
