export interface FoundElement {
  element: HTMLElement;
  x: number;
  y: number;
}

const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'summary']);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'tab', 'option', 'checkbox',
  'radio', 'textbox', 'combobox', 'listbox', 'switch',
]);

export function findByText(text: string): FoundElement | null {
  const query = text.trim().toLowerCase();

  // Collect interactive + block elements
  const candidates = document.querySelectorAll<HTMLElement>(
    'button, a, [role], input, select, textarea, label, summary, ' +
    'h1, h2, h3, h4, h5, h6, li, td, th, span, div, p'
  );

  let best: { el: HTMLElement; score: number } | null = null;

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const elText = visibleText(el).toLowerCase();
    if (!elText) continue;
    const score = score_match(elText, query, el);
    if (score > 0 && (!best || score > best.score)) {
      best = { el, score };
    }
  }

  return best ? toCentre(best.el) : null;
}

export function findByPlaceholder(text: string): FoundElement | null {
  const query = text.trim().toLowerCase();

  for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if (!isVisible(el)) continue;

    const placeholder = el.placeholder?.toLowerCase() ?? '';
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() ?? '';
    const label = labelFor(el)?.toLowerCase() ?? '';
    const ariaLabelledById = el.getAttribute('aria-labelledby');
    const ariaLabelledByText = ariaLabelledById
      ? (document.getElementById(ariaLabelledById)?.textContent ?? '').toLowerCase()
      : '';

    if (
      placeholder.includes(query) ||
      ariaLabel.includes(query) ||
      label.includes(query) ||
      ariaLabelledByText.includes(query)
    ) {
      return toCentre(el);
    }
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function score_match(elText: string, query: string, el: HTMLElement): number {
  let score = 0;

  if (elText === query) score += 100;
  else if (elText.includes(query)) score += 50;
  else return 0;

  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) score += 30;

  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) score += 20;

  // Prefer shorter/more specific matches
  score += Math.max(0, 60 - elText.length);

  return score;
}

function visibleText(el: HTMLElement): string {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const inp = el as HTMLInputElement;
    return inp.value || inp.placeholder || inp.getAttribute('aria-label') || '';
  }
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (rect.right < 0 || rect.left > window.innerWidth) return false;
  return true;
}

function toCentre(el: HTMLElement): FoundElement {
  const rect = el.getBoundingClientRect();
  return {
    element: el,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  };
}

function labelFor(el: HTMLElement): string | null {
  if (el.id) {
    const lbl = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
    if (lbl) return lbl.textContent?.trim() ?? null;
  }
  return el.closest('label')?.textContent?.trim() ?? null;
}
