// Server-side view of file types.
//
// The logic lives in ./fileTypes, which has no server-only guard because the browser
// needs the same answers — what extension a file has, whether it is text it can open
// in an editor. Keeping one copy is what stops the two ends disagreeing about
// whether a file may be served inline.
//
// This module exists so server code keeps its guard: importing it from a client
// component fails the build rather than shipping the tables into the bundle.

import "server-only";

export * from "./fileTypes";
