const code = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
try {
  if (!/^[a-f0-9]{64}$/.test(code)) throw new Error();
  const response = await fetch(`${import.meta.env.BASE_URL}auth/canopy`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error();
  location.replace(import.meta.env.BASE_URL);
} catch {
  document.getElementById("handoff-status")!.textContent = "";
  const error = document.getElementById("handoff-error")!;
  error.textContent = "This sign-in link expired or could not be verified. Open Voice again from Canopy.";
  error.hidden = false;
  document.getElementById("handoff-return")!.hidden = false;
}
export {};
