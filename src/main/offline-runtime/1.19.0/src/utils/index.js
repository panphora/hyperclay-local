import throttle from "../lib/throttle.js";
import cookie from "../lib/cookie.js";
import debounce from "./debounce.js";
import slugify from "./slugify.js";
import copyToClipboard from "./copy-to-clipboard.js";

const clay = (window.clay = window.clay || {});
clay.utils = { throttle, debounce, cookie, slugify, copyToClipboard };

export default clay.utils;
