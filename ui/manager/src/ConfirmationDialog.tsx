import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function ConfirmationDialog({ title, onCancel, children, modal = true }: { title: string; onCancel(): void; children: ReactNode; modal?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (modal) element?.showModal(); else element?.show();
    return () => element?.close();
  }, [modal]);
  return <dialog ref={dialog} className={`confirmation-dialog${modal ? "" : " confirmation-dialog--nonmodal"}`} aria-label={title} onCancel={event => { event.preventDefault(); onCancel(); }}>
    {children}
  </dialog>;
}
