// Mutual exclusion for the footer popovers (Insight / Dashboard / Postcard /
// Settings): only one is open — and only one footer button highlighted — at a
// time. Without this, which panel "wins" when two are open is an accident of
// mount order (all share z-index 156, so the later DOM sibling covers the
// earlier one).
//
// Panels stay decoupled: each registers its own close function and gets back
// a notify function to call when it opens. Nobody imports anybody else, and
// removing a panel module removes its membership with it.

const members = new Set();

/**
 * @param {() => void} close  closes this panel (must be safe when already closed)
 * @returns {() => void}      call right before/while opening; closes the others
 */
export function joinPopoverGroup(close) {
  members.add(close);
  return () => {
    members.forEach((other) => {
      if (other !== close) other();
    });
  };
}
