import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const { handleTypes } = require("@inco/js") as typeof import("@inco/js");
export const { Lightning } = require("@inco/js/lite") as typeof import("@inco/js/lite");
