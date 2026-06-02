-- Raise the free-tier itinerary cap to 30 (was 10).

create or replace function public.check_itinerary_limit() returns trigger
    language plpgsql security definer
    as $$
BEGIN
  IF (
    SELECT tier FROM profiles WHERE id = NEW.user_id
  ) = 'free' THEN
    IF (
      SELECT COUNT(*) FROM itineraries WHERE user_id = NEW.user_id
    ) >= 30 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'IT001',
        MESSAGE = 'ITINERARY_LIMIT_REACHED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
