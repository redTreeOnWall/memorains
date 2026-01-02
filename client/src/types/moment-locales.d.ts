declare module "moment/locale/*" {
  const locale: { locale: string; [key: string]: unknown };
  export default locale;
}
