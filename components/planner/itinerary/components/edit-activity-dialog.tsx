"use client";

import { useState } from "react";
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
import { AlertTriangle, Trash2 } from "lucide-react";
import type { Activity } from "@/types/itinerary";
import { useItineraryStore } from "../store";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { createActivityFormSchema, type ActivityFormValues } from "@/types/forms";

interface EditActivityDialogProps {
  activity: Activity;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Outer shell: controls Dialog visibility only ─────────────────────────
export function EditActivityDialog({ isOpen, onClose, ...contentProps }: EditActivityDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px]" onClose={onClose}>
        {isOpen && <EditActivityDialogContent onClose={onClose} {...contentProps} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Inner content: all state is fresh on every mount ─────────────────────
type Step = "edit" | "confirm-delete";

function EditActivityDialogContent({ activity, onClose }: Omit<EditActivityDialogProps, "isOpen">) {
  const t = useTranslations("planner.editDialog");
  const tv = useTranslations();
  const updateActivity = useItineraryStore((state) => state.updateActivity);
  const deleteActivity = useItineraryStore((state) => state.deleteActivity);
  const isSaving = useItineraryStore((state) => state.isSaving);

  const [step, setStep] = useState<Step>("edit");

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(
      createActivityFormSchema((key) => tv(key)),
    ) as Resolver<ActivityFormValues>,
    defaultValues: {
      title: activity.title,
      locationName: activity.location.name,
      note: activity.note || "",
      time: activity.time,
      duration: activity.duration_minutes,
    },
  });

  const { isDirty } = form.formState;

  const onSubmit = async (data: ActivityFormValues) => {
    try {
      const { resolveStatus } = await updateActivity(activity.id, data);
      if (resolveStatus === "not_found") {
        toast.warning(t("placeNotFound", { name: data.locationName }));
      } else if (resolveStatus === "error") {
        toast.error(t("placeResolveError"));
      }
      onClose();
    } catch (err) {
      console.error("Save activity failed:", err);
      toast.error(t("errorSave"));
    }
  };

  const handleDeleteClick = () => {
    setStep("confirm-delete");
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteActivity(activity.id);
      onClose();
    } catch (err) {
      console.error("Delete activity failed:", err);
      toast.error(t("errorDelete"));
    }
  };

  const handleBackToEdit = () => {
    setStep("edit");
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  if (step === "edit") {
    return (
      /* ── Edit Step ── */
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
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDeleteClick}
            disabled={isSaving}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t("delete")}
          </Button>
          <Button type="submit" isLoading={isSaving} loadingText={t("saving")} disabled={!isDirty}>
            {t("save")}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  if (step === "confirm-delete") {
    return (
      /* ── Confirm Delete Step ── */
      <div>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t("confirmDeleteTitle")}
          </DialogTitle>
          <DialogDescription>{t("confirmDeleteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="my-4 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-semibold">{activity.title}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {activity.location.name} · {activity.time}
          </p>
        </div>

        <p className="text-sm text-muted-foreground">{t("confirmDeleteNote")}</p>

        <DialogFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={handleBackToEdit} disabled={isSaving}>
            {t("cancelDelete")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirmDelete}
            isLoading={isSaving}
            loadingText={t("deleting")}
          >
            {t("confirmDelete")}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  // Exhaustive check: TypeScript will error here if a new Step is added but not handled
  const _exhaustive: never = step;
  return _exhaustive;
}
