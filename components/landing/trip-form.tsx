"use client";

import { useRef, useState } from "react";
import { useRouter } from "@/lib/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TimeSelect } from "@/components/ui/time-select";
import { TrendingDestinations } from "./trending-destinations";
import { DateRangePicker } from "./date-range-picker";
import { LoginDialog } from "@/components/auth/login-dialog";
import { getCurrentUser } from "@/lib/supabase/client";
import { createItineraryMetadata, ItineraryLimitError } from "@/lib/supabase/itineraries";
import { formatLocalDate } from "@/lib/utils/date";
import {
  buildAdvancedPrefsHint,
  DEFAULT_ADVANCED_START_TIME,
  DEFAULT_ADVANCED_END_TIME,
  DEFAULT_ADVANCED_TRANSPORT_MODE,
} from "@/lib/utils/advanced-prefs-hint";
import type { TransportMode } from "@/types/itinerary";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller, type Resolver } from "react-hook-form";
import { createTripFormSchema, type TripFormValues } from "@/types/forms";

const TRANSPORT_OPTIONS: TransportMode[] = ["driving", "walking", "transit", "bicycling"];

export function TripForm() {
  const t = useTranslations("landing.form");
  const tv = useTranslations();
  const ti = useTranslations("itineraries");
  const tp = useTranslations("planner");
  const locale = useLocale();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [generalError, setGeneralError] = useState<string>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Track whether the advanced section has been opened at least once. The
  // hint is only appended when the user actually engaged with this section —
  // pristine defaults should not surface to the AI as a preference.
  const advancedEverOpenedRef = useRef(false);

  const form = useForm<TripFormValues>({
    resolver: zodResolver(createTripFormSchema((key) => tv(key))) as Resolver<TripFormValues>,
    defaultValues: {
      destination: "",
      description: "",
      dates: {
        from: undefined,
        to: undefined,
      },
      startTime: DEFAULT_ADVANCED_START_TIME,
      endTime: DEFAULT_ADVANCED_END_TIME,
      transportMode: DEFAULT_ADVANCED_TRANSPORT_MODE,
    },
  });

  const toggleAdvanced = () => {
    setAdvancedOpen((open) => {
      const next = !open;
      if (next) advancedEverOpenedRef.current = true;
      return next;
    });
  };

  const onSubmit = async (data: TripFormValues) => {
    setIsLoading(true);
    setGeneralError(undefined);

    try {
      const user = await getCurrentUser();

      if (!user || user.is_anonymous) {
        setLoginOpen(true);
        setIsLoading(false);
        return;
      }

      const formattedStart = formatLocalDate(data.dates.from as Date);
      const formattedEnd = formatLocalDate(data.dates.to as Date);

      const title = ti("titleFormat", { destination: data.destination });

      const hint = buildAdvancedPrefsHint({
        startTime: data.startTime,
        endTime: data.endTime,
        transportMode: data.transportMode,
        advancedOpened: advancedEverOpenedRef.current,
        locale,
        transportModeLabel: tp(`transportMode.${data.transportMode}`),
      });
      const baseDescription = data.description?.trim() ?? "";
      const finalDescription = [baseDescription, hint].filter(Boolean).join("\n\n") || undefined;

      const itinerary = await createItineraryMetadata({
        user_id: user.id,
        title,
        destination: data.destination,
        start_date: formattedStart,
        end_date: formattedEnd,
        description: finalDescription,
      });

      router.push(`/plan/${itinerary.id}`);
    } catch (error) {
      if (error instanceof ItineraryLimitError) {
        setGeneralError(t("itineraryLimitError"));
      } else {
        console.error("Error creating itinerary:", error);
        setGeneralError(t("createError"));
      }
      setIsLoading(false);
    }
  };

  const handleDestinationClick = (dest: string) => {
    form.setValue("destination", dest, { shouldValidate: true });
  };

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="p-6 md:p-8">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
              {/* Destination Input */}
              <div className="flex-1">
                <label
                  htmlFor="destination"
                  className="block text-sm font-medium mb-2 text-foreground/80"
                >
                  {t("whereToNext")}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-5 -translate-y-1/2 text-muted-foreground">
                    📍
                  </span>
                  <Input
                    id="destination"
                    type="text"
                    placeholder={t("destinationPlaceholder")}
                    disabled={isLoading}
                    className="pl-10"
                    {...form.register("destination")}
                    error={!!form.formState.errors.destination}
                    helperText={form.formState.errors.destination?.message?.toString()}
                  />
                </div>
              </div>

              {/* Date Range Picker */}
              <div className="min-w-[300px]">
                <label className="block text-sm font-medium mb-2 text-foreground/80">
                  {t("whenAreYouGoing")}
                </label>
                <Controller
                  name="dates"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <DateRangePicker
                      startDate={field.value?.from}
                      endDate={field.value?.to}
                      onChange={(start, end) => {
                        field.onChange({ from: start, to: end });
                      }}
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                    />
                  )}
                />
              </div>
            </div>

            {/* Preferences/Custom Preferences Textarea */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium mb-2 text-foreground/80"
              >
                {t("describeYourTrip")}
              </label>
              <Textarea
                id="description"
                placeholder={t("descriptionPlaceholder")}
                disabled={isLoading}
                className="min-h-[120px] resize-none"
                {...form.register("description")}
                error={!!form.formState.errors.description}
                helperText={form.formState.errors.description?.message?.toString()}
              />
            </div>

            {/* Advanced preferences (collapsed by default). Values are appended
                to description as a hint to the AI — they are not persisted as
                separate columns. See lib/utils/advanced-prefs-hint. */}
            <div className="border-t border-border pt-4">
              <button
                type="button"
                onClick={toggleAdvanced}
                aria-expanded={advancedOpen}
                aria-controls="advanced-trip-prefs"
                className="flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-foreground"
              >
                {t("advanced")}
                <svg
                  className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {advancedOpen && (
                <div id="advanced-trip-prefs" className="mt-4 flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-foreground/80">
                      {t("dailyTimeRange")}
                      <span className="ml-1 text-xs text-muted-foreground">{t("optional")}</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <Controller
                        name="startTime"
                        control={form.control}
                        render={({ field }) => (
                          <TimeSelect
                            value={field.value}
                            onChange={field.onChange}
                            aria-label={t("startTimeLabel")}
                            disabled={isLoading}
                          />
                        )}
                      />
                      <span className="text-sm text-muted-foreground">–</span>
                      <Controller
                        name="endTime"
                        control={form.control}
                        render={({ field }) => (
                          <TimeSelect
                            value={field.value}
                            onChange={field.onChange}
                            aria-label={t("endTimeLabel")}
                            disabled={isLoading}
                          />
                        )}
                      />
                    </div>
                    {(form.formState.errors.startTime || form.formState.errors.endTime) && (
                      <p className="text-xs text-destructive mt-1">
                        {(
                          form.formState.errors.startTime ?? form.formState.errors.endTime
                        )?.message?.toString()}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2 text-foreground/80">
                      {t("transportMode")}
                    </label>
                    <Controller
                      name="transportMode"
                      control={form.control}
                      render={({ field }) => (
                        <select
                          value={field.value}
                          onChange={(event) => field.onChange(event.target.value as TransportMode)}
                          disabled={isLoading}
                          aria-label={t("transportMode")}
                          className="bg-background border border-border rounded px-3 h-9 text-sm cursor-pointer"
                        >
                          {TRANSPORT_OPTIONS.map((mode) => (
                            <option key={mode} value={mode}>
                              {tp(`transportMode.${mode}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* General Error Message */}
            {generalError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive">{generalError}</p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {t("generating")}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                  {t("generateButton")}
                </span>
              )}
            </Button>
          </form>

          {/* Trending Destinations */}
          <TrendingDestinations onDestinationClick={handleDestinationClick} />
        </CardContent>
      </Card>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </>
  );
}
