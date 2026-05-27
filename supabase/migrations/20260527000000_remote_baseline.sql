


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."link_access_level" AS ENUM (
    'none',
    'view',
    'edit'
);


ALTER TYPE "public"."link_access_level" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_credits"("p_user_id" "uuid", "p_amount" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  rows_affected integer;
begin
  update profiles
     set credits = credits - p_amount,
         updated_at = now()
   where id = p_user_id
     and credits >= p_amount;

  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end;
$$;


ALTER FUNCTION "public"."capture_credits"("p_user_id" "uuid", "p_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_itinerary_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$BEGIN
  IF (
    SELECT tier FROM profiles WHERE id = NEW.user_id
  ) = 'free' THEN
    IF (
      SELECT COUNT(*) FROM itineraries WHERE user_id = NEW.user_id
    ) >= 10 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'IT001',
        MESSAGE = 'ITINERARY_LIMIT_REACHED';
    END IF;
  END IF;
  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."check_itinerary_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_expired_google_places"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$BEGIN
  -- 刪除超過 90 天未更新的快取
  DELETE FROM google_places
  WHERE updated_at < now() - interval '90 days';
END;$$;


ALTER FUNCTION "public"."delete_expired_google_places"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_itinerary"("p_id" "uuid") RETURNS TABLE("id" "uuid", "user_id" "uuid", "title" "text", "destination" "text", "start_date" "date", "end_date" "date", "preferences" "text", "status" "text", "data" "jsonb", "settings" "jsonb", "link_access" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  select
    i.id,
    i.user_id,
    i.title,
    i.destination,
    i.start_date,
    i.end_date,
    i.preferences,
    i.status::text,
    i.data,
    i.settings,
    i.link_access::text,
    i.created_at,
    i.updated_at
  from public.itineraries i
  where i.id = p_id
    and i.link_access != 'none';
end;
$$;


ALTER FUNCTION "public"."get_public_itinerary"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$BEGIN
  IF new.is_anonymous THEN
    RETURN new;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, avatar_url, credits)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    1000
  );
  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_itinerary_owner"("itinerary_uuid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.itineraries
    WHERE id = itinerary_uuid
    AND user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_itinerary_owner"("itinerary_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_amount" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  rows_affected integer;
begin
  update profiles
     set credits = credits + p_amount,
         updated_at = now()
   where id = p_user_id;

  get diagnostics rows_affected = row_count;
  return rows_affected > 0;
end;
$$;


ALTER FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_public_itinerary"("p_id" "uuid", "p_updates" "jsonb") RETURNS TABLE("id" "uuid", "user_id" "uuid", "title" "text", "destination" "text", "start_date" "date", "end_date" "date", "preferences" "text", "status" "text", "data" "jsonb", "settings" "jsonb", "link_access" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return query
  update public.itineraries as i
  set
    title = coalesce(p_updates->>'title', i.title),
    destination = coalesce(p_updates->>'destination', i.destination),
    start_date = coalesce((p_updates->>'start_date')::date, i.start_date),
    end_date = coalesce((p_updates->>'end_date')::date, i.end_date),
    preferences = coalesce(p_updates->>'preferences', i.preferences),
    data = coalesce(p_updates->'data', i.data),
    settings = coalesce(p_updates->'settings', i.settings),
    updated_at = now()
  where i.id = p_id
    and i.link_access = 'edit'
  returning
    i.id,
    i.user_id,
    i.title,
    i.destination,
    i.start_date,
    i.end_date,
    i.preferences,
    i.status::text,
    i.data,
    i.settings,
    i.link_access::text,
    i.created_at,
    i.updated_at;

  if not found then
    raise exception 'Itinerary not found or not editable' using errcode = 'P0002';
  end if;
end;
$$;


ALTER FUNCTION "public"."update_public_itinerary"("p_id" "uuid", "p_updates" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."day_matrices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "itinerary_id" "uuid" NOT NULL,
    "day_number" integer NOT NULL,
    "activity_ids" "text"[] NOT NULL,
    "matrix" "jsonb" NOT NULL,
    "transport_mode" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_fingerprint" "text" NOT NULL,
    "matrix_source" "text" DEFAULT 'google_routes_matrix'::"text" NOT NULL,
    CONSTRAINT "day_matrices_matrix_source_check" CHECK (("matrix_source" = ANY (ARRAY['google_routes_matrix'::"text", 'google_distance_matrix'::"text", 'haversine_fallback'::"text"])))
);


ALTER TABLE "public"."day_matrices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."google_places" (
    "place_id" "text" NOT NULL,
    "name" "text",
    "lat" double precision,
    "lng" double precision,
    "rating" double precision,
    "user_ratings_total" integer,
    "website" "text",
    "opening_hours" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."google_places" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."itineraries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "destination" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "preferences" "text",
    "link_access" "public"."link_access_level" DEFAULT 'none'::"public"."link_access_level" NOT NULL,
    "settings" "jsonb",
    CONSTRAINT "itineraries_data_check" CHECK (("pg_column_size"("data") <= 65536)),
    CONSTRAINT "itineraries_destination_check" CHECK (("char_length"("destination") <= 100)),
    CONSTRAINT "itineraries_destination_length_check" CHECK (("char_length"("destination") <= 100)),
    CONSTRAINT "itineraries_preferences_check" CHECK (("char_length"("preferences") <= 1000)),
    CONSTRAINT "itineraries_settings_valid" CHECK ((("settings" ? 'startTime'::"text") AND ("settings" ? 'endTime'::"text") AND ("settings" ? 'transportMode'::"text") AND (("settings" ->> 'startTime'::"text") ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::"text") AND (("settings" ->> 'endTime'::"text") ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::"text") AND (("settings" ->> 'startTime'::"text") < ("settings" ->> 'endTime'::"text")) AND (("settings" ->> 'transportMode'::"text") = ANY (ARRAY['driving'::"text", 'walking'::"text", 'transit'::"text", 'bicycling'::"text"])))),
    CONSTRAINT "itineraries_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'generating'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "itineraries_title_check" CHECK (("char_length"("title") <= 100)),
    CONSTRAINT "valid_dates" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."itineraries" OWNER TO "postgres";


COMMENT ON CONSTRAINT "itineraries_destination_length_check" ON "public"."itineraries" IS 'Ensures destination field does not exceed 100 characters';



CREATE TABLE IF NOT EXISTS "public"."itinerary_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "itinerary_id" "uuid" NOT NULL,
    "shared_with_email" "text" NOT NULL,
    "permission" "text" DEFAULT 'edit'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "itinerary_shares_permission_check" CHECK (("permission" = ANY (ARRAY['view'::"text", 'edit'::"text"]))),
    CONSTRAINT "itinerary_shares_shared_with_email_check" CHECK (("shared_with_email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text"))
);


ALTER TABLE "public"."itinerary_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "tier" "text" DEFAULT 'free'::"text",
    "credits" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profiles_tier_check" CHECK (("tier" = ANY (ARRAY['free'::"text", 'pro'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."day_matrices"
    ADD CONSTRAINT "day_matrices_itinerary_id_day_number_key" UNIQUE ("itinerary_id", "day_number");



ALTER TABLE ONLY "public"."day_matrices"
    ADD CONSTRAINT "day_matrices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."itineraries"
    ADD CONSTRAINT "itineraries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."itinerary_shares"
    ADD CONSTRAINT "itinerary_shares_itinerary_id_shared_with_email_uniq" UNIQUE ("itinerary_id", "shared_with_email");



ALTER TABLE ONLY "public"."itinerary_shares"
    ADD CONSTRAINT "itinerary_shares_itinerary_id_shared_with_user_id_uniq" UNIQUE ("itinerary_id", "shared_with_email");



ALTER TABLE ONLY "public"."itinerary_shares"
    ADD CONSTRAINT "itinerary_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."google_places"
    ADD CONSTRAINT "place_cache_pkey" PRIMARY KEY ("place_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_google_places_name_lower" ON "public"."google_places" USING "btree" ("lower"("name"));



CREATE INDEX "idx_itineraries_created_at" ON "public"."itineraries" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_itineraries_destination" ON "public"."itineraries" USING "btree" ("destination");



CREATE INDEX "idx_itineraries_link_access" ON "public"."itineraries" USING "btree" ("link_access") WHERE ("link_access" <> 'none'::"public"."link_access_level");



CREATE INDEX "idx_itineraries_status" ON "public"."itineraries" USING "btree" ("status");



CREATE INDEX "idx_itineraries_user_id" ON "public"."itineraries" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_email" ON "public"."profiles" USING "btree" ("email");



CREATE INDEX "idx_profiles_tier" ON "public"."profiles" USING "btree" ("tier");



CREATE INDEX "idx_shares_itinerary_id" ON "public"."itinerary_shares" USING "btree" ("itinerary_id");



CREATE INDEX "idx_shares_user_id" ON "public"."itinerary_shares" USING "btree" ("shared_with_email");



CREATE OR REPLACE TRIGGER "enforce_itinerary_limit" BEFORE INSERT ON "public"."itineraries" FOR EACH ROW EXECUTE FUNCTION "public"."check_itinerary_limit"();



CREATE OR REPLACE TRIGGER "update_google_places_updated_at" BEFORE UPDATE ON "public"."google_places" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_itineraries_updated_at" BEFORE UPDATE ON "public"."itineraries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."day_matrices"
    ADD CONSTRAINT "day_matrices_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."itineraries"
    ADD CONSTRAINT "itineraries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."itinerary_shares"
    ADD CONSTRAINT "itinerary_shares_itinerary_id_fkey" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Itinerary owners can manage day matrices" ON "public"."day_matrices" USING ((EXISTS ( SELECT 1
   FROM "public"."itineraries"
  WHERE (("itineraries"."id" = "day_matrices"."itinerary_id") AND ("itineraries"."user_id" = "auth"."uid"())))));



CREATE POLICY "Owners can manage shares" ON "public"."itinerary_shares" USING ("public"."is_itinerary_owner"("itinerary_id"));



CREATE POLICY "Users can create their own itineraries" ON "public"."itineraries" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own itineraries" ON "public"."itineraries" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update accessible itineraries" ON "public"."itineraries" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."itinerary_shares"
  WHERE (("itinerary_shares"."itinerary_id" = "itineraries"."id") AND ("itinerary_shares"."shared_with_email" = "lower"(("auth"."jwt"() ->> 'email'::"text"))) AND ("itinerary_shares"."permission" = 'edit'::"text"))))));



CREATE POLICY "Users can view accessible itineraries" ON "public"."itineraries" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."itinerary_shares"
  WHERE (("itinerary_shares"."itinerary_id" = "itineraries"."id") AND ("itinerary_shares"."shared_with_email" = "lower"(("auth"."jwt"() ->> 'email'::"text"))))))));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own shares" ON "public"."itinerary_shares" FOR SELECT USING (("shared_with_email" = "lower"(("auth"."jwt"() ->> 'email'::"text"))));



ALTER TABLE "public"."day_matrices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."google_places" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."itineraries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."itinerary_shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_credits"("p_user_id" "uuid", "p_amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."capture_credits"("p_user_id" "uuid", "p_amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_credits"("p_user_id" "uuid", "p_amount" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_itinerary_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_itinerary_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_itinerary_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_expired_google_places"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_expired_google_places"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_expired_google_places"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_public_itinerary"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_itinerary"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_itinerary"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_itinerary_owner"("itinerary_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_itinerary_owner"("itinerary_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_itinerary_owner"("itinerary_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_amount" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_public_itinerary"("p_id" "uuid", "p_updates" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."update_public_itinerary"("p_id" "uuid", "p_updates" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_public_itinerary"("p_id" "uuid", "p_updates" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."day_matrices" TO "anon";
GRANT ALL ON TABLE "public"."day_matrices" TO "authenticated";
GRANT ALL ON TABLE "public"."day_matrices" TO "service_role";



GRANT ALL ON TABLE "public"."google_places" TO "anon";
GRANT ALL ON TABLE "public"."google_places" TO "authenticated";
GRANT ALL ON TABLE "public"."google_places" TO "service_role";



GRANT ALL ON TABLE "public"."itineraries" TO "anon";
GRANT ALL ON TABLE "public"."itineraries" TO "authenticated";
GRANT ALL ON TABLE "public"."itineraries" TO "service_role";



GRANT ALL ON TABLE "public"."itinerary_shares" TO "anon";
GRANT ALL ON TABLE "public"."itinerary_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."itinerary_shares" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


-- Remote production does not have pg_net (Supabase CLI installs it locally by default).
-- Drop it explicitly so local matches remote.
DROP EXTENSION IF EXISTS "pg_net";

-- pg_cron lives in pg_catalog on remote; `db dump --schema public` does not capture it.
create extension if not exists "pg_cron" with schema "pg_catalog";

-- Trigger lives on auth.users (auth schema), also missed by --schema public.
-- It auto-creates a public.profiles row on signup, so the app needs it.
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();







