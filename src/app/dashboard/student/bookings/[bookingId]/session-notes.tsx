"use client";

import { useActionState, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateSessionNotesAction } from "@/app/dashboard/session-actions";

// Plain elements, styled to match the rest of the app's type scale rather
// than pulling in a typography plugin for one markdown document.
const markdownComponents: Components = {
  h1: (props: ComponentPropsWithoutRef<"h1">) => <h3 className="mt-6 font-heading text-base font-semibold first:mt-0" {...props} />,
  h2: (props: ComponentPropsWithoutRef<"h2">) => <h3 className="mt-6 font-heading text-base font-semibold first:mt-0" {...props} />,
  h3: (props: ComponentPropsWithoutRef<"h3">) => <h4 className="mt-4 font-heading text-sm font-semibold" {...props} />,
  p: (props: ComponentPropsWithoutRef<"p">) => <p className="mt-2 text-sm leading-6 text-muted-foreground first:mt-0" {...props} />,
  ul: (props: ComponentPropsWithoutRef<"ul">) => <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground" {...props} />,
  ol: (props: ComponentPropsWithoutRef<"ol">) => <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground" {...props} />,
  li: (props: ComponentPropsWithoutRef<"li">) => <li {...props} />,
  strong: (props: ComponentPropsWithoutRef<"strong">) => <strong className="font-semibold text-foreground" {...props} />,
  a: (props: ComponentPropsWithoutRef<"a">) => <a className="text-foreground underline underline-offset-2 hover:text-saffron" target="_blank" rel="noreferrer" {...props} />,
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground italic" {...props} />,
  code: (props: ComponentPropsWithoutRef<"code">) => <code className="rounded bg-muted px-1 py-0.5 text-xs" {...props} />,
  hr: () => <hr className="my-4 border-border" />,
};

/**
 * Replaces the old separate summary / topics / action-point / misconception
 * cards with one editable markdown document. Everyone on the booking can
 * read it; only the tutor can switch to editing it, and their draft is kept
 * in local state until they explicitly save.
 *
 * Two different "give up on this" actions, because they discard different
 * things: Cancel discards only the current edit, back to whatever is saved
 * (which may itself already be a past edit). Reset goes further, back to
 * originalMarkdown — the AI's own output, recomputed fresh from summary_notes
 * on every render (see page.tsx) rather than read from notes_markdown, since
 * notes_markdown is overwritten by each save and so can't be used to get back
 * past more than one save.
 */
export function SessionNotes({
  bookingId,
  initialMarkdown,
  originalMarkdown,
  canEdit,
}: {
  bookingId: string;
  initialMarkdown: string;
  originalMarkdown: string;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateSessionNotesAction, {});
  const [saved, setSaved] = useState(initialMarkdown);
  const [draft, setDraft] = useState(initialMarkdown);
  const [editing, setEditing] = useState(false);

  // Adjust state during render rather than in an effect: useActionState
  // gives a new `state` object each time a submission resolves, so
  // comparing against the last one we've handled reacts to a successful
  // save with no extra render after commit (and no setState-in-effect).
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.success) {
      setSaved(draft);
      setEditing(false);
    }
  }

  function startEditing() {
    setDraft(saved);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(saved);
    setEditing(false);
  }

  function resetToOriginal() {
    setDraft(originalMarkdown);
  }

  const dirty = draft !== saved;
  const atOriginal = draft === originalMarkdown;

  return (
    <Card className="flex h-[32rem] flex-col lg:h-[42rem]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-saffron" /> Session notes
        </CardTitle>
        {canEdit && !editing && (
          <CardAction>
            <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        {editing ? (
          <form action={formAction} className="flex h-full flex-col gap-3">
            <input type="hidden" name="booking_id" value={bookingId} />
            <textarea
              name="notes_markdown"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Session notes (markdown)"
              className="w-full flex-1 resize-none rounded-lg border border-input bg-background p-3 font-mono text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
            <div className="flex shrink-0 items-center gap-2">
              <Button type="submit" size="sm" disabled={pending || !dirty}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={cancelEditing} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={resetToOriginal} disabled={pending || atOriginal}>
                <RotateCcw className="size-3.5" /> Reset to AI version
              </Button>
            </div>
          </form>
        ) : saved.trim() ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {saved}
          </ReactMarkdown>
        ) : (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
