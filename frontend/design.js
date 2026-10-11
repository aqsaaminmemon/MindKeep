export function designLogo() {
  return "/logo-peach.svg";
}
export function setDesign() {
  // Migrate any previous design selection to the permanent Peach design.
  localStorage.removeItem("mindkeep-design");
  document.documentElement.dataset.design = "peach";
  document.querySelectorAll(".brand img, .small-logo img").forEach((image) => {
    image.src = designLogo();
  });
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.href = designLogo();
  const dark = document.documentElement.classList.contains("theme-dark");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#241f1c" : "#fff8f1";
}
