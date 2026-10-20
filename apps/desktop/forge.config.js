const path = require("node:path");

module.exports = {
  packagerConfig: {
    name: "LazyDesk",
    executableName: "LazyDesk",
    asar: true,
    extraResource: [
      path.resolve(__dirname, "..", "web", "out"),
      path.resolve(__dirname, "..", "..", "services", "organizer", "organizer"),
    ],
    ignore: [
      /^\/apps\/desktop\/node_modules/,
      /^\/services/,
      /^\/\.git/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux", "win32"],
    },
  ],
};
