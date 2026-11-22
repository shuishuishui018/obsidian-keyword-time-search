// 构建 Obsidian 插件：打包 src/main.ts -> main.js（CommonJS，obsidian 由客户端提供）
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const options = {
    entryPoints: ["src/main.ts"],
    bundle: true,
    format: "cjs",
    target: "es2018",
    platform: "browser",
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
    outfile: "main.js",
    logLevel: "info",
    sourcemap: false,
};

if (watch) {
    esbuild.context(options).then((ctx) => ctx.watch());
} else {
    esbuild.build(options).catch(() => process.exit(1));
}
