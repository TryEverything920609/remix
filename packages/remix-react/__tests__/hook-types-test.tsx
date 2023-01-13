import type {
  TypedDeferredData,
  TypedResponse,
} from "@remix-run/server-runtime";

import type { useLoaderData } from "../components";

function isEqual<A, B>(
  arg: A extends B ? (B extends A ? true : false) : false
): void {}

type LoaderData<T> = ReturnType<typeof useLoaderData<T>>;

describe("useLoaderData", () => {
  it("supports plain data type", () => {
    type AppData = { hello: string };
    type response = LoaderData<AppData>;
    isEqual<response, { hello: string }>(true);
  });

  it("supports plain Response", () => {
    type Loader = (args: any) => Response;
    type response = LoaderData<Loader>;
    isEqual<response, any>(true);
  });

  it("infers type regardless of redirect", () => {
    type Loader = (
      args: any
    ) => TypedResponse<{ id: string }> | TypedResponse<never>;
    type response = LoaderData<Loader>;
    isEqual<response, { id: string }>(true);
  });

  it("supports Response-returning loader", () => {
    type Loader = (args: any) => TypedResponse<{ hello: string }>;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string }>(true);
  });

  it("supports async Response-returning loader", () => {
    type Loader = (args: any) => Promise<TypedResponse<{ hello: string }>>;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string }>(true);
  });

  it("supports data-returning loader", () => {
    type Loader = (args: any) => { hello: string };
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string }>(true);
  });

  it("supports async data-returning loader", () => {
    type Loader = (args: any) => Promise<{ hello: string }>;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string }>(true);
  });
});

describe("type serializer", () => {
  it("converts Date to string", () => {
    type AppData = { hello: Date };
    type response = LoaderData<AppData>;
    isEqual<response, { hello: string }>(true);
  });

  it("supports custom toJSON", () => {
    type AppData = { toJSON(): { data: string[] } };
    type response = LoaderData<AppData>;
    isEqual<response, { data: string[] }>(true);
  });

  it("supports recursion", () => {
    type AppData = { dob: Date; parent: AppData };
    type SerializedAppData = { dob: string; parent: SerializedAppData };
    type response = LoaderData<AppData>;
    isEqual<response, SerializedAppData>(true);
  });

  it("supports tuples and arrays", () => {
    type AppData = { arr: Date[]; tuple: [string, number, Date]; empty: [] };
    type response = LoaderData<AppData>;
    isEqual<
      response,
      { arr: string[]; tuple: [string, number, string]; empty: [] }
    >(true);
  });

  it("transforms unserializables to null in arrays", () => {
    type AppData = [Function, symbol, undefined];
    type response = LoaderData<AppData>;
    isEqual<response, [null, null, null]>(true);
  });

  it("transforms unserializables to never in objects", () => {
    type AppData = { arg1: Function; arg2: symbol; arg3: undefined };
    type response = LoaderData<AppData>;
    isEqual<response, {}>(true);
  });

  it("supports class instances", () => {
    class Test {
      arg: string;
      speak: () => string;
    }
    type Loader = (args: any) => TypedResponse<Test>;
    type response = LoaderData<Loader>;
    isEqual<response, { arg: string }>(true);
  });

  it("makes keys optional if the value is undefined", () => {
    type AppData = {
      arg1: string;
      arg2: number | undefined;
      arg3: undefined;
    };
    type response = LoaderData<AppData>;
    isEqual<response, { arg1: string; arg2?: number }>(true);
  });
});

describe("deferred type serializer", () => {
  it("supports synchronous loader", () => {
    type Loader = (
      args: any
    ) => TypedDeferredData<{ hello: string; lazy: Promise<string> }>;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string; lazy: Promise<string> }>(true);
  });

  it("supports asynchronous loader", () => {
    type Loader = (
      args: any
    ) => Promise<TypedDeferredData<{ hello: string; lazy: Promise<string> }>>;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string; lazy: Promise<string> }>(true);
  });

  it("supports synchronous loader with deferred object result", () => {
    type Loader = (
      args: any
    ) => TypedDeferredData<{ hello: string; lazy: Promise<{ a: number }> }>;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string; lazy: Promise<{ a: number }> }>(true);
  });

  it("supports asynchronous loader with deferred object result", () => {
    type Loader = (
      args: any
    ) => Promise<
      TypedDeferredData<{ hello: string; lazy: Promise<{ a: number }> }>
    >;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string; lazy: Promise<{ a: number }> }>(true);
  });

  it("converts Date to string", () => {
    type Loader = (
      args: any
    ) => Promise<
      TypedDeferredData<{ hello: Date; lazy: Promise<{ a: Date }> }>
    >;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: string; lazy: Promise<{ a: string }> }>(true);
  });

  it("supports custom toJSON", () => {
    type AppData = { toJSON(): { data: string[] } };
    type Loader = (
      args: any
    ) => Promise<
      TypedDeferredData<{ hello: AppData; lazy: Promise<{ a: AppData }> }>
    >;
    type response = LoaderData<Loader>;
    isEqual<
      response,
      { hello: { data: string[] }; lazy: Promise<{ a: { data: string[] } }> }
    >(true);
  });

  it("supports recursion", () => {
    type AppData = { dob: Date; parent: AppData };
    type SerializedAppData = { dob: string; parent: SerializedAppData };
    type Loader = (
      args: any
    ) => Promise<TypedDeferredData<{ hello: AppData; lazy: Promise<AppData> }>>;
    type response = LoaderData<Loader>;
    isEqual<
      response,
      { hello: SerializedAppData; lazy: Promise<SerializedAppData> }
    >(true);
  });

  it("supports tuples and arrays", () => {
    type AppData = { arr: Date[]; tuple: [string, number, Date]; empty: [] };
    type SerializedAppData = {
      arr: string[];
      tuple: [string, number, string];
      empty: [];
    };
    type Loader = (
      args: any
    ) => Promise<TypedDeferredData<{ hello: AppData; lazy: Promise<AppData> }>>;
    type response = LoaderData<Loader>;
    isEqual<
      response,
      { hello: SerializedAppData; lazy: Promise<SerializedAppData> }
    >(true);
  });

  it("transforms unserializables to null in arrays", () => {
    type AppData = [Function, symbol, undefined];
    type SerializedAppData = [null, null, null];
    type Loader = (
      args: any
    ) => Promise<TypedDeferredData<{ hello: AppData; lazy: Promise<AppData> }>>;
    type response = LoaderData<Loader>;
    isEqual<
      response,
      { hello: SerializedAppData; lazy: Promise<SerializedAppData> }
    >(true);
  });

  it("transforms unserializables to never in objects", () => {
    type AppData = { arg1: Function; arg2: symbol; arg3: undefined };
    type Loader = (
      args: any
    ) => Promise<TypedDeferredData<{ hello: AppData; lazy: Promise<AppData> }>>;
    type response = LoaderData<Loader>;
    isEqual<response, { hello: {}; lazy: Promise<{}> }>(true);
  });

  it("supports class instances", () => {
    class Test {
      arg: string;
      speak: () => string;
    }
    type Loader = (
      args: any
    ) => Promise<TypedDeferredData<{ hello: Test; lazy: Promise<Test> }>>;
    type response = LoaderData<Loader>;
    isEqual<
      response,
      { hello: { arg: string }; lazy: Promise<{ arg: string }> }
    >(true);
  });

  it("makes keys optional if the value is undefined", () => {
    type AppData = {
      arg1: string;
      arg2: number | undefined;
      arg3: undefined;
    };
    type SerializedAppData = { arg1: string; arg2?: number };
    type Loader = (
      args: any
    ) => Promise<TypedDeferredData<{ hello: AppData; lazy: Promise<AppData> }>>;
    type response = LoaderData<Loader>;
    isEqual<
      response,
      { hello: SerializedAppData; lazy: Promise<SerializedAppData> }
    >(true);
  });
});
