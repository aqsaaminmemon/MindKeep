let observer;
let frame = 0;
let listening = false;
function layout() {
  for (const grid of document.querySelectorAll(
    "#collection .notes-grid.grid",
  )) {
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    for (const card of grid.children) {
      const span = `span ${Math.ceil(card.getBoundingClientRect().height + gap)}`;
      if (card.style.gridRowEnd !== span) card.style.gridRowEnd = span;
    }
  }
}
function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    layout();
  });
}
export function refreshMasonry() {
  observer?.disconnect();
  if (!listening) {
    window.addEventListener("resize", schedule);
    listening = true;
  }
  if (window.ResizeObserver) observer ||= new ResizeObserver(schedule);
  layout();
  for (const grid of document.querySelectorAll(
    "#collection .notes-grid.grid",
  )) {
    observer?.observe(grid);
    for (const card of grid.children) observer?.observe(card);
  }
}
