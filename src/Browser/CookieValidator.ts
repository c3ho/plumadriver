import { Pluma } from '../Types/types';
import { isBoolean, isString } from '../utils/utils';

export class CookieValidator {
  static isValidName(name: string): boolean {
    return isString(name) && name !== '';
  }

  static isValidValue(value: string): boolean {
    return isString(value);
  }

  static isValidSecure(secure: boolean) {
    return secure === undefined || isBoolean(secure);
  }

  static isValidHttpOnly(httpOnly: boolean) {
    return httpOnly === undefined || isBoolean(httpOnly);
  }

  static isValidExpiry(expiry: number) {
    return (
      expiry === undefined ||
      (Number.isInteger(expiry) &&
        expiry >= 0 &&
        expiry <= Number.MAX_SAFE_INTEGER)
    );
  }

  static isValidCookie(cookie: Pluma.Cookie): boolean {
    const { name, value, httpOnly, secure, expiry } = cookie;

    if (!this.isValidName(name) || !this.isValidValue(value)) {
      return false;
    }

    return (
      this.isValidHttpOnly(httpOnly) &&
      this.isValidSecure(secure) &&
      this.isValidExpiry(expiry)
    );
  }
}
