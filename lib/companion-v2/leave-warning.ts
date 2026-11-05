'use client';

// Warns before leaving a screen with unsaved work (an unapplied proposal, a
// draft, a reply still coming). beforeunload covers reloads and closing the
// tab; the workspace tabs are client-side links, so they ask confirmLeave().

import { useEffect } from 'react';

let unsavedCount = 0;

const MESSAGE = 'Leave this screen? Your unsaved work here will be lost.';

export function useLeaveWarning(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    unsavedCount++;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => {
      unsavedCount--;
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [unsaved]);
}

/** True when it's fine to navigate away (nothing unsaved, or the user agreed). */
export function confirmLeave(): boolean {
  return unsavedCount === 0 || window.confirm(MESSAGE);
}
