"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useItineraryStore } from "../store";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { createActivityFormSchema, type ActivityFormValues } from "@/types/forms";

interface AddActivityDialogProps {
  dayNumber: number;
  insertionIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Outer shell: controls Dialog visibility only ─────────────────────────
export function AddActivityDialog({ isOpen, onClose, ...contentProps }: AddActivityDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]" onClose={onClose}>
        {isOpen && <AddActivityDialogContent onClose={onClose} {...contentProps} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Inner content: all state is fresh on every mount ─────────────────────
function AddActivityDialogContent({
  dayNumber,
  insertionIndex,
  onClose,
}: Omit<AddActivityDialogProps, "isOpen">) {
  const t = useTranslations("planner.addDialog");
  const tv = useTranslations();
  const addActivity = useItineraryStore((state) => state.addActivity);
  const isSaving = useItineraryStore((state) => state.isSaving);

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(
      createActivityFormSchema((key) => tv(key)),
    ) as Resolver<ActivityFormValues>,
    defaultValues: {
      title: "",
      locationName: "",
      time: "09:00",
      duration: 60,
      note: "",
    },
  });

  const titleValue = useWatch({ control: form.control, name: "title" });
  const isDirtyLocation = form.getFieldState("locationName").isDirty;
  const { isDirty } = form.formState;

  // Sync location name with title until user manually edits the location field
  useEffect(() => {
    if (!isDirtyLocation && titleValue) {
      form.setValue("locationName", titleValue, {
        shouldValidate: true,
        shouldDirty: false,
      });
    }
  }, [titleValue, isDirtyLocation, form]);

  const onSubmit = async (data: ActivityFormValues) => {
    try {
      const { resolveStatus } = await addActivity(dayNumber, data, insertionIndex);
      if (resolveStatus === "not_found") {
        toast.warning(t("placeNotFound", { name: data.locationName }));
      } else if (resolveStatus === "error") {
        toast.error(t("placeResolveError"));
      }
      onClose();
    } catch (err) {
      console.error("Add activity failed:", err);
      toast.error(t("errorAdd"));
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid gap-2">
          <label htmlFor="title" className="text-sm font-medium">
            {t("labelTitle")}
          </label>
          <Input
            id="title"
            autoFocus
            disabled={isSaving}
            {...form.register("title")}
            error={!!form.formState.errors.title}
            helperText={form.formState.errors.title?.message?.toString()}
          />
        </div>
        <div className="grid gap-2">
          <label htmlFor="location" className="text-sm font-medium">
            {t("labelLocation")}
          </label>
          <Input
            id="location"
            disabled={isSaving}
            {...form.register("locationName")}
            error={!!form.formState.errors.locationName}
            helperText={form.formState.errors.locationName?.message?.toString()}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <label htmlFor="time" className="text-sm font-medium">
              {t("labelTime")}
            </label>
            <Input
              id="time"
              type="time"
              disabled={isSaving}
              {...form.register("time")}
              error={!!form.formState.errors.time}
              helperText={form.formState.errors.time?.message?.toString()}
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="duration" className="text-sm font-medium">
              {t("labelDuration")}
            </label>
            <Input
              id="duration"
              type="number"
              disabled={isSaving}
              {...form.register("duration")}
              error={!!form.formState.errors.duration}
              helperText={form.formState.errors.duration?.message?.toString()}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <label htmlFor="note" className="text-sm font-medium">
            {t("labelNote")}
          </label>
          <Textarea
            id="note"
            disabled={isSaving}
            placeholder={t("placeholderNote")}
            {...form.register("note")}
          />
          {form.formState.errors.note && (
            <p className="text-xs text-destructive mt-1">
              {form.formState.errors.note.message?.toString()}
            </p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          {t("cancel")}
        </Button>
        <Button type="submit" isLoading={isSaving} loadingText={t("saving")} disabled={!isDirty}>
          {t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
