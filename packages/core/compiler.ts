import path from "path";
import type {
  ExternalOption,
  InputOption,
  RollupBuild,
  RollupError,
  RollupOutput,
  OutputOptions,
  Plugin
} from "rollup";
import * as rollup from "rollup";
import alias from "@rollup/plugin-alias";
import babel from "@rollup/plugin-babel";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";

import { AssetManifestFilename, ServerManifestFilename } from "./build";
import type { RemixConfig } from "./config";
import { readConfig } from "./config";
import { purgeRequireCache } from "./requireCache";

import manifest from "./rollup/manifest";
import watchInput from "./rollup/watchInput";
import watchStyles from "./rollup/watchStyles";
import mdxTransform from "./rollup/mdx";
import styles from "./rollup/styles";

export enum BuildMode {
  Development = "development",
  Production = "production"
}

export enum BuildTarget {
  Browser = "browser",
  Server = "server"
}

/**
 * A Rollup build with our build options attached.
 */
export interface RemixBuild extends RollupBuild {
  options: BuildOptions;
}

function createBuild(build: RollupBuild, options: BuildOptions): RemixBuild {
  let remixBuild = (build as unknown) as RemixBuild;
  remixBuild.options = options;
  return remixBuild;
}

export interface BuildOptions {
  mode: BuildMode;
  target: BuildTarget;
}

/**
 * Runs the build.
 */
export async function build(
  config: RemixConfig,
  {
    mode = BuildMode.Production,
    target = BuildTarget.Server
  }: Partial<BuildOptions> = {}
): Promise<RemixBuild> {
  let plugins: Plugin[] = [];

  if (target === BuildTarget.Browser) {
    plugins.push(styles({ sourceDir: config.appDirectory }));
  }

  plugins.push(...getCommonPlugins(config, mode, target));

  let rollupBuild = await rollup.rollup({
    external: getExternalOption(target),
    input: getInputOption(config, target),
    plugins
  });

  return createBuild(rollupBuild, { mode, target });
}

export interface WatchOptions extends BuildOptions {
  onBuildStart: () => void;
  onBuildEnd: (build: RemixBuild) => void;
  onError: (error: RollupError) => void;
}

/**
 * Runs the build in watch mode.
 */
export function watch(
  config: RemixConfig,
  {
    mode = BuildMode.Development,
    target = BuildTarget.Browser,
    onBuildStart,
    onBuildEnd,
    onError
  }: Partial<WatchOptions> = {}
): () => void {
  let watcher = rollup.watch({
    external: getExternalOption(target),
    plugins: [
      watchInput({
        sourceDir: config.rootDirectory,
        async getInput() {
          purgeRequireCache(config.rootDirectory);
          config = await readConfig(config.rootDirectory);
          return getInputOption(config, target);
        }
      }),
      watchStyles({
        sourceDir: config.appDirectory
      }),
      ...getCommonPlugins(config, mode, target)
    ],
    watch: {
      // Skip the write here and do it in a callback instead. This gives us
      // a more consistent interface between `build` and `watch`. Both of them
      // give you access to the raw build and let you do the generate/write
      // step separately.
      skipWrite: true
    }
  });

  watcher.on("event", event => {
    if (event.code === "ERROR") {
      if (onError) {
        onError(event.error);
      } else {
        console.error(event.error);
      }
    } else if (event.code === "BUNDLE_START") {
      if (onBuildStart) onBuildStart();
    } else if (event.code === "BUNDLE_END") {
      if (onBuildEnd) {
        onBuildEnd(createBuild(event.result, { mode, target }));
      }
    }
  });

  return () => {
    watcher.close();
  };
}

function getCommonOutputOptions(build: RemixBuild): OutputOptions {
  let { mode, target } = build.options;

  return {
    format: target === BuildTarget.Server ? "cjs" : "esm",
    exports: target === BuildTarget.Server ? "named" : undefined,
    entryFileNames:
      mode === BuildMode.Production ? "[name]-[hash].js" : "[name].js",
    chunkFileNames: "[name]-[hash].js",
    assetFileNames:
      mode === BuildMode.Production
        ? "[name]-[hash][extname]"
        : "[name][extname]"
  };
}

/**
 * Creates an in-memory build. This is useful in both the asset server and the
 * main server in dev mode to avoid writing the builds to disk.
 */
export function generate(build: RemixBuild): Promise<RollupOutput> {
  return build.generate(getCommonOutputOptions(build));
}

/**
 * Writes the build to disk.
 */
export function write(
  build: RemixBuild,
  config: RemixConfig
): Promise<RollupOutput> {
  let { target } = build.options;

  let options: OutputOptions = {
    ...getCommonOutputOptions(build),
    dir:
      target === BuildTarget.Server
        ? config.serverBuildDirectory
        : config.browserBuildDirectory
  };

  return build.write(options);
}

/**
 * Runs the server build in dev as requests come in.
 */
export async function generateDevServerBuild(
  config: RemixConfig
): Promise<RollupOutput> {
  let serverBuild = await build(config, {
    mode: BuildMode.Development,
    target: BuildTarget.Server
  });

  return generate(serverBuild);
}

////////////////////////////////////////////////////////////////////////////////

function getExternalOption(target: BuildTarget): ExternalOption | undefined {
  return target === BuildTarget.Server
    ? // Ignore node_modules, bare identifiers, etc.
      (id: string) => !(id.startsWith("/") || id.startsWith("."))
    : undefined;
}

function getInputOption(config: RemixConfig, target: BuildTarget): InputOption {
  let input: { [entryName: string]: string } = {};

  if (target === BuildTarget.Browser) {
    input["entry-browser"] = path.resolve(config.appDirectory, "entry-browser");
  } else if (target === BuildTarget.Server) {
    input["entry-server"] = path.resolve(config.appDirectory, "entry-server");
  }

  for (let key in config.routeManifest) {
    let route = config.routeManifest[key];
    input[route.id] = path.resolve(config.appDirectory, route.componentFile);
  }

  return input;
}

function getCommonPlugins(
  config: RemixConfig,
  mode: BuildMode,
  target: BuildTarget
): Plugin[] {
  let plugins: Plugin[] = [];

  if (target === BuildTarget.Browser) {
    plugins.push(
      alias({
        entries: [
          {
            find: "@remix-run/react",
            replacement: path.resolve(
              config.rootDirectory,
              "node_modules/@remix-run/react/esm"
            )
          }
        ]
      })
    );
  }

  plugins.push(
    mdxTransform(config.mdx),
    babel({
      babelHelpers:
        mode === BuildMode.Development && target === BuildTarget.Server
          ? // Everything needs to be inlined into the server bundles in
            // development since they are served directly out of the build
            // in memory instead of from on disk, so there is no way they
            // can require() something else from the build.
            "inline"
          : "bundled",
      configFile: false,
      exclude: /node_modules/,
      extensions: [".js", ".ts", ".tsx", ".md", ".mdx"],
      presets: [
        "@babel/preset-react",
        ["@babel/preset-env", { targets: { node: "12" } }],
        [
          "@babel/preset-typescript",
          {
            allExtensions: true,
            isTSX: true
          }
        ]
      ]
    }),
    nodeResolve({
      extensions: [".js", ".json", ".ts", ".tsx"]
    }),
    commonjs(),
    replace({
      "process.env.NODE_ENV": JSON.stringify(mode)
    }),
    manifest({
      outputDir: config.serverBuildDirectory,
      fileName:
        target === BuildTarget.Browser
          ? AssetManifestFilename
          : ServerManifestFilename
    })
  );

  return plugins;
}
