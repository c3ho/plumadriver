import { JSDOM } from 'jsdom';
import { BrowserConfig } from './BrowserConfig';
import { Pluma } from '../Types/types';
import { ELEMENT } from '../constants/constants';
import { WebElement } from '../WebElement/WebElement';
import * as Utils from '../utils/utils';
import * as PlumaError from '../Error/errors';
import { CookieValidator } from './CookieValidator';

import { Cookie } from '../jsdom_extensions/tough-cookie/lib/cookie';

/**
 * Plumadriver browser with jsdom at its core.
 * Stores user-defined config object from which to create new instances of jsdom upon
 * navigation to any given URL.
 */
class Browser {
  /** contains the user-defined jsdom configuration object for the session */
  browserConfig: BrowserConfig;
  /** the [list of known elements](https://www.w3.org/TR/webdriver1/#elements) */
  knownElements: Array<WebElement> = [];
  /** the jsdom object */
  dom: JSDOM;
  /** the user-agent's active element */
  activeElement: HTMLElement | null;

  /** accepts a capabilities object with jsdom and plumadriver specific options */
  constructor(capabilities: object) {
    const browserOptions: Pluma.BrowserOptions = {
      runScripts: '',
      strictSSL: true,
      unhandledPromptBehaviour: 'dismiss and notify',
      rejectPublicSuffixes: false,
    };

    Object.keys(browserOptions).forEach(option => {
      if (capabilities[option]) browserOptions[option] = capabilities[option];
    });

    this.browserConfig = new BrowserConfig(browserOptions);
    this.configureBrowser(this.browserConfig, null);
  }

  /**
   * Creates an empty jsdom object from a url or file path depending on the url pathType parameter value.
   * Accepts a [[BrowserConfig]] object used to configure the jsdom object
   */
  async configureBrowser(
    config: BrowserConfig,
    url: URL | null,
    pathType = 'url',
  ) {
    let dom;

    if (url !== null) {
      if (pathType === 'url') {
        dom = await JSDOM.fromURL(url, {
          resources: config.resourceLoader,
          runScripts: config.runScripts,
          beforeParse: config.beforeParse,
          pretendToBeVisual: true,
          cookieJar: config.jar,
        });
      } else if (pathType === 'file') {
        dom = await JSDOM.fromFile(url, {
          resources: config.resourceLoader,
          runScripts: config.runScripts,
          beforeParse: config.beforeParse,
          pretendToBeVisual: true,
          cookieJar: config.jar,
        });
      }

      /*  promise resolves after load event has fired. Allows onload events to execute
      before the DOM object can be manipulated  */
      const loadEvent = () =>
        new Promise(resolve => {
          dom.window.addEventListener('load', () => {
            resolve(dom);
          });
        });

      this.dom = await loadEvent();
    } else {
      this.dom = new JSDOM(' ', {
        resources: config.resourceLoader,
        runScripts: config.runScripts,
        beforeParse: config.beforeParse,
        pretendToBeVisual: true,
        cookieJar: config.jar,
      });
    }

    // webdriver-active property (W3C)
    this.dom.window.navigator.webdriver = true;
    this.activeElement = this.dom.window.document.activeElement;
  }

  /**
   * handles errors thrown by the navigation function
   */
  private handleNavigationError(error, config) {
    // the jsdom instance will otherwise crash on a 401
    if (error.statusCode === 401) {
      this.dom = new JSDOM(' ', {
        resources: config.resourceLoader,
        runScripts: config.runScripts,
        beforeParse: config.beforeParse,
        pretendToBeVisual: true,
        cookieJar: config.jar,
      });
    } else {
      throw error;
    }
  }

  /**
   * accepts a url and pathType @type {String} from which to instantiate the
   * jsdom object
   */
  async navigate(path: URL, pathType) {
    if (path) {
      try {
        await this.configureBrowser(this.browserConfig, path, pathType);
      } catch (error) {
        this.handleNavigationError(error, this.browserConfig);
      }
    }
    return true;
  }

  /**
   * Returns the current page title
   * @returns {String}
   */
  getTitle() {
    return this.dom.window.document.title;
  }

  /**
   * returns the current page url
   * @returns {String}
   */
  getUrl() {
    return this.dom.window.document.URL;
  }

  private createCookieJarOptions(
    cookie: Pluma.Cookie,
    activeDomain: string,
  ): Pluma.Cookie {
    const OPTIONAL_FIELD_DEFAULTS = {
      domain: activeDomain,
      path: '/',
      secure: false,
      httpOnly: false,
    };
    // fill in any missing fields with W3C defaults
    // https://www.w3.org/TR/webdriver/#dfn-table-for-cookie-conversion
    return { ...OPTIONAL_FIELD_DEFAULTS, ...cookie };
  }

  /**
   * clones a cookie removing the dot prefix in the domain field
   */
  private cloneCookieWithoutDomainDotPrefix(
    cookie: Pluma.Cookie,
  ): Pluma.Cookie {
    return {
      ...cookie,
      domain: cookie.domain.replace(/^\./, ''),
    };
  }

  /*
   * returns true if the cookie domain is prefixed with a dot
   */
  private isCookieDomainDotPrefixed(cookie: Pluma.Cookie): boolean {
    return cookie.domain && cookie.domain.charAt(0) === '.';
  }

  /*
   * returns true if the scheme is in an allowed format
   */
  private isValidScheme(scheme: string): boolean {
    /* include 'about' (the default JSDOM scheme) to allow
     * priming cookies prior to visiting a site
     */
    const VALID_SCHEMES = ['http', 'https', 'ftp', 'about'];
    return VALID_SCHEMES.includes(scheme);
  }

  /**
   * sets a cookie on the browser
   */
  addCookie(cookie: Pluma.Cookie): void {
    if (!this.dom.window) {
      throw new PlumaError.NoSuchWindow();
    }

    const activeUrl: string = this.getUrl();
    const activeDomain: string = Utils.extractDomainFromUrl(activeUrl);
    const scheme = activeUrl.substr(0, activeUrl.indexOf(':'));

    if (!this.isValidScheme(scheme)) {
      throw new PlumaError.InvalidArgument(`scheme "${scheme}" is invalid.`);
    }

    const shallowClonedCookie = this.isCookieDomainDotPrefixed(cookie)
      ? this.cloneCookieWithoutDomainDotPrefix(cookie)
      : { ...cookie };

    if (!CookieValidator.isValidCookie(shallowClonedCookie)) {
      throw new PlumaError.InvalidArgument();
    }

    const {
      name: key,
      expiry: expires,
      ...remainingFields
    } = this.createCookieJarOptions(shallowClonedCookie, activeDomain);

    this.dom.cookieJar.store.putCookie(
      new Cookie({
        key,
        // CookieJar only accepts a Date object here, not a number
        ...(expires ? [new Date(expires)] : []),
        ...remainingFields,
      }),
      err => {
        if (err) {
          throw new PlumaError.UnableToSetCookie(err);
        }
      },
    );
  }

  /**
   * returns all cookies in the cookie jar
   */
  getCookies(): Pluma.Cookie[] {
    const cookies = [];

    this.dom.cookieJar.serialize((err, serializedJar) => {
      if (err) throw err;
      serializedJar.cookies.forEach(cookie => {
        const currentCookie: Pluma.Cookie = { name: '', value: '' };
        Object.keys(cookie).forEach(key => {
          // renames 'key' property to 'name' for W3C compliance and selenium functionality
          if (key === 'key') currentCookie.name = cookie[key];
          else if (key === 'expires') {
            // sets the expiry time in seconds form epoch time
            // renames property for selenium functionality
            const seconds = new Date(currentCookie[key]).getTime();
            currentCookie.expiry = seconds;
          } else currentCookie[key] = cookie[key];
        });
        delete currentCookie.creation;
        cookies.push(currentCookie);
      });
    });

    return cookies;
  }

  /**
   * returns true if the cookie is associated with the current
   * browsing context's active document
   */
  private isAssociatedCookie({ path, domain }: Pluma.Cookie): boolean {
    const { pathname, hostname }: URL = new URL(this.getUrl());
    return new RegExp(`^${path}`).test(pathname) && hostname.includes(domain);
  }

  /**
   * returns the cookie in the cookie jar matching the requested name
   */
  public getNamedCookie(requestedName: string): Pluma.Cookie {
    const requestedCookie = this.getCookies().find(
      (cookie: Pluma.Cookie): boolean =>
        cookie.name === requestedName && this.isAssociatedCookie(cookie),
    );

    if (!requestedCookie) throw new PlumaError.NoSuchCookie();
    return requestedCookie;
  }

  /**
   * delete associated cookies from the cookie jar matching a regexp pattern
   */
  public deleteCookies(pattern: RegExp): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.getCookies()
        .filter(
          (cookie: Pluma.Cookie): boolean =>
            pattern.test(cookie.name) && this.isAssociatedCookie(cookie),
        )
        .forEach(({ domain, path, name }: Pluma.Cookie): void => {
          this.dom.cookieJar.store.removeCookie(domain, path, name, err => {
            if (err) reject(err);
          });
        });
      resolve();
    });
  }

  /**
   * @param elementId @type {string} the id of a known element in the known element list
   */
  getKnownElement(elementId: string): WebElement {
    let foundElement = null;
    this.knownElements.forEach(element => {
      if (element[ELEMENT] === elementId) foundElement = element;
    });
    if (!foundElement) throw new PlumaError.NoSuchElement();
    return foundElement;
  }

  /**
   * terminates all scripts and timers initiated in jsdom vm
   */
  close() {
    this.dom.window.close();
  }
}

export { Browser };
