// Fade only overflowing text. Keep the ellipsis outside the mask, and preserve the full
// label for assistive technology and the browser tooltip. Neither observer changes data.
export function trackTruncatedLabel(label: HTMLElement): void {
  const line = label.parentElement!;
  const measure = () => {
    const title = label.textContent || '';
    if (label.title !== title) label.title = title;
    line.dataset.truncated = String(label.scrollWidth > label.clientWidth + 1);
  };
  new ResizeObserver(measure).observe(label);
  new MutationObserver(measure).observe(label, {childList: true, characterData: true, subtree: true});
  void document.fonts.ready.then(measure);
  measure();
}
