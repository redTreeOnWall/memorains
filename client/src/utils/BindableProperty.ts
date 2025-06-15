type ValueChangeListener<T> = (newValue: T, oldValue: T) => void;

export class BindableProperty<T> {
  private _value: T;

  constructor(value: T) {
    this._value = value;
  }

  set value(v: T) {
    if (v === this._value) {
      return;
    }

    const oldValue = this._value;
    this._value = v;

    this.listeners.forEach((l) => {
      l(v, oldValue);
    });
  }

  get value() {
    return this._value;
  }

  private listeners = new Set<ValueChangeListener<T>>();

  addValueChangeListener(listener: ValueChangeListener<T>) {
    this.listeners.add(listener);
  }

  removeValueChangeListener(listener: ValueChangeListener<T>) {
    this.listeners.delete(listener);
  }
}
