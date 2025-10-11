import { BindableProperty } from "./BindableProperty";

export class LocalStorageProperty<T extends string> {
  property: BindableProperty<T>;
  constructor(keyName: string, defaultValue: T) {
    const localValue = localStorage.getItem(keyName) as T | null;

    if (localValue === null) {
      localStorage.setItem(keyName, defaultValue);
    }

    this.property = new BindableProperty<T>(localValue ?? defaultValue);

    this.property.addValueChangeListener((v) => {
      if (v !== null) {
        localStorage.setItem(keyName, v);
      }
    });
  }
}
