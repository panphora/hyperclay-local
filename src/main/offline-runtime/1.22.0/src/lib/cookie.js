// A sandboxed document (an iframe without allow-same-origin) throws a
// SecurityError on document.cookie. is-edit-mode.js reads a cookie at module
// scope, so an unguarded throw does not merely lose the cookie: it escapes the
// dynamic import the loader is awaiting and the document loses its client
// entirely. No cookies readable means no cookie, which is the honest answer.
function readCookies() {
  try {
    return document.cookie;
  } catch (err) {
    return '';
  }
}

// A cookie value that is not valid percent-encoding (a stray '%') makes
// decodeURIComponent throw URIError. Decode ONCE, outside the JSON try: the catch
// used to call it a second time on the value that had just thrown, so the second
// throw escaped — out through is-edit-mode's module-scope read, out through the
// loader's awaited import, and the document lost its client over a malformed cookie
// it never even needed.
function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

// e.g. Cookie.get("isAdminOfCurrentResource")
function get (cookieName) {
  const cookies = readCookies().split('; ');
  const cookie = cookies.find(row => row.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const cookieValue = decode(cookie.slice(cookieName.length + 1));
  try {
    return JSON.parse(cookieValue);
  } catch (err) {
    return cookieValue;
  }
}

// Writing document.cookie throws in a sandbox for the same reason reading it
// does, and there is nothing to clear there anyway.
function writeCookie(value) {
  try {
    document.cookie = value;
  } catch (err) {
    // Sandboxed: no cookie jar to clear.
  }
}

// e.g. Cookie.remove("isAdminOfCurrentResource")
function remove(name) {
  // Clear from current path
  writeCookie(`${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`)

  // Clear from every parent domain rather than a guessed apex. Joining the last
  // two labels produces `.co.uk` on editor.example.co.uk, which is a public
  // suffix: the browser rejects it and the real cookie survives. Walking every
  // suffix needs no public-suffix list, because the browser rejects exactly the
  // ones that are public suffixes, harmlessly.
  const labels = window.location.hostname.split('.');
  for (let i = 0; i < labels.length; i++) {
    writeCookie(`${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${labels.slice(i).join('.')};`);
  }
}

const cookie = {
  get,
  remove
};

export default cookie;
