module.exports = {
  packagerConfig: {
    asar: true,
    // osxSign: {},
    // appCategoryType: "public.app-category.developer-tools",
    icon: "./electron/icons/icon.png",
    ignore: (path) => {
      if (
        !path ||
        path.startsWith("/electron") ||
        path === "/index.html" ||
        path.startsWith("/package.json") ||
        path.startsWith("/dist")
      ) {
        return false;
      }
      return true;
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          maintainer: "Reno Li",
          homepage: "https://note.lirunlong.com",
          icon: "./electron/icons/icon.png",
        },
      },
    },
    {
      name: "@electron-forge/maker-zip",
    },
  ],
};
