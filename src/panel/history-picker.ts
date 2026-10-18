import {el, glyph} from './dom';

export interface HistoryOption {value: string; label: string; description: string}
// The native select popup is drawn by the browser/OS and cannot match the panel reliably.
// This picker only selects a journal ID supplied by the current store; it never loads or writes data.
export class HistoryPicker {
  private readonly trigger: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly value: HTMLElement;
  private readonly description: HTMLElement;
  private items: HistoryOption[] = [];
  private selected = '';
  private active = 0;

  constructor(root: HTMLElement, private readonly choose: (value: string) => void) {
    this.trigger = root.querySelector<HTMLButtonElement>('#history')!;
    this.list = root.querySelector<HTMLElement>('[role="listbox"]')!;
    this.value = root.querySelector<HTMLElement>('#history-value')!;
    this.description = root.querySelector<HTMLElement>('#history-description')!;
    this.trigger.addEventListener('click', () => this.list.hidden ? this.open() : this.close());
    this.trigger.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault(); this.open(event.key === 'ArrowUp' ? -1 : 1);
    });
    this.list.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); this.close(); return;}
      if (event.key === 'Tab') {this.close(); return;}
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = this.buttons();
      this.active = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (this.active + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[this.active]?.focus();
    });
    document.addEventListener('pointerdown', event => {if (!root.contains(event.target as Node)) this.close(false);});
  }

  update(items: HistoryOption[], selected?: string): void {
    this.close(false);
    this.items = items;
    this.selected = items.some(item => item.value === selected) ? selected! : items[0]?.value || '';
    const current = items.find(item => item.value === this.selected);
    this.value.textContent = current?.label || 'Nenhum envio disponível';
    this.description.textContent = current?.description || 'O histórico aparece após o primeiro envio.';
    this.list.replaceChildren(...items.map((item, index) => {
      const option = el('button', {class: 'history-option', attrs: {type: 'button', role: 'option', tabindex: '-1', 'aria-selected': String(item.value === this.selected)}},
        el('span', {class: 'history-option-copy'}, el('strong', {text: item.label}), el('span', {text: item.description})), glyph('check'));
      option.addEventListener('focus', () => {this.active = index;});
      option.addEventListener('click', () => {
        this.selected = item.value;
        this.value.textContent = item.label; this.description.textContent = item.description;
        for (const [i, button] of this.buttons().entries()) button.setAttribute('aria-selected', String(i === index));
        this.close(); this.choose(item.value);
      });
      return option;
    }));
    this.setDisabled(!items.length);
  }

  setDisabled(disabled: boolean): void {
    this.trigger.disabled = disabled || !this.items.length;
    if (this.trigger.disabled) this.close(false);
  }

  close(focus = true): void {
    const wasOpen = !this.list.hidden;
    this.list.hidden = true; this.trigger.setAttribute('aria-expanded', 'false');
    if (wasOpen && focus && !this.trigger.disabled) this.trigger.focus({preventScroll: true});
  }

  private buttons(): HTMLButtonElement[] {return [...this.list.querySelectorAll<HTMLButtonElement>('[role="option"]')];}
  private open(direction = 1): void {
    if (this.trigger.disabled || !this.items.length) return;
    const selected = this.items.findIndex(item => item.value === this.selected);
    this.active = selected >= 0 ? selected : direction < 0 ? this.items.length - 1 : 0;
    this.list.hidden = false; this.trigger.setAttribute('aria-expanded', 'true');
    this.buttons()[this.active]?.focus({preventScroll: true});
  }
}
