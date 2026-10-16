// Disclosure behavior adapted from web/src/account-menu.ts; auth stays in main.ts.
export function createAccountMenu(root: HTMLElement) {
  const toggle = root.querySelector<HTMLButtonElement>("#account-toggle")!;
  const panel = root.querySelector<HTMLElement>("#account-panel")!;

  function setOpen(open: boolean, restoreFocus = false) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (restoreFocus) toggle.focus();
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  toggle.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    setOpen(true);
    panel.querySelector<HTMLAnchorElement>("a")!.focus();
  });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  document.addEventListener("click", event => {
    if (!root.contains(event.target as Node | null)) setOpen(false);
  });
  root.addEventListener("focusout", event => {
    if (!root.contains(event.relatedTarget as Node | null)) setOpen(false);
  });
  panel.querySelectorAll("a").forEach(link => link.addEventListener("click", () => setOpen(false, true)));
  return { close: (restoreFocus = false) => setOpen(false, restoreFocus) };
}
