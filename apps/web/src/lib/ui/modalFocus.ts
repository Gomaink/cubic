const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keep a custom modal in the tab order and make its sibling app surfaces inert. */
export function modalFocus(node: HTMLElement) {
  const previousFocus = document.activeElement;
  const modalRoot = node.parentElement;
  const background = Array.from(modalRoot?.parentElement?.children ?? [])
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== modalRoot)
    .map((element) => ({ element, wasInert: element.inert }));

  for (const { element } of background) element.inert = true;
  node.focus();

  function keepFocusInside(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(node.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.tabIndex >= 0
        && !element.closest('[inert], [hidden], [aria-hidden="true"]')
        && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden');
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      node.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) {
      event.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', keepFocusInside);
  return {
    destroy() {
      node.removeEventListener('keydown', keepFocusInside);
      for (const { element, wasInert } of background) element.inert = wasInert;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    }
  };
}
