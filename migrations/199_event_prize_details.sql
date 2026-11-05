-- Descriptive organizer promises only. No award, attendance or fulfilment state.
-- Existing events retain an empty list; legacy writers may omit the new field.
CREATE FUNCTION valid_event_prize_details(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; seen text[] := '{}'; item_id text; field text; quantity numeric; stored_text text; max_length integer;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(value)>5 THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF NOT (item ?& ARRAY['prize_id','name','description','quantity','icon_id','completion_rule','claim_note'])
      OR item - ARRAY['prize_id','name','description','quantity','icon_id','completion_rule','claim_note'] <> '{}'::jsonb THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['prize_id','name','description','icon_id','completion_rule','claim_note'] LOOP
      IF jsonb_typeof(item->field) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    END LOOP;
    item_id := item->>'prize_id';
    IF item_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR item_id=ANY(seen) THEN RETURN false; END IF;
    seen := array_append(seen,item_id);
    FOREACH field IN ARRAY ARRAY['name','description','completion_rule','claim_note'] LOOP
      stored_text := item->>field;
      max_length := CASE WHEN field='name' THEN 120 ELSE 500 END;
      -- Match JavaScript trim and Zod 4 Unicode code-point length limits.
      IF stored_text <> btrim(stored_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        OR (field<>'description' AND stored_text='') OR char_length(stored_text)>max_length THEN RETURN false; END IF;
    END LOOP;
    -- Stable IDs match the domain catalog; runtime parity test protects changes.
    IF item->>'icon_id' NOT IN ('gift','trophy','medal','book','ticket','voucher') THEN RETURN false; END IF;
    IF jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    quantity := (item->>'quantity')::numeric;
    IF quantity<1 OR quantity>500 OR quantity<>trunc(quantity) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
ALTER TABLE community_events ADD COLUMN prize_details jsonb NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT community_events_prize_details_valid CHECK (valid_event_prize_details(prize_details));
