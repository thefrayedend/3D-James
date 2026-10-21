// Where files are opened from and saved to. One app, two "drives":
//   local.js  - this computer (the browser's Open / Save windows), when 3DJames.html is opened from a folder
//   server.js - a 3DJames server, when the app was loaded from one (it then signs people in and owns the folders)
// The app finds out which at start-up (detectDrive) and from then on only talks to `drive`.
import * as local from './local.js';
import * as server from './server.js';

export let drive = local;
export async function detectDrive() {
  if (await server.connect()) drive = server;
  return drive;
}
/** A file handle kept in the browser's database, usable again (server handles come back as plain objects). */
export const reviveHandle = (handle) => (handle?.__server ? server.revive(handle) : handle);
