import type { AssetManifest } from "./build";
import {
  AssetManifestFilename,
  getAssetManifest,
  getServerManifest,
  getServerEntryModule,
  getRouteModules
} from "./build";
import { getCacheDir } from "./cache";
import { writeDevServerBuild } from "./compiler";
import { ServerMode } from "./config";
import type { RemixConfig } from "./config";
import type { AppLoadContext } from "./data";
import { loadGlobalData, loadRouteData, callRouteAction } from "./data";
import type { EntryManifest, ServerHandoff } from "./entry";
import {
  createEntryMatches,
  createGlobalData,
  createRouteData,
  createRouteManifest,
  createServerHandoffString
} from "./entry";
import { Headers, Request, Response, fetch } from "./fetch";
import type { ConfigRouteObject, ConfigRouteMatch } from "./match";
import { matchRoutes } from "./match";
import { json, jsonError } from "./responseHelpers";
import type { RouteManifest } from "./routes";
import { oneYear } from "./seconds";
import type { Session } from "./sessions";

/**
 * The main request handler for a Remix server. This handler runs in the context
 * of a cloud provider's server (e.g. Express on Firebase) or locally via their
 * dev tools.
 */
export interface RequestHandler {
  (
    request: Request,
    session: Session,
    loadContext?: AppLoadContext
  ): Promise<Response>;
}

/**
 * Creates a handler (aka "server") that serves HTTP requests from the app in the
 * given `remixRoot`.
 *
 * In production mode, the server reads the build from disk. In development, it
 * dynamically generates the build at request time for only the modules needed
 * to serve that request.
 */
export function createRequestHandler(remixConfig: RemixConfig): RequestHandler {
  return async (request, session, loadContext = {}) => {
    let url = new URL(request.url);

    if (url.pathname.startsWith("/_remix/data")) {
      return handleDataRequest(remixConfig, request, session, loadContext);
    }

    if (url.pathname.startsWith("/_remix/manifest")) {
      return handleManifestRequest(remixConfig, request);
    }

    return handleDocumentRequest(remixConfig, request, session, loadContext);
  };
}

async function handleDataRequest(
  remixConfig: RemixConfig,
  request: Request,
  session: Session,
  loadContext: AppLoadContext
): Promise<Response> {
  let isAction = isActionRequest(request);
  let searchParams = new URL(request.url).searchParams;
  let urlParam = searchParams.get("url");
  let loaderId = searchParams.get("id");
  let params = JSON.parse(searchParams.get("params") || "{}");

  if (!urlParam) {
    return jsonError(`Missing ?url`, 403);
  }
  if (!loaderId) {
    return jsonError(`Missing ?id`, 403);
  }

  let loaderRequest = new Request(urlParam, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  let response =
    loaderId === "_global"
      ? await loadGlobalData(
          remixConfig.dataDirectory,
          loaderRequest,
          session,
          loadContext
        )
      : isAction
      ? await callRouteAction(
          remixConfig.dataDirectory,
          remixConfig.routeManifest[loaderId],
          loaderRequest,
          session,
          loadContext,
          params
        )
      : await loadRouteData(
          remixConfig.dataDirectory,
          remixConfig.routeManifest[loaderId],
          loaderRequest,
          session,
          loadContext,
          params
        );

  if (isRedirectResponse(response)) {
    // This request is a fetch, so we don't have any way to prevent it from
    // following redirects. So we use the `X-Remix-Redirect` header to indicate
    // the next URL, and then "follow" the redirect manually on the client.
    return new Response("", {
      status: 204,
      headers: {
        "X-Remix-Redirect": response.headers.get("Location")!
      }
    });
  }

  return response;
}

async function handleManifestRequest(
  remixConfig: RemixConfig,
  request: Request
): Promise<Response> {
  let searchParams = new URL(request.url).searchParams;
  let urlParam = searchParams.get("url");

  if (!urlParam) {
    return jsonError(`Missing ?url`, 403);
  }

  let url = new URL(urlParam);
  let matches = matchRoutes(remixConfig.routes, url.pathname);

  if (!matches) {
    return jsonError(`No routes matched path "${url.pathname}"`, 404);
  }

  let assetManifest: AssetManifest;
  if (remixConfig.serverMode === ServerMode.Development) {
    let devAssetManifestPromise = getDevAssetManifest(remixConfig.publicPath);

    try {
      assetManifest = await devAssetManifestPromise;
    } catch (error) {
      return jsonError(`Unable to fetch asset manifest`, 500);
    }
  } else {
    assetManifest = getAssetManifest(remixConfig.serverBuildDirectory);
  }

  let entryManifest: EntryManifest = {
    version: assetManifest.version,
    routes: createRouteManifest(
      matches,
      assetManifest.entries,
      remixConfig.publicPath
    )
  };

  return json(entryManifest, {
    headers: {
      "Cache-Control": `public, max-age=${oneYear}`,
      ETag: entryManifest.version
    }
  });
}

async function handleDocumentRequest(
  remixConfig: RemixConfig,
  request: Request,
  session: Session,
  loadContext: AppLoadContext = {}
): Promise<Response> {
  let isAction = isActionRequest(request);
  let url = new URL(request.url);

  let statusCode = 200;
  let matches = matchRoutes(remixConfig.routes, url.pathname);

  function handleDataLoaderError(error: Error) {
    if (remixConfig.serverMode !== ServerMode.Test) {
      console.error(error);
    }

    statusCode = 500;
    matches = [
      {
        params: {},
        pathname: url.pathname,
        route: {
          path: url.pathname,
          id: "routes/500",
          componentFile: "routes/500"
        }
      }
    ];
  }

  if (!matches) {
    statusCode = 404;
    matches = [
      {
        params: {},
        pathname: url.pathname,
        route: {
          path: url.pathname,
          id: "routes/404",
          componentFile: "routes/404"
        }
      }
    ];
  }

  if (isAction) {
    let leafMatch = matches[matches.length - 1];
    let response = await callRouteAction(
      remixConfig.dataDirectory,
      remixConfig.routeManifest[leafMatch.route.id],
      request,
      session,
      loadContext,
      leafMatch.params
    );

    return response;
  }

  // Run all data loaders in parallel and await them individually below.
  let globalLoaderPromise = loadGlobalData(
    remixConfig.dataDirectory,
    request.clone(),
    session,
    loadContext
  );
  let routeLoaderPromises = matches.map(match =>
    loadRouteData(
      remixConfig.dataDirectory,
      remixConfig.routeManifest[match.route.id],
      request.clone(),
      session,
      loadContext,
      match.params
    )
  );

  let globalLoaderResponse: Response;
  try {
    globalLoaderResponse = await globalLoaderPromise;
  } catch (error) {
    globalLoaderResponse = json(null);

    console.error(`There was an error running the global data loader`);
    handleDataLoaderError(error);
  }

  let routeLoaderResponses: Response[] = [];
  for (let promise of routeLoaderPromises) {
    try {
      routeLoaderResponses.push(await promise);
    } catch (error) {
      routeLoaderResponses.push(json(null));

      let route = matches[routeLoaderResponses.length - 1].route;
      console.error(
        `There was an error running the data loader for route ${route.id}`
      );
      handleDataLoaderError(error);
    }
  }

  let allResponses = [globalLoaderResponse, ...routeLoaderResponses];

  // Check for redirect. A redirect in a loader takes precedence over all
  // other responses and is immediately returned.
  let redirectResponse = allResponses.find(isRedirectResponse);
  if (redirectResponse) {
    return redirectResponse;
  }

  // Check for a response with a non-200 status code. The first loader with a
  // non-200 status code determines the status code for the whole response.
  let notOkResponse = allResponses.find(response => response.status !== 200);
  if (notOkResponse) {
    statusCode = notOkResponse.status;
  }

  let serverBuildDirectory: string;
  let assetManifest: AssetManifest;
  if (remixConfig.serverMode === ServerMode.Development) {
    serverBuildDirectory = getCacheDir(remixConfig.rootDirectory, "build");

    let devAssetManifestPromise = getDevAssetManifest(remixConfig.publicPath);
    let devServerBuildPromise = writeDevServerBuild(
      getDevConfigForMatches(remixConfig, matches),
      serverBuildDirectory
    );

    try {
      assetManifest = await devAssetManifestPromise;
    } catch (error) {
      // TODO: Show a nice error page.
      throw error;
    }

    await devServerBuildPromise;
  } else {
    serverBuildDirectory = remixConfig.serverBuildDirectory;
    assetManifest = getAssetManifest(serverBuildDirectory);
  }

  let serverManifest = getServerManifest(serverBuildDirectory);
  let serverEntryModule = getServerEntryModule(
    serverBuildDirectory,
    serverManifest
  );
  let routeModules = getRouteModules(
    serverBuildDirectory,
    serverManifest,
    matches.map(match => match.route.id)
  );

  let entryManifest: EntryManifest = {
    version: assetManifest.version,
    routes: createRouteManifest(
      matches,
      assetManifest.entries,
      remixConfig.publicPath
    ),
    entryModuleUrl:
      remixConfig.publicPath + assetManifest.entries["entry-browser"].file,
    // TODO: When we start compiling loaders, check to see if there is a global
    // data loader. If not, this should be undefined just like routes w/out a
    // `loaderFile` property.
    globalLoaderUrl: "/_remix/data",
    globalStylesUrl:
      "global.css" in assetManifest.entries
        ? remixConfig.publicPath + assetManifest.entries["global.css"].file
        : undefined
  };
  let entryMatches = createEntryMatches(entryManifest.routes, matches);
  let globalData = await createGlobalData(globalLoaderResponse);
  let routeData = await createRouteData(routeLoaderResponses, matches);

  let serverHandoff: ServerHandoff = {
    globalData,
    manifest: entryManifest,
    matches: entryMatches,
    routeData
  };
  let serverEntryContext = {
    ...serverHandoff,
    routeModules,
    serverHandoffString: createServerHandoffString(serverHandoff)
  };

  // Calculate response headers from the matched routes.
  let headers = matches.reduce((parentsHeaders, match, index) => {
    let routeId = match.route.id;
    let routeModule = routeModules[routeId];

    if (typeof routeModule.headers === "function") {
      try {
        let response = routeLoaderResponses[index];
        let routeHeaders = routeModule.headers({
          loaderHeaders: response.headers,
          parentsHeaders
        });

        if (routeHeaders) {
          for (let [key, value] of new Headers(routeHeaders).entries()) {
            parentsHeaders.set(key, value);
          }
        }
      } catch (error) {
        console.error(
          `There was an error getting headers for route ${routeId}`
        );
        console.error(error);
      }
    }

    return parentsHeaders;
  }, new Headers());

  return serverEntryModule.default(
    request,
    statusCode,
    headers,
    serverEntryContext
  );
}

function getDevConfigForMatches(
  remixConfig: RemixConfig,
  matches: ConfigRouteMatch[]
): RemixConfig {
  return {
    ...remixConfig,

    // Modify routes and routeManifest so they contain only the matched routes.
    // This speeds up the build considerably.
    routes: matches.reduceRight((children, match) => {
      let route = { ...match.route };
      if (children.length) route.children = children;
      return [route];
    }, [] as ConfigRouteObject[]),

    routeManifest: matches.reduce((routeManifest, match) => {
      let { children, ...route } = match.route;
      routeManifest[route.id] = route;
      return routeManifest;
    }, {} as RouteManifest)
  };
}

export async function getDevAssetManifest(
  remixRunOrigin: string
): Promise<AssetManifest> {
  try {
    let res = await fetch(remixRunOrigin + AssetManifestFilename);
    return res.json();
  } catch (error) {
    console.error(error);
    console.error(
      `Unable to fetch the asset manifest. Are you running \`remix run\`?`
    );

    throw error;
  }
}

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

function isRedirectResponse(response: Response): boolean {
  return redirectStatusCodes.has(response.status);
}

function isActionRequest(request: Request): boolean {
  return request.method.toLowerCase() !== "get";
}
