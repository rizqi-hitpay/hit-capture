/**
 * Before/After toggle — lets the user compare raw vs polished cursor track.
 */
import { store, setShowRawCursor } from '../state/editorStore';

export class BeforeAfterToggle {
  private el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = container;
    this.render();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="before-after">
        <button class="ba-btn ba-btn--active" id="btn-after">Polished</button>
        <button class="ba-btn" id="btn-before">Raw</button>
      </div>
    `;

    const afterBtn = this.el.querySelector('#btn-after') as HTMLButtonElement;
    const beforeBtn = this.el.querySelector('#btn-before') as HTMLButtonElement;

    afterBtn.addEventListener('click', () => {
      setShowRawCursor(false);
      afterBtn.classList.add('ba-btn--active');
      beforeBtn.classList.remove('ba-btn--active');
    });

    beforeBtn.addEventListener('click', () => {
      setShowRawCursor(true);
      beforeBtn.classList.add('ba-btn--active');
      afterBtn.classList.remove('ba-btn--active');
    });

    store.subscribe((state) => {
      const polished = !state.showRawCursor;
      afterBtn.classList.toggle('ba-btn--active', polished);
      beforeBtn.classList.toggle('ba-btn--active', !polished);
    });
  }
}
