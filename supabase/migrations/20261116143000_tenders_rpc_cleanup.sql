-- PROMPT 6 : nettoyage des surcharges pÃ©rimÃ©es (gÃ©nÃ©rations antÃ©rieures des RPC DAO).
-- Les anciennes signatures sont retirÃ©es pour Ã©viter toute ambiguÃ¯tÃ© d'appel
-- et toute variante obsolÃ¨te (dont tender_quote_set 5 args sans tender_id).
-- Les signatures actuelles reÃ§oivent grants cohÃ©rents avec le projet.

drop function if exists public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid);
drop function if exists public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text);
drop function if exists public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid);
drop function if exists public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text);
drop function if exists public.tender_item_add(uuid, text, numeric, text, bigint, text);
drop function if exists public.tender_item_add(uuid, text, numeric, text, bigint, text, uuid);
drop function if exists public.tender_quote_set(uuid, uuid, bigint, text, text);

revoke execute on function
  public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid, text, text),
  public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid, text, text),
  public.tender_set_status(uuid, text, bigint, text),
  public.tender_item_add(uuid, text, numeric, text, bigint, text, uuid, text, text),
  public.tender_item_remove(uuid),
  public.tender_quote_set(uuid, uuid, bigint, text, text, text, bigint, integer, integer, text, uuid),
  public.tender_item_select_supplier(uuid, uuid, text)
from anon, public;

grant execute on function
  public.tender_create(text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid, text, text),
  public.tender_update(uuid, text, uuid, timestamptz, text, text, timestamptz, text, text, date, bigint, bigint, uuid, text, text),
  public.tender_set_status(uuid, text, bigint, text),
  public.tender_item_add(uuid, text, numeric, text, bigint, text, uuid, text, text),
  public.tender_item_remove(uuid),
  public.tender_quote_set(uuid, uuid, bigint, text, text, text, bigint, integer, integer, text, uuid),
  public.tender_item_select_supplier(uuid, uuid, text)
to authenticated;
