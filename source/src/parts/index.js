// Every ready-made part builder, by shape kind (used by the geometry engine; see defs.js for the numbers).
import { gfbaseplate, gfbin } from './gridfinity.js';
import { boardhook, drawerdivider, lidbox } from './organizing.js';
import { boardposts, boardholes, fanmount, fanholes } from './electronics.js';
import { ptfehole, filamentguide, spoolaxle, bearingmount, bearingpocket } from './printer.js';
import { gt2pulley, shaftcollar, vwheel } from './motion.js';
import { hinge, dovetail, dovetailslot, peg, pegsocket, balljoint, ujoint, shafthole, boss, rib } from './joints.js';
import { knob, thumbscrew, drawerpull } from './knobs.js';
import { snapfit, tolerancetest } from './helpers.js';
import { gear, rack, worm } from './gears.js';
import { stock, cornerbracket, tnut } from './stock.js';
import { woodscrew, rivet } from './fasteners.js';
import { keyhole, screwtab, frenchcleat, cableclip, zipanchor, grommet, chainlink, footpocket, levelfoot } from './mounting.js';

export const BUILDERS = {
  gfbaseplate, gfbin, boardhook, drawerdivider, lidbox,
  boardposts, boardholes, fanmount, fanholes, ptfehole, filamentguide, spoolaxle, bearingmount, bearingpocket, gt2pulley, shaftcollar, vwheel,
  hinge, dovetail, dovetailslot, peg, pegsocket, balljoint, ujoint, shafthole, boss, rib, knob, thumbscrew, drawerpull, snapfit, tolerancetest,
  gear, rack, worm, stock, cornerbracket, tnut, woodscrew, rivet,
  keyhole, screwtab, frenchcleat, cableclip, zipanchor, grommet, chainlink, footpocket, levelfoot,
};
