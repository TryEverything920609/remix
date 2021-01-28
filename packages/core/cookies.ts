import type { CookieParseOptions, CookieSerializeOptions } from "cookie";
import { parse, serialize } from "cookie";
import { sign, unsign } from "cookie-signature";

/**
 * A HTTP cookie.
 */
export interface Cookie {
  /**
   * The name of the cookie, used in the `Cookie` and `Set-Cookie` headers.
   */
  readonly name: string;

  /**
   * True if this cookie uses one or more secrets for verification.
   */
  readonly isSigned: boolean;

  /**
   * Parses a raw `Cookie` header and returns the value of this cookie or
   * `null` if it's not present.
   */
  parse(cookieHeader?: string, options?: CookieParseOptions): any;

  /**
   * Serializes the given value to a string and returns the value to be used
   * in a `Set-Cookie` header.
   */
  serialize(value: any, options?: CookieSerializeOptions): string;
}

interface CookieSignatureOptions {
  /**
   * An array of secret strings that may be used to sign/unsign the value of a
   * cookie.
   *
   * The array makes it easy to rotate secrets. New secrets should be added to
   * the beginning of the array. `cookie.serialize()` will always use the first
   * value in the array, but `cookie.parse()` may use any of them so that
   * cookies that were signed with older secrets still work.
   */
  secrets?: string[];
}

export type CookieOptions = CookieParseOptions &
  CookieSerializeOptions &
  CookieSignatureOptions;

/**
 * Creates and returns a new Cookie.
 */
export function createCookie(
  name: string,
  { secrets = [], ...options }: CookieOptions = {}
): Cookie {
  return {
    get name() {
      return name;
    },
    get isSigned() {
      return secrets.length > 0;
    },
    parse(cookieHeader, parseOptions) {
      if (!cookieHeader) return null;
      let cookies = parse(cookieHeader, { ...options, ...parseOptions });
      return name in cookies
        ? cookies[name] === ""
          ? ""
          : decodeCookieValue(cookies[name], secrets)
        : null;
    },
    serialize(value, serializeOptions) {
      return serialize(
        name,
        value === "" ? "" : encodeCookieValue(value, secrets),
        {
          ...options,
          ...serializeOptions
        }
      );
    }
  };
}

export function isCookie(object: any): object is Cookie {
  return (
    object &&
    typeof object.name === "string" &&
    typeof object.isSigned === "boolean" &&
    typeof object.parse === "function" &&
    typeof object.serialize === "function"
  );
}

function encodeCookieValue(value: any, secrets: string[]): string {
  let encoded = encodeData(value);

  if (secrets.length > 0) {
    encoded = sign(encoded, secrets[0]);
  }

  return encoded;
}

function decodeCookieValue(value: string, secrets: string[]): any {
  if (secrets.length > 0) {
    for (let secret of secrets) {
      let unsignedValue = unsign(value, secret);
      if (unsignedValue !== false) {
        return decodeData(unsignedValue);
      }
    }

    return null;
  }

  return decodeData(value);
}

function encodeData(value: any): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

function decodeData(value: string): any {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString());
  } catch (error) {
    return {};
  }
}
