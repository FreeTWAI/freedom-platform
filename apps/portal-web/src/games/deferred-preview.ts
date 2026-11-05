/** Prefer primary export, without making an optional preview wait forever.
 * This never cancels PNG encoding or changes its success/error/retry state.
 */
export function deferOptionalPreview(start: () => void) {
    let active = true, released = false, frame: number | undefined, task: number | undefined;
    const release = () => {
        if (!active || released) return;
        released = true;
        window.clearTimeout(deadline);
        // A frame then a separate task gives the committed download/error UI a
        // paint opportunity before synchronous PMREM/model/first-render work.
        frame = requestAnimationFrame(() => {
            if (!active) return;
            task = window.setTimeout(() => { if (active) start(); }, 0);
        });
    };
    const deadline = window.setTimeout(release, 15000);
    return {release, dispose() {
        active = false;
        window.clearTimeout(deadline);
        if (frame !== undefined) cancelAnimationFrame(frame);
        if (task !== undefined) window.clearTimeout(task);
    }};
}
