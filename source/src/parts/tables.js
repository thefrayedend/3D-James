// Standard sizes used by the ready-made parts (shared by the builders and by defs.js).

/** Boards: size [length, width] and the mounting holes [x, y] from the board's lower left corner, clearance diameter. */
export const BOARDS = {
  pi4: { label: 'Raspberry Pi 5 / 4 / 3 (58 × 49 holes)', size: [85, 56], holes: [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]], d: 2.75 },
  pizero: { label: 'Raspberry Pi Zero (58 × 23 holes)', size: [65, 30], holes: [[3.5, 3.5], [61.5, 3.5], [3.5, 26.5], [61.5, 26.5]], d: 2.75 },
  pico: { label: 'Raspberry Pi Pico (47 × 11.4 holes)', size: [51, 21], holes: [[2, 4.8], [2, 16.2], [49, 4.8], [49, 16.2]], d: 2.1 },
  uno: { label: 'Arduino Uno / Leonardo', size: [68.6, 53.3], holes: [[13.97, 2.54], [15.24, 50.8], [66.04, 7.62], [66.04, 35.56]], d: 3.2 },
  mega: { label: 'Arduino Mega 2560', size: [101.6, 53.3], holes: [[13.97, 2.54], [15.24, 50.8], [66.04, 7.62], [66.04, 35.56], [90.17, 50.8], [96.52, 2.54]], d: 3.2 },
};

/** PC fans by frame size: [hole spacing, screw hole, opening]. */
export const FANS = {
  25: [20, 2.7, 22], 30: [24, 3.2, 27], 40: [32, 3.4, 37], 50: [40, 3.4, 47], 60: [50, 3.4, 56],
  70: [61.5, 3.4, 66], 80: [71.5, 4.3, 76], 92: [82.5, 4.3, 88], 120: [105, 4.3, 114], 140: [124.5, 4.3, 134],
};

/** Push-fit pneumatic fittings: [thread, hole to tap the thread into, PTFE tube bore]. */
export const FITTINGS = {
  'PC4-M5': ['M5', 4.2, 4.1], 'PC4-M6': ['M6', 5.0, 4.1], 'PC4-M10': ['M10', 9.0, 4.1], 'PC6-M10': ['M10', 9.0, 6.1], 'PC6-M12': ['M12', 10.9, 6.1],
};
