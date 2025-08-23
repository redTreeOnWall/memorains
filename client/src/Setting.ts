import { BindableProperty } from "./utils/BindableProperty";

const memorainsSettingKey = "memorainsSettingKey";

export type SettingKeys = keyof Setting["properties"];

type SettingConfig = {
  [k in SettingKeys]?: Setting["properties"][k]["value"];
};

export class Setting {
  // TODO default value will be different when in the native client
  properties = {
    /** When this enable, the log-in panel will be hide and the app will
     * be in offlineMode by default.
     */
    offlineByDefault: new BindableProperty<boolean>(false),

    /** An save button will shows in the corner of the screen if false */
    autoSaveToLocal: new BindableProperty<boolean>(true),
  };

  colorTheme = {
    themeColorSetting: new BindableProperty<"dark" | "light" | "auto">("light"),
    systemLightColor: new BindableProperty(true),
    resultThemeColor: new BindableProperty<"dark" | "light">("light"),
  };

  constructor() {
    const settingString = localStorage.getItem(memorainsSettingKey) ?? "{}";
    const settingFromLocal = JSON.parse(settingString) as SettingConfig;

    for (const k in settingFromLocal) {
      const key = k as SettingKeys;
      const value = settingFromLocal[key];
      const p = this.properties[key];
      if (p !== undefined && value !== undefined) {
        p.value = value;
      }
    }

    for (const k in this.properties) {
      const key = k as SettingKeys;
      this.properties[key].addValueChangeListener(this.updateSetting);
    }
  }

  private updateSetting = () => {
    const settingConfigToSave: SettingConfig = {};
    for (const k in this.properties) {
      const key = k as SettingKeys;
      const value = this.properties[key].value;
      settingConfigToSave[key] = value;
    }
    localStorage.setItem(
      memorainsSettingKey,
      JSON.stringify(settingConfigToSave),
    );
  };
}
